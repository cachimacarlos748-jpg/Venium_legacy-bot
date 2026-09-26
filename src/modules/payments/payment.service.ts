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
  unlockPaymentClaim,
  updateOrderPaymentData,
  updatePaymentAttempt,
} from "../antifraud/antifraud.service.js";

// The customer-facing message the bot shows while a verified payment waits
// for the reseller wallet (Venium balance) to catch up. Never expose the
// provider error to the customer.
export const VENIUM_UNAVAILABLE_CUSTOMER_MESSAGE =
  "✅ *¡Pago confirmado! Tu recarga está en proceso y se completará en unos minutos.*\n\n🔔 Te aviso por aquí en cuanto quede lista. ¡Gracias por comprar en *Vex Store*! 🙌";

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
  // A parked 'venium_pending' order (or any already-paid order) must not go
  // through the pipeline again: Pabilo would reject the same reference as
  // already-used. The customer gets a friendly "already confirmed" answer.
  if (["approved_for_venium", "venium_pending", "venium_processing", "completed", "cancelled", "refunded"].includes(order.status)) {
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

  const playerData = JSON.parse(order.player_data_json);
  // Wallet balance is the ONE failure we do not bounce back to the customer:
  // their money is already verified and ours. Park the order as
  // 'venium_pending', release the payment claim so the order can be retried
  // later (button from the panel or a new attempt), and let the bot answer
  // with the standard "en proceso" message.
  let veniumOrder: Awaited<ReturnType<typeof venium.createOrder>> | null = null;
  let veniumError: unknown = null;
  try {
    veniumOrder = await venium.createOrder({
      productId: order.veniumProductId,
      packageId: order.veniumPackageId,
      playerData,
      quantity: order.quantity,
    });
  } catch (error) {
    veniumError = error;
  }
  if (!veniumOrder) {
    updatePaymentAttempt(db, attemptId, {
      antifraudStatus: "verified",
      pabiloStatus: "verified_new",
      pabiloIsNew: true,
      providerResponse: { veniumError: veniumError instanceof Error ? veniumError.message : String(veniumError ?? "unknown") },
    });
    setPaymentState(db, orderId, "verified_new");
    db.prepare("UPDATE orders SET venium_order_id = NULL, updated_at = ? WHERE id = ?").run(new Date().toISOString(), orderId);
    changeStatus(db, orderId, "venium_pending", "venium", {
      reason: veniumError instanceof Error ? veniumError.message : String(veniumError ?? "unknown"),
    });
    unlockPaymentClaim(db, orderId);
    return {
      order: getOrder(db, orderId),
      pabilo: result,
      venium: { status: "unavailable", queued: true },
      veniumUnavailable: true,
    };
  }
  setVeniumOrder(db, orderId, veniumOrder.orderId, "venium_processing");
  linkAttemptToVeniumOrder(db, orderId, veniumOrder.orderId);
  return { order: getOrder(db, orderId), pabilo: result, venium: veniumOrder };
}

// Admin-panel retry for orders parked as 'venium_pending' (wallet had no
// balance when the payment was verified). The payment is already confirmed;
// this ONLY talks to Venium, so Pabilo's reference uniqueness is untouched.
export async function retryVeniumOrder(db: Database.Database, orderId: string): Promise<{ ok: boolean; veniumOrderId?: string; error?: string }> {
  const order: any = getOrder(db, orderId);
  if (!order) return { ok: false, error: "order not found" };
  if (order.status !== "venium_pending") return { ok: false, error: "order is not pending a Venium retry" };
  try {
    const veniumOrder = await venium.createOrder({
      productId: order.veniumProductId,
      packageId: order.veniumPackageId,
      playerData: order.playerData,
      quantity: order.quantity,
    });
    setVeniumOrder(db, orderId, veniumOrder.orderId, "venium_processing");
    linkAttemptToVeniumOrder(db, orderId, veniumOrder.orderId);
    return { ok: true, veniumOrderId: veniumOrder.orderId };
  } catch (error) {
    // Still no balance (or another provider hiccup): keep the order queued.
    changeStatus(db, orderId, "venium_pending", "venium_retry", {
      reason: error instanceof Error ? error.message : String(error),
    });
    return { ok: false, error: error instanceof Error ? error.message : "venium retry failed" };
  }
}

// "18.500,00" -> "18500.00"; "18,500.00" -> "18500.00"; "18500.5" unchanged.
function normalizeBsAmount(raw: string): string {
  let value = raw.trim().replace(/[^0-9.,-]/g, "");
  if (value.includes(",")) {
    // Venezuelan/European style: dots are thousands, comma is decimal.
    value = value.replace(/\./g, "").replace(",", ".");
  }
  return value;
}

export async function submitReceipt(
  db: Database.Database,
  orderId: string,
  input: { text?: string; imageBase64?: string; imageMimeType?: string },
): Promise<any> {
  let extraction = await receiptAnalyzer.analyze(input);
  // Gemini-less resilience: if the analyzer could not extract the fields and
  // the customer typed the receipt (or the OCR failed), parse the classic
  // venezuelan "referencia + monto" text deterministically.
  if ((!extraction.reference || !extraction.amountBs) && input.text) {
    const refMatch = input.text.match(/(?:ref(?:erencia)?\.?|operaci[oó]n|op\.?)\s*[:#]?\s*([0-9]{6,25})/i);
    const amtMatch = input.text.match(/(?:monto|total|por|bs\.?|pago)\s*[:]?\s*([0-9][0-9.,]*)/i);
    if (refMatch || amtMatch) {
      extraction = {
        reference: extraction.reference ?? (refMatch ? refMatch[1] : null),
        amountBs: extraction.amountBs ?? (amtMatch ? normalizeBsAmount(amtMatch[1]) : null),
        paymentDate: extraction.paymentDate,
        bank: extraction.bank,
        recipientData: extraction.recipientData,
        confidence: extraction.confidence ?? 0.5,
      };
    }
  }
  if (!extraction.reference || !extraction.amountBs) {
    setPaymentState(db, orderId, "gemini_extraction_incomplete");
    return {
      order: getOrder(db, orderId),
      gemini: { status: "incomplete", extraction },
      pabilo: null,
    };
  }
  // Gemini can return Venezuelan-formatted amounts ("18.500,00" = 18500.00).
  // Normalize: strip thousand separators ("." groups) and map "," to ".".
  const normalizedAmount = normalizeBsAmount(extraction.amountBs);
  const rawReceipt = input.imageBase64
    ? Buffer.from(input.imageBase64.replace(/^data:[^;]+;base64,/, ""), "base64")
    : Buffer.from(input.text ?? "", "utf8");
  const receiptHash = createHash("sha256").update(rawReceipt).digest("hex");
  try {
    return await submitPayment(db, orderId, {
      reference: extraction.reference,
      amountBs: normalizedAmount,
      receiptHash,
      paymentDate: extraction.paymentDate ?? undefined,
      bank: extraction.bank ?? undefined,
      recipientData: extraction.recipientData ?? undefined,
      geminiStatus: "extracted",
    });
  } catch (error) {
    // Re-sending a receipt for an order that already has its money confirmed
    // (parked for wallet balance or already at Venium) is a happy event, not
    // an error: answer with the standard "in process" message.
    if (error instanceof Error && /no longer accepting payment submissions/i.test(error.message)) {
      const latest: any = getOrder(db, orderId);
      if (latest && ["approved_for_venium", "venium_pending", "venium_processing", "completed"].includes(latest.status)) {
        return { order: latest, alreadyVerified: true, pabilo: { verified: true, isNew: true, status: "verified_new" } };
      }
    }
    throw error;
  }
}