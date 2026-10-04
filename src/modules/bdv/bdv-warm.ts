/**
 * Lector de movimientos por "sesion caliente" de BDVenlinea.
 *
 * El verificador con navegador (bdv.browser.ts) tiene un problema real: raspa
 * la tabla del portal, y esa tabla cambia cada vez que el banco toca una
 * palabra. Cuando el parser queda obsoleto devuelve 0 movimientos y el sistema
 * lo traduce a "no se encontro el pago" = rechazo falso a un cliente que si
 * pago. Es el fallo mas caro que tiene esta tienda.
 *
 * Este lector evita el scraping por completo. El portal de personas tiene una
 * API JSON propia que usa su propia SPA; verificadas contra el bundle real
 * (main.66b40745d1bdf6825841.js):
 *
 *   GET  /movimientoscuenta/movimientosCuenta/<cuenta>   (Bearer)
 *   POST /oauthaccess/actualizar                        (refresh)
 *
 * Que el banco existe y responde JSON no es una suposicion: la ruta esta
 * literal en el bundle y sin token devuelve 401 con
 * `WWW-Authenticate: Bearer realm="BDVENLINEA"`.
 *
 * NO se automatiza el login. El login del portal es multi-paso, depende de una
 * huella de dispositivo cifrada y el banco bloquea la cuenta tras pocos
 * intentos fallidos. La sesion se captura UNA vez a mano (el titular inicia
 * sesion en su navegador y resuelve su segundo factor) y aqui solo se
 * reutiliza lo que ya esta autorizado. El riesgo de esa cuenta es del
 * titular, no del codigo.
 */

import { env } from "../../config/env.js";
import { amountsMatch, parseBs, referencesMatch } from "./bdv-match.js";
import type { BdvMovement } from "./bdv.browser.js";

/**
 * Fallo al hablar con el banco. Se distingue de "no hay movimientos" porque
 * son cosas opuestas: una es que el banco no respondio, la otra que si
 * respondio y no pago. Confundirlas produce el rechazo falso.
 */
export class BdvSessionError extends Error {
  readonly code = "BDV_SESSION_FAILED";
  /** HTTP status del banco, si lo hubo. */
  readonly status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = "BdvSessionError";
    this.status = status;
  }
}

