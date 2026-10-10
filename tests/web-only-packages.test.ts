// Regression test for the money-losing bug: a customer asked for a LEVEL
// package (Free Fire "Nivel 15"), which is sold ONLY on the web store. The bot
// did not refuse — it sold a normal diamond package instead ("100 + 10
// Diamantes"), so the store delivered a different, more expensive product.
//
// The guard is deterministic and runs BEFORE the sales brain, so no model
// reply can substitute the package. This test drives the real state machine.
import "./helpers/mock-env.js";
process.env.WHATSAPP_PROVIDER = "cloud";
process.env.WHATSAPP_MODE = "disabled";

import test from "node:test";
import assert from "node:assert/strict";
import { createDatabase, migrate } from "../src/db/connection.js";
import { syncCatalog } from "../src/modules/catalog/catalog.service.js";
import { updateSettings } from "../src/modules/admin/settings.service.js";
import { updateModerationSettings } from "../src/modules/moderation/moderation.service.js";
import { createBotCore, isWebOnlyPackageRequest } from "../src/modules/whatsapp/bot-core.js";

const db = createDatabase(":memory:");
migrate(db);
// "Nivel 15" is exactly how the catalog names the level package; the diamond
// package is the one the bot wrongly sold in its place.
syncCatalog(db, [
  {
    productId: "free-fire",
    name: "Free Fire",
    category: "Juegos móviles",
    packages: [
      { packageId: "ff-100", name: "100 + 10 Diamantes", price: 0.55, outOfStock: false },
      { packageId: "ff-310", name: "310 + 31 Diamantes", price: 2.2, outOfStock: false },
      { packageId: "ff-n15", name: "Nivel 15", price: 0.46, outOfStock: false },
      { packageId: "ff-n30", name: "Nivel 30", price: 0.75, outOfStock: false },
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
  paymentDestinationJson: JSON.stringify({ banco: "0102 (BDV)", telefono: "04129251197", cedula: "V-13.166.374" }),
}, "webonly");
updateModerationSettings(db, { enabled: false, windowSeconds: 60, maxMessages: 100, repeatedMessageLimit: 100, warningThreshold: 100, autoBlockThreshold: 100, cooldownSeconds: 0, blockDurationSeconds: 60 });

const sent: Array<{ to: string; text: string; buttons?: Array<{ id: string; title: string }> }> = [];
const core = createBotCore(db, async (jid, text, interactive) => {
  sent.push({ to: jid, text, buttons: interactive?.buttons });
});

const JID = "584129999999@s.whatsapp.invalid";
let seq = 0;
function customer(text: string) {
  return core.processIncoming({ from: JID, text, hasMedia: false, isImage: false, timestampSec: Math.floor(Date.now() / 1000), id: `wop-${++seq}` });
}
function last() {
  return sent[sent.length - 1];
}
function orderCount(): number {
  return (db.prepare("SELECT COUNT(*) AS n FROM orders").get() as { n: number }).n;
}

test("isWebOnlyPackageRequest detects real level-package phrasings", () => {
  for (const text of [
    "quiero un paquete de nivel 15",
    "nivel 15",
    "Quiero subir de nivel 20",
    "pase de nivel 6",
    "paso de nivel 10 por favor",
    "me interesa el nivel 16",
    "level up 30",
  ]) {
    assert.equal(isWebOnlyPackageRequest(text), true, `should be web-only: ${text}`);
  }
});

test("isWebOnlyPackageRequest does not block normal diamond orders", () => {
  for (const text of [
    "quiero 100 + 10 diamantes",
    "310 + 31 diamantes",
    "hola",
    "precios:free fire",
    "pack:ff-100",
    "pase booyah",
    "mi id es 12345678",
  ]) {
    assert.equal(isWebOnlyPackageRequest(text), false, `should NOT be web-only: ${text}`);
  }
});

test("level packages never appear in the WhatsApp price list", async () => {
  await customer("precios:free fire");
  const list = last().text;
  assert.match(list, /100 \+ 10 Diamantes/);
  assert.match(list, /310 \+ 31 Diamantes/);
  assert.doesNotMatch(list, /Nivel 15|Nivel 30/);
});

test("asking for a level package is refused and points to the web store", async () => {
  const before = orderCount();
  await customer("quiero un paquete de nivel 15");
  const reply = last().text;
  assert.match(reply, /solo en nuestra página web/i);
  assert.match(reply, /recargaslegacystore\.base44\.app/);
  // The bot must NOT have sold the closest diamond package instead.
  assert.doesNotMatch(reply, /Excelente elección|100 \+ 10/);
  assert.equal(orderCount(), before, "no order may be created for a web-only package");
});

test("'subir de nivel 20' is refused too and keeps the conversation open", async () => {
  await customer("quiero subir de nivel 20 para free fire");
  const reply = last().text;
  assert.match(reply, /solo en nuestra página web/i);
  assert.doesNotMatch(reply, /Excelente elección/);
  const ids = (last().buttons ?? []).map((button) => button.id);
  assert.deepEqual(ids, ["precios:free fire", "precios:blood strike", "precios:roblox"]);
});

test("a diamond package still sells normally after the guard", async () => {
  await customer("pack:ff-100");
  assert.match(last().text, /Excelente elección|Total/i);
  assert.match(last().text, /100 \+ 10 Diamantes/);
});
