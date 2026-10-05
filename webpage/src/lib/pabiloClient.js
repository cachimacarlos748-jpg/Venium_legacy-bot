import { base44 } from "@/api/base44Client";
import { callEdgeFunction, isSupabaseConfigured } from "@/lib/supabaseClient";
import { buildBdvProxyUrl } from "@/lib/bdvProxyUrl";
import { parsePabiloResponse } from "@/lib/pabiloParse";

// Cliente Pabilo — verificación de pagos en tiempo real.
// Si Supabase está configurado, usa la Edge Function (API key segura).
// Respaldo: llamada directa con la API key del Setting (menos seguro).

async function readSetting(key) {
  try {
    const recs = await base44.entities.Setting.filter({ key });
    return recs?.[0]?.value || "";
  } catch {
    return "";
  }
}

export async function getPabiloConfig() {
  try {
    const raw = await readSetting("pabilo");
    const p = raw ? JSON.parse(raw) : {};
    return {
      api_key: (p.api_key || p.appKey || "").trim(),
      user_bank_id: (p.user_bank_id || p.userBankId || p.account_id || "").trim(),
      // Campos opcionales según el banco (ver docs de Pabilo).
      movement_type: (p.movement_type || "").trim(),   // MOVIL_PAY | TRANSFER (solo Mercantil)
      bank_origin: (p.bank_origin || "").trim(),       // código de banco origen (cuentas de empresa)
    };
  } catch {
    return { api_key: "", user_bank_id: "", movement_type: "", bank_origin: "" };
  }
}

// Un solo intento de verificación (directa + Edge Function de respaldo).
async function attemptVerification(ref, amountNum, api_key, user_bank_id, movement_type, bank_origin) {
  // 1) Llamada directa a Pabilo (soporta CORS + appKey desde el navegador).
  if (api_key && user_bank_id) {
    try {
      const payload = { bank_reference: ref, amount: +amountNum.toFixed(2) };
      if (movement_type) payload.movement_type = movement_type;
      if (bank_origin) payload.bank_origin = bank_origin;

      const res = await fetch(`https://api.pabilo.app/userbankpayment/${user_bank_id}/betaserio`, {
        method: "POST",
        headers: { "Content-Type": "application/json", appKey: api_key },
        body: JSON.stringify(payload),
      });
      const text = await res.text();
      let data = {};
      try { data = text ? JSON.parse(text) : {}; } catch {}
      return parsePabiloResponse(res.status, data, text.slice(0, 280));
    } catch (e) {
      console.warn("[pabilo] llamada directa falló, intentando Edge Function:", e.message);
    }
  }

  // 2) Respaldo: Edge Function de Supabase (con credenciales en el body).
  if (await isSupabaseConfigured()) {
    try {
      const result = await callEdgeFunction("verify-payment", {
        reference: ref,
        amount: +amountNum.toFixed(2),
        movement_type: movement_type || undefined,
        bank_origin: bank_origin || undefined,
        api_key: api_key || undefined,
        user_bank_id: user_bank_id || undefined,
      });
      if (result && typeof result === "object" && "status" in result) {
        return parsePabiloResponse(result.status, result.data || {}, result.raw || "");
      }
    } catch (e) {
      return { ok: false, kind: "connection", error: "No se pudo conectar con el servicio de verificación. Reintenta en unos momentos." };
    }
  }

  return { ok: false, kind: "config", error: "El servicio de verificación no está disponible. Contacta al soporte." };
}

// Normalizamos respuesta a { ok, is_new, error }
//  - is_new true   -> pago válido y nuevo
//  - is_new false  -> referencia ya utilizada
//  - API errores conocidos: PAYMENT_NOT_FOUND / BANK_NOT_AVAILABLE
//
// REINTENTOS: cuando Pabilo responde "not_found" puede ser que el banco aún
// no ha propagado la transacción (latencia de hasta 1-2 min). Por eso
// reintentamos hasta `retries` veces con `retryDelayMs` entre cada intento.
// Solo "not_found" se reintenta; el resto de errores son definitivos.
export async function verifyPayment(bankReference, amount, opts = {}) {
  const maxRetries = opts.retries ?? 3;
  const retryDelayMs = opts.retryDelayMs ?? 6000;
  const onRetry = typeof opts.onRetry === "function" ? opts.onRetry : null;

  // Proveedor de pagos. Pabilo es el de la tienda (mismo que usa el bot de
  // WhatsApp, misma clave y mismo banco). El verificador propio contra
  // BDVenlínea existe pero solo entra si se pide a proposito con
  // VITE_PAYMENT_VERIFIER=bdv: daba demasiados falsos "no encontrado" y el
  // cliente veia pagos como rechazados.
  const verifier = String(import.meta.env.VITE_PAYMENT_VERIFIER || "pabilo").trim().toLowerCase();
  if (verifier === "bdv") {
    // Va por el proxy de Cloudflare (mismo patrón que el proxy de Venium); la
    // clave compartida vive como secreto del Worker, nunca en el navegador.
    const bdv = await verifyWithBdvViaProxy(bankReference, amount);
    // Si el verificador de BDV dio una RESPUESTA (pago encontrado o no), manda
    // esa: el banco es la fuente de verdad. Solo si no pudo responder (proxy
    // caido, timeout del Worker, 5xx) se usa Pabilo, para que el cliente nunca
    // se quede a medio pago.
    if (bdv && bdv.kind !== "server_error" && bdv.kind !== "connection") return bdv;
  }

  const { api_key, user_bank_id, movement_type, bank_origin } = await getPabiloConfig();
  const ref = String(bankReference || "").trim();
  if (!/^\d{6,9}$/.test(ref)) return { ok: false, kind: "invalid", error: "La referencia debe tener entre 6 y 9 dígitos" };
  const amountNum = Number(amount);
  if (!Number.isFinite(amountNum) || amountNum <= 0) return { ok: false, kind: "invalid", error: "Monto inválido" };

  let lastResult = null;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    lastResult = await attemptVerification(ref, amountNum, api_key, user_bank_id, movement_type, bank_origin);
    // Resultado definitivo: verificado, o cualquier error que NO sea "not_found".
    if (lastResult.ok || lastResult.kind !== "not_found") return lastResult;
    // "not_found": el banco puede tardar en propagar la transacción. Reintentar.
    if (attempt < maxRetries) {
      if (onRetry) onRetry(attempt, maxRetries);
      await new Promise((r) => setTimeout(r, retryDelayMs));
    }
  }
  return lastResult;
}

