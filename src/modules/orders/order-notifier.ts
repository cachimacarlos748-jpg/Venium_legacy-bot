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

// ---------------------------------------------------------------------------
// Reenvío AUTOMÁTICO de las recargas en cola (el pago ya está verificado; lo
// único que faltaba era saldo en la billetera de Venium).
//
// Esta automatización estuvo APAGADA después de un incidente real: al entrar
// saldo, se disparó sola una recarga VIEJA y salió un paquete distinto al que
// el cliente había pagado. Se vuelve a encender con las barreras que hacen que
// ESE error sea imposible, no con promesas:
//
//   1. Solo pedidos ENCOLADOS HACE POCO (por defecto 90 minutos). Una recarga
//      vieja NUNCA se dispara sola: queda listada en el panel para que el dueño
//      la procese a mano, viendo qué paquete es.
//   2. El paquete debe seguir existiendo en el catálogo, estar activo, en stock
//      y pertenecer al MISMO producto del pedido. Si algo cambió, se salta y se
//      avisa al panel en vez de mandar otra cosa.
//   3. Un pedido que ya tiene venium_order_id no se toca (no hay doble envío).
//   4. Como máximo AUTO_RETRY_BATCH (3) por ciclo, del más antiguo al más nuevo
//      dentro de la ventana. Un tope bajo es intencional: cada recarga que sale
//      mueve dinero real.
//   5. Enfriamiento por pedido (15 min) y tope de intentos (4): si el proveedor
//      sigue sin saldo, se deja de insistir y el pedido espera al panel.
//   6. La billetera se consulta ANTES de disparar: si sabemos que está en cero,
//      ni se intenta.
// ---------------------------------------------------------------------------
const AUTO_RETRY_BATCH = 3;
const AUTO_RETRY_MAX_AGE_MINUTES = 90;
const AUTO_RETRY_COOLDOWN_MS = 15 * 60_000;
const AUTO_RETRY_MAX_ATTEMPTS = 4;

interface AutoRetryCandidate {
  id: string;
  updatedAt: string | null;
  jid: string | null;
  phone: string | null;
  productName: string | null;
  packageName: string | null;
  veniumProductId: string | null;
  veniumPackageId: string | null;
  outOfStock: number;
  productActive: number;
  orderProductId: number;
  packageProductId: number;
}

interface AutoRetryState {
  attempts: number;
  lastAttemptAt: number;
}

// Estado en memoria: no toca la base de datos (nada que migrar ni que borrar) y
// se pierde a propósito en cada arranque. Un pedido ya enviado sale de
// 'venium_pending', así que el tope de intentos solo protege de insistir contra
// el proveedor cuando todavía no hay saldo.
const autoRetryState = new Map<string, AutoRetryState>();

export interface AutoRetrySummary {
  sent: number;
  attempted: number;
  skippedOld: number;
  skippedUnsafe: number;
  skippedCooldown: number;
  balance: number | null;
  results: Array<{ id: string; ok: boolean; veniumOrderId?: string; error?: string }>;
}

// Lee el saldo de la billetera sin depender de la forma exacta de la respuesta
// del proveedor (mock, {balance}, {data:{balance}}, string...). Devuelve null
// cuando no se puede leer, y en ese caso se procede igual: no poder leer el
// saldo no puede dejar a un cliente ya pagado esperando.
function readBalance(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  for (const key of ["balance", "available", "amount", "credits", "saldo"]) {
    const direct = readBalance(record[key]);
    if (direct !== null) return direct;
  }
  for (const key of ["data", "wallet", "account", "result"]) {
    const nested = readBalance(record[key]);
    if (nested !== null) return nested;
  }
  return null;
}

