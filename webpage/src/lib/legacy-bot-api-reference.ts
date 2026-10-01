/**
 * legacy-bot-api-reference.ts
 * ----------------------------------------------------------------------------
 * Contrato de "API" que el bot de WhatsApp de Legacy Store implementa en su
 * VPS para poder:
 *   1) Hacer LOGIN y obtener un JWT contra Base44 (autenticación del bot).
 *   2) Verificar IDs de jugadores (Free Fire y otros) contra Mobentas.
 *   3) Consultar pagos por referencia/monto.
 *   4) Crear órdenes de recarga.
 *
 * IMPORTANTE — por qué NO se usan backend functions ni X-API-Key
 * ----------------------------------------------------------------------
 * Base44 NO permite crear funciones backend (entry.ts) en el plan actual
 * (requiere plan Builder). Por eso NO hay endpoints HTTP propios del estilo
 * /api/player/verify evaluables en el servidor de la app. PERO el bot NO los
 * necesita: la plataforma ya expone una API REST pública:
 *
 *      https://base44.app/api/apps/{APP_ID}/entities/{Entity}
 *      https://base44.app/api/apps/{APP_ID}/auth/login
 *
 * Esa API REST es la "función" que tu bot usa. Se autentica con un JWT
 * obtenido por login (email+password de la cuenta de servicio del bot), igual
 * que el navegador. El header es `Authorization: Bearer <jwt>` (no X-API-Key),
 * y funciona hoy mismo sin upgrade de plan.
 *
 * Si en el futuro activas backend functions, este mismo contrato se puede
 * envolver en entry.ts que acepten `X-API-Key: <key>` y deleguen aquí; el bot
 * no tendría que cambiar.
 *
 * Cómo lo usa el bot: copia este archivo a tu VPS (src/legacy-bot-api.ts),
 * define las variables de entorno (ver BASE44_CONFIG) y llama a los helpers
 * exportados. Ejemplos al final del archivo.
 * ----------------------------------------------------------------------------
 */

// ============================================================================
// CONFIGURACIÓN (variables de entorno del VPS del bot)
// ============================================================================
export const BASE44_CONFIG = {
  serverUrl: "https://base44.app",
  appId: process.env.LEGACY_APP_ID || "6a5b9606e1931edeb474236e",
  botEmail: process.env.LEGACY_BOT_EMAIL || "narutff27@gmail.com",
  botPassword: process.env.LEGACY_BOT_PASSWORD || "",
} as const;

const API = BASE44_CONFIG.serverUrl + "/api";
const APP = `/apps/${BASE44_CONFIG.appId}`;

// Configuración Mobentas (mismo default que usa la tienda en mobentasClient.js)
const MOBENTAS_BASE = (process.env.MOBENTAS_BASE || "https://mobentas.com").replace(/\/+$/, "");

// ============================================================================
// TIPOS mínimos
// ============================================================================
export interface JwtSession {
  token: string;
  expiresAt: number; // ms timestamp (refresco conservador a 50 min)
}

export interface Order {
  id: string;
  product_name?: string;
  product_slug?: string;
  category?: string;
  player_id?: string;
  server?: string;
  denomination?: string;
  price?: number;
  amount_paid?: number;
  balance?: number;
  payment_method?: string;
  customer_email?: string;
  bank_reference?: string;
  status?: "pending" | "processing" | "completed" | "cancelled" | "partial_payment";
  bot_product?: string;
  bot_tx_id?: string;
  created_date?: string;
}

// ============================================================================
// Cliente HTTP con sesión JWT (login + refresh automático en 401)
// ============================================================================
export class LegacyBotApi {
  private token: string | null = null;
  private expiresAt = 0;

