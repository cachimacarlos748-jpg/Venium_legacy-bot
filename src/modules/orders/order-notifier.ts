import type Database from "better-sqlite3";
import pino from "pino";
import { publishEvent } from "../events/event-bus.js";
import { retryVeniumOrder } from "../payments/payment.service.js";
import { sendSurvey } from "../survey/survey.service.js";
import type { BotCore } from "../whatsapp/bot-core.js";

const logger = pino({ level: process.env.NODE_ENV === "production" ? "info" : "warn" });

// The promise the store makes is "te aviso cuando esté lista". Orders get
// there through the Venium webhook; when the webhook never arrives (it was
// lost, the status changed without an event, the order was parked for wallet
// balance) the customer used to never hear back. This module closes that
// loop: it delivers the completion message and automatically re-sends orders
// that were parked waiting for Venium balance.

const DONE_STATUSES = new Set(["completed", "delivered", "delivered_code", "done", "success"]);
const FAILED_STATUSES = new Set(["failed", "cancelled", "canceled", "refunded", "rejected"]);

export function isCompletedStatus(status: string): boolean {
  return DONE_STATUSES.has(String(status ?? "").toLowerCase());
}

export function isFailedStatus(status: string): boolean {
  return FAILED_STATUSES.has(String(status ?? "").toLowerCase());
}

// Sends the "tu recarga está lista" message exactly once per order. The
// delivered_code (when the reseller sends one) is included so the customer
// has their proof.
export async function notifyOrderCompleted(
  db: Database.Database,
  core: BotCore | null,
  orderId: string,
): Promise<boolean> {
  const order: any = db.prepare(`
    SELECT o.id, o.delivered_code, o.player_data_json, o.status,
           c.whatsapp_jid AS jid, p.name AS productName, pk.name AS packageName
    FROM orders o
    LEFT JOIN customers c ON c.id = o.customer_id
    LEFT JOIN products p ON p.id = o.product_id
    LEFT JOIN packages pk ON pk.id = o.package_id
    WHERE o.id = ?
  `).get(orderId);
  if (!order?.jid) return false;
  // Venium also POSTs order.processing / order.cancelled / order.refunded to
  // this same endpoint. Only a COMPLETED order may promise the recharge is
  // ready: announcing it on the "processing" event told customers their
  // diamonds were ready seconds after paying.
  if (!isCompletedStatus(order.status)) return false;
  const already: any = db.prepare("SELECT id FROM chat_messages WHERE whatsapp_jid = ? AND body LIKE ? LIMIT 1")
    .get(order.jid, `%TU RECARGA ESTÁ LISTA%${orderId.slice(0, 8)}%`);
  if (already) return false;

  const message = [
    "🎉 *¡TU RECARGA ESTÁ LISTA!* ✅",
    "",
    `🎮 ${order.productName ?? "Tu recarga"} — ${order.packageName ?? ""}`.trim(),
    order.delivered_code ? `🔑 Código de entrega: *${order.delivered_code}*` : "",
    "",
    "Revisa tu juego: los diamantes ya deben estar acreditados ⚡",
    "¡Gracias por comprar en *Vex Store*! 🙌",
    "",
    `_Pedido ${String(orderId).slice(0, 8)}_`,
  ].filter(Boolean).join("\n");

  if (core) {
    await core.sendCustomerNotice(order.jid, message);
    // Right after the "tu recarga está lista" news the customer is at their
    // happiest: that is when the CSAT survey goes out (once per order).
    await sendSurvey(db, core, order.jid, { trigger: "order", orderId });
  }
  publishEvent({
    type: "order_completed",
    jid: order.jid,
    phone: String(order.jid).split("@")[0],
    preview: `${order.productName ?? ""} · pedido ${String(orderId).slice(0, 8)}`,
    meta: { orderId, deliveredCode: order.delivered_code ?? null },
  });
  return true;
}

export interface PendingVeniumOrder {
  id: string;
  jid: string | null;
  productName: string | null;
  packageName: string | null;
  salePriceBsTotal: string | null;
  updatedAt: string | null;
}

// Las recargas pagadas que quedaron en cola esperando saldo en la billetera de
// Venium. El panel las lista para que el dueño sepa QUÉ va a salir antes de
// apretar el botón.
export function listPendingVeniumOrders(db: Database.Database, limit = 200): PendingVeniumOrder[] {
  return db.prepare(`
    SELECT o.id, c.whatsapp_jid AS jid, p.name AS productName, pk.name AS packageName,
           o.sale_price_bs_total AS salePriceBsTotal, o.updated_at AS updatedAt
    FROM orders o
    LEFT JOIN customers c ON c.id = o.customer_id
    LEFT JOIN products p ON p.id = o.product_id
    LEFT JOIN packages pk ON pk.id = o.package_id
    WHERE o.status = 'venium_pending'
    ORDER BY o.updated_at ASC LIMIT ?
  `).all(limit) as PendingVeniumOrder[];
}

export interface ResendSummary {
  attempted: number;
  sent: number;
  failed: number;
  results: Array<{ id: string; ok: boolean; veniumOrderId?: string; error?: string }>;
}

