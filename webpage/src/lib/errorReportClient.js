// Reporte de errores del cliente al admin: captura la pantalla con html2canvas,
// la sube a Base44, y envía el error + la captura al WhatsApp del admin.
// El cliente solo ve "Reportando..." → "Reporte enviado ✓".

import html2canvas from "html2canvas";
import { sendWhatsAppMessage, sendWhatsAppImage, getAdminNumber } from "@/lib/whatsappClient";
import { uploadImage } from "@/lib/receiptUploadClient";

// Sube una captura de pantalla vía el Cloudflare Worker → catbox.moe (gratis,
// sin Telegram ni créditos de Base44). Respaldo: UploadFile.
async function uploadScreenshot(file) {
  const result = await uploadImage(file);
  return result?.url || "";
}

export async function reportErrorToSupport(errorMsg, context = {}) {
  try {
    const adminNum = await getAdminNumber();
    if (!adminNum) return { ok: false, error: "No hay número de admin configurado" };

    // 1. Captura de pantalla del estado actual (incluye el modal de error).
    const canvas = await html2canvas(document.body, {
      backgroundColor: "#0a0a0b",
      useCORS: true,
      logging: false,
      scale: 1,
    });
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png", 0.8));
    if (!blob) throw new Error("No se pudo generar la captura");
    const file = new File([blob], `error-${Date.now()}.png`, { type: "image/png" });

    // 2. Subir la captura (Telegram primero, Base44 como respaldo).
    const file_url = await uploadScreenshot(file, "🚨 Captura del error reportado");

    // 3. Detalles del error.
    const lines = [
      "🚨 *REPORTE DE ERROR — Legacy Store*",
      "",
      `⚠️ Error: ${errorMsg || "Error desconocido"}`,
    ];
    if (context.email) lines.push(`📧 Email: ${context.email}`);
    if (context.whatsapp) lines.push(`📱 WhatsApp: ${context.whatsapp}`);
    if (context.playerId) lines.push(`🎮 ID: ${context.playerId}`);
    if (context.bankRef) lines.push(`🔢 Ref: ${context.bankRef}`);
    if (context.ip) lines.push(`🌐 IP: ${context.ip}`);
    lines.push(`🔗 URL: ${window.location.href}`);
    lines.push(`📅 Fecha: ${new Date().toLocaleString("es-VE")}`);

    // 4. Enviar texto del error al WhatsApp del admin.
    await sendWhatsAppMessage(adminNum, lines.join("\n"));

    // 5. Enviar captura de pantalla como imagen.
    if (file_url) {
      await sendWhatsAppImage(adminNum, file_url, "🚨 Captura del error reportado");
    }

    return { ok: true };
  } catch (e) {
    return { ok: false, error: e?.message || "Error al generar captura" };
  }
}

// Alerta de fraude (comprobante falso) al WhatsApp del admin.
// Captura la pantalla con el modal que muestra la IP/ubicación del cliente.
export async function reportFraudToAdmin(context = {}) {
  try {
    const adminNum = await getAdminNumber();
    if (!adminNum) return { ok: false, error: "No hay número de admin configurado" };

    // 1. Captura de pantalla (incluye el modal con IP/ubicación visible).
    const canvas = await html2canvas(document.body, {
      backgroundColor: "#0a0a0b",
      useCORS: true,
      logging: false,
      scale: 1,
    });
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png", 0.8));
    if (!blob) throw new Error("No se pudo generar la captura");
    const file = new File([blob], `fraud-${Date.now()}.png`, { type: "image/png" });

    // 2. Subir la captura (Telegram primero, Base44 como respaldo).
    const file_url = await uploadScreenshot(file, "🚨 Captura del fraude (IP y ubicación visible)");

    // 3. Detalles del fraude.
    const lines = [
      "🚨 *FRAUDE DETECTADO — Comprobante Falso*",
      "",
      "⚠️ Un cliente subió una imagen que NO es un comprobante de pago válido.",
    ];
    if (context.email) lines.push(`📧 Email: ${context.email}`);
    if (context.whatsapp) lines.push(`📱 WhatsApp: ${context.whatsapp}`);
    if (context.playerId) lines.push(`🎮 ID: ${context.playerId}`);
    if (context.bankRef) lines.push(`🔢 Ref: ${context.bankRef}`);
    if (context.ip) lines.push(`🌐 IP: ${context.ip}`);
    if (context.city || context.region || context.country) {
      lines.push(`📍 Ubicación: ${[context.city, context.region, context.country].filter(Boolean).join(", ")}`);
    }
    if (context.confidence) lines.push(`🤖 Confianza IA: ${context.confidence}%`);
    if (context.reason) lines.push(`📝 Razón: ${context.reason}`);
    if (context.receiptUrl) lines.push(`🧾 Comprobante: ${context.receiptUrl}`);
    lines.push(`🔗 URL: ${window.location.href}`);
    lines.push(`📅 Fecha: ${new Date().toLocaleString("es-VE")}`);

    // 4. Enviar texto del fraude.
    await sendWhatsAppMessage(adminNum, lines.join("\n"));

    // 5. Enviar captura de pantalla con el modal de IP/ubicación.
    if (file_url) {
      await sendWhatsAppImage(adminNum, file_url, "🚨 Captura del fraude (IP y ubicación visible)");
    }

    // 6. Enviar el comprobante original subido por el cliente (para que el
    //    admin pueda ver la imagen real, no solo la captura de pantalla).
    if (context.receiptUrl) {
      try {
        await sendWhatsAppImage(adminNum, context.receiptUrl, "🧾 Comprobante subido por el cliente");
      } catch (e) {
        console.warn("[fraud] no se pudo enviar el comprobante original:", e?.message || e);
      }
    }

    return { ok: true };
  } catch (e) {
    return { ok: false, error: e?.message || "Error al generar captura" };
  }
}