/**
 * base44.ts — Cliente Base44 para el bot de WhatsApp del Programa de Creadores.
 * ----------------------------------------------------------------------------
 * Este archivo replica, en TypeScript puro (Node.js 18+), las llamadas HTTP
 * que hace el SDK @base44/sdk desde el navegador. Se creó leyendo el código
 * del SDK instalado en la app (dist/client.js, dist/modules/entities.js,
 * dist/modules/auth.js, dist/utils/axios-client.js) para que las rutas,
 * headers y body coincidan EXACTAMENTE con los que espera el backend.
 *
 * Por qué existe este archivo
 * ---------------------------
 * El bot de WhatsApp se ejecuta en un VPS externo (Fly.io / Oracle) y NO
 * tiene acceso al SDK ni al navegador. Para que el SDK del navegador
 * funcione necesita `window`, `localStorage`, etc. Aquí reimplementamos
 * solo lo mínimo: login por email+password y CRUD de entidades
 * (Creator y CreatorVideo) usando fetch nativo de Node.
 *
 * RUTAS REALES (confirmadas en el SDK):
 *   baseURL  = `${serverUrl}/api`
 *   login    = POST   /api/apps/{APP_ID}/auth/login
 *   entities = /api/apps/{APP_ID}/entities/{Entity}
 *   me       = GET    /api/apps/{APP_ID}/entities/User/me
 *
 * HEADERS (todos obligatorios):
 *   Content-Type: application/json
 *   Accept: application/json
 *   X-App-Id: {APP_ID}              <- el backend lo exige
 *   Authorization: Bearer {token}     <- después del login
 *
 * Uninitialized-agent fallback
 * ----------------------------
 * Base44 permite "anonymous-agent access" mediante el header
 * `X-Base44-Anonymous-Id`. El SDK lo envía cuando NO hay token. Para el bot,
 * SYSADMIN crea un usuario dedicado "bot@legacy-store.com" con rol admin
 * y se usa el flujo de login normal, por lo que ese header anónimo no se usa.
 * ----------------------------------------------------------------------------
 */

// ============================================================================
// CONFIGURACIÓN — estos valores vienen de variables de entorno del VPS del bot.
// ============================================================================
export const BASE44_CONFIG = {
  /**
   * Backend real de Base44. Confirmado en la variable VITE_BASE44_BACKEND_URL.
   * NO uses aquí tu dominio custom (legacy-store.com) porque ese proxya /api;
   * apunta directo al backend para evitar doubt. El backend enruta por header
   * X-App-Id, no por dominio, así que este host sirve para cualquier app.
   */
  serverUrl: process.env.LEGACY_APP_URL || "https://base44.app",
  /** App ID real de Legacy Store (de VITE_BASE44_APP_ID). */
  appId: process.env.LEGACY_APP_ID || "6a5b9606e1931edeb474236e",
  /** Creado con invite desde el panel de admin de Base44 (ver mensaje-para-ia.txt). */
  botEmail: process.env.LEGACY_BOT_EMAIL || "narutff27@gmail.com",
  botPassword: process.env.LEGACY_BOT_PASSWORD || "",
} as const;

/** Ruta base del API: el SDK SIEMPRE antepone /api. */
const API_BASE = `${BASE44_CONFIG.serverUrl}/api`;

// ============================================================================
// TIPOS DE ENTIDADES (reflejan base44/entities/Creator.jsonc y CreatorVideo.jsonc)
// ============================================================================
export type CreatorStatus = "pending" | "approved" | "rejected";

export interface Creator {
  id: string;
  created_date?: string;
  updated_date?: string;
  name: string;
  email: string;
  whatsapp: string;
  tiktok_handle?: string;
  code?: string;
  status: CreatorStatus;
  approved_date?: string;
  notes?: string;
  panel_pin?: string;
}

export type CreatorVideoStatus =
  | "pending"
  | "approved"
  | "counting"
  | "manual"
  | "completed"
  | "rejected";

export type RewardTier = "none" | "inicial" | "intermedio" | "pro";

export interface CreatorVideo {
  id: string;
  created_date?: string;
  updated_date?: string;
  creator_email: string;
  creator_name?: string;
  whatsapp?: string;
  tiktok_url: string;
  game: string;
  game_id: string;
  code?: string;
  week_end_date?: string;
  days_active?: number;
  status: CreatorVideoStatus;
  views_initial: number;
  views_current: number;
  reward_tier: RewardTier;
  reward_label?: string;
  screenshot_url?: string;
  manual_note?: string;
  check_attempts?: number;
  view_check_error?: string;
}

