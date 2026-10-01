// Cliente de WhatsApp Business API vía UltraMsg para enviar notificaciones
// automáticas a los clientes cuando su pedido se completa.
// Configura en Admin > Config > WhatsApp API (instance_id + token de UltraMsg).
// Si no está configurado, el OrderManager abre un link wa.me como respaldo.

import { base44 } from "@/api/base44Client";
import { callEdgeFunction, isSupabaseConfigured } from "@/lib/supabaseClient";

let cachedCfg = null;

async function getWhatsAppConfig() {
  if (cachedCfg && cachedCfg.token) return cachedCfg;
  try {
    const recs = await base44.entities.Setting.filter({ key: "whatsapp_api" });
    const rec = recs?.[0];
    const parsed = rec?.value ? JSON.parse(rec.value) : {};
    if (parsed.token && parsed.instance_id) cachedCfg = parsed;
    return parsed;
  } catch {
    return {};
  }
}

// Envía un mensaje de WhatsApp automáticamente al número del cliente.
// Devuelve { ok: true } si se envió, { ok: false, skipped: true } si no hay
// API configurada (el caller debe abrir wa.me como respaldo), o error.
export async function sendWhatsAppMessage(to, body) {
  const num = String(to || "").replace(/\D/g, "");
  if (!num) return { ok: false, error: "Número inválido" };

  const cfg = await getWhatsAppConfig();

  // 1) Llamada directa a UltraMsg (soporta CORS — Access-Control-Allow-Origin: *)
  if (cfg.instance_id && cfg.token) {
    try {
      const res = await fetch(`https://api.ultramsg.com/${cfg.instance_id}/messages/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ token: cfg.token, to: num, body: String(body).slice(0, 4096) }).toString(),
      });
      const data = await res.json().catch(() => ({}));
      if (data.sent === true || data.sent === "true") return { ok: true };
      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
      return { ok: false, error: data?.error || "UltraMsg error" };
    } catch (e) {
      console.warn("[whatsapp] llamada directa falló, intentando Edge Function:", e.message);
    }
  }

  // 2) Respaldo: Edge Function con credenciales en el body
  if (await isSupabaseConfigured()) {
    try {
      const result = await callEdgeFunction("send-whatsapp", {
        to: num, message: String(body).slice(0, 4096),
        instance_id: cfg.instance_id, token: cfg.token,
      });
      if (result.sent === true || result.sent === "true") return { ok: true };
      return { ok: false, error: result?.error || result?.message || "Edge function error" };
    } catch (e) {
      return { ok: false, error: "No se pudo enviar el mensaje (servicio no disponible)." };
    }
  }
  return { ok: false, skipped: true };
}

// Construye un link wa.me como respaldo cuando no hay API configurada.
export function buildWaLink(order) {
  const num = (order.customer_whatsapp || "").replace(/\D/g, "");
  if (!num) return null;
  const msg = `¡Hola! Tu recarga de ${order.product_name || "tu pedido"}${order.denomination ? ` (${order.denomination})` : ""} ha sido completada ✅. ¡Gracias por tu compra en Legacy Store! 🎮`;
  return `https://wa.me/${num}?text=${encodeURIComponent(msg)}`;
}

// Mensaje 1 — Pago verificado, recarga en proceso (se envía al crear el pedido).
export function paymentVerifiedMessage(order, nick) {
  const oid = String(order.id || "").slice(-8);
  const lines = [
    "*✅ PAGO VERIFICADO*",
    "",
    "Tu pago ha sido confirmado correctamente.",
    "",
    "*DETALLES DEL PEDIDO*",
    `🎮 Producto: ${order.product_name || "—"}`,
    `📦 Paquete: ${order.denomination || "—"}`,
  ];
  if (order.player_id) lines.push(`🆔 ID: ${order.player_id}`);
  if (nick) lines.push(`👤 Jugador: ${nick}`);
  if (order.payment_method) lines.push(`💳 Método: ${order.payment_method}`);
  if (oid) lines.push(`🆔 Pedido: #${oid}`);
  lines.push(
    "",
    "⏳ *Tu recarga está en proceso*",
    "Tiempo estimado: 1-2 horas",
    "",
    "Te avisaremos cuando esté lista. ¡Gracias por tu compra en Legacy Store! 🎮"
  );
  return lines.join("\n");
}

// Mensaje 2 — Recarga completada (se envía al marcar como completado).
export function completionMessage(order) {
  const oid = String(order.id || "").slice(-8);
  const lines = [
    "*🎉 ¡RECARGA COMPLETADA!*",
    "",
    "Tu recarga ha sido aplicada a tu cuenta de juego.",
    "",
    "*DETALLES DEL PEDIDO*",
    `🎮 Producto: ${order.product_name || "—"}`,
    `📦 Paquete: ${order.denomination || "—"}`,
  ];
  if (order.player_id) lines.push(`🆔 ID: ${order.player_id}`);
  if (oid) lines.push(`🆔 Pedido: #${oid}`);
  lines.push(
    "",
    "✅ *¡Todo listo!*",
    "Disfruta tu recarga.",
    "",
    "¡Gracias por confiar en Legacy Store! 🎮"
  );
  return lines.join("\n");
}

// Normaliza números venezolanos: 0412... → 58412...
function normalizeVeNumber(num) {
  let n = String(num || "").replace(/\D/g, "");
  if (n.length === 10 && n.startsWith("0")) n = "58" + n.slice(1);
  else if (n.length === 10 && n.startsWith("4")) n = "58" + n;
  return n;
}

// Número del admin para recibir notificaciones (errores, pedidos).
// Se configura en Admin > Config > WhatsApp API > admin_number.
export async function getAdminNumber() {
  const cfg = await getWhatsAppConfig();
  if (cfg.admin_number) return normalizeVeNumber(cfg.admin_number);
  try {
    const recs = await base44.entities.Setting.filter({ key: "support" });
    const support = recs?.[0]?.value ? JSON.parse(recs[0].value) : {};
    if (support.whatsapp) return normalizeVeNumber(support.whatsapp);
  } catch {}
  return "";
}

// Envía una imagen con caption por WhatsApp (vía UltraMsg image endpoint).
export async function sendWhatsAppImage(to, imageUrl, caption) {
  const num = String(to || "").replace(/\D/g, "");
  if (!num) return { ok: false, error: "Número inválido" };

  const cfg = await getWhatsAppConfig();

  // 1) Llamada directa a UltraMsg (soporta CORS)
  if (cfg.instance_id && cfg.token) {
    try {
      const res = await fetch(`https://api.ultramsg.com/${cfg.instance_id}/messages/image`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ token: cfg.token, to: num, image: imageUrl, caption: caption || "" }).toString(),
      });
      const data = await res.json().catch(() => ({}));
      if (data.sent === true || data.sent === "true") return { ok: true };
      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
      return { ok: false, error: data?.error || "UltraMsg error" };
    } catch (e) {
      console.warn("[whatsapp] imagen directa falló, intentando Edge Function:", e.message);
    }
  }

  // 2) Respaldo: Edge Function con credenciales en el body
  if (await isSupabaseConfigured()) {
    try {
      const result = await callEdgeFunction("send-whatsapp", {
        to: num, image: imageUrl, caption: caption || "",
        instance_id: cfg.instance_id, token: cfg.token,
      });
      if (result.sent === true || result.sent === "true") return { ok: true };
      return { ok: false, error: result?.error || result?.message || "Edge function error" };
    } catch (e) {
      return { ok: false, error: "No se pudo enviar la imagen (servicio no disponible)." };
    }
  }
  return { ok: false, skipped: true };
}

