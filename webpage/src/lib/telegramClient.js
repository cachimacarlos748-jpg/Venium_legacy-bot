// Cliente de notificaciones a Telegram para el admin de Legacy Store.
// Envía un mensaje al chat configurado (Setting "telegram") cada vez que se
// crea un pedido, sin importar si el despacho fue automático (bot NEXUS) o
// manual (diamantes). No bloquea el flujo de compra — falla silenciosamente
// si no hay credenciales o Telegram responde con error.

import { base44 } from "@/api/base44Client";

let cachedCfg = null;

async function getTelegramConfig() {
  // Solo cachea configuraciones válidas. Si la primera consulta falla (red,
  // Setting aún no creado), NO se cachea el vacío — así el próximo pedido
  // vuelve a consultar y eventualmente encuentra la config del admin.
  if (cachedCfg && cachedCfg.bot_token) return cachedCfg;
  try {
    const recs = await base44.entities.SecretSetting.filter({ key: "telegram" });
    const rec = recs?.[0];
    const parsed = rec?.value ? JSON.parse(rec.value) : {};
    if (parsed.bot_token && parsed.chat_id) cachedCfg = parsed;
    return parsed;
  } catch {
    return {};
  }
}

function escapeHtml(s) {
  return String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export async function notifyTelegramOrder(order, opts = {}) {
  const cfg = await getTelegramConfig();
  if (!cfg.bot_token || !cfg.chat_id) return { ok: false, skipped: true };

  const dispatch = opts.dispatch || "manual";
  const currency = opts.currency || "";
  const total = typeof order.price === "number" ? order.price.toFixed(2) : (order.price || "0");
  const shortId = String(order.id || "").slice(-8);
  const dispatchLabel =
    dispatch === "bot" ? "🤖 Automático (bot)" :
    dispatch === "partial" ? "⚠️ Pago parcial" :
    "✋ Manual";
  const statusLabel =
    order.status === "completed" ? "✅ Completado" :
    order.status === "partial_payment" ? "⚠️ Pago parcial" :
    order.status === "pending" ? "⏳ Pendiente" :
    escapeHtml(order.status || "pendiente");

  const lines = [
    "<b>🎮 Nueva Recarga — Legacy Store</b>",
    "",
    `📦 <b>Producto:</b> ${escapeHtml(order.product_name || "—")}`,
    `💎 <b>Paquete:</b> ${escapeHtml(order.denomination || "—")}`,
    `💰 <b>Total:</b> ${escapeHtml(total)} ${escapeHtml(currency)}`,
    `🏦 <b>Pago:</b> ${escapeHtml(order.payment_method || "—")}`,
    `👤 <b>ID Jugador:</b> ${escapeHtml(order.player_id || "—")}${order.server ? ` · ${escapeHtml(order.server)}` : ""}`,
    `📧 <b>Email:</b> ${escapeHtml(order.customer_email || "—")}`,
    `🔢 <b>Referencia:</b> <code>${escapeHtml(order.bank_reference || "—")}</code>`,
    `🚚 <b>Despacho:</b> ${dispatchLabel}`,
    `⏱️ <b>Estado:</b> ${statusLabel}`,
    `🆔 <b>Pedido:</b> <code>#${shortId}</code>`,
  ];
  if (Number(order.balance) > 0) {
    lines.push(`💵 <b>Pagado:</b> ${(order.amount_paid ?? 0).toFixed(2)} ${escapeHtml(currency)}`);
    lines.push(`📌 <b>Saldo pendiente:</b> ${(order.balance ?? 0).toFixed(2)} ${escapeHtml(currency)}`);
  }

  const text = lines.join("\n");
  const baseApi = `https://api.telegram.org/bot${cfg.bot_token}`;
  const chatId = cfg.chat_id;

  const sendText = (parse_mode) => fetch(`${baseApi}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode, disable_web_page_preview: true }),
  });

  // Envía el comprobante como FOTO (no como link). Si la URL ya es de Telegram
  // (respaldo cuando UploadFile falló), la foto ya se envió → no duplicar.
  const sendReceiptPhoto = async () => {
    if (!order.receipt_url) return;
    if (order.receipt_url.includes("api.telegram.org/file/")) return;
    try {
      const caption = `📄 Comprobante — Pedido #${shortId} · Ref: ${order.bank_reference || "—"}`;
      const r = await fetch(`${baseApi}/sendPhoto`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, photo: order.receipt_url, caption: caption.slice(0, 1024) }),
      });
      const d = await r.json().catch(() => ({}));
      if (!d.ok) console.warn("[telegram] sendPhoto falló:", d.description || r.status);
    } catch (e) {
      console.warn("[telegram] sendPhoto error:", e?.message || e);
    }
  };

  try {
    let r = await sendText("HTML");
    // Si Telegram rechaza el HTML, reintentamos en texto plano.
    if (!r.ok) {
      const detail = await r.text().catch(() => "");
      if (/parse|entities|html/i.test(detail)) {
        r = await sendText("");
      } else {
        console.error("[telegram] sendMessage HTTP", r.status, detail);
        return { ok: false, error: `HTTP ${r.status}` };
      }
    }
    const data = await r.json().catch(() => ({}));
    if (!data.ok) {
      console.error("[telegram] telegram rejected", data.description);
      return { ok: false, error: data.description || "rejected" };
    }
    // Envía la foto del comprobante después del mensaje de texto.
    await sendReceiptPhoto();
    return { ok: true };
  } catch (e) {
    console.error("[telegram] fetch error", e?.message || e);
    return { ok: false, error: e?.message || "fetch failed" };
  }
}

