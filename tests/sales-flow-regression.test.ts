// Regression tests for the complaints that broke the sales flow:
//  1. the receipt photo could not be read and the bot never verified the
//     payment with the reference ALONE against the order amount,
//  2. a failed verification answered a generic "no pude verificar" instead of
//     the EXACT reason (reference not found, wrong amount, ...),
//  3. "soporte" threw the customer at a human handoff instead of the fixed
//     button menu, and the flow derailed from the fixed purchase steps,
//  4. the store never told the customer "tu recarga está lista".
import "./helpers/mock-env.js";
process.env.WHATSAPP_PROVIDER = "cloud";
process.env.WHATSAPP_MODE = "disabled";

import test from "node:test";
import assert from "node:assert/strict";
import { createDatabase, migrate } from "../src/db/connection.js";
import { syncCatalog } from "../src/modules/catalog/catalog.service.js";
import { updateSettings } from "../src/modules/admin/settings.service.js";
import { updateModerationSettings } from "../src/modules/moderation/moderation.service.js";
import { createBotCore } from "../src/modules/whatsapp/bot-core.js";
import { createLocalOrder } from "../src/modules/orders/order.service.js";
import { describePaymentFailure } from "../src/modules/payments/payment.service.js";
import { notifyOrderCompleted } from "../src/modules/orders/order-notifier.js";
import { subscribeEvents, type VexEvent } from "../src/modules/events/event-bus.js";

const db = createDatabase(":memory:");
migrate(db);
syncCatalog(db, [
  {
    productId: "free-fire",
    name: "Free Fire",
    category: "Juegos móviles",
    packages: [
      { packageId: "ff-100", name: "100 + 10 Diamantes", price: 0.77, outOfStock: false },
      { packageId: "ff-310", name: "310 + 31 Diamantes", price: 2.31, outOfStock: false },
    ],
    playerFields: [{ label: "Player ID", type: "text", required: true, key: "playerid" }],
  },
]);
updateSettings(db, {
  usdToBsRate: "990",
  marginPercent: "3",
  roundingMode: "nearest",
  roundingIncrementBs: "10",
  minimumPriceBs: "0",
  pabiloEnabled: true,
  pabiloUserBankId: "mock-bank",
  pabiloMovementType: "GENERIC",
  paymentDestinationJson: JSON.stringify({ banco: "0102 (BDV)", telefono: "04129251197" }),
}, "test");
updateModerationSettings(db, { enabled: false, windowSeconds: 60, maxMessages: 100, repeatedMessageLimit: 100, warningThreshold: 100, autoBlockThreshold: 100, cooldownSeconds: 0, blockDurationSeconds: 60 });

const sent: Array<{ to: string; text: string; buttons?: Array<{ id: string; title: string }> }> = [];
const core = createBotCore(db, async (jid, text, interactive) => {
  sent.push({ to: jid, text, buttons: interactive?.buttons });
});

const events: VexEvent[] = [];
const unsubscribe = subscribeEvents((event) => events.push(event));

let seq = 0;
async function customer(text: string, from: string) {
  await core.processIncoming({ from, text, hasMedia: false, isImage: false, timestampSec: Math.floor(Date.now() / 1000), id: `sfr-${++seq}` });
}
const last = () => sent[sent.length - 1];
const lastButtonIds = () => (last().buttons ?? []).map((button) => button.id);
const state = (jid: string) =>
  (db.prepare("SELECT state FROM whatsapp_sessions WHERE whatsapp_jid = ?").get(jid) as any)?.state;

const realFetch = globalThis.fetch;
function withLookup(ok: boolean) {
  globalThis.fetch = (async () => new Response(
    JSON.stringify(ok
      ? { success: true, data: { nickname: "★VEX★" } }
      : { success: false, data: { message: "ID incorrecto" } }),
    { status: 200, headers: { "content-type": "application/json" } },
  )) as any;
}
function restoreLookup() {
  globalThis.fetch = realFetch;
}

// Drives one purchase up to "waiting for the receipt photo".
async function openReceiptWait(jid: string, playerId: string): Promise<any> {
  await customer("pack:ff-100", jid);
  withLookup(true);
  try {
    await customer(playerId, jid);
    assert.match(last().text, /Jugador verificado/);
    await customer("pedido:confirmar", jid);
  } finally {
    restoreLookup();
  }
  assert.match(last().text, /DETALLES DE TU PEDIDO/);
  assert.equal(state(jid), "awaiting_receipt");
  return db.prepare(`
    SELECT o.id, o.sale_price_bs_total FROM orders o
    JOIN customers c ON c.id = o.customer_id
    WHERE c.whatsapp_jid = ? ORDER BY o.created_at DESC LIMIT 1
  `).get(jid) as any;
}

test("failure reasons are EXACT: reference not found, wrong amount, bank down", () => {
  const order = { sale_price_bs_total: 790 };
  const notFound = describePaymentFailure("not_found", order);
  assert.match(notFound.title, /Referencia no encontrada en el banco/);
  assert.match(notFound.detail, /exactamente la que sale en tu comprobante/);

  const mismatch = describePaymentFailure("amount_mismatch", order);
  assert.match(mismatch.title, /El monto no coincide/);
  assert.match(mismatch.detail, /Bs 790,00/, "the exact order total must be shown");

  const bankDown = describePaymentFailure("bank_unavailable", order);
  assert.match(bankDown.title, /El banco no está respondiendo/);

  const generic = describePaymentFailure("error", order);
  assert.match(generic.detail, /soporte/, "the fallback must still route to support");
});

