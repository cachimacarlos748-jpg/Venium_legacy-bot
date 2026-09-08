import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { Decimal } from "decimal.js";
import { findPackage } from "../catalog/catalog.service.js";
import { getSettings } from "../admin/settings.service.js";
import { calculatePrice } from "../pricing/pricing.service.js";

export interface CreateOrderInput {
  whatsappJid: string;
  phoneDisplay?: string;
  customerName?: string;
  packageId: string;
  playerData: Record<string, string>;
  quantity?: number;
}

function changeStatus(
  db: Database.Database,
  orderId: string,
  toStatus: string,
  source: string,
  metadata: unknown = {},
): void {
  const current: any = db.prepare("SELECT status FROM orders WHERE id = ?").get(orderId);
  db.prepare("UPDATE orders SET status = ?, updated_at = ? WHERE id = ?")
    .run(toStatus, new Date().toISOString(), orderId);
  db.prepare(`
    INSERT INTO order_status_history
      (order_id, from_status, to_status, source, metadata_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(orderId, current?.status ?? null, toStatus, source, JSON.stringify(metadata), new Date().toISOString());
}

export function createLocalOrder(db: Database.Database, input: CreateOrderInput): any {
  if (!input.whatsappJid) throw new Error("whatsappJid is required");
  const item: any = findPackage(db, input.packageId);
  if (!item) throw new Error("package not found in local catalog");
  if (item.outOfStock) throw new Error("package is out of stock");
  const requiredFields = db.prepare(`
    SELECT field_key AS fieldKey, required
    FROM player_fields WHERE product_id = ?
  `).all(item.productLocalId) as Array<{ fieldKey: string; required: number }>;
  for (const field of requiredFields) {
    if (field.required && !String(input.playerData[field.fieldKey] ?? "").trim()) {
      throw new Error(`missing required player field: ${field.fieldKey}`);
    }
  }
  const quantity = input.quantity ?? 1;
  const settings = getSettings(db);
  const quote = calculatePrice(item.costUsd, quantity, settings);
  const now = new Date().toISOString();
  const orderId = randomUUID();

  const transaction = db.transaction(() => {
    db.prepare(`
      INSERT INTO customers (whatsapp_jid, phone_display, name, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(whatsapp_jid) DO UPDATE SET
        phone_display = excluded.phone_display,
        name = excluded.name,
        updated_at = excluded.updated_at
    `).run(input.whatsappJid, input.phoneDisplay ?? "", input.customerName ?? "", now, now);
    const customerId = db.prepare("SELECT id FROM customers WHERE whatsapp_jid = ?").pluck().get(input.whatsappJid);

    db.prepare(`
      INSERT INTO orders (
        id, customer_id, product_id, package_id, quantity, player_data_json,
        cost_usd_unit, cost_usd_total, exchange_rate, margin_percent,
        price_before_rounding_bs, rounding_mode, rounding_increment_bs,
        minimum_price_bs, sale_price_bs_unit, sale_price_bs_total,
        payment_status, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'not_submitted', 'quote_created', ?, ?)
    `).run(
      orderId,
      customerId,
      item.productLocalId,
      item.packageLocalId,
      quantity,
      JSON.stringify(input.playerData),
      quote.costUsdUnit,
      new Decimal(quote.costUsdUnit).mul(quantity).toFixed(2),
      settings.usdToBsRate,
      settings.marginPercent,
      quote.priceBeforeRoundingBs,
      settings.roundingMode,
      settings.roundingIncrementBs,
      settings.minimumPriceBs,
      quote.salePriceBsUnit,
      quote.salePriceBsTotal,
      now,
      now,
    );
    db.prepare(`
      INSERT INTO order_status_history
        (order_id, from_status, to_status, source, metadata_json, created_at)
      VALUES (?, NULL, 'quote_created', 'system', ?, ?)
    `).run(orderId, JSON.stringify({ quote }), now);
  });
  transaction();
  return getOrder(db, orderId);
}

export function getOrder(db: Database.Database, orderId: string): any {
  const order: any = db.prepare(`
    SELECT
      o.*,
      c.whatsapp_jid AS whatsappJid,
      c.phone_display AS phoneDisplay,
      p.name AS productName,
      pk.name AS packageName,
      p.venium_product_id AS veniumProductId,
      pk.venium_package_id AS veniumPackageId
    FROM orders o
    LEFT JOIN customers c ON c.id = o.customer_id
    JOIN products p ON p.id = o.product_id
    JOIN packages pk ON pk.id = o.package_id
    WHERE o.id = ?
  `).get(orderId);
  if (!order) return null;
  return {
    ...order,
    playerData: JSON.parse(order.player_data_json),
  };
}

export function toPublicOrder(order: any): Record<string, unknown> {
  return {
    id: order.id,
    productName: order.productName,
    packageName: order.packageName,
    quantity: order.quantity,
    playerData: order.playerData,
    salePriceBsUnit: order.sale_price_bs_unit,
    salePriceBsTotal: order.sale_price_bs_total,
    paymentStatus: order.payment_status,
    status: order.status,
    veniumOrderId: order.venium_order_id,
    createdAt: order.created_at,
    updatedAt: order.updated_at,
  };
}

export function listOrders(db: Database.Database): any[] {
  return db.prepare(`
    SELECT o.id, o.venium_order_id AS veniumOrderId, o.status, o.payment_status AS paymentStatus,
           c.whatsapp_jid AS whatsappJid, p.name AS productName, pk.name AS packageName,
           sale_price_bs_total AS salePriceBsTotal, payment_reference AS paymentReference,
           o.created_at AS createdAt, o.updated_at AS updatedAt
    FROM orders o
    LEFT JOIN customers c ON c.id = o.customer_id
    JOIN products p ON p.id = o.product_id
    JOIN packages pk ON pk.id = o.package_id
    ORDER BY o.created_at DESC LIMIT 100
  `).all() as any[];
}

export function setPaymentState(db: Database.Database, orderId: string, paymentStatus: string): void {
  db.prepare("UPDATE orders SET payment_status = ?, updated_at = ? WHERE id = ?")
    .run(paymentStatus, new Date().toISOString(), orderId);
}

export function setVeniumOrder(
  db: Database.Database,
  orderId: string,
  veniumOrderId: string,
  status: string,
): void {
  db.prepare("UPDATE orders SET venium_order_id = ?, updated_at = ? WHERE id = ?")
    .run(veniumOrderId, new Date().toISOString(), orderId);
  changeStatus(db, orderId, status, "venium", { veniumOrderId });
}

export function setWebhookOrderStatus(
  db: Database.Database,
  veniumOrderId: string,
  status: string,
  deliveredCode?: string,
): any {
  const order: any = db.prepare("SELECT id, status FROM orders WHERE venium_order_id = ?").get(veniumOrderId);
  if (!order) return null;
  db.prepare(`
    UPDATE orders SET status = ?, delivered_code = COALESCE(?, delivered_code), updated_at = ?
    WHERE id = ?
  `).run(status, deliveredCode ?? null, new Date().toISOString(), order.id);
  db.prepare(`
    INSERT INTO order_status_history
      (order_id, from_status, to_status, source, metadata_json, created_at)
    VALUES (?, ?, ?, 'venium_webhook', ?, ?)
  `).run(order.id, order.status, status, JSON.stringify({ veniumOrderId, deliveredCode }), new Date().toISOString());
  return order.id;
}

export { changeStatus };