// Sube el comprobante de pago del cliente DIRECTAMENTE al chat del admin con
// sendPhoto del Bot API (Telegram permite CORS desde el navegador). Así NO se
// consumen créditos de la integración UploadFile y la foto te llega en
// Telegram para revisarla. Devuelve la URL pública del archivo en el almacén
// de Telegram (se guarda en el pedido y se muestra luego en el panel admin).
export async function uploadReceiptToTelegram(file, caption) {
  const cfg = await getTelegramConfig();
  if (!cfg.bot_token || !cfg.chat_id) throw new Error("Telegram no configurado");
  if (file.size > 5 * 1024 * 1024) throw new Error("La imagen supera 5 MB");

  const fd = new FormData();
  fd.append("chat_id", cfg.chat_id);
  const safeName = (file.name || "comprobante").replace(/[^\w.-]/g, "_").slice(0, 60) || "comprobante";
  fd.append("photo", file, safeName);
  if (caption) fd.append("caption", String(caption).slice(0, 1024));

  const r = await fetch(`https://api.telegram.org/bot${cfg.bot_token}/sendPhoto`, { method: "POST", body: fd });
  const data = await r.json().catch(() => ({}));
  if (!data.ok) throw new Error(data.description || `sendPhoto ${r.status}`);

  const sizes = data.result?.photo;
  const fileId = sizes?.[sizes.length - 1]?.file_id || "";
  let url = "";
  if (fileId) {
    try {
      const g = await fetch(`https://api.telegram.org/bot${cfg.bot_token}/getFile?file_id=${encodeURIComponent(fileId)}`);
      const gd = await g.json().catch(() => ({}));
      if (gd.ok && gd.result?.file_path) {
        url = `https://api.telegram.org/file/bot${cfg.bot_token}/${gd.result.file_path}`;
      }
    } catch {}
  }
  return { url, file_id: fileId };
}

// Envía un mensaje de texto plano al chat del admin (para reportes de error, etc.).
export async function sendTelegramText(text, parse_mode = "HTML") {
  const cfg = await getTelegramConfig();
  if (!cfg.bot_token || !cfg.chat_id) return { ok: false, skipped: true };
  try {
    const r = await fetch(`https://api.telegram.org/bot${cfg.bot_token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: cfg.chat_id, text, parse_mode, disable_web_page_preview: true }),
    });
    const data = await r.json().catch(() => ({}));
    return data.ok ? { ok: true } : { ok: false, error: data.description };
  } catch (e) {
    return { ok: false, error: e?.message || "fetch failed" };
  }
}