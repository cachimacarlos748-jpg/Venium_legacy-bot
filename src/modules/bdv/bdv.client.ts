import { env } from "../../config/env.js";

/**
 * Cliente de verificación de pagos para BDVenlínea (Banco de Venezuela).
 *
 * Los bancos venezolanos no publican APIs, pero la web de BDV es una SPA
 * Angular que consume su propia API REST. Este cliente habla directamente con
 * esos endpoints en vez de automatizar el navegador: es mas rapido, no depende
 * del diseño de las pantallas y no se rompe cuando cambian los estilos.
 *
 * Misma interfaz que el cliente de Pabilo, para poder cambiar de proveedor sin
 * tocar el pipeline de pagos.
 */

export interface BdvPaymentResult {
  verified: boolean;
  isNew: boolean;
  status: "verified_new" | "duplicate" | "not_found" | "bank_unavailable" | "error";
  raw: unknown;
}

export interface BdvMovement {
  reference: string | null;
  amount: number | null;
  date: string | null;
  description: string | null;
}

export interface BdvClient {
  verifyPayment(input: { amount: string; bankReference: string }): Promise<BdvPaymentResult>;
  listMovements(input?: { days?: number }): Promise<BdvMovement[]>;
}

// Endpoints de movimientos que expone la SPA, en orden de preferencia.
const MOVEMENT_ENDPOINTS = [
  "/movementsonline/v1/movementsonline",
  "/movimientoscuentaenlinea/movimientosCuentaEnLinea",
  "/movimientoscuenta/movimientosCuenta/",
  "/historicooperaciones/historicoOperaciones",
];

// Estrategias de login, en orden. La SPA usa OAuth (identity/oauth/token) y
// tambien expone la ruta legacy de loginunico; probamos ambas porque el orden
// de uso cambia segun la version del portal.
const LOGIN_STRATEGIES: Array<{ path: string; build: (u: string, p: string) => { body: string | undefined; contentType: string } }> = [
  {
    path: "/identity/oauth/token",
    build: (u, p) => ({
      contentType: "application/x-www-form-urlencoded",
      body: new URLSearchParams({
        grant_type: "password",
        client_id: "bdvenlinea",
        username: u,
        password: p,
      }).toString(),
    }),
  },
  {
    path: "/loginunico/validarUsuarioUnico",
    build: (u, p) => ({
      contentType: "application/json",
      body: JSON.stringify({ usuario: u, clave: p, password: p }),
    }),
  },
  {
    path: "/loginunico/consultarUsuario",
    build: (u, p) => ({
      contentType: "application/json",
      body: JSON.stringify({ usuario: u, clave: p, password: p }),
    }),
  },
];

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

/** Extrae los valores de Set-Cookie, ignorando atributos. */
function parseCookies(headers: Headers, jar: Map<string, string>): void {
  const raw = typeof (headers as any).getSetCookie === "function"
    ? (headers as any).getSetCookie()
    : [headers.get("set-cookie")].filter(Boolean);
  for (const line of raw as string[]) {
    const [pair] = line.split(";");
    const idx = pair.indexOf("=");
    if (idx <= 0) continue;
    jar.set(pair.slice(0, idx).trim(), pair.slice(idx + 1).trim());
  }
}

function cookieHeader(jar: Map<string, string>): string {
  return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
}