// ============================================================================
// CLIENTE HTTP — sesión con token en memoria + persistencia en ~/.legacy-bot
// ============================================================================
export class Base44Client {
  private token: string | null = null;
  private tokenExpiry = 0; // ms timestamp; el backend no expone exp, así que refrescamos cada 50 min.

  /**
   * Login por email + password. Replica loginViaEmailPassword del SDK.
   * Guarda el access_token internamente para las siguientes llamadas.
   */
  async login(): Promise<void> {
    const url = `${API_BASE}/apps/${BASE44_CONFIG.appId}/auth/login`;
    const res = await fetch(url, {
      method: "POST",
      headers: this.baseHeaders(),
      body: JSON.stringify({
        email: BASE44_CONFIG.botEmail,
        password: BASE44_CONFIG.botPassword,
      }),
    });

    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      throw new Error(`Login fallido (${res.status}): ${txt}`);
    }

    const data = (await res.json()) as { access_token?: string; user?: unknown };
    if (!data.access_token) {
      throw new Error("Login respondió sin access_token");
    }
    this.token = data.access_token;
    // El backend no devuelve exp; refrescamos de forma conservadora cada 50 min.
    this.tokenExpiry = Date.now() + 50 * 60 * 1000;
    console.log("[base44] sesión iniciada como", BASE44_CONFIG.botEmail);
  }

  /** Garantiza que haya un token válido; si expiró o no existe, hace login. */
  private async ensureToken(): Promise<void> {
    if (!this.token || Date.now() > this.tokenExpiry) {
      await this.login();
    }
  }

  /** Headers base que el backend exige en TODA petición. */
  private baseHeaders(token?: string | null): Record<string, string> {
    const h: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json",
      "X-App-Id": BASE44_CONFIG.appId,
    };
    if (token) h["Authorization"] = `Bearer ${token}`;
    return h;
  }

  /**
   * Wrapper de fetch con reintento automático: si la 1ª llamada da 401,
   * hace login de nuevo y reintenta una vez. Esto cubre tokens caducados.
   */
  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    await this.ensureToken();
    const url = `${API_BASE}${path}`;
    const doFetch = async () =>
      fetch(url, {
        method,
        headers: this.baseHeaders(this.token),
        body: body ? JSON.stringify(body) : undefined,
      });

    let res = await doFetch();
    if (res.status === 401) {
      // token inválido/expirado -> refresca y reintenta una sola vez.
      console.log("[base44] 401 recibido, refrescando token...");
      await this.login();
      res = await doFetch();
    }

    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      throw new Error(`Base44 ${method} ${path} -> ${res.status}: ${txt}`);
    }
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }

  // --------------------------------------------------------------------------
  // CRUD genérico — replica createEntityHandler del SDK (dist/modules/entities.js)
  // --------------------------------------------------------------------------
  async list<E>(entity: string, sort?: string, limit?: number, skip?: number): Promise<E[]> {
    const params = new URLSearchParams();
    if (sort) params.set("sort", sort);
    if (limit) params.set("limit", String(limit));
    if (skip) params.set("skip", String(skip));
    const q = params.toString();
    return this.request<E[]>("GET", `/apps/${BASE44_CONFIG.appId}/entities/${entity}${q ? "?" + q : ""}`);
  }

  async filter<E>(entity: string, query: Record<string, unknown>, sort?: string, limit?: number, skip?: number): Promise<E[]> {
    const params = new URLSearchParams();
    params.set("q", JSON.stringify(query));
    if (sort) params.set("sort", sort);
    if (limit) params.set("limit", String(limit));
    if (skip) params.set("skip", String(skip));
    return this.request<E[]>("GET", `/apps/${BASE44_CONFIG.appId}/entities/${entity}?${params.toString()}`);
  }

  async get<E>(entity: string, id: string): Promise<E> {
    return this.request<E>("GET", `/apps/${BASE44_CONFIG.appId}/entities/${entity}/${id}`);
  }

  async create<E>(entity: string, data: Partial<E>): Promise<E> {
    return this.request<E>("POST", `/apps/${BASE44_CONFIG.appId}/entities/${entity}`, data);
  }

  async update<E>(entity: string, id: string, data: Partial<E>): Promise<E> {
    return this.request<E>("PUT", `/apps/${BASE44_CONFIG.appId}/entities/${entity}/${id}`, data);
  }

  async remove(entity: string, id: string): Promise<void> {
    return this.request<void>("DELETE", `/apps/${BASE44_CONFIG.appId}/entities/${entity}/${id}`);
  }

  // --------------------------------------------------------------------------
  // Helpers de alto nivel para el bot del Programa de Creadores
  // --------------------------------------------------------------------------
  /** Lista videos pendientes de aprobación (cola de revisión del admin). */
  pendingVideos(): Promise<CreatorVideo[]> {
    return this.filter<CreatorVideo>("CreatorVideo", { status: "pending" }, "created_date");
  }

  /** Trae un perfil de creador por su email. */
  getCreatorByEmail(email: string): Promise<Creator[]> {
    return this.filter<Creator>("Creator", { email });
  }

  /** Trae todos los videos de un creador por email. */
  videosByEmail(email: string): Promise<CreatorVideo[]> {
    return this.filter<CreatorVideo>("CreatorVideo", { creator_email: email }, "-created_date");
  }

  /** Verifica si el usuario ya tiene al menos un video aprobado (para liberar el código). */
  async hasApprovedVideo(email: string): Promise<boolean> {
    const vids = await this.filter<CreatorVideo>("CreatorVideo", {
      creator_email: email,
      status: { $in: ["approved", "counting"] },
    });
    return vids.length > 0;
  }

  /**
   * Marca un video como aprobado y empieza el conteo de vistas.
   * El bot llama esto cuando el admin responde "sí" por WhatsApp.
   */
  approveVideo(videoId: string): Promise<CreatorVideo> {
    return this.update<CreatorVideo>("CreatorVideo", videoId, {
      status: "counting",
      views_initial: 0,
      views_current: 0,
      check_attempts: 0,
    });
  }

  /** Rechaza un video con nota opcional. */
  rejectVideo(videoId: string, note: string): Promise<CreatorVideo> {
    return this.update<CreatorVideo>("CreatorVideo", videoId, {
      status: "rejected",
      manual_note: note,
    });
  }

  /**
   * Registra el conteo final de vistas a los 7 días y la recompensa calculada.
   * `tier` y `label` los calcula la lógica de recompensas (creatorRewards.js en la app).
   */
  finalizeVideo(videoId: string, views: number, tier: RewardTier, label: string): Promise<CreatorVideo> {
    return this.update<CreatorVideo>("CreatorVideo", videoId, {
      status: "completed",
      views_current: views,
      reward_tier: tier,
      reward_label: label,
    });
  }

  /** Pone el video en modo manual (la API de TikTok falló y pide captura al creador). */
  markManual(videoId: string, errorMessage: string): Promise<CreatorVideo> {
    return this.update<CreatorVideo>("CreatorVideo", videoId, {
      status: "manual",
      view_check_error: errorMessage,
    });
  }

  /** Guarda el código de creador elegido por el usuario (solo si tiene video aprobado). */
  async setCreatorCode(email: string, code: string): Promise<Creator> {
    const [existing] = await this.getCreatorByEmail(email);
    if (!existing) throw new Error("Creador no encontrado");
    return this.update<Creator>("Creator", existing.id, { code, status: "approved" });
  }

  /** Asigna (o regenera) el PIN de acceso al mini-panel web del creador. */
  async setPanelPin(email: string, pin: string): Promise<Creator> {
    const [existing] = await this.getCreatorByEmail(email);
    if (!existing) throw new Error("Creador no encontrado");
    return this.update<Creator>("Creator", existing.id, { panel_pin: pin });
  }

  /** Valida que la sesión del bot sigue activa (GET entidades/User/me). */
  async ping(): Promise<boolean> {
    try {
      await this.request("GET", `/apps/${BASE44_CONFIG.appId}/entities/User/me`);
      return true;
    } catch {
      return false;
    }
  }
}

// Singleton para que el bot reutilice la misma sesión en todos los comandos.
export const base44 = new Base44Client();

// ============================================================================
// EJEMPLO DE USO en el bot (pseudo-código del flujo principal)
// ----------------------------------------------------------------------------
//   await base44.login();
//   const pendientes = await base44.pendingVideos();
//   for (const v of pendientes) {
//     // notificar por WhatsApp al admin: "Aprobar video de {v.creator_name}? [sí/no]"
//     // si sí:
//       await base44.approveVideo(v.id);
//     // al cabo de 7 días, el cron hace:
//       const views = await fetchTikTokViews(v.tiktok_url);           // tikwm / douyin
//       const { tier, label } = calcReward(views);                     // réplica de creatorRewards
//       await base44.finalizeVideo(v.id, views, tier, label);
//   }
// ============================================================================