  /** (1) LOGIN → JWT. Replica loginViaEmailPassword del SDK. */
  async login(): Promise<JwtSession> {
    const url = `${API}${APP}/auth/login`;
    const res = await fetch(url, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ email: BASE44_CONFIG.botEmail, password: BASE44_CONFIG.botPassword }),
    });
    if (!res.ok) throw new Error(`login ${res.status}: ${await res.text().catch(() => "")}`);
    const data = (await res.json()) as { access_token?: string };
    if (!data.access_token) throw new Error("login sin access_token");
    this.token = data.access_token;
    this.expiresAt = Date.now() + 50 * 60 * 1000;
    return { token: this.token, expiresAt: this.expiresAt };
  }

  /** Obtiene un JWT válido, refrescando si expiró. */
  async getJwt(): Promise<string> {
    if (!this.token || Date.now() > this.expiresAt) await this.login();
    return this.token!;
  }

  private headers(token?: string | null): Record<string, string> {
    const h: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json",
      "X-App-Id": BASE44_CONFIG.appId,
    };
    if (token) h["Authorization"] = `Bearer ${token}`;
    return h;
  }

  private async req<T>(method: string, path: string, body?: unknown): Promise<T> {
    if (!this.token || Date.now() > this.expiresAt) await this.login();
    const doFetch = () =>
      fetch(`${API}${path}`, { method, headers: this.headers(this.token), body: body ? JSON.stringify(body) : undefined });
    let res = await doFetch();
    if (res.status === 401) { await this.login(); res = await doFetch(); }
    if (!res.ok) throw new Error(`Base44 ${method} ${path} ${res.status}: ${await res.text().catch(() => "")}`);
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }

  // ---- CRUD genérico sobre entidades ------------------------------------
  private filter<E>(entity: string, q: Record<string, unknown>, sort?: string, limit?: number): Promise<E[]> {
    const p = new URLSearchParams(); p.set("q", JSON.stringify(q));
    if (sort) p.set("sort", sort);
    if (limit) p.set("limit", String(limit));
    return this.req<E[]>("GET", `${APP}/entities/${entity}?${p}`);
  }
  private get<E>(entity: string, id: string): Promise<E> {
    return this.req<E>("GET", `${APP}/entities/${entity}/${id}`);
  }
  private create<E>(entity: string, data: Partial<E>): Promise<E> {
    return this.req<E>("POST", `${APP}/entities/${entity}`, data);
  }
  private update<E>(entity: string, id: string, data: Partial<E>): Promise<E> {
    return this.req<E>("PUT", `${APP}/entities/${entity}/${id}`, data);
  }

  // ========================================================================
  // (2) VERIFICAR ID DE JUGADOR  →  POST Mobentas wp-admin/admin-ajax.php
  //     Desde el VPS no hay CORS, así que se llama directo (sin proxy).
  //     Mismo action map que usa la tienda (mobentasClient.VERIFY_MAP).
  // ========================================================================
  private static VERIFY_MAP: Record<string, { action: string; zid: boolean }> = {
    "free-fire": { action: "mobentas_user_verify_free", zid: false },
    "blood-strike": { action: "mobentas_user_verify_blood", zid: false },
    "mobile-legends": { action: "mobentas_user_verify", zid: true },
    "genshin-impact": { action: "mobentas_user_verify_ganshin", zid: true },
    "farlight-84": { action: "mobentas_user_verify_farlight", zid: false },
  };

  async verifyPlayer(game: string, playerId: string, server?: string): Promise<{ success: boolean; name?: string; playerId: string; error?: string }> {
    const v = LegacyBotApi.VERIFY_MAP[game];
    if (!v) return { success: false, playerId, error: `Juego "${game}" no soportado para verificación` };

    const body = new URLSearchParams({ action: v.action, id: String(playerId).trim() });
    if (v.zid && server) body.set("zid", String(server).trim());

    const res = await fetch(`${MOBENTAS_BASE}/wp-admin/admin-ajax.php`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
      signal: AbortSignal.timeout(15_000),
    }).catch(() => null);

    if (!res || !res.ok) return { success: false, playerId, error: "Mobentas no respondió" };

    let data: any;
    try { data = await (res as Response).json(); } catch { return { success: false, playerId, error: "Respuesta inválida de Mobentas" }; }

    const pick = (o: any): string => {
      if (!o || typeof o !== "object") return "";
      const cands = [o.nickname, o.name, o.response, o.usuario, o.player_name, o.user, o.player, o.message];
      return cands.map((v) => (v == null ? "" : String(v).trim())).find((x) => !!x) || "";
    };
    const nick = typeof data === "string" ? data.trim() : pick(data);
    if (nick) return { success: true, name: nick, playerId };
    const resp = String(typeof data === "object" ? (data?.response ?? data?.message ?? "") : data).trim();
    const invalid = /incorrect|not found|inv[aá]lid|no est|failed|error/i.test(resp);
    return { success: false, playerId, error: invalid ? resp : resp || "ID no encontrado" };
  }

  // ========================================================================
  // (3) CONSULTAR PAGO  →  GET Order por bank_reference
  //     Verifica si existe una orden con esa referencia y, si se pasó amount,
  //     que el monto pagado cubra ese valor.
  // ========================================================================
  async checkPayment(reference: string, amount?: number): Promise<{ verified: boolean; amount?: number; reference: string; timestamp?: string; orderId?: string }> {
    if (!reference) return { verified: false, reference };
    const recs = await this.filter<Order>("Order", { bank_reference: String(reference) }, "-created_date", 10);
    if (!recs.length) return { verified: false, reference };

    // Toma la orden más reciente con esa referencia.
    const ord = recs[0];
    const paid = Number(ord.amount_paid ?? 0) || 0;
    const price = Number(ord.price ?? 0) || 0;
    const okAmount = amount == null ? paid > 0 : paid >= amount - 0.01;
    const verified = okAmount && ["processing", "completed", "partial_payment"].includes(ord.status || "");
    return {
      verified,
      amount: paid || price,
      reference: String(reference),
      timestamp: ord.created_date || ord.updated_date || new Date().toISOString(),
      orderId: ord.id,
    };
  }

  // ========================================================================
  // (4) CREAR ORDEN  →  POST Order
  //     El bot arma el payload con product_name/slug/player_id/etc. y lautí lo
  //     deja en status "pending" igual que el flujo web de Comprar.jsx.
  // ========================================================================
  async createOrder(input: {
    game: string;          // ej: "free-fire", "blood-strike"
    playerId: string;
    packageId: string;     // denomination/etiqueta, ej: "pase_booyah"
    paymentMethod: string; // ej: "pagomovil"
    source?: string;       // ej: "whatsapp_bot"
    email?: string;
    server?: string;
    productName?: string;
    productSlug?: string;
    price?: number;
  }): Promise<{ success: boolean; orderId?: string; status: string; error?: string }> {
    try {
      const created = await this.create<Order>("Order", {
        product_name: input.productName || input.packageId,
        product_slug: input.productSlug || input.game,
        category: "Recarga",
        player_id: String(input.playerId),
        server: input.server || "",
        denomination: input.packageId,
        price: Number(input.price ?? 0),
        amount_paid: 0,
        balance: Number(input.price ?? 0),
        payment_method: input.paymentMethod,
        customer_email: input.email || "",
        bank_reference: "",
        status: "pending",
      } as Partial<Order>);
      // El campo "source" no existe en la entidad Order; lo registramos en
      // bot_product para auditoría del admin (igual que el flujo automático).
      if (input.source) {
        await this.update<Order>("Order", created.id, { bot_product: input.source } as Partial<Order>);
      }
      return { success: true, orderId: created.id, status: "pending" };
    } catch (e: any) {
      return { success: false, status: "error", error: e?.message || "create failed" };
    }
  }

  // ========================================================================
  // (EXTRA) Verificación REAL de pago contra el banco vía Pabilo.
  //         Igual que pabiloClient.js de la web, SOLO aceptamos is_new: true.
  //         Sin esto, el bot entregaría recargas sin haber recibido el pago.
  // ========================================================================
  private async readSetting(key: string): Promise<string> {
    const recs = await this.filter<{ value?: string }>("Setting", { key });
    return recs?.[0]?.value || "";
  }

  async verifyPaymentPabilo(bankReference: string, amount: number): Promise<{ verified: boolean; amount?: number; error?: string }> {
    const ref = String(bankReference || "").trim();
    if (!/^\d{6,9}$/.test(ref)) return { verified: false, error: "Referencia inválida" };
    const amt = +Number(amount || 0).toFixed(2);
    if (amt <= 0) return { verified: false, error: "Monto inválido" };

    let pabilo: any = {};
    try { pabilo = JSON.parse((await this.readSetting("pabilo")) || "{}"); } catch {}
    const apiKey = String(pabilo.api_key || pabilo.appKey || "").trim();
    const userBankId = String(pabilo.user_bank_id || pabilo.userBankId || pabilo.account_id || "").trim();
    if (!apiKey || !userBankId) return { verified: false, error: "Pabilo no configurado" };

    const payload: any = { bank_reference: ref, amount: amt };
    if (pabilo.movement_type) payload.movement_type = pabilo.movement_type;
    if (pabilo.bank_origin) payload.bank_origin = pabilo.bank_origin;

    try {
      const res = await fetch(`https://api.pabilo.app/userbankpayment/${userBankId}/betaserio`, {
        method: "POST",
        headers: { "Content-Type": "application/json", appKey: apiKey },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(20_000),
      });
      if (!res.ok) return { verified: false, error: `Pabilo HTTP ${res.status}` };
      let data: any; try { data = await res.json(); } catch { return { verified: false, error: "Respuesta inválida de Pabilo" }; }
      // Solo confirmamos cuando Pabilo lo dice de forma explícita.
      if (data?.is_new === true) return { verified: true, amount: amt };
      if (data?.is_new === false) return { verified: false, error: "Referencia ya utilizada" };
      return { verified: false, error: "Pabilo no confirmó is_new" };
    } catch (e: any) {
      return { verified: false, error: e?.message || "Pabilo no respondió" };
    }
  }

  // ========================================================================
  // (EXTRA) Marcar orden como entregada  →  PUT Order status=completed
  //   SEGURIDAD: verifica el pago REAL contra el banco (Pabilo) antes de
  //   marcar completado. Rechaza referencias inválidas o pagos no verificados.
  // ========================================================================
  async deliverOrder(orderId: string, botTxId?: string): Promise<{ success: boolean; orderId: string; status: string; error?: string }> {
    const ord = await this.get<Order>("Order", orderId);
    if (!ord) return { success: false, orderId, status: "pending", error: "Orden no encontrada" };
    if (!ord.bank_reference || !/^\d{6,9}$/.test(ord.bank_reference))
      return { success: false, orderId, status: ord.status || "pending", error: "Referencia bancaria inválida o ausente" };
    const payoff = await this.verifyPaymentPabilo(ord.bank_reference, Number(ord.price ?? 0));
    if (!payoff.verified) return { success: false, orderId, status: ord.status || "pending", error: payoff.error || "Pago no verificado" };

    const updated = await this.update<Order>("Order", orderId, {
      status: "completed",
      amount_paid: payoff.amount ?? Number(ord.price ?? 0),
      ...(botTxId ? { bot_tx_id: botTxId } : {}),
    } as Partial<Order>);
    return { success: true, orderId: updated.id, status: "completed" };
  }

  // ========================================================================
  // (EXTRA) Listar órdenes (admin)  →  GET Order con filtro de estado
  // ========================================================================
  async listOrders(status?: string, limit = 50): Promise<Order[]> {
    const q = status ? { status } : {};
    return this.filter<Order>("Order", q, "-created_date", limit);
  }

  /** Valida que la sesión sigue activa (GET /User/me). */
  async ping(): Promise<boolean> {
    try { await this.req("GET", `${APP}/entities/User/me`); return true; } catch { return false; }
  }
}

// Singleton para reutilizar sesión entre comandos del bot.
export const botApi = new LegacyBotApi();

// ============================================================================
// EJEMPLO DE USO en el bot
// ----------------------------------------------------------------------------
//   await botApi.login();
//   const jwt = await botApi.getJwt();           // (1) JWT listo
//
//   const v = await botApi.verifyPlayer("free-fire", "1234567890");
//   // → { success: true, name: "NOMBRE★彡", playerId: "1234567890" }
//
//   const p = await botApi.checkPayment("123456", 5.01);
//   // → { verified: true, amount: 5.01, reference: "123456", timestamp, orderId }
//
//   const o = await botApi.createOrder({
//     game: "free-fire", playerId: "1234567890", packageId: "pase_booyah",
//     paymentMethod: "pagomovil", source: "whatsapp_bot", price: 5.01,
//   });
//   // → { success: true, orderId: "65f...", status: "pending" }
//
//   await botApi.deliverOrder(o.orderId, "TX-9999");
// ============================================================================