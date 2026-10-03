import { base44 } from "@/api/base44Client";
import { callEdgeFunction, isSupabaseConfigured } from "@/lib/supabaseClient";

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

// Parsea la respuesta de Pabilo en un resultado normalizado { ok, is_new, kind, error }.
// Compartido entre la Edge Function y la llamada directa para mantener consistencia.
function parsePabiloResponse(status, data, raw) {
  if (status === 200) {
    // PUNTO CRÍTICO DE SEGURIDAD.
    // Solo consideramos el pago válido cuando Pabilo lo dice de forma
    // explícita con `is_new: true` (pago nuevo y verificado por el banco).
    const isNew = data?.is_new ?? data?.data?.is_new;
    if (isNew === true) return { ok: true, is_new: true, data };
    if (isNew === false) return { ok: true, is_new: false, data };
    // 200 sin is_new explícito → NO confirmado.
    return {
      ok: false,
      kind: "unknown",
      error: "Pabilo respondió 200 sin confirmar is_new. Respuesta: " + raw,
      status,
      raw,
    };
  }
  // Clasificamos el fallo según los códigos documentados por Pabilo.
  const err = String(data?.error || data?.message || "");
  const code = err.toUpperCase();
  if (err.includes("user_bank not found") || err.includes("no documents in result"))
    return { ok: false, kind: "bank_missing", error: "El banco receptor no está configurado en Pabilo", code, status, raw };
  if (status === 404 || code.includes("PAYMENT_NOT_FOUND"))
    return { ok: false, kind: "not_found", error: err, code, status, raw };
  if (code.includes("BANK_NOT_AVAILABLE"))
    return { ok: false, kind: "bank_unavailable", error: err, code, status, raw };
  if (status === 402)
    return { ok: false, kind: "config", error: err || "Sin créditos de verificación", code, status, raw };
  if (status === 400) {
    if (code.includes("PAYMENT_AMOUNT"))
      return { ok: false, kind: "amount", error: "El monto recibido no coincide con el del pedido", code, status, raw };
    if (code.includes("REFERENCE") || code.includes("INVALID_REF"))
      return { ok: false, kind: "invalid", error: "La referencia no es válida", code, status, raw };
    return { ok: false, kind: "invalid", error: err || "Faltan datos obligatorios", code, status, raw };
  }
  if (status === 401 || status === 403)
    return { ok: false, kind: "config", error: err || "Credenciales inválidas", code, status, raw };
  if (status >= 500 || code.includes("INTERNAL_SERVER"))
    return { ok: false, kind: "server_error", error: err || `HTTP ${status}`, code, status, raw };
  if (err) return { ok: false, kind: "unknown", error: err, code, status, raw };
  return { ok: false, kind: "unknown", error: `HTTP ${status}`, status, raw };
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

  // Verificador ACTIVO: BDVenlínea, a través del proxy de Cloudflare (mismo
  // patrón que el proxy de Venium). El mismo flujo de siempre para el cliente;
  // lo único que cambia es quién consulta el banco. La clave compartida vive
  // como secreto del Worker, nunca en el navegador. Si el proxy no está
  // configurado o falla, se cae al proveedor anterior (Pabilo).
  const bdv = await verifyWithBdvViaProxy(bankReference, amount);
  if (bdv) return bdv;

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
  // El proxy entra al banco: puede tardar 15-40 s. Timeout holgado.
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 90000);
  try {
    const r = await fetch(`${proxy.replace(/\/+$/, "")}`, {
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