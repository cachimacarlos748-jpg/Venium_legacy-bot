import Database from "better-sqlite3";
import { Decimal } from "decimal.js";

export interface FraudPaymentInput {
  reference: string;
  amountBs: string;
  receiptHash: string;
  paymentDate?: string;
  bank?: string;
  recipientData?: Record<string, string>;
}

export interface FraudEvaluation {
  status: "clear" | "suspicious" | "duplicate";
  reasons: string[];
  reference: string;
  receiptHash: string;
  recipientData: Record<string, string>;
}

function normalized(value: unknown): string {
  return String(value ?? "").trim().replace(/\s+/g, " ").toLowerCase();
}

export function normalizeReference(reference: string): string {
  return reference.trim().replace(/\s+/g, "").toUpperCase();
}

function parseDestination(value: string): Record<string, string> {
  try {
    const parsed = JSON.parse(value || "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("destination must be an object");
    return Object.fromEntries(Object.entries(parsed).map(([key, item]) => [key, String(item)]));
  } catch {
    return {};
  }
}

export function evaluatePayment(
  db: Database.Database,
  order: any,
  input: FraudPaymentInput,
): FraudEvaluation {
  const reference = normalizeReference(input.reference);
  const receiptHash = input.receiptHash.trim().toLowerCase();
  const recipientData = input.recipientData ?? {};
  const reasons: string[] = [];

  if (!reference) reasons.push("missing_reference");
  if (!receiptHash) reasons.push("missing_receipt_hash");
  if (!new Decimal(input.amountBs).eq(new Decimal(order.sale_price_bs_total))) {
    reasons.push("amount_mismatch");
  }

  const existingReference: any = reference
    ? db.prepare("SELECT id, order_id FROM payment_attempts WHERE reference = ?").get(reference)
    : null;
  if (existingReference) reasons.push("reference_already_used");

  const existingHash: any = receiptHash
    ? db.prepare("SELECT id, order_id FROM payment_attempts WHERE receipt_hash = ?").get(receiptHash)
    : null;
  if (existingHash) reasons.push("receipt_hash_already_used");

  const settings: any = db.prepare("SELECT payment_destination_json FROM settings WHERE id = 1").get();
  const destination = parseDestination(settings?.payment_destination_json ?? "{}");
  if (Object.keys(destination).length === 0) {
    reasons.push("destination_not_configured");
  } else {
    for (const [key, expected] of Object.entries(destination)) {
      if (!normalized(recipientData[key]) || normalized(recipientData[key]) !== normalized(expected)) {
        reasons.push(`destination_mismatch:${key}`);
      }
    }
  }

  if (input.paymentDate) {
    const paymentTime = Date.parse(input.paymentDate);
    if (!Number.isFinite(paymentTime) || paymentTime > Date.now() + 5 * 60 * 1000) {
      reasons.push("payment_date_invalid");
    }
  }

  const duplicate = reasons.some((reason) => reason === "reference_already_used" || reason === "receipt_hash_already_used");
  return {
    status: duplicate ? "duplicate" : reasons.length > 0 ? "suspicious" : "clear",
    reasons,
    reference,
    receiptHash,
    recipientData,
  };
}

export function isUniqueConstraintError(error: unknown): boolean {
  return error instanceof Error && /UNIQUE constraint failed/i.test(error.message);
}

export function recordSecurityEvent(
  db: Database.Database,
  order: any,
  input: FraudPaymentInput,
  reason: string,
): void {
  db.prepare(`
    INSERT INTO payment_security_events
      (order_id, reference, amount_bs, payment_date, bank, recipient_data_json,
       customer_whatsapp_jid, receipt_hash, reason, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'review', ?)
  `).run(
    order.id,
    normalizeReference(input.reference) || null,
    input.amountBs,
    input.paymentDate ?? null,
    input.bank ?? null,
    JSON.stringify(input.recipientData ?? {}),
    order.whatsappJid ?? "",
    input.receiptHash || null,
    reason,
    new Date().toISOString(),
  );
}

export function reservePaymentAttempt(
  db: Database.Database,
  order: any,
  input: FraudPaymentInput,
  evaluation: FraudEvaluation,
  geminiStatus: string,
): number {
  const timestamp = new Date().toISOString();
  const result = db.prepare(`
    INSERT INTO payment_attempts
      (order_id, reference, amount_bs, payment_date, bank, recipient_data_json,
       customer_whatsapp_jid, receipt_hash, antifraud_status, antifraud_reason,
       gemini_status, pabilo_status, pabilo_is_new, provider_response_json,
       created_at, updated_at, venium_order_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', NULL, NULL, ?, ?, NULL)
  `).run(
    order.id,
    evaluation.reference,
    input.amountBs,
    input.paymentDate ?? null,
    input.bank ?? null,
    JSON.stringify(evaluation.recipientData),
    order.whatsappJid ?? "",
    evaluation.receiptHash,
    evaluation.status,
    evaluation.reasons.join(",") || null,
    geminiStatus,
    timestamp,
    timestamp,
  );
  return Number(result.lastInsertRowid);
}

export function updatePaymentAttempt(
  db: Database.Database,
  attemptId: number,
  values: { antifraudStatus: string; antifraudReason?: string; pabiloStatus: string; pabiloIsNew?: boolean; providerResponse?: unknown },
): void {
  db.prepare(`
    UPDATE payment_attempts SET
      antifraud_status = ?, antifraud_reason = ?, pabilo_status = ?,
      pabilo_is_new = ?, provider_response_json = ?, updated_at = ?
    WHERE id = ?
  `).run(
    values.antifraudStatus,
    values.antifraudReason ?? null,
    values.pabiloStatus,
    values.pabiloIsNew === undefined ? null : values.pabiloIsNew ? 1 : 0,
    values.providerResponse === undefined ? null : JSON.stringify(values.providerResponse),
    new Date().toISOString(),
    attemptId,
  );
}

export function updateOrderPaymentData(
  db: Database.Database,
  orderId: string,
  input: FraudPaymentInput,
  evaluation: FraudEvaluation,
  status: string,
  reason?: string,
): void {
  db.prepare(`
    UPDATE orders SET
      payment_reference = ?, payment_receipt_hash = ?, payment_date = ?,
      payment_bank = ?, payment_recipient_json = ?, payment_antifraud_status = ?,
      payment_antifraud_reason = ?, updated_at = ?
    WHERE id = ?
  `).run(
    evaluation.reference || null,
    evaluation.receiptHash || null,
    input.paymentDate ?? null,
    input.bank ?? null,
    JSON.stringify(evaluation.recipientData),
    status,
    reason ?? null,
    new Date().toISOString(),
    orderId,
  );
}

export function linkAttemptToVeniumOrder(db: Database.Database, orderId: string, veniumOrderId: string): void {
  db.prepare(`
    UPDATE payment_attempts SET venium_order_id = ?, updated_at = ?
    WHERE order_id = ? AND antifraud_status IN ('clear', 'verified')
  `).run(veniumOrderId, new Date().toISOString(), orderId);
}