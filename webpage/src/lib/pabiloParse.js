// Clasificador de respuestas de Pabilo, sin dependencias de navegador.
//
// Vive aparte de pabiloClient.js por dos razones:
//   1. Se puede testear con `node --test` (pabiloClient importa el SDK de
//      Base44 y `import.meta.env`, que Node no entiende).
//   2. La Edge Function de Supabase puede reusar la misma clasificación, que
//      es la que decide si un pago se confirma o se rechaza.
//
// REGLA INNEGOCIABLE: un fallo de la plataforma NUNCA es un rechazo del pago
// del cliente. `not_found` significa "el banco todavía no lo muestra", y eso
// es reintentable, no definitivo.

export function parsePabiloResponse(status, data, raw) {
  if (status === 200) {
    // Solo consideramos el pago válido cuando Pabilo lo dice de forma
    // explícita con `is_new: true` (pago nuevo y verificado por el banco).
    const isNew = data?.is_new ?? data?.data?.is_new;
    if (isNew === true) return { ok: true, is_new: true, data };
    if (isNew === false) return { ok: true, is_new: false, data };
    // 200 sin is_new explícito -> NO confirmado.
    return {
      ok: false,
      kind: "unknown",
      error: "Pabilo respondió 200 sin confirmar is_new. Respuesta: " + raw,
      status,
      raw,
    };
  }

  // OJO: el detalle puede venir SOLO en `message` (por ejemplo
  // {"error":"NOT_FOUND","message":"not found: user_bank not found"}), así que
  // hay que mirar los dos campos. Si solo se mira `error`, un banco receptor
  // mal configurado se disfrazaba de "no encontramos tu pago" y el cliente
  // recibía un rechazo falso de un pago que sí estaba pagado.
  const errField = String(data?.error || "");
  const msgField = String(data?.message || "");
  const err = errField || msgField;
  const code = err.toUpperCase();
  const detail = `${errField} ${msgField}`.toLowerCase();

  if (detail.includes("user_bank not found") || detail.includes("no documents in result"))
    return { ok: false, kind: "bank_missing", error: "El banco receptor no está configurado en Pabilo", code, status, raw };
  if (code.includes("BANK_NOT_AVAILABLE"))
    return { ok: false, kind: "bank_unavailable", error: err, code, status, raw };
  if (status === 404 || code.includes("PAYMENT_NOT_FOUND"))
    return { ok: false, kind: "not_found", error: err, code, status, raw };
  if (status === 402)
    return { ok: false, kind: "no_credits", error: err || "Sin créditos de verificación", code, status, raw };
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