// Verifica contra BDVenlínea pasando por el proxy de Cloudflare. Devuelve null
// (no un error) si el proxy no está configurado, para que el flujo siga con el
// proveedor anterior igual que antes.
async function verifyWithBdvViaProxy(bankReference, amount) {
  const proxy = String(import.meta.env.VITE_BDV_VERIFY_PROXY_URL || "").trim();
  if (!proxy) return null;
  const ref = String(bankReference || "").trim();
  if (!/^\d{6,20}$/.test(ref)) {
    return { ok: false, kind: "invalid", error: "La referencia debe tener entre 6 y 20 dígitos" };
  }
  const amountNum = Number(amount);
  if (!Number.isFinite(amountNum) || amountNum <= 0) {
    return { ok: false, kind: "invalid", error: "Monto inválido" };
  }
  // El Worker corta a 95 s; aqui esperamos un poco mas para recibir SU error
  // (que es el que nos dice "el banco tardo demasiado" y permite caer al
  // proveedor anterior). Este corte es solo la red de seguridad del navegador:
  // si se dispara, el flujo tambien sigue con Pabilo.
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 99000);
  try {
    const r = await fetch(buildBdvProxyUrl(proxy), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ amount: String(amountNum), reference: ref }),
      signal: ctrl.signal,
    });
    const data = await r.json().catch(() => ({}));
    if (r.status === 429) return { ok: false, kind: "bank_unavailable", error: "Banco ocupado" };
    if (!r.ok) return { ok: false, kind: "server_error", error: String(data?.error || `HTTP ${r.status}`) };
    const verified = !!data.verified;
    return {
      ok: verified,
      kind: verified ? "ok" : "not_found",
      is_new: !!data.isNew,
      reference: data?.raw?.reference || ref,
      amount: data?.raw?.amount ?? amountNum,
      date: data?.raw?.date,
      description: data?.raw?.description,
      raw: data,
    };
  } catch (e) {
    if (e.name === "AbortError") return { ok: false, kind: "server_error", error: "El banco tardo demasiado" };
    return { ok: false, kind: "connection", error: "No se pudo contactar el verificador" };
  } finally {
    clearTimeout(t);
  }
}

// Convierte el resultado de verifyPayment en un mensaje claro para el cliente.
// Nunca expone textos técnicos del proveedor (pabilo, internal_server_error...).
export function friendlyPabiloError(res) {
  switch (res?.kind) {
    case "not_found":
      return "No pudimos encontrar una transacción con los datos proporcionados. Verifica el número de referencia o intenta de nuevo.";
    case "bank_unavailable":
      return "El banco no está disponible en este momento. Reintenta en unos minutos.";
    case "bank_missing":
      return "Falta configurar los datos bancarios receptores en el panel. Avísanos por soporte para activar la verificación.";
    case "server_error":
      return "El servicio de verificación no está disponible ahora mismo. Inténtalo de nuevo en unos momentos.";
    case "no_credits":
      // No es un rechazo del pago: la tienda se quedó sin créditos de
      // verificación. Decírselo claro evita que el cliente pague dos veces.
      return "Estamos verificando los pagos más lento de lo normal en este momento. Tu pago no está rechazado: espera unos minutos e inténtalo de nuevo.";
    case "connection":
      return "No pudimos conectar con el servicio de verificación. Revisa tu conexión e inténtalo de nuevo.";
    case "config":
      return "El servicio de pago no está configurado correctamente. Contacta al soporte.";
    case "amount":
      return "El monto que recibimos no coincide con el total del pedido. Revisa que hayas pagado la cantidad exacta mostrada en el resumen y vuelve a reportar el pago.";
    case "invalid":
      return "Los datos del pago no son válidos. Verifica la referencia y vuelve a intentarlo.";
    case "already_used":
    default:
      if (res?.is_new === false) return "Esta referencia ya fue utilizada anteriormente.";
      return res?.error || "No se pudo verificar el pago. Inténtalo de nuevo.";
  }
}