export interface BdvWarmOptions {
  baseUrl: string;
  account: string;
  accessToken: string;
  refreshToken: string;
  /** Huella de dispositivo que el portal manda en la cabecera "Rip". */
  rip: string;
  xsrfToken?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

/** "2026-10-04" | "04/10/2026" -> "2026-10-04" | null */
export function parseIsoDate(raw: unknown): string | null {
  if (raw == null || raw === "") return null;
  const text = String(raw).trim().slice(0, 19);
  let m = text.match(/^(\d{4})[-/](\d{2})[-/](\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = text.match(/^(\d{2})[-/](\d{2})[-/](\d{4})/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  return null;
}

/**
 * Busca la lista de movimientos dentro de la respuesta.
 *
 * Se recorre en profundidad a proposito: no se sabe si el banco devuelve el
 * array en la raiz, bajo "data", o anidado en un campo con otro nombre. Ante la
 * duda se busca en todas partes, porque devolver [] por no haber adivinado la
 * clave es exactamente el fallo que estamos intentando evitar.
 */
export function findMovements(payload: unknown): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  const seen = new Set<unknown>();
  const walk = (node: unknown, depth: number): void => {
    if (depth > 6 || node == null || typeof node !== "object") return;
    if (seen.has(node)) return;
    seen.add(node);
    if (Array.isArray(node)) {
      for (const item of node) {
        if (item && typeof item === "object" && !Array.isArray(item)) out.push(item as Record<string, unknown>);
      }
      return;
    }
    for (const value of Object.values(node as Record<string, unknown>)) walk(value, depth + 1);
  };
  walk(payload, 0);
  return out;
}

/**
 * Convierte un movimiento del JSON del banco al formato interno.
 *
 * Los nombres de campo se prueban en varios idiomas porque el portal es
 * bilingue y la respuesta depende de la configuracion del navegador del
 * titular, no de la peticion.
 */
export function normalizeMovement(raw: Record<string, unknown>): BdvMovement {
  const pick = (...keys: string[]): unknown => {
    for (const key of keys) {
      const value = raw[key];
      if (value !== undefined && value !== null && value !== "") return value;
    }
    return undefined;
  };
  const reference = pick("referencia", "reference", "nroReferencia", "numeroReferencia", "referenciaBancaria", "bankReference");
  const amount = pick("monto", "amount", "importe", "montoOperacion", "valor", "haber");
  const date = pick("fecha", "date", "fechaOperacion", "fechaMovimiento", "fechaValor");
  const description = pick("descripcion", "description", "concepto", "detalle", "tipo");
  // El signo del movimiento no siempre viene en su propio campo: suele venir
  // dentro del tipo o la descripcion ("DEBITO", "CREDITO", "ABONO"). Se busca
  // en todos los textos y se normalizan los acentos, porque el banco escribe
  // "DÉBITO" con tilde unas veces y sin ella otras.
  const flowText = Object.values(raw)
    .filter((v) => typeof v === "string")
    .join(" ")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase();
  const flow = flowText.match(/DEBITO|CREDITO|ABONO|CARGO/)?.[0] ?? "";
  return {
    reference: reference === undefined ? null : String(reference).replace(/\D/g, "") || null,
    amount: parseBs(amount),
    date: date === undefined ? null : String(date),
    description: description === undefined ? null : String(description),
    // Solo los abonos. Contar los debitos daria por pagado lo que el titular
    // NUNCA ha enviado: es el error que hace que una tienda entregue gratis.
    // Sin dato de signo se asume abono: es lo que hace el portal, y descartar
    // aqui seria peor que arriesgar (el chequeo real es referencia + monto).
    incoming: flow ? flow !== "DEBITO" && flow !== "CARGO" : true,
  };
}

export type BdvWarmVerdict =
  | { kind: "verified"; movement: BdvMovement }
  | { kind: "amount_mismatch"; movement: BdvMovement; target: number }
  | { kind: "not_found"; checked: number }
  | { kind: "pending"; reason: string };

/**
 * Cliente de sesion caliente.
 *
 * Se instancia una vez (singleton) porque el refresh debe ser single-flight: si
 * llegan diez verificaciones con la sesion caducada, las diez reciben el mismo
 * token nuevo en vez de disparar diez refreshes contra el banco.
 */
export class BdvWarmClient {
  private session: { accessToken: string; refreshToken: string };
  private refreshing: Promise<boolean> | null = null;

  constructor(private readonly opts: BdvWarmOptions) {
    this.session = { accessToken: opts.accessToken, refreshToken: opts.refreshToken };
  }

  private get doFetch(): typeof fetch {
    return this.opts.fetchImpl ?? fetch;
  }

  /** true si hay los datos minimos para leer movimientos. */
  get configured(): boolean {
    return Boolean(this.opts.account && this.session.accessToken);
  }

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    return {
      Accept: "application/json",
      Authorization: `Bearer ${this.session.accessToken}`,
      ...(this.opts.rip ? { Rip: this.opts.rip } : {}),
      ...(this.opts.xsrfToken ? { "X-XSRF-TOKEN": this.opts.xsrfToken } : {}),
      ...extra,
    };
  }

  /**
   * Refresca el access token una sola vez, aunque la llamen manyas
   * verificaciones al tiempo. Nunca lanza: si el refresh falla, la peticion que
   * lo provoke dara 401 y entonces si se propaga el error, porque un refresh
   * fallido NO significa que la sesion este muerta todavia.
   */
  private async refresh(): Promise<boolean> {
    if (this.refreshing) return this.refreshing;
    if (!this.session.refreshToken) return false;
    this.refreshing = (async () => {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), this.opts.timeoutMs ?? 15_000);
      try {
        const res = await this.doFetch(`${this.opts.baseUrl.replace(/\/$/, "")}/oauthaccess/actualizar`, {
          method: "POST",
          headers: this.headers({ "Content-Type": "application/json" }),
          body: JSON.stringify({ refresh_token: this.session.refreshToken, factor3: "true" }),
          signal: ctrl.signal,
        });
        if (!res.ok) return false;
        const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
        const data = (body?.data ?? body) as Record<string, unknown> | undefined;
        // El portal alterna camelCase y snake_case entre endpoints.
        const access = data?.accessToken ?? data?.access_token;
        const refreshTok = data?.refreshToken ?? data?.refresh_token;
        if (typeof access === "string" && access) this.session.accessToken = access;
        if (typeof refreshTok === "string" && refreshTok) this.session.refreshToken = refreshTok;
        return Boolean(access);
      } catch {
        return false;
      } finally {
        clearTimeout(timer);
      }
    })().finally(() => {
      this.refreshing = null;
    });
    return this.refreshing;
  }

