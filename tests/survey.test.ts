// CSAT survey: the store asks how it went right after a successful recharge
// or right after a human support session ends — and never nags twice.
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
  await core.processIncoming({ from, text, hasMedia: false, isImage: false, timestampSec: Math.floor(Date.now() / 1000), id: `sv-${++seq}` });
}
const last = () => sent[sent.length - 1];
const lastButtonIds = () => (last().buttons ?? []).map((button) => button.id);
const state = (jid: string) =>
  (db.prepare("SELECT state FROM whatsapp_sessions WHERE whatsapp_jid = ?").get(jid) as any)?.state;

const realFetch = globalThis.fetch;
function restoreLookup() {
  globalThis.fetch = realFetch;
}

test("a human session ending asks for the survey and never nags twice", async () => {
  const jid = "584123100001@s.whatsapp.invalid";
  await customer("quiero hablar con el dueño", jid);
  assert.ok(events.some((event) => event.type === "handoff_on" && event.jid === jid));

  await customer("atiende tú", jid);
  assert.match(last().text, /¿Cómo te fue con el soporte/i);
  assert.deepEqual(lastButtonIds(), ["encuesta:5", "encuesta:3", "encuesta:1"]);

  // A bad rating warns the owner and routes straight back to support.
  await customer("encuesta:1", jid);
  assert.match(last().text, /Lamento que no haya salido bien/);
  assert.ok(lastButtonIds().includes("soporte"), "a unhappy customer must reach support in one tap");
  const stored: any = db.prepare("SELECT score, trigger_reason FROM surveys WHERE whatsapp_jid = ?").get(jid);
  assert.equal(stored.score, 1);
  assert.equal(stored.trigger_reason, "support");
  const alert = events.find((event) => event.type === "survey_response" && event.jid === jid);
  assert.equal(alert?.meta?.score, 1, "the owner must receive the rating");

  // Second support cycle in the same day: resume works, no second survey.
  await customer("quiero hablar con el dueño", jid);
  const before = sent.length;
  await customer("atiende tú", jid);
  assert.equal(sent.length, before + 1, "resume message only — no second survey");
  assert.match(last().text, /asistente volvió/i);
  assert.equal(db.prepare("SELECT COUNT(*) FROM surveys WHERE whatsapp_jid = ?").pluck().get(jid), 1);
});

test("a survey tap never derails an open checkout", async () => {
  const jid = "584123100002@s.whatsapp.invalid";
  await customer("pack:ff-100", jid);
  globalThis.fetch = (async () => new Response(
    JSON.stringify({ success: true, data: { nickname: "★CSAT★" } }),
    { status: 200, headers: { "content-type": "application/json" } },
  )) as any;
  try {
    await customer("7430955555", jid);
    assert.match(last().text, /Jugador verificado/);
    await customer("pedido:confirmar", jid);
  } finally {
    restoreLookup();
  }
  assert.equal(state(jid), "awaiting_receipt");

  // A stale survey button tapped mid-checkout: recorded, order untouched.
  await customer("encuesta:5", jid);
  assert.match(last().text, /Mil gracias/);
  assert.equal(state(jid), "awaiting_receipt", "the open order must survive the tap");
  const orders = db.prepare(`
    SELECT o.id FROM orders o JOIN customers c ON c.id = o.customer_id
    WHERE c.whatsapp_jid = ?
  `).all(jid) as any[];
  assert.equal(orders.length, 1, "no second order may be created");
  assert.equal(db.prepare("SELECT COUNT(*) FROM surveys WHERE whatsapp_jid = ?").pluck().get(jid), 1);
});

test.after(() => unsubscribe());
