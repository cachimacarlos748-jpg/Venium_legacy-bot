import Database from "better-sqlite3";
import { Decimal } from "decimal.js";
import { createHash } from "node:crypto";
import { createPabiloClient } from "../pabilo/pabilo.client.js";
import { createReceiptAnalyzer } from "../gemini/gemini.adapter.js";
import { createVeniumClient } from "../venium/venium.client.js";
import { getSettings } from "../admin/settings.service.js";
import { getOrder, setPaymentState, setVeniumOrder, changeStatus } from "../orders/order.service.js";
import { env } from "../../config/env.js";
import {
  evaluatePayment,
  isUniqueConstraintError,
  linkAttemptToVeniumOrder,
  recordSecurityEvent,
  reservePaymentAttempt,
  updateOrderPaymentData,
  updatePaymentAttempt,
} from "../antifraud/antifraud.service.js";

const pabilo = createPabiloClient();
const venium = createVeniumClient();
const receiptAnalyzer = createReceiptAnalyzer();

export interface PaymentSubmission {
  reference: string;
  amountBs: string;
  receiptHash: string;
  paymentDate?: string;
  bank?: string;
  recipientData?: Record<string, string>;
  geminiStatus?: string;
}

export async function submitPayment(db: Database.Database, orderId: string, input: PaymentSubmission): Promise<any> {
  const order: any = getOrder(db, orderId);
  if (!order) throw new Error("order not found");
  const amount = new Decimal(input.amountBs);
  if (amount.lte(0)) throw new Error("amountBs must be positive");

  const evaluation = evaluatePayment(db, order, input);
  if (evaluation.status === "duplicate") {
    if (order.payment_status === "checking") {
      return { order, pabilo: null, idempotent: true, inProgress: true };
    }
    const reason = evaluation.reasons.join(",");
    recordSecurityEvent(db, order, input, reason);
    const orderAlreadyProcessed =
      ["verified_new", "venium_processing", "completed"].includes(order.payment_status) ||
      ["venium_processing", "completed"].includes(order.status);
    if (!orderAlreadyProcessed) {
      updateOrderPaymentData(db, orderId, input, evaluation, "duplicate", reason);
      setPaymentState(db, orderId, "duplicate");
    }
    return { order: getOrder(db, orderId), pabilo: null, duplicate: true };
  }
  if (["approved_for_venium", "venium_processing", "completed", "cancelled", "refunded"].includes(order.status)) {
    throw new Error("order is no longer accepting payment submissions");
  }

  // Atomically claim the quote before any provider call. This prevents two
  // different references from paying the same order concurrently.
  const claim = db.prepare(`
    UPDATE orders SET payment_status = 'checking', updated_at = ?
    WHERE id = ? AND status = 'quote_created'
      AND payment_status IN (
        'not_submitted', 'suspicious', 'duplicate', 'not_found',
        'bank_unavailable', 'error', 'pabilo_disabled',
        'gemini_extraction_incomplete'
      )
  `).run(new Date().toISOString(), orderId);
  if (claim.changes !== 1) {
    const latest: any = getOrder(db, orderId);
    if (latest?.payment_status === "checking") {
      return { order: latest, pabilo: null, idempotent: true, inProgress: true };
    }
    throw new Error("order is already being processed or no longer accepts payment submissions");
  }

  let attemptId: number;
  try {
    // This reservation happens before Pabilo. SQLite's UNIQUE constraints
    // close the race where two requests arrive with the same reference/hash.
    attemptId = reservePaymentAttempt(db, order, input, evaluation, input.geminiStatus ?? "extracted");
  } catch (error) {
    if (!isUniqueConstraintError(error)) throw error;
    recordSecurityEvent(db, order, input, "reference_or_receipt_hash_race_duplicate");
    updateOrderPaymentData(db, orderId, input, evaluation, "duplicate", "reference_or_receipt_hash_race_duplicate");
    setPaymentState(db, orderId, "duplicate");
    return { order: getOrder(db, orderId), pabilo: null, duplicate: true };
  }

  updateOrderPaymentData(
    db,
    orderId,
    input,
    evaluation,
    evaluation.status === "clear" ? "clear" : "suspicious",
    evaluation.reasons.join(",") || undefined,
  );

  if (evaluation.status !== "clear") {
    updatePaymentAttempt(db, attemptId, {
      antifraudStatus: "suspicious",
      antifraudReason: evaluation.reasons.join(","),
      pabiloStatus: "not_called",
    });
    setPaymentState(db, orderId, "suspicious");
    return {
      order: getOrder(db, orderId),
      antifraud: { status: "suspicious", reasons: evaluation.reasons },
      pabilo: null,
      duplicate: false,
    };
  }

  const settings = getSettings(db);
  if (!settings.pabiloEnabled) {
    updatePaymentAttempt(db, attemptId, {
      antifraudStatus: "clear",
      pabiloStatus: "disabled",
    });
    setPaymentState(db, orderId, "pabilo_disabled");
    return { order: getOrder(db, orderId), pabilo: { status: "error", isNew: false }, duplicate: false };
  }

  const reference = evaluation.reference;
  let result;
  try {
    result = await pabilo.verifyPayment({
      userBankId: settings.pabiloUserBankId || env.PABILO_USER_BANK_ID,
      amount: amount.toFixed(2),
      bankReference: reference,
      movementType: settings.pabiloMovementType || env.PABILO_MOVEMENT_TYPE,
    });
  } catch (error) {
    updatePaymentAttempt(db, attemptId, {
      antifraudStatus: "verified",
      pabiloStatus: "error",
      providerResponse: { error: error instanceof Error ? error.message : "Pabilo request failed" },
    });
    setPaymentState(db, orderId, "error");
    return {
      order: getOrder(db, orderId),
      pabilo: { status: "error", isNew: false },
      error: error instanceof Error ? error.message : "Pabilo request failed",
    };
  }

  updatePaymentAttempt(db, attemptId, {
    antifraudStatus: "verified",
    antifraudReason: undefined,
    pabiloStatus: result.status,
    pabiloIsNew: result.isNew,
    providerResponse: result.raw,
  });

  if (!result.verified || !result.isNew) {
    setPaymentState(db, orderId, result.status);
    return { order: getOrder(db, orderId), pabilo: result, duplicate: result.status === "duplicate" };
  }

  setPaymentState(db, orderId, "verified_new");
  changeStatus(db, orderId, "approved_for_venium", "pabilo", { reference });

  if (env.VENIUM_MODE === "live" && !env.ALLOW_LIVE_ORDER_CREATION) {
    return {
      order: getOrder(db, orderId),
      pabilo: result,
      venium: { status: "blocked_by_safety_flag" },
    };
  }

  const playerData = JSON.parse(order.player_data_json);
  const veniumOrder = await venium.createOrder({
    productId: order.veniumProductId,
    packageId: order.veniumPackageId,
    playerData,
    quantity: order.quantity,
  });
  setVeniumOrder(db, orderId, veniumOrder.orderId, "venium_processing");
  linkAttemptToVeniumOrder(db, orderId, veniumOrder.orderId);
  return { order: getOrder(db, orderId), pabilo: result, venium: veniumOrder };
}

export async function submitReceipt(
  db: Database.Database,
  orderId: string,
  input: { text?: string; imageBase64?: string; imageMimeType?: string },
): Promise<any> {
  const extraction = await receiptAnalyzer.analyze(input);
  if (!extraction.reference || !extraction.amountBs) {
    setPaymentState(db, orderId, "gemini_extraction_incomplete");
    return {
      order: getOrder(db, orderId),
      gemini: { status: "incomplete", extraction },
      pabilo: null,
    };
  }
  const rawReceipt = input.imageBase64
    ? Buffer.from(input.imageBase64.replace(/^data:[^;]+;base64,/, ""), "base64")
    : Buffer.from(input.text ?? "", "utf8");
  const receiptHash = createHash("sha256").update(rawReceipt).digest("hex");
  return submitPayment(db, orderId, {
    reference: extraction.reference,
    amountBs: extraction.amountBs,
    receiptHash,
    paymentDate: extraction.paymentDate ?? undefined,
    bank: extraction.bank ?? undefined,
    recipientData: extraction.recipientData ?? undefined,
    geminiStatus: "extracted",
  });
}