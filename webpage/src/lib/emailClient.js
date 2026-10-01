import { base44 } from "@/api/base44Client";

// Envía correos de notificación al cliente usando la integración SendEmail
// de Base44. Esta integración SIEMPRE llega a usuarios registrados de la app.
// Para correos a no registrados se requiere un plan pago y la app habilitada.
// Si el envío falla, no bloquea el flujo de compra (WhatsApp es el canal primario).

export async function sendOrderEmail(to, subject, body) {
  if (!to || !to.includes("@")) return { ok: false, skipped: true };
  try {
    await base44.integrations.Core.SendEmail({ to, subject, body });
    return { ok: true };
  } catch (e) {
    console.warn("[email] no se pudo enviar a", to, ":", e?.message || e);
    return { ok: false, error: e?.message || "send failed" };
  }
}

export function paymentVerifiedEmail(order) {
  return {
    subject: `Pago verificado — ${order.product_name || "tu pedido"} · Legacy Store`,
    body: `¡Hola! Hemos verificado tu pago correctamente.

DETALLES DEL PEDIDO:
• Producto: ${order.product_name || "—"}
• Paquete: ${order.denomination || "—"}
${order.player_id ? `• ID de jugador: ${order.player_id}\n` : ""}• Referencia: ${order.bank_reference || "—"}
• Total: ${(order.price ?? 0).toFixed(2)} ${order._currency || ""}

${order.status === "partial_payment" ? `Pagaste ${(order.amount_paid ?? 0).toFixed(2)} y te faltan ${(order.balance ?? 0).toFixed(2)} para completar.` : "Tu recarga está siendo procesada. Te avisaremos por WhatsApp cuando esté lista."}

Gracias por comprar en Legacy Store 🎮`,
  };
}

export function completionEmail(order) {
  const hasCode = order.delivery_code && String(order.delivery_code).trim();
  return {
    subject: `¡Recarga completada! — ${order.product_name || "tu pedido"} · Legacy Store`,
    body: `¡Tu recarga fue aplicada con éxito!

DETALLES:
• Producto: ${order.product_name || "—"}
• Paquete: ${order.denomination || "—"}
${order.player_id ? `• ID de jugador: ${order.player_id}\n` : ""}• Total: ${(order.price ?? 0).toFixed(2)} ${order._currency || ""}
${hasCode ? `\nTU CÓDIGO DE CANJE: ${order.delivery_code}\n\nGuarda este código. Canjéalo en el sitio oficial del producto. Si no sabes cómo, revisa la guía de canje que se muestra en la página de tu pedido.\n` : ""}${hasCode ? "" : "Tu paquete fue aplicado a tu cuenta de juego de inmediato.\n"}
Gracias por confiar en Legacy Store 🎮`,
  };
}