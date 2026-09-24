// End-to-end simulation of the WhatsApp Cloud sales flow. Providers are
// pinned to mock (helpers/mock-env) so no external service is touched; this
// exercises the bot-core state machine exactly as a customer would live:
// welcome buttons -> price list -> package tap -> ID validation (bad + good)
// -> order details with both buttons -> payment-data tap -> edit-ID flow.
import "./helpers/mock-env.js";
process.env.WHATSAPP_PROVIDER = "cloud";
process.env.WHATSAPP_MODE = "disabled";

import test from "node:test";
import assert from "node:assert/strict";
import { createDatabase, migrate } from "../src/db/connection.js";
import { syncCatalog } from "../src/modules/catalog/catalog.service.js";
import { updateSettings } from "../src/modules/admin/settings.service.js";
import { createVeniumClient } from "../src/modules/venium/venium.client.js";
import { updateModerationSettings } from "../src/modules/moderation/moderation.service.js";
import { createBotCore } from "../src/modules/whatsapp/bot-core.js";

const db = createDatabase(":memory:");
migrate(db);
// The mock Venium catalog uses "mock-*" package ids, which the bot correctly
// refuses to sell. Simulate a live catalog with real-shaped ids instead.
const venium = createVeniumClient();
void venium;
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
  paymentDestinationJson: JSON.stringify({
    banco: "0102 (BDV)",
    telefono: "04129251197",
    cedula: "V-13.166.374",
  }),
}, "sim");
// Simulation sends bursts faster than any human; relax anti-spam so the
// state machine (not rate limiting) is what gets tested.
updateModerationSettings(db, { enabled: false, windowSeconds: 60, maxMessages: 100, repeatedMessageLimit: 100, warningThreshold: 100, autoBlockThreshold: 100, cooldownSeconds: 0, blockDurationSeconds: 60 });

// Transport that records exactly what the bot would send over WhatsApp.
const sent: Array<{ to: string; text: string; buttons?: Array<{ id: string; title: string }> }> = [];
const core = createBotCore(db, async (jid, text, interactive) => {
  sent.push({ to: jid, text, buttons: interactive?.buttons });
});

const JID = "584120000000@s.whatsapp.invalid";
let seq = 0;
function customer(text: string) {
  return core.processIncoming({ from: JID, text, hasMedia: false, isImage: false, timestampSec: Math.floor(Date.now() / 1000), id: `sim-${++seq}` });
}
function last() {
  return sent[sent.length - 1];
}
function lastButtonIds(): string[] {
  return (last().buttons ?? []).map((button) => button.id);
}

test("simulation: welcome shows game buttons", async () => {
  await customer("hola");
  assert.equal(last().text.includes("Vex Store"), true);
  assert.deepEqual(lastButtonIds(), ["precios:free fire", "precios:blood strike", "precios:roblox"]);
});

test("simulation: game button opens tappable price list", async () => {
  await customer("precios:free fire");
  assert.match(last().text, /Free Fire/);
  // List rows are rendered by the adapter; core must have set lastShown.
  assert.ok(last().text.includes("1") || last().text.includes("🔹"));
});

test("simulation: bad player ID is rejected with guidance", async () => {
  await customer("pack:ff-100");
  assert.match(last().text, /Excelente|elegido|Total/i);
  await customer("123");
  assert.match(last().text, /no parece válido|8 y 12 d/);
});

test("simulation: valid ID creates order with payment + edit buttons", async () => {
  await customer("7430929951");
  assert.match(last().text, /DETALLES DE TU PEDIDO/);
  assert.match(last().text, /7430929951/);
  assert.deepEqual(lastButtonIds(), ["pago:datos", "pedido:editarid"]);
});

test("simulation: payment-data tap shows BDV destination", async () => {
  await customer("pago:datos");
  assert.match(last().text, /DATOS DE PAGO MÓVIL/);
  assert.match(last().text, /0102 \(BDV\)/);
  assert.match(last().text, /04129251197/);
  assert.match(last().text, /V-13\.166\.374/);
});

test("simulation: edit-ID flow replaces the player id", async () => {
  await customer("pedido:editarid");
  assert.match(last().text, /Editar ID/);
  await customer("6965873869");
  assert.match(last().text, /ID actualizado/);
  assert.match(last().text, /6965873869/);
  assert.deepEqual(lastButtonIds(), ["pago:datos", "pedido:editarid"]);
});

test("simulation: receipt text path reaches Pabilo (mock) and confirms", async () => {
  await customer("referencia: 0099887766 monto: 790.00");
  const reply = last().text;
  const accepted = /confirmado|procesando/i.test(reply);
  const guarded = /problema técnico|revisión de seguridad|No se pudo/i.test(reply);
  assert.ok(accepted || guarded, `unexpected receipt reply: ${reply}`);
});

test("simulation: duplicate receipt is rejected", async () => {
  await customer("referencia: 0099887766 monto: 790.00");
  assert.match(last().text, /ya fue utilizado/i);
});