export async function autoRetryVeniumPending(
  db: Database.Database,
  options: {
    olderThanMinutes?: number;
    maxAgeMinutes?: number;
    limit?: number;
    getBalance?: () => Promise<unknown>;
  } = {},
): Promise<AutoRetrySummary> {
  const olderThanMinutes = options.olderThanMinutes ?? 1;
  const maxAgeMinutes = options.maxAgeMinutes ?? AUTO_RETRY_MAX_AGE_MINUTES;
  const limit = Math.max(1, Math.min(options.limit ?? AUTO_RETRY_BATCH, AUTO_RETRY_BATCH));
  const summary: AutoRetrySummary = {
    sent: 0,
    attempted: 0,
    skippedOld: 0,
    skippedUnsafe: 0,
    skippedCooldown: 0,
    balance: null,
    results: [],
  };

  // (6) Billetera primero: sin saldo no se dispara nada.
  if (options.getBalance) {
    try {
      summary.balance = readBalance(await options.getBalance());
    } catch (error) {
      logger.warn({ err: error }, "No se pudo leer el saldo de Venium; se intenta igual");
      summary.balance = null;
    }
    if (summary.balance !== null && summary.balance <= 0) {
      logger.info({ balance: summary.balance }, "Billetera de Venium en cero: no se reenvía ninguna recarga en cola");
      return summary;
    }
  }

  const now = Date.now();
  // Poda del estado en memoria (pedidos que ya salieron de la ventana).
  for (const [orderId, state] of autoRetryState) {
    if (now - state.lastAttemptAt > maxAgeMinutes * 2 * 60_000) autoRetryState.delete(orderId);
  }

  const rows = db.prepare(`
    SELECT o.id, o.updated_at AS updatedAt, c.whatsapp_jid AS jid, c.phone_display AS phone,
           p.name AS productName, pk.name AS packageName,
           p.venium_product_id AS veniumProductId, pk.venium_package_id AS veniumPackageId,
           pk.out_of_stock AS outOfStock, p.active AS productActive,
           o.product_id AS orderProductId, pk.product_id AS packageProductId
    FROM orders o
    LEFT JOIN customers c ON c.id = o.customer_id
    JOIN products p ON p.id = o.product_id
    JOIN packages pk ON pk.id = o.package_id
    WHERE o.status = 'venium_pending' AND o.venium_order_id IS NULL
    ORDER BY o.updated_at ASC LIMIT 200
  `).all() as AutoRetryCandidate[];

  for (const row of rows) {
    if (summary.attempted >= limit) break;
    const parkedMinutes = (now - (Date.parse(row.updatedAt ?? "") || 0)) / 60_000;
    if (!Number.isFinite(parkedMinutes) || parkedMinutes < olderThanMinutes) continue;

    // (1) Nada viejo se dispara solo.
    if (parkedMinutes > maxAgeMinutes) {
      summary.skippedOld += 1;
      continue;
    }

    // (2) El paquete debe seguir siendo el mismo y estar disponible.
    const unsafe = !row.veniumProductId || !row.veniumPackageId
      || Boolean(row.outOfStock) || !row.productActive
      || row.packageProductId !== row.orderProductId;
    if (unsafe) {
      summary.skippedUnsafe += 1;
      logger.warn({ orderId: row.id }, "Recarga en cola NO se reenvía sola: el paquete cambió o no está disponible");
      publishEvent({
        type: "order_stuck",
        jid: row.jid || "sistema@vex.store",
        phone: row.phone || "Sistema",
        preview: `Pedido ${row.id.slice(0, 8)} NO se reenvió solo: ${row.productName ?? "?"} / ${row.packageName ?? "?"} cambió o no está disponible. Procésalo a mano desde el panel.`,
        meta: { orderId: row.id, reason: "auto_retry_unsafe_package" },
      });
      continue;
    }

    // (5) Enfriamiento y tope de intentos.
    const state = autoRetryState.get(row.id);
    if (state && (state.attempts >= AUTO_RETRY_MAX_ATTEMPTS || now - state.lastAttemptAt < AUTO_RETRY_COOLDOWN_MS)) {
      summary.skippedCooldown += 1;
      continue;
    }

    autoRetryState.set(row.id, { attempts: (state?.attempts ?? 0) + 1, lastAttemptAt: now });
    summary.attempted += 1;
    const result = await retryVeniumOrder(db, row.id);
    summary.results.push({ id: row.id, ok: result.ok, veniumOrderId: result.veniumOrderId, error: result.error });
    if (result.ok) {
      summary.sent += 1;
      autoRetryState.delete(row.id);
      logger.info({ orderId: row.id, veniumOrderId: result.veniumOrderId }, "Recarga en cola reenviada automáticamente");
    } else {
      logger.warn({ orderId: row.id, error: result.error }, "La recarga en cola no se pudo reenviar todavía");
    }
  }

  return summary;
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