  private async request(method: string, path: string, retry = true): Promise<unknown> {
    const url = this.opts.baseUrl.replace(/\/$/, "") + path;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.opts.timeoutMs ?? 15_000);
    let res: Response;
    try {
      res = await this.doFetch(url, {
        method,
        headers: this.headers(),
        signal: ctrl.signal,
      });
    } catch (error) {
      // Aqui SÍ se propaga: no hubo respuesta del banco, y "no responde" jamas
      // debe convertirse en "el cliente no pago".
      throw new BdvSessionError(`BDV no responde: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      clearTimeout(timer);
    }
    if (res.status === 401 && retry) {
      const ok = await this.refresh();
      if (ok) return this.request(method, path, false);
    }
    if (res.status >= 400) {
      const text = await res.text().catch(() => "");
      throw new BdvSessionError(`BDV HTTP ${res.status}: ${text.slice(0, 200)}`, res.status);
    }
    return res.json().catch(() => null);
  }

  /** Lee los movimientos de la cuenta. Lanza si el banco no responde. */
  async listMovements(): Promise<BdvMovement[]> {
    if (!this.configured) throw new BdvSessionError("sesion BDV sin configurar (falta cuenta o token)");
    const payload = await this.request("GET", `/movimientoscuenta/movimientosCuenta/${encodeURIComponent(this.opts.account)}`);
    return findMovements(payload)
      .map(normalizeMovement)
      .filter((m) => m.reference !== null && m.amount !== null && m.amount > 0);
  }

  /**
   * Decide el veredicto de una referencia.
   *
   * La parte importante es el final: cuando el banco responde bien y no hay
   * ningun movimiento con esa referencia, NO se afirma que el cliente no pago.
   * Se devuelve "pending": el pago movil puede tardar segundos en reflejarse,
   * y un "no existe" en ese momento es el rechazo falso que ya costo una
   * venta. El llamador decide cuando dejarlo de esperar.
   */
  static evaluate(movements: BdvMovement[], reference: string, target: number): BdvWarmVerdict {
    const candidates = movements.filter((m) => m.reference && referencesMatch(m.reference, reference));
    for (const movement of candidates) {
      if (amountsMatch(movement.amount, target)) return { kind: "verified", movement };
    }
    // Hay referencia pero el monto no cuadra: se distingue de "no existe"
    // para que la tienda pueda decir "pagaste otro monto".
    if (candidates.length) {
      return { kind: "amount_mismatch", movement: candidates[0], target };
    }
    if (movements.length === 0) {
      return { kind: "pending", reason: "el banco respondio pero todavia no muestra movimientos" };
    }
    return { kind: "not_found", checked: movements.length };
  }

  /** Lee y evalua en una sola pasada. */
  async verify(reference: string, target: number): Promise<BdvWarmVerdict> {
    return BdvWarmClient.evaluate(await this.listMovements(), reference, target);
  }
}

let singleton: BdvWarmClient | null = null;

/** Cliente caliente compartido, o null si no hay sesion configurada. */
export function getBdvWarmClient(): BdvWarmClient | null {
  if (!env.BDV_SESSION_ACCESS_TOKEN || !env.BDV_SESSION_ACCOUNT) return null;
  if (!singleton) {
    singleton = new BdvWarmClient({
      baseUrl: env.BDV_BASE_URL,
      account: env.BDV_SESSION_ACCOUNT,
      accessToken: env.BDV_SESSION_ACCESS_TOKEN,
      refreshToken: env.BDV_SESSION_REFRESH_TOKEN,
      rip: env.BDV_SESSION_RIP,
      xsrfToken: env.BDV_SESSION_XSRF || undefined,
      timeoutMs: env.BDV_SESSION_TIMEOUT_MS,
    });
  }
  return singleton;
}

/** Util para tests y para reiniciar el cliente tras cambiar la sesion. */
export function resetBdvWarmClient(): void {
  singleton = null;
}