// Procesa a mano las recargas en cola (botón del panel, cuando ya recargaste la
// billetera del proveedor). Nada se reenvía solo: una recarga vieja que nadie
// está mirando se disparaba en el instante en que entraba saldo, y salía un
// paquete distinto al que el cliente pidió. Devuelve el detalle pedido por
// pedido para que el panel diga qué se envió y qué sigue en cola.
export async function resendPendingVeniumOrders(
  db: Database.Database,
  options: { ids?: string[]; olderThanMinutes?: number; limit?: number } = {},
): Promise<ResendSummary> {
  const limit = options.limit ?? 500;
  const olderThanMinutes = options.olderThanMinutes ?? 0;

  let rows: Array<{ id: string; updatedAt: string | null }>;
  if (options.ids?.length) {
    const placeholders = options.ids.map(() => "?").join(",");
    rows = db.prepare(`
      SELECT id, updated_at AS updatedAt FROM orders
      WHERE status = 'venium_pending' AND id IN (${placeholders})
      ORDER BY updated_at ASC LIMIT ?
    `).all(...options.ids, limit) as Array<{ id: string; updatedAt: string | null }>;
  } else {
    rows = db.prepare(`
      SELECT id, updated_at AS updatedAt FROM orders
      WHERE status = 'venium_pending'
      ORDER BY updated_at ASC LIMIT ?
    `).all(limit) as Array<{ id: string; updatedAt: string | null }>;
  }

  if (olderThanMinutes > 0) {
    const now = Date.now();
    rows = rows.filter((row) => (now - (Date.parse(row.updatedAt ?? "") || now)) / 60_000 >= olderThanMinutes);
  }

  const results: ResendSummary["results"] = [];
  for (const row of rows) {
    const result = await retryVeniumOrder(db, row.id);
    if (result.ok) {
      logger.info({ orderId: row.id, veniumOrderId: result.veniumOrderId }, "Pending Venium order re-sent");
    }
    results.push({ id: row.id, ok: result.ok, veniumOrderId: result.veniumOrderId, error: result.error });
  }
  return {
    attempted: results.length,
    sent: results.filter((item) => item.ok).length,
    failed: results.filter((item) => !item.ok).length,
    results,
  };
}

// A paid order parked waiting for Venium balance is money already in the
// store's hands. Only used when AUTO_RETRY_VENIUM_PENDING is explicitly on:
// by default the owner tops up the wallet and presses the panel button, so an
// old order never fires on its own.
export async function autoRetryVeniumPending(db: Database.Database, olderThanMinutes = 5): Promise<number> {
  const summary = await resendPendingVeniumOrders(db, { olderThanMinutes, limit: 10 });
  if (summary.sent > 0) {
    logger.info({ sent: summary.sent, attempted: summary.attempted }, "Orders parked for Venium balance were re-sent automatically");
  }
  return summary.sent;
}

// Venium is the only one who knows if a processing order finished. The
// webhook is the happy path; this defensive pass asks the reseller API for
// the recent orders and completes anything that already finished, so a lost
// webhook never leaves a customer waiting forever.
export async function reconcileVeniumProcessing(
  db: Database.Database,
  core: BotCore | null,
  getOrders: (query?: Record<string, string | number>) => Promise<unknown>,
): Promise<number> {
  const rows = db.prepare(`
    SELECT id, venium_order_id AS veniumOrderId FROM orders
    WHERE status = 'venium_processing' AND venium_order_id IS NOT NULL
      AND updated_at < ?
    LIMIT 25
  `).all(new Date(Date.now() - 10 * 60_000).toISOString()) as Array<{ id: string; veniumOrderId: string }>;
  if (!rows.length) return 0;

  let payload: any;
  try {
    payload = await getOrders({ limit: 100 });
  } catch (error) {
    logger.warn({ err: error }, "Could not list Venium orders for reconciliation");
    return 0;
  }
  const list: any[] = Array.isArray(payload) ? payload : Array.isArray(payload?.orders) ? payload.orders : Array.isArray(payload?.data) ? payload.data : [];
  if (!list.length) return 0;

  let completed = 0;
  for (const row of rows) {
    const match = list.find((item) => String(item?.orderId ?? item?.id ?? "") === row.veniumOrderId);
    const status = String(match?.status ?? "").toLowerCase();
    if (!status) continue;
    if (isCompletedStatus(status)) {
      db.prepare("UPDATE orders SET status = 'completed', delivered_code = COALESCE(?, delivered_code), updated_at = ? WHERE id = ?")
        .run(match?.deliveredCode ?? match?.code ?? null, new Date().toISOString(), row.id);
      db.prepare(`
        INSERT INTO order_status_history (order_id, from_status, to_status, source, metadata_json, created_at)
        VALUES (?, 'venium_processing', 'completed', 'venium_reconcile', ?, ?)
      `).run(row.id, JSON.stringify({ veniumOrderId: row.veniumOrderId, status }), new Date().toISOString());
      await notifyOrderCompleted(db, core, row.id);
      completed += 1;
    } else if (isFailedStatus(status)) {
      db.prepare("UPDATE orders SET status = 'failed', updated_at = ? WHERE id = ?").run(new Date().toISOString(), row.id);
      publishEvent({
        type: "order_stuck",
        jid: "sistema@vex.store",
        phone: "Sistema",
        preview: `Pedido ${row.id.slice(0, 8)} FALLÓ en Venium (${status}): revisar y reembolsar`,
        meta: { orderId: row.id, status, reason: "venium_failed" },
      });
    }
  }
  return completed;
}
