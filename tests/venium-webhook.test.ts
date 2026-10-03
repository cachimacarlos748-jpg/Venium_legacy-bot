// Venium webhook contract (per Venium's own docs):
//   POST https://<tu-servidor>/... with headers
//     X-Webhook-Signature  -> HMAC-SHA256 hex of the BODY, using the secret
//                             generated in the Venium panel
//     X-Webhook-Event      -> order.processing | order.completed |
//                             order.cancelled | order.refunded | order.review
//     X-Webhook-Timestamp  -> ISO timestamp of the event
//   body: { event, timestamp, data: { orderId, status, product, game,
//           amount, quantity, playerData, deliveredCode } }
//   deliveredCode only arrives on order.completed; HTTPS only; 10 s timeout;
//   2 automatic retries.
import "./helpers/mock-env.js";
process.env.WHATSAPP_MODE = "disabled";

import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { createDatabase, migrate } from "../src/db/connection.js";
import { syncCatalog } from "../src/modules/catalog/catalog.service.js";
import { updateSettings } from "../src/modules/admin/settings.service.js";
import { createLocalOrder, getOrder } from "../src/modules/orders/order.service.js";
import { verifyVeniumSignature, isFreshWebhook, processVeniumWebhook } from "../src/modules/webhooks/webhook.service.js";
import { notifyOrderCompleted } from "../src/modules/orders/order-notifier.js";
import { createBotCore } from "../src/modules/whatsapp/bot-core.js";

const SECRET = "venium-webhook-secret-de-prueba";
const sign = (body: string): string => createHmac("sha256", SECRET).update(body).digest("hex");

const db = createDatabase(":memory:");
migrate(db);
syncCatalog(db, [
  {
    productId: "free-fire",
    name: "Free Fire",
    category: "Juegos móviles",
    packages: [{ packageId: "ff-100", name: "100 + 10 Diamantes", price: 0.77, outOfStock: false }],
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

const sent: Array<{ to: string; text: string }> = [];
const core = createBotCore(db, async (jid, text) => {
  sent.push({ to: jid, text });
});

// A paid order already handed to Venium (the state right before any webhook).
let seq = 0;
function veniumOrder(jid: string): any {
  seq += 1;
  const order = createLocalOrder(db, {
    whatsappJid: jid,
    phoneDisplay: jid.split("@")[0],
    packageId: "ff-100",
    playerData: { playerid: `74309000${seq}` },
  });
  db.prepare("UPDATE orders SET venium_order_id = ?, status = 'venium_processing', payment_status = 'verified_new' WHERE id = ?")
    .run(`ORD000${seq}`, order.id);
  return getOrder(db, order.id);
}

function payload(event: string, orderId: string, status: string, deliveredCode?: string): string {
  return JSON.stringify({
    event,
    timestamp: new Date().toISOString(),
    data: {
      orderId,
      status,
      product: "100 + 10 Diamantes",
      game: "Free Fire",
      amount: 0.55,
      quantity: 1,
      playerData: { playerid: "123456789" },
      ...(deliveredCode ? { deliveredCode } : {}),
    },
  });
}

test("la firma HMAC se valida sobre los bytes EXACTOS del body", () => {
  const body = payload("order.completed", "ORD0001", "completed", "ABC-DEF-GHI");
  assert.equal(verifyVeniumSignature(body, sign(body), SECRET), true);
  // One changed byte must invalidate it (that is why the raw body is kept).
  assert.equal(verifyVeniumSignature(`${body} `, sign(body), SECRET), false);
  assert.equal(verifyVeniumSignature(body, "deadbeef", SECRET), false);
  assert.equal(verifyVeniumSignature(body, sign(body), "otro-secreto"), false);
  assert.equal(verifyVeniumSignature(body, "", SECRET), false);
  // Without a configured secret nothing is ever accepted (fail closed).
  assert.equal(verifyVeniumSignature(body, sign(body), ""), false);
});

test("el timestamp ISO de Venium solo se acepta si es fresco", () => {
  assert.equal(isFreshWebhook(new Date().toISOString()), true);
  assert.equal(isFreshWebhook(new Date(Date.now() - 60 * 60_000).toISOString()), false);
  assert.equal(isFreshWebhook("no-es-una-fecha"), false);
});

test("order.completed actualiza el pedido y guarda el deliveredCode", () => {
  const order = veniumOrder("584130000001@s.whatsapp.invalid");
  const body = payload("order.completed", order.venium_order_id, "completed", "ABC-DEF-GHI");
  const result = processVeniumWebhook(db, body, sign(body), new Date().toISOString(), "order.completed");

  assert.equal(result.duplicate, false);
  assert.equal(result.matchedOrderId, order.id);
  const updated: any = getOrder(db, order.id);
  assert.equal(updated.status, "completed");
  assert.equal(updated.delivered_code, "ABC-DEF-GHI");
  const event: any = db.prepare("SELECT processing_status FROM webhook_events WHERE venium_order_id = ?").get(order.venium_order_id);
  assert.equal(event.processing_status, "processed");

  // Venium retries up to 2 times: the replay must be a no-op, not a re-send.
  const retry = processVeniumWebhook(db, body, sign(body), new Date().toISOString(), "order.completed");
  assert.equal(retry.duplicate, true);
});

test("order.processing NO anuncia 'recarga lista' (solo order.completed)", async () => {
  const order = veniumOrder("584130000002@s.whatsapp.invalid");
  const before = sent.length;

  // 1) Venium confirma que el pedido entró en cola.
  const processing = payload("order.processing", order.venium_order_id, "processing");
  const first = processVeniumWebhook(db, processing, sign(processing), new Date().toISOString(), "order.processing");
  assert.equal(first.matchedOrderId, order.id);
  assert.equal((getOrder(db, order.id) as any).status, "processing");
  assert.equal(await notifyOrderCompleted(db, core, order.id), false, "nada de recarga lista aún");
  assert.equal(sent.length, before, "el cliente NO debe recibir 'tu recarga está lista'");

  // 2) Llega el completed: ahí sí se avisa, una sola vez.
  const done = payload("order.completed", order.venium_order_id, "completed", "XYZ-999");
  processVeniumWebhook(db, done, sign(done), new Date().toISOString(), "order.completed");
  assert.equal(await notifyOrderCompleted(db, core, order.id), true);
  // "recarga lista" + su encuesta CSAT (dos mensajes, uno solo aviso de entrega)
  assert.equal(sent.length, before + 2);
  assert.match(sent[before].text, /TU RECARGA ESTÁ LISTA/);
  assert.match(sent[before].text, /XYZ-999/);
  assert.match(sent[before + 1].text, /¿Cómo te fue con tu recarga/);
  assert.doesNotMatch(sent[before + 1].text, /TU RECARGA ESTÁ LISTA/);
  assert.equal(await notifyOrderCompleted(db, core, order.id), false, "una sola vez por pedido");
  assert.equal(sent.length, before + 2);
});

test("order.refunded / order.cancelled tampoco anuncian entrega", async () => {
  const order = veniumOrder("584130000003@s.whatsapp.invalid");
  const before = sent.length;
  for (const [event, status] of [["order.cancelled", "cancelled"], ["order.refunded", "refunded"]] as const) {
    const body = payload(event, order.venium_order_id, status);
    processVeniumWebhook(db, body, sign(body), new Date().toISOString(), event);
    assert.equal(await notifyOrderCompleted(db, core, order.id), false, `${event} no es una recarga lista`);
  }
  assert.equal(sent.length, before);
  assert.equal((getOrder(db, order.id) as any).status, "refunded");
});