/** "18.500,00" | "18500.00" | "1.250,5" -> number */
export function parseBs(raw: unknown): number | null {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  if (typeof raw !== "string") return null;
  let value = raw.replace(/[^\d.,-]/g, "");
  if (!value || value === "-") return null;
  const lastComma = value.lastIndexOf(",");
  const lastDot = value.lastIndexOf(".");
  if (lastComma > -1 && lastComma > lastDot) {
    // Formato venezolano: puntos son miles, coma es decimal.
    value = value.replace(/\./g, "").replace(",", ".");
  } else if (lastDot > -1) {
    value = value.replace(/,/g, "");
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

// Nombres de campo que suelen aparecer en las respuestas del banco. Los buscamos de
// forma tolerante porque el portal cambia nombres entre versiones.
const AMOUNT_KEYS = ["monto", "importe", "valor", "amount", "montoOperacion", "montoBs", "total"];
const REFERENCE_KEYS = ["referencia", "reference", "ref", "referenciaOperacion", "numReferencia", "referenciaC2P", "codigo", "comprobante"];
const DATE_KEYS = ["fecha", "fechaOperacion", "fechaValor", "date", "fechaTransaccion"];
const DESC_KEYS = ["descripcion", "description", "concepto", "movimiento", "tipoMovimiento", "detalle"];

/**
 * Recorre el JSON buscando objetos que parezcan un movimiento bancario y los
 * normaliza. En vez de fijar una ruta exacta en el JSON (que el banco puede
 * cambiar), buscamos "el primer objeto que tenga monto y referencia".
 */
export function extractMovements(payload: unknown): BdvMovement[] {
  const found: BdvMovement[] = [];
  const seen = new Set<string>();

  const pick = (obj: Record<string, unknown>, keys: string[]): unknown => {
    for (const key of keys) {
      if (obj[key] !== undefined && obj[key] !== null && obj[key] !== "") return obj[key];
    }
    return undefined;
  };

  const visit = (node: unknown, depth: number): void => {
    if (depth > 8 || node === null || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const item of node) visit(item, depth + 1);
      return;
    }
    const obj = node as Record<string, unknown>;

    const amount = parseBs(pick(obj, AMOUNT_KEYS));
    const refRaw = pick(obj, REFERENCE_KEYS);
    if (amount !== null && refRaw !== undefined) {
      const reference = String(refRaw).replace(/\D/g, "") || null;
      const date = pick(obj, DATE_KEYS);
      const desc = pick(obj, DESC_KEYS);
      const key = `${reference ?? "noref"}|${amount}|${date ?? ""}`;
      if (!seen.has(key)) {
        seen.add(key);
        found.push({
          reference,
          amount,
          date: date === undefined ? null : String(date),
          description: desc === undefined ? null : String(desc),
        });
      }
    }
    for (const value of Object.values(obj)) visit(value, depth + 1);
  };

  visit(payload, 0);
  return found;
}

export function createBdvClient(): BdvClient {
  const jar = new Map<string, string>();
  let sessionReadyAt = 0;
  // La sesion del banco no dura para siempre. Re-autenticamos antes de que
  // expire para no fallar justo cuando llega un pago.
  const SESSION_TTL_MS = 20 * 60 * 1000;

  async function request(path: string, init: RequestInit = {}): Promise<{ status: number; body: unknown }> {
    const response = await fetch(`${env.BDV_BASE_URL}${path}`, {
      ...init,
      headers: {
        "user-agent": UA,
        accept: "application/json, text/plain, */*",
        "accept-language": "es-VE,es;q=0.9",
        referer: `${env.BDV_BASE_URL}/`,
        ...(jar.size ? { cookie: cookieHeader(jar) } : {}),
        ...(init.headers as Record<string, string> | undefined),
      },
      redirect: "manual",
      signal: AbortSignal.timeout(20_000),
    });
    parseCookies(response.headers, jar);
    const text = await response.text();
    let body: unknown = {};
    try {
      body = text ? JSON.parse(text) : {};
    } catch {
      body = { raw: text.slice(0, 400) };
    }
    return { status: response.status, body };
  }

  async function login(): Promise<boolean> {
    if (!env.BDV_USER || !env.BDV_PASSWORD) {
      throw new Error("BDV_USER y BDV_PASSWORD son obligatorios");
    }
    let lastStatus = 0;
    for (const strategy of LOGIN_STRATEGIES) {
      const { body, contentType } = strategy.build(env.BDV_USER, env.BDV_PASSWORD);
      const { status, body: response } = await request(strategy.path, {
        method: "POST",
        headers: { "content-type": contentType },
        body,
      });
      lastStatus = status;
      const ok = status >= 200 && status < 300 && jar.size > 0;
      if (env.BDV_DEBUG) {
        console.log(`[bdv] login ${strategy.path} -> ${status} cookies=${jar.size}`, JSON.stringify(response).slice(0, 300));
      }
      if (ok) {
        sessionReadyAt = Date.now();
        return true;
      }
    }
    throw new Error(`BDV login fallo (ultimo status ${lastStatus})`);
  }

  async function ensureSession(): Promise<void> {
    if (sessionReadyAt && Date.now() - sessionReadyAt < SESSION_TTL_MS && jar.size > 0) return;
    await login();
  }

  async function fetchMovements(days: number): Promise<BdvMovement[]> {
    await ensureSession();
    const from = new Date(Date.now() - days * 86_400_000);
    const dateFrom = from.toISOString().slice(0, 10);
    const dateTo = new Date().toISOString().slice(0, 10);

    for (const path of MOVEMENT_ENDPOINTS) {
      for (const method of ["GET", "POST"]) {
        const query = `?fechaDesde=${dateFrom}&fechaHasta=${dateTo}&fromDate=${dateFrom}&toDate=${dateTo}`;
        try {
          const { status, body } = await request(path + query, {
            method,
            headers: method === "POST" ? { "content-type": "application/json" } : undefined,
            body: method === "POST" ? JSON.stringify({ fechaDesde: dateFrom, fechaHasta: dateTo }) : undefined,
          });
          if (status < 200 || status >= 300) continue;
          const movements = extractMovements(body);
          if (movements.length > 0) {
            if (env.BDV_DEBUG) console.log(`[bdv] movimientos via ${method} ${path}: ${movements.length}`);
            return movements;
          }
          if (env.BDV_DEBUG) {
            console.log(`[bdv] ${method} ${path} ok pero sin movimientos extraibles`, JSON.stringify(body).slice(0, 400));
          }
        } catch (error) {
          if (env.BDV_DEBUG) console.log(`[bdv] ${method} ${path} fallo:`, error instanceof Error ? error.message : error);
        }
      }
    }
    return [];
  }

  return {
    async listMovements({ days = 3 } = {}) {
      if (env.BDV_MODE === "mock") {
        return [{ reference: "0000000000", amount: 100, date: new Date().toISOString(), description: "mock" }];
      }
      return fetchMovements(days);
    },

    async verifyPayment({ amount, bankReference }) {
      if (env.BDV_MODE === "mock") {
        return { verified: true, isNew: true, status: "verified_new" as const, raw: { mock: true } };
      }

      const target = parseBs(amount);
      const reference = String(bankReference || "").replace(/\D/g, "");
      if (target === null || !reference) {
        return { verified: false, isNew: false, status: "error" as const, raw: { error: "monto o referencia invalidos" } };
      }

      let movements: BdvMovement[];
      try {
        movements = await fetchMovements(3);
      } catch (error) {
        return {
          verified: false,
          isNew: false,
          status: "bank_unavailable" as const,
          raw: { error: error instanceof Error ? error.message : "BDV no responde" },
        };
      }

      // Coincidencia por referencia (identico a como valida Pabilo). El monto
      // se compara con tolerancia de 0.01 porque el banco redondea a 2 decimales.
      const hit = movements.find((m) => m.reference === reference);
      if (!hit) {
        return { verified: false, isNew: false, status: "not_found" as const, raw: { checked: movements.length } };
      }
      if (hit.amount === null || Math.abs(hit.amount - target) > 0.01) {
        // La referencia existe pero por otro monto: es un intento de repetir un
        // comprobante con otra cantidad. Nunca lo damos por bueno.
        return {
          verified: false,
          isNew: false,
          status: "error" as const,
          raw: { error: "MONTO_NO_COINCIDE", esperado: target, encontrado: hit.amount },
        };
      }

      // El propio servicio se encarga de no reutilizar la misma referencia:
      // este cliente solo responde si el movimiento existe en el banco.
      return { verified: true, isNew: true, status: "verified_new" as const, raw: hit };
    },
  };
}