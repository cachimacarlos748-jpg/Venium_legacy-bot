import Database from "better-sqlite3";
import { Decimal } from "decimal.js";
import { createHash } from "node:crypto";
import { createPabiloClient, type PabiloPaymentResult } from "../pabilo/pabilo.client.js";
import { createBdvClient, bdvHabilitado, BDV_APAGADO_NOTA } from "../bdv/bdv.browser.js";
import { createReceiptAnalyzer } from "../gemini/gemini.adapter.js";
import { createVeniumClient } from "../venium/venium.client.js";
import { getSettings } from "../admin/settings.service.js";
import { getOrder, setPaymentState, setVeniumOrder, changeStatus } from "../orders/order.service.js";
import { publishEvent } from "../events/event-bus.js";
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

/**
 * Configuracion de Pabilo EFECTIVA, con las variables de entorno por delante
 * de lo guardado en el panel.
 *
 * La clave de Pabilo caduca (10 dias / 40 creditos segun el plan), asi que se
 * rota seguido. Si el panel manda, la tienda se queda verificando con la clave
 * vieja hasta que alguien recuerde abrir el admin y pegar la nueva: los pagos
 * caen en "no pude confirmar" y el cliente cree que su pago fue rechazado. Con
 * el entorno mandando, cambiar la clave es cambiar una variable y reiniciar.
 */
export function resolvePabiloConfig(settings: { pabiloEnabled: boolean; pabiloUserBankId: string; pabiloMovementType: string }) {
  const userBankId = env.PABILO_USER_BANK_ID || settings.pabiloUserBankId;
  const movementType = env.PABILO_MOVEMENT_TYPE || settings.pabiloMovementType;
  const apiKeyConfigured = Boolean(env.PABILO_API_KEY);
  // El interruptor del panel manda, con una excepcion: si el despliegue
  // declaro credenciales de Pabilo completas, esta activo aunque el interruptor
  // siga apagado (asi quedo la tienda, con pedidos en 'pabilo_disabled' y el
  // cliente sin respuesta). PABILO_ENABLED=false lo apaga igual, para cuando se
  // quiera parar el servicio a proposito.
  const configured = env.PABILO_MODE !== "mock" && apiKeyConfigured && Boolean(userBankId);
  const enabled = env.PABILO_ENABLED === "false" ? false : settings.pabiloEnabled || configured;
  return {
    enabled,
    userBankId,
    movementType,
    apiKeyConfigured,
    mode: env.PABILO_MODE,
    baseUrl: env.PABILO_BASE_URL,
    source: (env.PABILO_USER_BANK_ID ? "env" : "panel") as "env" | "panel",
    panelEnabled: settings.pabiloEnabled,
    configured,
  };
}

// Ambos proveedores exponen la misma interfaz. Elegir uno es cambiar una
// variable de entorno, no reescribir el pipeline de pagos.
//
// El monto que se verifica es SIEMPRE el del pedido (no el que el cliente
// transcribió): el cliente confirma la referencia y nosotros exigimos que el
// movimiento del banco tenga exactamente el monto de su pedido. Eso es lo que
// permite verificar "solo con la referencia" cuando la foto del comprobante
// no se pudo leer.
export interface ProviderVerification {
  result: PabiloPaymentResult;
  // El despliegue pide un proveedor que no puede verificar y se uso el otro.
  // Viaja hasta el aviso al dueno (ver config_mismatch) porque es un problema
  // de variables de entorno, no del pago de un cliente.
  configWarning?: string;
}

async function verifyWithProvider(input: { db: Database.Database; amount: string; orderAmount: string; bankReference: string; userBankId: string; movementType: string }): Promise<ProviderVerification> {
  if (env.PAYMENT_PROVIDER === "bdv" && bdvHabilitado()) {
    return { result: await createBdvClient(input.db).verifyPayment({ amount: input.orderAmount, bankReference: input.bankReference }) };
  }
  // PAYMENT_PROVIDER=bdv con el verificador apagado es una desincronizacion de
  // configuracion, no un pago malo. Antes lanzaba un error y TODOS los pagos
  // caian en "estamos verificando mas lento" mientras el cliente creia que su
  // dinero se habia perdido. Como la tienda verifica con Pabilo, se sigue con
  // Pabilo y se avisa al dueno del desajuste en vez de dejarlo adivinando.
  const result = await pabilo.verifyPayment({
    userBankId: input.userBankId,
    amount: input.amount,
    bankReference: input.bankReference,
    movementType: input.movementType,
  });
  if (env.PAYMENT_PROVIDER !== "bdv") return { result };
  return {
    result,
    configWarning: `PAYMENT_PROVIDER=bdv pero el verificador BDV esta apagado (BDV_ENABLED=${env.BDV_ENABLED || "false"}). ${BDV_APAGADO_NOTA}`,
  };
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
        detail: "En este momento no puedo consultar el banco. *Tu pago NO fue rechazado*: espera unos minutos y mándame la referencia otra vez.",
      };
    case "error":
    case "pabilo_disabled":
      // Fallo nuestro (servicio caido, clave sin créditos, sin configuracion).
      // Decirle al cliente "no pude confirmar" sin más lo deja pensando que su
      // pago fue rechazado, y entonces paga otra vez.
      return {
        title: "⏳ Estamos verificando más lento de lo normal",
        detail: "No pude confirmar tu pago en este momento, pero *no significa que esté mal*: tu dinero no se pierde. Espera unos minutos y mándame la referencia otra vez, o escribe *soporte* y lo resolvemos ya.",
      };
    default:
      return {
        title: "No pude confirmar ese pago",
        detail: "Revisa la referencia y el monto, y mándamelos otra vez. Si ya pagaste y sigue sin aparecer, escribe *soporte*.",
      };
  }
}

