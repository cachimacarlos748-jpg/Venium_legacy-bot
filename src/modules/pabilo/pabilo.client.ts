import { env } from "../../config/env.js";

// Por que una verificacion quedo sin respuesta. Importa porque la clave de
// Pabilo es de un mes (10 dias / 40 creditos): cuando se acaba o se vence,
// TODOS los pagos del bot caen en la misma situacion y hay que enterarse con
// un aviso al telefono, no leyendo el panel a diario.
export type PabiloUnavailableReason =
  | "no_credits" // 402: se acabaron los 40 creditos del mes
  | "invalid_key" // 401/403: la clave se vencio o esta mal pegada
  | "rate_limited" // 429: demasiadas consultas seguidas
  | "server_error" // 5xx o respuesta que no entendemos
  | "bank_unavailable" // el propio Pabilo dice que el banco no responde
  | "bank_missing" // el banco receptor no esta registrado en esta clave
  | "invalid_request"; // 400 que no sabemos interpretar

export interface PabiloPaymentResult {
  verified: boolean;
  isNew: boolean;
  status: "verified_new" | "duplicate" | "not_found" | "amount_mismatch" | "bank_unavailable" | "error";
  reason?: PabiloUnavailableReason;
  message?: string;
  raw: unknown;
}

export interface PabiloClient {
  listUserBanks(): Promise<unknown>;
  verifyPayment(input: { userBankId: string; amount: string; bankReference: string; movementType: string }): Promise<PabiloPaymentResult>;
}

export function createPabiloClient(): PabiloClient {
  const mockSeen = new Set<string>();

  return {
    async listUserBanks() {
      if (env.PABILO_MODE === "mock") return { user_banks: [] };
      if (!env.PABILO_API_KEY) throw new Error("PABILO_API_KEY is required for live mode");
      const response = await fetch(`${env.PABILO_BASE_URL}/me/usersbank`, {
        method: "GET",
        headers: { appKey: env.PABILO_API_KEY },
        signal: AbortSignal.timeout(15_000),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(`Pabilo error ${response.status}`);
      return body;
    },
    async verifyPayment(input) {
      if (!input.userBankId) {
        return { verified: false, isNew: false, status: "error", raw: { error: "PABILO_USER_BANK_ID_MISSING" } };
      }

      if (env.PABILO_MODE === "mock") {
        const key = `${input.userBankId}:${input.amount}:${input.bankReference}`;
        if (mockSeen.has(key)) return { verified: false, isNew: false, status: "duplicate", raw: { data: { is_new: false } } };
        mockSeen.add(key);
        return { verified: true, isNew: true, status: "verified_new", raw: { data: { is_new: true } } };
      }

      if (!env.PABILO_API_KEY) throw new Error("PABILO_API_KEY is required for live mode");
      const response = await fetch(
        `${env.PABILO_BASE_URL}/userbankpayment/${encodeURIComponent(input.userBankId)}/betaserio`,
        {
          method: "POST",
          headers: { "content-type": "application/json", appKey: env.PABILO_API_KEY },
          body: JSON.stringify({
            amount: Number(input.amount),
            bank_reference: input.bankReference,
            movement_type: input.movementType,
          }),
          // Hard timeout: without it a hung Pabilo call stalls the whole
          // receipt verification and the customer never gets an answer.
          signal: AbortSignal.timeout(15_000),
        },
      );
      const body: any = await response.json().catch(() => ({}));
      const apiError = String(body?.error ?? body?.message ?? "").trim();
      if (apiError === "BANK_NOT_AVAILABLE") {
        return { verified: false, isNew: false, status: "bank_unavailable", reason: "bank_unavailable", raw: body };
      }
      if (apiError === "PAYMENT_NOT_FOUND") {
        return { verified: false, isNew: false, status: "not_found", raw: body };
      }
      // Pabilo responde el veredicto en `is_new`. Cualquier otra cosa es una
      // respuesta que no entendemos y NO puede convertirse en un "no" para el
      // cliente.
      const isNew = body?.data?.is_new ?? body?.is_new;
      if (response.ok && isNew === false) {
        // Referencia ya consumida: es la respuesta definitiva de Pabilo (la
        // gasto un pedido anterior), no una caida nuestra.
        return { verified: false, isNew: false, status: "duplicate", raw: body };
      }
      if (response.ok && isNew === true) {
        return { verified: true, isNew: true, status: "verified_new", raw: body };
      }
      if (response.ok) {
        // 200 sin veredicto explicito: incertidumbre, nunca rechazo. El cliente
        // puede reintentar y el dueño recibe el aviso.
        return { verified: false, isNew: false, status: "bank_unavailable", reason: "server_error", message: "respuesta sin is_new", raw: body };
      }
      // Errores HTTP. Ojo con el signo: 402/401/429/5xx NO son "el pago es
      // falso", son "no pudimos verificar". Tratarlos como rechazo hacia que
      // el cliente paie dos veces o que el dueño renueve la clave por un
      // error que en realidad no existe.
      const code = apiError.toUpperCase();
      // El banco receptor no existe en esta clave. Es lo que paso con las dos
      // claves que tuvo la tienda: el plan venció, el banco se desregistró y
      // todas las verificaciones empezaron a fallar sin que nadie supiera por
      // qué. Es un problema de configuracion, NO un rechazo del pago del
      // cliente, y tiene su propio motivo para que el aviso sea accionable.
      if (apiError.toLowerCase().includes("user_bank not found") || apiError.toLowerCase().includes("user bank not found")
        || `${body?.error ?? ""} ${body?.message ?? ""}`.toLowerCase().includes("user_bank not found")) {
        return { verified: false, isNew: false, status: "bank_unavailable", reason: "bank_missing", message: apiError, raw: body };
      }
      if (response.status === 400 && code.includes("PAYMENT_AMOUNT")) {
        return { verified: false, isNew: false, status: "amount_mismatch", message: apiError, raw: body };
      }
      if (response.status === 400 && (code.includes("REFERENCE") || code.includes("INVALID_REF"))) {
        // La referencia no tiene el formato que Pabilo entiende: el cliente la
        // reescribe y se vuelve a intentar.
        return { verified: false, isNew: false, status: "not_found", message: apiError, raw: body };
      }
      const reason: PabiloUnavailableReason =
        response.status === 402 ? "no_credits"
        : response.status === 401 || response.status === 403 ? "invalid_key"
        : response.status === 429 ? "rate_limited"
        : response.status >= 500 ? "server_error"
        : "invalid_request";
      return {
        verified: false,
        isNew: false,
        status: "bank_unavailable",
        reason,
        message: apiError || `HTTP ${response.status}`,
        raw: body,
      };
    },
  };
}
