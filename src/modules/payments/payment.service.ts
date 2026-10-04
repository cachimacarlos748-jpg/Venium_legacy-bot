import Database from "better-sqlite3";
import { Decimal } from "decimal.js";
import { createHash } from "node:crypto";
import { createPabiloClient } from "../pabilo/pabilo.client.js";
import { createBdvClient } from "../bdv/bdv.browser.js";
import { createReceiptAnalyzer } from "../gemini/gemini.adapter.js";
import { createVeniumClient } from "../venium/venium.client.js";
import { getSettings } from "../admin/settings.service.js";
import { getOrder, setPaymentState, setVeniumOrder, changeStatus } from "../orders/order.service.js";
import { env } from "../../config/env.js";
import {
  evaluatePayment,
  isUniqueConstraintError,
  linkAttemptToVeniumOrder,
  reclaimPaymentAttempt,
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

// Ambos proveedores exponen la misma interfaz. Elegir uno es cambiar una
// variable de entorno, no reescribir el pipeline de pagos.
//
// El monto que se verifica es SIEMPRE el del pedido (no el que el cliente
// transcribió): el cliente confirma la referencia y nosotros exigimos que el
// movimiento del banco tenga exactamente el monto de su pedido. Eso es lo que
// permite verificar "solo con la referencia" cuando la foto del comprobante
// no se pudo leer.
async function verifyWithProvider(input: { db: Database.Database; amount: string; orderAmount: string; bankReference: string; userBankId: string; movementType: string }) {
  if (env.PAYMENT_PROVIDER === "bdv") {
    return createBdvClient(input.db).verifyPayment({ amount: input.orderAmount, bankReference: input.bankReference });
  }
  return pabilo.verifyPayment({
    userBankId: input.userBankId,
    amount: input.amount,
    bankReference: input.bankReference,
    movementType: input.movementType,
  });
}
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
  // Verificación por REFERENCIA SOLA (sin foto legible): el monto que se exige
  // es el del pedido, y el antifraude no puede comparar datos del receptor
  // porque no hay imagen. La referencia + el monto exacto siguen siendo la
  // barrera real contra fraude.
  referenceOnly?: boolean;
}