test("the reference ALONE is verified against the exact order amount", async () => {
  const jid = "584123000001@s.whatsapp.invalid";
  const order = await openReceiptWait(jid, "7430911111");
  assert.ok(order?.id, "the order must exist before the receipt step");

  // The photo could not be read: the customer types ONLY the reference.
  await customer("953712", jid);

  assert.match(last().text, /pago quedó confirmado/i, `got: ${last().text}`);
  assert.equal(state(jid), "idle", "the flow must close cleanly after verification");

  const attempt: any = db.prepare(`
    SELECT amount_bs, gemini_status FROM payment_attempts WHERE order_id = ?
  `).get(order.id);
  assert.ok(attempt, "the payment attempt must be recorded");
  assert.equal(attempt.gemini_status, "reference_only");
  assert.equal(
    Number(attempt.amount_bs),
    Number(order.sale_price_bs_total),
    "the bank must be checked against the ORDER total, not a transcribed amount",
  );

  const paid: any = db.prepare("SELECT status, payment_status FROM orders WHERE id = ?").get(order.id);
  assert.equal(paid.payment_status, "verified_new");
  assert.ok(["venium_processing", "venium_pending"].includes(paid.status), `order went to ${paid.status}`);
});

test("'soporte' opens the fixed button menu and never a raw handoff", async () => {
  const jid = "584123000002@s.whatsapp.invalid";
  await customer("soporte", jid);
  assert.match(last().text, /SOPORTE VEX STORE/);
  assert.deepEqual(lastButtonIds(), ["soporte:humano", "soporte:pedido", "soporte:comprar"]);
  assert.equal(
    events.filter((event) => event.type === "handoff_on" && event.jid === jid).length,
    0,
    "the menu itself must not escalate to a human",
  );

  // The "Mi pedido" button keeps the customer inside the fixed flow.
  await customer("soporte:pedido", jid);
  assert.match(last().text, /TUS PEDIDOS RECIENTES|No veo pedidos/);
  assert.deepEqual(lastButtonIds(), ["soporte:humano", "soporte:comprar"]);
  assert.equal(state(jid), "idle", "support must not derail the purchase flow");

  // Asking for a person in a sentence still reaches a human immediately.
  const human = "584123000003@s.whatsapp.invalid";
  await customer("quiero hablar con soporte ya", human);
  assert.ok(
    events.some((event) => event.type === "handoff_on" && event.jid === human),
    "a real request for a person must hand off",
  );
});

test("'tu recarga está lista' is sent exactly once with the delivery code", async () => {
  const jid = "584123000004@s.whatsapp.invalid";
  const order = createLocalOrder(db, {
    whatsappJid: jid,
    phoneDisplay: "584123000004",
    packageId: "ff-310",
    playerData: { playerid: "7430922222" },
  });
  db.prepare("UPDATE orders SET status = 'completed', delivered_code = ? WHERE id = ?")
    .run("FF-CODE-77", order.id);

  const before = sent.length;
  const firstTime = await notifyOrderCompleted(db, core, order.id);
  assert.equal(firstTime, true);
  assert.equal(sent.length, before + 2, "completion notice + CSAT survey");
  const notice = sent[before];
  assert.equal(notice.to, jid);
  assert.match(notice.text, /TU RECARGA ESTÁ LISTA/);
  assert.match(notice.text, /FF-CODE-77/);
  assert.match(notice.text, new RegExp(order.id.slice(0, 8)));
  const survey = sent[before + 1];
  assert.equal(survey.to, jid);
  assert.match(survey.text, /¿Cómo te fue con tu recarga/);
  assert.deepEqual(
    (survey.buttons ?? []).map((button) => button.id),
    ["encuesta:5", "encuesta:3", "encuesta:1"],
    "the survey must be tappable",
  );

  const secondTime = await notifyOrderCompleted(db, core, order.id);
  assert.equal(secondTime, false, "the same order must never announce twice");
  assert.equal(sent.length, before + 2, "no duplicate message nor survey");
  assert.equal(
    events.filter((event) => event.type === "order_completed" && event.meta?.orderId === order.id).length,
    1,
    "one completion event per order",
  );

  // The customer answers the survey: recorded once, thanked, published.
  await customer("encuesta:5", jid);
  assert.match(last().text, /Mil gracias/);
  const stored: any = db.prepare("SELECT score, trigger_reason, order_id FROM surveys WHERE whatsapp_jid = ?").get(jid);
  assert.equal(stored.score, 5);
  assert.equal(stored.trigger_reason, "order", "the answer must be linked to the recharge");
  assert.equal(stored.order_id, order.id);
  assert.equal(
    events.filter((event) => event.type === "survey_response" && event.jid === jid).length,
    1,
  );
});

test.after(() => unsubscribe());
