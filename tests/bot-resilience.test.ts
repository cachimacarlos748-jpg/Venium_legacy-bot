// Regression tests for the store complaints that broke the bot:
//  1. the Player ID lookup rejected EVERY id (the game lookup changed shape),
//  2. any text that was not an id answered "ese ID no es válido" forever,
//  3. a screenshot of the game profile was ignored instead of read,
//  4. a handoff left the customer mute forever,
//  5. the same customer writing from two numbers was not detected,
//  6. a pending order stayed unnoticed (no alert for orders stuck on their own).
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
import { checkStuckOrders } from "../src/modules/orders/order-watchdog.js";
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
async function customer(text: string, from = "584121112233@s.whatsapp.invalid") {
  await core.processIncoming({ from, text, hasMedia: false, isImage: false, timestampSec: Math.floor(Date.now() / 1000), id: `res-${++seq}` });
}
async function photo(from = "584121112233@s.whatsapp.invalid", id = `res-img-${++seq}`) {
  await core.processIncoming({
    from,
    text: "",
    hasMedia: true,
    isImage: true,
    timestampSec: Math.floor(Date.now() / 1000),
    id,
    downloadMedia: async () => ({ data: Buffer.from("fake-profile").toString("base64"), mimetype: "image/jpeg" }),
  });
}
const last = () => sent[sent.length - 1];
const lastButtonIds = () => (last().buttons ?? []).map((button) => button.id);
const state = (jid = "584121112233@s.whatsapp.invalid") =>
  (db.prepare("SELECT state FROM whatsapp_sessions WHERE whatsapp_jid = ?").get(jid) as any)?.state;

// The game lookup is a third party: the bot must survive it being dead.
const realFetch = globalThis.fetch;
function withLookup(result: () => Promise<Response> | Response) {
  globalThis.fetch = (async () => result()) as any;
}
function restoreLookup() {
  globalThis.fetch = realFetch;
}

test("player ID: a dead lookup service never blocks the sale", async () => {
  await customer("pack:ff-100");
  assert.match(last().text, /Excelente elección/);
  withLookup(() => { throw new Error("network down"); });
  try {
    await customer("7430929951");
  } finally {
    restoreLookup();
  }
  assert.match(last().text, /DETALLES DE TU PEDIDO/, "the order must be created even without the lookup");
  assert.match(last().text, /7430929951/);
  assert.equal(state(), "awaiting_receipt");
});

test("player ID: the current lookup answer shape is understood", async () => {
  await customer("pack:ff-100");
  await customer("pack:ff-100");
  withLookup(() => new Response(JSON.stringify({ success: true, data: { uid: "1234567890", nickname: "★VENEZ★" } }), {
    status: 200,
    headers: { "content-type": "application/json" },
  }));
  try {
    await customer("1234567890");
  } finally {
    restoreLookup();
  }
  assert.match(last().text, /Jugador verificado/);
  assert.match(last().text, /VENEZ/);
  assert.deepEqual(lastButtonIds(), ["pedido:confirmar", "precios:free fire"]);
  await customer("pedido:confirmar");
  assert.match(last().text, /DETALLES DE TU PEDIDO/);
});

