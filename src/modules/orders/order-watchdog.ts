import type Database from "better-sqlite3";
import { publishEvent } from "../events/event-bus.js";

// Orders that need a human and were NOT waiting for a push: the store had a
// pending order since yesterday and the owner never heard about it. This
// watchdog looks for the orders that get stuck in a state nobody is watching
// (paid but not sent to Venium, no wallet balance, customer never paid) and
// raises a phone notification for each of them.
const REPEAT_ALERT_MS = 6 * 60 * 60_000;

interface WatchedOrder {
  id: string;
  status: string;
  payment_status: string;
  created_at: string;
  updated_at: string;
  sale_price_bs_total: string;
  jid: string | null;
  phone: string | null;
}

function stuckReason(order: WatchedOrder, ageMinutes: number): string | null {
  switch (order.status) {
    case "venium_pending":
      return ageMinutes >= 10
        ? "pago verificado pero Venium no tenía saldo: hay que reenviar la recarga"
        : null;
    case "approved_for_venium":
      return ageMinutes >= 10 ? "pago verificado y la recarga todavía no se ha enviado a Venium" : null;
    case "venium_processing":
      return ageMinutes >= 90 ? "la recarga lleva más de 1h30 en proceso: revisa el estado con Venium" : null;
    case "quote_created":
      return ageMinutes >= 180 ? "el cliente no ha enviado el comprobante en más de 3 horas" : null;
    default:
      return null;
  }
}

export function checkStuckOrders(db: Database.Database): number {
  const rows = db.prepare(`
    SELECT o.id, o.status, o.payment_status, o.created_at, o.updated_at,
           o.sale_price_bs_total, c.whatsapp_jid AS jid, c.phone_display AS phone
    FROM orders o
    LEFT JOIN customers c ON c.id = o.customer_id
    WHERE o.status IN ('quote_created', 'approved_for_venium', 'venium_pending', 'venium_processing')
  `).all() as WatchedOrder[];

  const now = Date.now();
  let raised = 0;
  for (const order of rows) {
    const touched = Date.parse(order.updated_at || order.created_at) || now;
    const reason = stuckReason(order, (now - touched) / 60_000);
    if (!reason) continue;
    const key = `${order.id}:${order.status}`;
    const previous = checkStuckOrders.lastAlert.get(key) ?? 0;
    if (now - previous < REPEAT_ALERT_MS) continue;
    checkStuckOrders.lastAlert.set(key, now);
    publishEvent({
      type: "order_stuck",
      jid: order.jid || "sistema@vex.store",
      phone: order.phone || "Sistema",
      preview: `Pedido ${order.id.slice(0, 8)} · Bs ${order.sale_price_bs_total} · ${reason}`,
      meta: { orderId: order.id, status: order.status, paymentStatus: order.payment_status, reason },
    });
    raised += 1;
  }
  return raised;
}

// Keeps the per-order alert timestamps on the function itself so there is no
// module-level mutable state to reset between calls.
checkStuckOrders.lastAlert = new Map<string, number>();

// Runs shortly after boot (so yesterday's pending orders are announced on the
// restart that follows the outage) and then every few minutes.
export function startOrderWatchdog(db: Database.Database, intervalMs = 5 * 60_000): () => void {
  const first = setTimeout(() => {
    try {
      checkStuckOrders(db);
    } catch (error) {
      console.error("[watchdog] no se pudieron revisar los pedidos pendientes", error);
    }
  }, 20_000);
  const timer = setInterval(() => {
    try {
      checkStuckOrders(db);
    } catch (error) {
      console.error("[watchdog] no se pudieron revisar los pedidos pendientes", error);
    }
  }, intervalMs);
  timer.unref?.();
  first.unref?.();
  return () => {
    clearTimeout(first);
    clearInterval(timer);
  };
}