// Aviso al dueno cuando el proveedor de pagos no puede responder. Con una
// clave de 10 dias y 40 creditos, estos son los fines de ciclo: sin aviso el
// primer sintoma es que "los pagos no entran" y se pierde tiempo sospechando
// del banco. Se agrupa por motivo y no mas de una vez cada 30 minutos para no
// llenar el telefono de notificaciones iguales.
const providerAlertAt = new Map<string, number>();
const PROVIDER_ALERT_THROTTLE_MS = 30 * 60_000;
const PROVIDER_ALERT_TEXT: Record<string, string> = {
  no_credits: "se acabaron los creditos de Pabilo",
  invalid_key: "la clave de Pabilo esta vencida o mal pegada",
  bank_missing: "el banco receptor no esta registrado en Pabilo (revisar PABILO_USER_BANK_ID)",
  rate_limited: "Pabilo esta limitando las consultas",
  server_error: "Pabilo esta fallando",
  bank_unavailable: "el banco no responde a Pabilo",
  invalid_request: "Pabilo rechazo la consulta",
  config_mismatch: "PAYMENT_PROVIDER=bdv con el verificador BDV apagado: la tienda verifica con Pabilo, pero el despliegue sigue pidiendo BDV (revisar las variables)",
};

function alertProviderProblem(order: any, result: { status?: string; reason?: string; message?: string }): void {
  const reason = String(result.reason ?? "server_error");
  const last = providerAlertAt.get(reason) ?? 0;
  if (Date.now() - last < PROVIDER_ALERT_THROTTLE_MS) return;
  providerAlertAt.set(reason, Date.now());
  const jid = String(order?.whatsapp_jid ?? "");
  publishEvent({
    type: "provider_alert",
    jid,
    phone: jid.split("@")[0] || "web",
    preview: `Verificacion de pagos caida: ${PROVIDER_ALERT_TEXT[reason] ?? reason}`,
    meta: { reason, message: result.message ?? "" },
  });
}

export async function submitPayment(db: Database.Database, orderId: string, input: PaymentSubmission): Promise<any> {  const order: any = getOrder(db, orderId);
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
  const pabiloConfig = resolvePabiloConfig(settings);
  // The on/off switch belongs to Pabilo. With our own BDV verifier the gate
  // would silently skip the bank check entirely (payments were left
  // 'pabilo_disabled' and the customer was told nothing).
  if (!pabiloConfig.enabled && env.PAYMENT_PROVIDER !== "bdv") {
    updatePaymentAttempt(db, attemptId, {
      antifraudStatus: "clear",
      pabiloStatus: "disabled",
    });
    setPaymentState(db, orderId, "pabilo_disabled");
    return { order: getOrder(db, orderId), provider: { status: "error", isNew: false }, pabilo: { status: "error", isNew: false }, duplicate: false };
  }

  const reference = evaluation.reference;
  let result: PabiloPaymentResult;
  let configWarning: string | undefined;
  try {
    const verification = await verifyWithProvider({
      db,
      userBankId: pabiloConfig.userBankId,
      amount: amount.toFixed(2),
      // El banco debe mostrar EXACTAMENTE el total del pedido: es la regla que
      // autoriza a verificar con la referencia sola cuando no hay foto.
      orderAmount: String(order.sale_price_bs_total),
      bankReference: reference,
      movementType: pabiloConfig.movementType,
    });
    result = verification.result;
    configWarning = verification.configWarning;
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

  // La clave de Pabilo es de un mes. Cuando se acaba el credito o se vence,
  // TODOS los pagos se caen a la vez y sin explicacion: hay que avisarle al
  // dueno aunque todavia no haya fallado nada mas.
  if (result.status === "bank_unavailable") alertProviderProblem(order, result);

  // Desajuste de variables del despliegue: sin este aviso la unica senal es
  // "los pagos tardan en confirmar" y el dueno no tiene como saber que la
  // culpa es de PAYMENT_PROVIDER.
  if (configWarning) alertProviderProblem(order, { reason: "config_mismatch", message: configWarning });

  // Pabilo dice "esta referencia ya se uso", pero la referencia esta reservada
  // por ESTE pedido (si fuera de otro, el antifraude lo habria detenido antes).
  // O sea: un intento anterior nuestro la consumio y el proceso murio antes de
  // anotarlo. El dinero ya es nuestro, asi que se continua el pedido normal en
  // vez de acusarle al cliente de usar la referencia de otro.
  if (result.status === "duplicate") {
    result = { ...result, verified: true, isNew: true, status: "verified_new", raw: { ...(result.raw as object), recoveredOwnDuplicate: true } };
  }

  updatePaymentAttempt(db, attemptId, {
    antifraudStatus: "verified",
    antifraudReason: undefined,
    pabiloStatus: result.status,
    pabiloIsNew: result.isNew,
    providerResponse: configWarning ? { configWarning, provider: result.raw } : result.raw,
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