test("player ID: 'does not exist' is the only answer that stops the flow, and it offers a way out", async () => {
  const jid = "584124440044@s.whatsapp.invalid";
  await customer("pack:ff-100", jid);
  const notFound = () => new Response(JSON.stringify({ success: false, data: { message: "Ha ingresado el ID incorrecto" } }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
  withLookup(notFound);
  try {
    await customer("9999999999", jid);
    assert.match(last().text, /no existe en el juego/);
    assert.equal(state(jid), "awaiting_player", "no order is created on a rejected id");
    // Second rejection: the bot must always leave the door open.
    await customer("8888888888", jid);
    assert.ok(lastButtonIds().includes("pedido:idigual"), `expected a way forward, got ${lastButtonIds().join(",")}`);
    await customer("pedido:idigual", jid);
    assert.match(last().text, /DETALLES DE TU PEDIDO/);
    assert.match(last().text, /8888888888/);
  } finally {
    restoreLookup();
  }
});

test("a screenshot while asking for the ID asks for the ID instead of failing forever", async () => {
  const jid = "584124440055@s.whatsapp.invalid";
  await customer("pack:ff-310", jid);
  assert.equal(state(jid), "awaiting_player");
  await photo(jid);
  // Gemini is disabled in tests: the bot must explain and re-ask, not loop.
  assert.match(last().text, /no logré leer|Player ID/i);
  assert.equal(state(jid), "awaiting_player");
  // And the customer can still finish with the written id.
  withLookup(() => new Response(JSON.stringify({ success: true, data: { nickname: "★PLAYER★" } }), { status: 200, headers: { "content-type": "application/json" } }));
  try {
    await customer("7430929951", jid);
  } finally {
    restoreLookup();
  }
  assert.match(last().text, /Jugador verificado/);
});

test("talking instead of sending the ID never loops the invalid-id message", async () => {
  const jid = "584124440066@s.whatsapp.invalid";
  await customer("pack:ff-100", jid);
  await customer("eso no sé dónde está", jid);
  assert.doesNotMatch(last().text, /no parece válido|no existe en el juego/);
  assert.match(last().text, /Player ID/);
  assert.equal(state(jid), "awaiting_player", "the selection must survive the question");
  assert.ok(lastButtonIds().includes("soporte"), "a way to reach support must be offered");
  // The customer can still complete the purchase afterwards.
  withLookup(() => new Response(JSON.stringify({ success: true, data: { nickname: "★OK★" } }), { status: 200, headers: { "content-type": "application/json" } }));
  try {
    await customer("7777777777", jid);
  } finally {
    restoreLookup();
  }
  assert.match(last().text, /Jugador verificado/);
});

test("asking for a person hands off from any state and the bot never goes mute", async () => {
  const jid = "584129998877@s.whatsapp.invalid";
  await customer("quiero hablar con el dueño", jid);
  assert.match(last().text, /compañero humano|te escribe por aquí/i);
  const handoffEvents = events.filter((event) => event.type === "handoff_on" && event.jid === jid);
  assert.ok(handoffEvents.length >= 1, "the owner must be alerted");

  // More messages from the customer: acknowledged, not ignored.
  const before = sent.length;
  await customer("es que nadie me responde", jid);
  assert.ok(sent.length > before, "the customer must never be left with silence");
  assert.match(last().text, /compañero|te responde/i);

  // And the customer can bring the bot back. The human session ending is also
  // the one moment the store asks for the CSAT survey.
  await customer("atiende tú", jid);
  assert.match(sent[sent.length - 2].text, /asistente volvió/i);
  assert.match(last().text, /¿Cómo te fue con el soporte/i);
  assert.deepEqual((last().buttons ?? []).map((button) => button.id), ["encuesta:5", "encuesta:3", "encuesta:1"]);
  assert.equal(state(jid), "idle");
});

test("the same customer writing from two numbers is reported to the owner", async () => {
  const first = "584125555555@s.whatsapp.invalid";
  const second = "584127777777@s.whatsapp.invalid";
  withLookup(() => new Response(JSON.stringify({ success: true, data: { nickname: "★DOS★" } }), { status: 200, headers: { "content-type": "application/json" } }));
  try {
    await customer("pack:ff-100", first);
    await customer("1122334455", first);
    if (/verificado/i.test(last().text)) await customer("pedido:confirmar", first);
    assert.match(last().text, /DETALLES DE TU PEDIDO/);
    // Same player id, different number: the owner must hear about it.
    await customer("pack:ff-100", second);
    await customer("1122334455", second);
    if (/verificado/i.test(last().text)) await customer("pedido:confirmar", second);
  } finally {
    restoreLookup();
  }
  const alert = events.find((event) => event.type === "multi_number" && event.jid === second);
  assert.ok(alert, "the owner must be told the customer used two numbers");
  assert.match(String(alert?.meta?.reason ?? ""), /mismo Player ID/);
});

test("pending orders raise their own alert instead of waiting for a new message", () => {
  // Reuse a real order from the flow above and park it as "paid but not sent".
  const order: any = db.prepare("SELECT id, sale_price_bs_total FROM orders ORDER BY created_at DESC LIMIT 1").get();
  assert.ok(order, "a previous test must have created an order");
  const old = new Date(Date.now() - 3 * 60 * 60_000).toISOString();
  db.prepare("UPDATE orders SET status = 'venium_pending', payment_status = 'verified_new', updated_at = ? WHERE id = ?")
    .run(old, order.id);

  const raised = checkStuckOrders(db);
  assert.ok(raised >= 1, "the stuck order must be reported");
  const alert = events.find((event) => event.type === "order_stuck" && event.meta?.orderId === order.id);
  assert.ok(alert, "an order_stuck event must be published for that order");
  assert.match(String(alert?.preview ?? ""), /Bs/);

  // No spam: the same order is not announced again right away.
  const second = checkStuckOrders(db);
  assert.equal(events.filter((event) => event.type === "order_stuck" && event.meta?.orderId === order.id).length, 1, `announced twice (${second} raised)`);
});

test.after(() => unsubscribe());