// Notificación de nuevo pedido al WhatsApp del admin (reemplaza Telegram).
export async function notifyWhatsAppOrder(order, opts = {}) {
  const num = await getAdminNumber();
  if (!num) return { ok: false, skipped: true };
  const dispatch = opts.dispatch || "manual";
  const currency = opts.currency || "";
  const total = typeof order.price === "number" ? order.price.toFixed(2) : (order.price || "0");
  const shortId = String(order.id || "").slice(-8);
  const dispatchLabel = dispatch === "venium" ? "⚡ Instantáneo (Venium)" : dispatch === "bot" ? "🤖 Automático (bot)" : dispatch === "partial" ? "⚠️ Pago parcial" : "✋ Manual";
  const statusLabel = order.status === "completed" ? "✅ Completado" : order.status === "partial_payment" ? "⚠️ Pago parcial" : order.status === "pending" ? "⏳ Pendiente" : (order.status || "pendiente");
  const lines = [
    "🎮 *Nueva Recarga — Legacy Store*",
    "",
    `📦 Producto: ${order.product_name || "—"}`,
    `💎 Paquete: ${order.denomination || "—"}`,
    `💰 Total: ${total} ${currency}`,
    `🏦 Pago: ${order.payment_method || "—"}`,
    `👤 ID: ${order.player_id || "—"}${order.server ? ` · ${order.server}` : ""}`,
    `📧 Email: ${order.customer_email || "—"}`,
    `📱 WhatsApp: ${order.customer_whatsapp || "—"}`,
    `🔢 Ref: ${order.bank_reference || "—"}`,
    `🚚 Despacho: ${dispatchLabel}`,
    `⏱️ Estado: ${statusLabel}`,
    `🆔 Pedido: #${shortId}`,
  ];
  if (Number(order.balance) > 0) {
    lines.push(`💵 Pagado: ${(order.amount_paid ?? 0).toFixed(2)} ${currency}`);
    lines.push(`📌 Saldo: ${(order.balance ?? 0).toFixed(2)} ${currency}`);
  }
  if (order.discount_code) {
    let isCreator = opts.discount?.creator_id != null;
    // Si no viene el objeto discount, verificar si el código pertenece a un creador
    if (!opts.discount) {
      try {
        const creators = await base44.entities.Creator.filter({ code: order.discount_code, status: "approved" });
        isCreator = (creators?.length || 0) > 0;
      } catch {}
    }
    const codeLabel = isCreator ? "🎬 Código de creador" : "🏷️ Cupón de página";
    lines.push(`${codeLabel}: ${order.discount_code}${order.discount_amount ? ` (−${order.discount_amount} ${currency})` : ""}`);
  }
  if (order.receipt_url) {
    lines.push(`📄 Comprobante: adjunto (ver en panel admin)`);
  }
  const res = await sendWhatsAppMessage(num, lines.join("\n"));
  return res;
}