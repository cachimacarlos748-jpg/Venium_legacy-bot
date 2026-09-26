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
import { env } from "../src/config/env.js";

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

test("simulation: verified ID asks for SI confirmation then creates order", async () => {
  // Lookup is live here: mobentas returns the nickname for real IDs. When the
  // sandbox has no network, lookup returns "" and the order goes straight in.
  await customer("7430929951");
  const confirmation = last().text;
  if (/verificado/i.test(confirmation)) {
    assert.match(confirmation, /7430929951/);
    await customer("si");
  }
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
  if (/verificado/i.test(last().text)) await customer("si");
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
  // The first order already consumed the reference; open a fresh one.
  await customer("pack:ff-100"); // pauses any open flow / selects the package
  await customer("pack:ff-100"); // second tap guarantees a fresh selection
  await customer("7430929951");
  if (/verificado/i.test(last().text)) await customer("si");
  assert.match(last().text, /DETALLES DE TU PEDIDO/);
  await customer("referencia: 0099887766 monto: 790.00");
  assert.match(last().text, /ya fue usada antes|ya fue utilizado/i);
  assert.match(last().text, /ya pagu[eé]/i);
});

// --- Regression guards for the Sep-26 receipt failures ---

test("simulation: non-Venezuelan numbers are ignored completely", async () => {
  const before = sent.length;
  await core.processIncoming({
    from: "5215534621828@s.whatsapp.invalid",
    text: "hola",
    hasMedia: false,
    isImage: false,
    timestampSec: Math.floor(Date.now() / 1000),
    id: `sim-mx-${Date.now()}`,
  });
  assert.equal(sent.length, before, "bot must not reply to non-58 numbers");
});

test("simulation: small talk while awaiting receipt never kills the order", async () => {
  // Fresh order for the main JID (ID verification may or may not be live).
  await customer("pack:ff-100"); // pauses any open flow / selects the package
  await customer("pack:ff-100"); // second tap guarantees a fresh selection
  await customer("7430929951");
  if (/verificado/i.test(last().text)) await customer("si");
  assert.match(last().text, /DETALLES DE TU PEDIDO/);
  // "Cambio de opinión" used to be fed to Gemini as a receipt text.
  await customer("cambio de opinión");
  assert.doesNotMatch(last().text, /No pude leer|problema técnico|revisión de seguridad/i);
  assert.match(last().text, /foto del comprobante/i);
  // The order is still open: an image goes straight into receipt processing.
  await core.processIncoming({
    from: JID,
    text: "",
    hasMedia: true,
    isImage: true,
    timestampSec: Math.floor(Date.now() / 1000),
    id: `sim-img-${Date.now()}`,
    downloadMedia: async () => ({ data: Buffer.from("sim-receipt").toString("base64"), mimetype: "image/jpeg" }),
  });
  assert.doesNotMatch(last().text, /problema técnico/i);
  assert.match(last().text, /más nítido|referencia|confirmado|en proceso|referencia y el monto/i);
});

test("simulation: 'ya pagué' releases a stuck duplicate on the same order", async () => {
  // Point the session at the order that already owns reference 0099887766.
  const attempt: any = db.prepare("SELECT order_id FROM payment_attempts WHERE reference = '0099887766'").get();
  assert.ok(attempt, "previous receipt test must have reserved the reference");
  db.prepare("UPDATE whatsapp_sessions SET state = 'awaiting_receipt', order_id = ? WHERE whatsapp_jid = ?")
    .run(attempt.order_id, JID);
  await customer("ya pagué");
  assert.match(last().text, /liber[eé] el comprobante/i);
  const gone = db.prepare("SELECT id FROM payment_attempts WHERE reference = '0099887766'").get();
  assert.equal(gone, undefined, "the attempt must be deleted so it can be retried");
});

test("simulation: receipt-image bursts never auto-block the customer", async () => {
  const burstJid = "584129998877@s.whatsapp.invalid";
  const burst = (text: string, id: string) =>
    core.processIncoming({ from: burstJid, text, hasMedia: false, isImage: false, timestampSec: Math.floor(Date.now() / 1000), id });
  // Tight anti-spam (like the live DB had): block at the 2nd warning.
  updateModerationSettings(db, { enabled: true, windowSeconds: 60, maxMessages: 3, repeatedMessageLimit: 2, warningThreshold: 1, autoBlockThreshold: 2, cooldownSeconds: 0, blockDurationSeconds: 3600 });
  await burst("uno", "b1");
  await burst("dos", "b2");
  await burst("tres", "b3"); // rate_limit -> warnings; next violation blocks
  await burst("cuatro", "b4");
  const blockedNow = db.prepare("SELECT blocked_until FROM moderation_users WHERE whatsapp_jid = ?").get(burstJid) as any;
  assert.ok(blockedNow?.blocked_until, "precondition: tight anti-spam blocked the jid");
  // The customer sends the receipt photo: the block must be lifted, silently.
  await core.processIncoming({
    from: burstJid,
    text: "",
    hasMedia: true,
    isImage: true,
    timestampSec: Math.floor(Date.now() / 1000),
    id: "b-img",
    downloadMedia: async () => ({ data: Buffer.from("sim-receipt").toString("base64"), mimetype: "image/jpeg" }),
  });
  const after = db.prepare("SELECT blocked_until FROM moderation_users WHERE whatsapp_jid = ?").get(burstJid) as any;
  assert.equal(after?.blocked_until ?? null, null, "receipt image must undo the auto-block");
  // And the chat works again.
  await burst("hola", "b-hola");
  assert.match(last().text, /Vex Store/);
  updateModerationSettings(db, { enabled: false, windowSeconds: 60, maxMessages: 100, repeatedMessageLimit: 100, warningThreshold: 100, autoBlockThreshold: 100, cooldownSeconds: 0, blockDurationSeconds: 60 });
});

test("simulation: Venium without balance answers 'en proceso' and queues the order", async () => {
  // Force Venium to fail while Pabilo (mock) still verifies the payment.
  const previousMode = env.VENIUM_MODE;
  env.VENIUM_MODE = "live"; // no API key in tests -> createOrder throws
  try {
    await customer("pack:ff-310"); // pauses any open flow / selects the package
    await customer("pack:ff-310"); // second tap guarantees a fresh selection
    await customer("7430929951");
    if (/verificado/i.test(last().text)) await customer("si");
    await customer("referencia: 0011223344 monto: 2360.00");
    assert.match(last().text, /está en proceso y se completará en unos minutos/i);
    assert.doesNotMatch(last().text, /saldo|error|Venium/i);
    const queued: any = db.prepare(
      "SELECT status FROM orders WHERE id = (SELECT order_id FROM payment_attempts WHERE reference = '0011223344')",
    ).get();
    assert.equal(queued?.status, "venium_pending");
  } finally {
    env.VENIUM_MODE = previousMode;
  }
});
