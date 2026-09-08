import Database from "better-sqlite3";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { env } from "../../config/env.js";
import { setWebhookOrderStatus } from "../orders/order.service.js";

export function verifyVeniumSignature(rawBody: string, signature: string): boolean {
  if (!env.VENIUM_WEBHOOK_SECRET || !signature) return false;
  const expected = createHmac("sha256", env.VENIUM_WEBHOOK_SECRET).update(rawBody).digest("hex");
  const left = Buffer.from(expected, "utf8");
  const right = Buffer.from(signature, "utf8");
  return left.length === right.length && timingSafeEqual(left, right);
}

export function isFreshWebhook(timestamp: string): boolean {
  const parsed = Date.parse(timestamp);
  if (!Number.isFinite(parsed)) return false;
  return Math.abs(Date.now() - parsed) <= env.WEBHOOK_TIMESTAMP_TOLERANCE_SECONDS * 1000;
}

export function processVeniumWebhook(
  db: Database.Database,
  rawBody: string,
  signature: string,
  timestamp: string,
  eventHeader?: string,
): { duplicate: boolean; matchedOrderId: string | null; eventType: string } {
  const payload: any = JSON.parse(rawBody);
  const eventType = String(payload.event ?? eventHeader ?? "");
  const orderId = payload.data?.orderId ? String(payload.data.orderId) : null;
  const eventKey = createHash("sha256").update(`${eventType}|${orderId ?? ""}|${timestamp}|${rawBody}`).digest("hex");

  const existing = db.prepare("SELECT id FROM webhook_events WHERE event_key = ?").get(eventKey);
  if (existing) return { duplicate: true, matchedOrderId: null, eventType };

  db.prepare(`
    INSERT INTO webhook_events
      (event_key, event_type, venium_order_id, payload_json, signature, timestamp_header, processing_status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, 'received', ?)
  `).run(eventKey, eventType, orderId, rawBody, signature, timestamp, new Date().toISOString());

  try {
    const matchedOrderId = orderId
      ? setWebhookOrderStatus(db, orderId, String(payload.data?.status ?? eventType.replace("order.", "")), payload.data?.deliveredCode)
      : null;
    db.prepare(`
      UPDATE webhook_events SET processing_status = 'processed', processed_at = ?
      WHERE event_key = ?
    `).run(new Date().toISOString(), eventKey);
    return { duplicate: false, matchedOrderId, eventType };
  } catch (error) {
    db.prepare(`
      UPDATE webhook_events SET processing_status = 'failed', error_message = ?
      WHERE event_key = ?
    `).run(error instanceof Error ? error.message : "unknown error", eventKey);
    throw error;
  }
}