// Motivo EXACTO que el cliente debe leer cuando su pago no pasó la
// verificación. Antes todo caía en un "no pude verificar" genérico y la gente
// se molestaba (con razón): no sabía si el problema era la referencia, el
// monto o el banco.
export function describePaymentFailure(status: string | undefined, order: any): { title: string; detail: string } {
  const total = order?.sale_price_bs_total ? `Bs ${Number(order.sale_price_bs_total).toLocaleString("es-VE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "el monto de tu pedido";
  switch (String(status ?? "")) {
    case "not_found":
      return {
        title: "🔍 Referencia no encontrada en el banco",
        detail: `No aparece ningún pago con esa referencia en el banco. Revisa que sea exactamente la que sale en tu comprobante (sin letras) y mándamela otra vez.`,
      };
    case "amount_mismatch":
      return {
        title: "⚠️ El monto no coincide",
        detail: `Encontré la referencia, pero el monto del banco NO es el de tu pedido (*${total}*). Verifica si pagaste el monto correcto; si fue un error, mándame el comprobante correcto.`,
      };
    case "duplicate":
      return {
        title: "⚠️ Esa referencia ya fue usada",
        detail: "Esa referencia ya está registrada en OTRO pedido de la tienda. Cada pago tiene su propia referencia: revisa tu comprobante y mándame la correcta. Si crees que es un error, escribe *soporte* y una persona lo revisa.",
      };
    case "bank_unavailable":
      return {
        title: "🏦 El banco no está respondiendo",
        detail: "En este momento no puedo consultar el banco. Espera unos minutos y mándame la referencia otra vez.",
      };
    default:
      return {
        title: "No pude confirmar ese pago",
        detail: "Revisa la referencia y el monto, y mándamelos otra vez. Si ya pagaste y sigue sin aparecer, escribe *soporte*.",
      };
  }
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
        'amount_mismatch', 'bank_unavailable', 'error', 'pabilo_disabled',
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
    // Reenviar la MISMA referencia del MISMO pedido es un reintento, no un
    // fraude: la verificacion anterior pudo quedar en not_found o
    // bank_unavailable (el banco todavia no mostraba el pago). Antes esto
    // respondia "esa referencia ya fue usada" y encerraba al cliente en un
    // bucle. Se reutiliza la fila reservada con el estado nuevo; solo OTRA
    // orden reclamando la referencia conserva el camino de duplicado.
    const owned: any = evaluation.reference
      ? db.prepare("SELECT id FROM payment_attempts WHERE reference = ? AND order_id = ?")
          .get(evaluation.reference, order.id)
      : null;
    if (!owned) {
      recordSecurityEvent(db, order, input, "reference_or_receipt_hash_race_duplicate");
      updateOrderPaymentData(db, orderId, input, evaluation, "duplicate", "reference_or_receipt_hash_race_duplicate");
      setPaymentState(db, orderId, "duplicate");
      return { order: getOrder(db, orderId), pabilo: null, duplicate: true };
    }
    attemptId = Number(owned.id);
    reclaimPaymentAttempt(db, attemptId, input, evaluation, input.geminiStatus ?? "extracted");
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
  // The on/off switch belongs to Pabilo. With our own BDV verifier the gate
  // would silently skip the bank check entirely (payments were left
  // 'pabilo_disabled' and the customer was told nothing).
  if (!settings.pabiloEnabled && env.PAYMENT_PROVIDER !== "bdv") {
    updatePaymentAttempt(db, attemptId, {
      antifraudStatus: "clear",
      pabiloStatus: "disabled",
    });
    setPaymentState(db, orderId, "pabilo_disabled");
    return { order: getOrder(db, orderId), provider: { status: "error", isNew: false }, pabilo: { status: "error", isNew: false }, duplicate: false };
  }

  const reference = evaluation.reference;
  let result;
  try {
    result = await verifyWithProvider({
      db,
      userBankId: settings.pabiloUserBankId || env.PABILO_USER_BANK_ID,
      amount: amount.toFixed(2),
      // El banco debe mostrar EXACTAMENTE el total del pedido: es la regla que
      // autoriza a verificar con la referencia sola cuando no hay foto.
      orderAmount: String(order.sale_price_bs_total),
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

// Deterministic receipt parser: pulls the referencia and monto from typed
// text like "953712 Trasnferi 800", "Monto 800,00 Referencia 953712" or
// "3712 monto 800,00". Handles customers who omit the word "referencia" and
// misspell "transferí" (trasnferi). Exported for regression tests.
export function regexExtractReceipt(text: string): { reference: string | null; amountBs: string | null } {
  // Reference: labeled first ("ref 953712", "operación: 953712"), otherwise
  // the first standalone number (4+ digits: customers often paste a truncated
  // reference like "3712"; Pabilo simply reports not_found if it is wrong).
  const refMatch = text.match(/(?:ref(?:erencia)?\.?|operaci[oó]n|op\.?)\s*[:#]?\s*([0-9]{6,25})/i)
    ?? text.match(/\b([0-9]{4,25})\b/);
  // Amount: labeled ("monto 800,00"), then a decimal figure ("800,00"),
  // then a figure right after a transfer verb ("trasnferi 800" — misspelling
  // included, and the trailing -i/-í of "transferí").
  const amtMatch = text.match(/(?:monto|total|por|bs\.?|pago)\s*[:]??\s*([0-9][0-9.,]*)/i)
    ?? text.match(/\b([0-9]{1,7}[.,][0-9]{2})\b/)
    ?? text.match(/(?:transfer[ií]?|trasnf(?:er|ir)[ií]?|deposit|abon|pagu[eé]|envi[eé])\s*[:]??\s*([0-9][0-9.,]*)/i);
  if (!refMatch && !amtMatch) return { reference: null, amountBs: null };
  return {
    reference: refMatch ? refMatch[1] : null,
    amountBs: amtMatch ? normalizeBsAmount(amtMatch[1]) : null,
  };
}

export async function submitReceipt(
  db: Database.Database,
  orderId: string,
  input: { text?: string; imageBase64?: string; imageMimeType?: string },
): Promise<any> {
  // Gemini can be down (503 "high demand" windows last hours on the free
  // tier). It must NEVER block checkout: on failure, keep going and let the
  // deterministic path below decide what the customer sees.
  let extraction = { reference: null, amountBs: null, paymentDate: null, bank: null, recipientData: null, confidence: null } as Awaited<ReturnType<typeof receiptAnalyzer.analyze>>;
  try {
    extraction = await receiptAnalyzer.analyze(input);
  } catch (error) {
    console.error("[receipt] Gemini analyze failed; using deterministic fallback", {
      error: error instanceof Error ? error.message : String(error),
      hasImage: Boolean(input.imageBase64),
    });
  }
  // Gemini-less resilience: if the analyzer could not extract the fields (or
  // Gemini is down) and the customer typed the receipt, parse the classic
  // venezuelan "referencia + monto" text deterministically.
  if ((!extraction.reference || !extraction.amountBs) && input.text) {
    const fallback = regexExtractReceipt(input.text);
    if (fallback.reference || fallback.amountBs) {
      extraction = {
        reference: extraction.reference ?? fallback.reference,
        amountBs: extraction.amountBs ?? fallback.amountBs,
        paymentDate: extraction.paymentDate,
        bank: extraction.bank,
        recipientData: extraction.recipientData,
        confidence: extraction.confidence ?? 0.5,
      };
    }
  }
  // The customer typed ONLY the reference (the photo could not be read, or the
  // bank app's receipt is unreadable): verify with the reference alone, but
  // ONLY against the exact total of the order. That is the rule the store
  // agreed on, and it is what keeps a real customer from being stuck in a loop
  // of "no pude leer el comprobante".
  const reference = extraction.reference;
  const referenceOnly = Boolean(reference) && !extraction.amountBs;
  if (!reference) {
    setPaymentState(db, orderId, "gemini_extraction_incomplete");
    return {
      order: getOrder(db, orderId),
      gemini: { status: "incomplete", extraction },
      pabilo: null,
    };
  }
  const order: any = getOrder(db, orderId);
  // The amount under test is ALWAYS the order total: with a readable receipt
  // the extracted amount is compared against it by the antifraud rules, and
  // with a reference-only submission the order total is what the bank
  // movement must match exactly.
  const normalizedAmount = referenceOnly
    ? normalizeBsAmount(String(order?.sale_price_bs_total ?? "0"))
    : normalizeBsAmount(extraction.amountBs ?? "0");
  // Reference-only has no image: hash the normalized reference so a repeated
  // submission of the same reference is still detected by the reference check
  // (the unique reference index), not by a bogus image hash.
  const rawReceipt = input.imageBase64
    ? Buffer.from(input.imageBase64.replace(/^data:[^;]+;base64,/, ""), "base64")
    : Buffer.from(referenceOnly ? `ref:${reference}` : input.text ?? "", "utf8");
  const receiptHash = createHash("sha256").update(rawReceipt).digest("hex");
  try {
    return await submitPayment(db, orderId, {
      reference,
      amountBs: normalizedAmount,
      receiptHash,
      paymentDate: extraction.paymentDate ?? undefined,
      bank: extraction.bank ?? undefined,
      recipientData: extraction.recipientData ?? undefined,
      geminiStatus: referenceOnly ? "reference_only" : "extracted",
      referenceOnly,
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