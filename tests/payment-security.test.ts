import test from "node:test";
import assert from "node:assert/strict";
import { createDatabase, migrate } from "../src/db/connection.js";
import { syncCatalog } from "../src/modules/catalog/catalog.service.js";
import { updateSettings } from "../src/modules/admin/settings.service.js";
import { createLocalOrder } from "../src/modules/orders/order.service.js";
import { submitPayment } from "../src/modules/payments/payment.service.js";
import { moderateMessage, updateModerationSettings, listBlockedUsers, unblockUser } from "../src/modules/moderation/moderation.service.js";
import { createVeniumClient } from "../src/modules/venium/venium.client.js";

function paymentDb(): ReturnType<typeof createDatabase> {
  const db = createDatabase(":memory:");
  migrate(db);
  return db;
}

async function createOrder(db: ReturnType<typeof createDatabase>, jid: string): Promise<any> {
  const venium = createVeniumClient();
  syncCatalog(db, await venium.getCatalog());
  updateSettings(db, {
    usdToBsRate: "990",
    marginPercent: "3",
    roundingMode: "ceil",
    roundingIncrementBs: "10",
    minimumPriceBs: "0",
    pabiloEnabled: true,
    pabiloUserBankId: "mock-bank",
    pabiloMovementType: "GENERIC",
    paymentDestinationJson: JSON.stringify({ bank: "Banco Demo", account: "0000" }),
  }, "test");
  return createLocalOrder(db, {
    whatsappJid: jid,
    packageId: "mock-100-diamantes",
    playerData: { playerid: "123" },
  });
}

function validPayment(hash: string, reference: string) {
  return {
    reference,
    amountBs: "570.00",
    receiptHash: hash,
    paymentDate: new Date().toISOString(),
    bank: "Banco Demo",
    recipientData: { bank: "Banco Demo", account: "0000" },
  };
}

test("valid payment passes antifraud, Pabilo mock, and authorizes Venium mock", async () => {
  const db = paymentDb();
  const order = await createOrder(db, "valid@s.whatsapp.invalid");
  const result = await submitPayment(db, order.id, validPayment("hash-valid", "REF-VALID"));

  assert.equal(result.antifraud, undefined);
  assert.equal(result.pabilo.status, "verified_new");
  assert.equal(result.order.status, "venium_processing");
  assert.match(result.order.venium_order_id, /^MOCK-/);
  assert.equal(
    db.prepare("SELECT antifraud_status FROM payment_attempts WHERE reference = 'REF-VALID'").pluck().get(),
    "verified",
  );
});

test("duplicate reference is rejected before Pabilo", async () => {
  const db = paymentDb();
  const first = await createOrder(db, "first@s.whatsapp.invalid");
  await submitPayment(db, first.id, validPayment("hash-ref-first", "REF-SAME"));
  const second = await createOrder(db, "second@s.whatsapp.invalid");
  const result = await submitPayment(db, second.id, validPayment("hash-ref-second", "REF-SAME"));

  assert.equal(result.duplicate, true);
  assert.equal(result.pabilo, null);
  assert.equal(result.order.status, "quote_created");
  assert.equal(db.prepare("SELECT COUNT(*) FROM payment_security_events WHERE reason LIKE '%reference_already_used%'").pluck().get(), 1);
});

test("duplicate receipt hash is rejected even with another reference", async () => {
  const db = paymentDb();
  const first = await createOrder(db, "hash-first@s.whatsapp.invalid");
  await submitPayment(db, first.id, validPayment("hash-same", "REF-HASH-1"));
  const second = await createOrder(db, "hash-second@s.whatsapp.invalid");
  const result = await submitPayment(db, second.id, validPayment("hash-same", "REF-HASH-2"));

  assert.equal(result.duplicate, true);
  assert.equal(result.pabilo, null);
  assert.equal(result.order.status, "quote_created");
  const indexes = db.prepare("PRAGMA index_list(payment_attempts)").all() as Array<{ name: string }>;
  assert.ok(indexes.some((item) => item.name.includes("receipt_hash")));
});

test("suspicious destination never reaches Pabilo or Venium", async () => {
  const db = paymentDb();
  const order = await createOrder(db, "suspicious@s.whatsapp.invalid");
  const result = await submitPayment(db, order.id, {
    ...validPayment("hash-suspicious", "REF-SUSPICIOUS"),
    recipientData: { bank: "Banco No Autorizado", account: "9999" },
  });

  assert.equal(result.antifraud.status, "suspicious");
  assert.ok(result.antifraud.reasons.some((reason: string) => reason.startsWith("destination_mismatch")));
  assert.equal(result.pabilo, null);
  assert.equal(result.order.venium_order_id, null);
  assert.equal(result.order.payment_status, "suspicious");
});

test("a quote can only be claimed once when two payments race", async () => {
  const db = paymentDb();
  const order = await createOrder(db, "race@s.whatsapp.invalid");
  const first = validPayment("hash-race-1", "REF-RACE-1");
  const second = validPayment("hash-race-2", "REF-RACE-2");
  const results = await Promise.all([
    submitPayment(db, order.id, first),
    submitPayment(db, order.id, second),
  ]);

  assert.equal(db.prepare("SELECT COUNT(*) FROM payment_attempts WHERE order_id = ?").pluck().get(order.id), 1);
  assert.equal(results.filter((result: any) => result.venium?.orderId).length, 1);
  assert.equal(results.filter((result: any) => result.inProgress).length, 1);
});

test("spam warnings, cooldown, automatic block, and admin unblock work", () => {
  const db = paymentDb();
  updateModerationSettings(db, {
    enabled: true,
    windowSeconds: 60,
    maxMessages: 2,
    repeatedMessageLimit: 3,
    warningThreshold: 1,
    autoBlockThreshold: 2,
    cooldownSeconds: 1,
    blockDurationSeconds: 3600,
  });
  const jid = "spam@s.whatsapp.invalid";
  const t0 = new Date("2026-01-01T00:00:00.000Z");

  const first = moderateMessage(db, { whatsappJid: jid, message: "hola", now: t0 });
  const second = moderateMessage(db, { whatsappJid: jid, message: "otra cosa", now: new Date(t0.getTime() + 1000) });
  const cooldown = moderateMessage(db, { whatsappJid: jid, message: "tercer mensaje", now: new Date(t0.getTime() + 1500) });

  assert.equal(first.action, "allow");
  assert.equal(second.action, "cooldown");
  assert.equal(second.allowed, false);
  assert.equal(cooldown.action, "cooldown");

  const blocked = moderateMessage(db, { whatsappJid: jid, message: "cuarto mensaje", now: new Date(t0.getTime() + 4000) });
  assert.equal(blocked.action, "block");
  assert.equal(blocked.allowed, false);
  assert.equal(listBlockedUsers(db).length, 1);

  unblockUser(db, jid);
  assert.equal(listBlockedUsers(db).length, 0);
  const afterUnblock = moderateMessage(db, { whatsappJid: jid, message: "mensaje después", now: new Date(t0.getTime() + 5000) });
  assert.notEqual(afterUnblock.action, "blocked");
});

test("a competitor mention alone is not a moderation violation", () => {
  const db = paymentDb();
  const result = moderateMessage(db, {
    whatsappJid: "competitor@s.whatsapp.invalid",
    message: "Nexus es mejor",
    classification: "competitor",
    now: new Date("2026-01-01T00:00:00.000Z"),
  });
  assert.equal(result.action, "allow");
  assert.equal(result.allowed, true);
});