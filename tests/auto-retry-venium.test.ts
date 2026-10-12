// Regresión del incidente que obligó a apagar el reenvío automático: con saldo
// en la billetera de Venium, se disparó SOLA una recarga vieja y salió un
// paquete distinto al que el cliente había pagado. El reenvío automático volvió
// a encenderse, así que estas son las barreras que deben seguir en pie:
//
//   1. una recarga vieja en cola NO se dispara sola (queda para el panel),
//   2. una recarga reciente SI sale, exactamente una vez (nunca doble envío),
//   3. si el paquete ya no pertenece al producto del pedido, no se envía nada
//      y se avisa al panel,
//   4. un paquete fuera de stock tampoco se dispara solo,
//   5. con la billetera en cero no se intenta ninguna recarga.
import "./helpers/mock-env.js";

import test from "node:test";
import assert from "node:assert/strict";
import { createDatabase, migrate } from "../src/db/connection.js";
import { syncCatalog } from "../src/modules/catalog/catalog.service.js";
import { updateSettings } from "../src/modules/admin/settings.service.js";
import { createLocalOrder } from "../src/modules/orders/order.service.js";
import { autoRetryVeniumPending } from "../src/modules/orders/order-notifier.js";
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
  {
    productId: "blood-strike",
    name: "Blood Strike",
    category: "Juegos móviles",
    packages: [{ packageId: "bs-100", name: "100 Pases", price: 0.9, outOfStock: false }],
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
  paymentDestinationJson: JSON.stringify({ banco: "0102 (BDV)" }),
}, "test");

const events: VexEvent[] = [];
subscribeEvents((event) => events.push(event));

let seq = 0;
// Un pedido pagado y verificado que quedó en cola porque la billetera de
// Venium no tenía saldo, con la antigüedad que se quiera simular.
function parkedOrder(packageId: string, minutesAgo: number): any {
  const order = createLocalOrder(db, {
    whatsappJid: `5841200000${++seq}@s.whatsapp.invalid`,
    phoneDisplay: `5841200000${seq}`,
    packageId,
    playerData: { playerid: "7430929951" },
  });
  const when = new Date(Date.now() - minutesAgo * 60_000).toISOString();
  db.prepare("UPDATE orders SET status = 'venium_pending', payment_status = 'verified_new', updated_at = ? WHERE id = ?")
    .run(when, order.id);
  return order;
}

function storedOrder(id: string): any {
  return db.prepare("SELECT status, venium_order_id AS veniumOrderId, package_id AS packageId FROM orders WHERE id = ?").get(id);
}

test("una recarga VIEJA en cola no se dispara sola (fue el incidente)", async () => {
  const order = parkedOrder("ff-100", 180);
  const summary = await autoRetryVeniumPending(db);
  assert.equal(summary.sent, 0, "nada viejo puede salir solo");
  assert.ok(summary.skippedOld >= 1, `skippedOld=${summary.skippedOld}`);
  const stored = storedOrder(order.id);
  assert.equal(stored.veniumOrderId, null);
  assert.equal(stored.status, "venium_pending");
});

test("una recarga RECIENTE sale sola, exactamente una vez", async () => {
  const order = parkedOrder("ff-310", 5);
  const summary = await autoRetryVeniumPending(db);
  assert.equal(summary.sent, 1, `attempted=${summary.attempted}`);
  const first = storedOrder(order.id);
  assert.equal(first.status, "venium_processing");
  assert.match(String(first.veniumOrderId), /^MOCK-/);

  // Segundo ciclo: el pedido ya salió de 'venium_pending', así que no se
  // vuelve a enviar ni cambia su orden de Venium.
  const again = await autoRetryVeniumPending(db);
  assert.equal(again.sent, 0);
  assert.equal(storedOrder(order.id).veniumOrderId, first.veniumOrderId);
});

test("si el paquete ya no pertenece al producto del pedido, no se envía y se avisa", async () => {
  const order = parkedOrder("ff-100", 5);
  // El catálogo cambia: el paquete queda apuntando a otro producto. Antes esto
  // era exactamente el "se equivocó de paquete"; ahora se detiene y avisa.
  const otherProduct = db.prepare("SELECT id FROM products WHERE venium_product_id = 'blood-strike'").pluck().get();
  db.prepare("UPDATE packages SET product_id = ? WHERE venium_package_id = 'ff-100'").run(otherProduct);
  const before = events.length;

  const summary = await autoRetryVeniumPending(db);
  assert.equal(summary.sent, 0);
  assert.ok(summary.skippedUnsafe >= 1, `skippedUnsafe=${summary.skippedUnsafe}`);
  assert.equal(storedOrder(order.id).veniumOrderId, null);
  assert.equal(storedOrder(order.id).status, "venium_pending", "sigue en cola para el panel");
  assert.ok(
    events.slice(before).some((event) => event.type === "order_stuck" && (event.meta as any)?.reason === "auto_retry_unsafe_package"),
    "el dueño recibe el aviso para procesarlo a mano",
  );

  db.prepare("UPDATE packages SET product_id = (SELECT id FROM products WHERE venium_product_id = 'free-fire') WHERE venium_package_id = 'ff-100'").run();
  // Ese pedido queda para el panel (fuera de la ventana automática), como
  // queda en la tienda real: al dueño le toca procesarlo a mano.
  db.prepare("UPDATE orders SET updated_at = ? WHERE id = ?")
    .run(new Date(Date.now() - 180 * 60_000).toISOString(), order.id);
});

test("un paquete fuera de stock no se dispara solo", async () => {
  const order = parkedOrder("ff-310", 5);
  db.prepare("UPDATE packages SET out_of_stock = 1 WHERE venium_package_id = 'ff-310'").run();
  try {
    const summary = await autoRetryVeniumPending(db);
    assert.equal(summary.sent, 0);
    assert.ok(summary.skippedUnsafe >= 1);
    assert.equal(storedOrder(order.id).veniumOrderId, null);
  } finally {
    db.prepare("UPDATE packages SET out_of_stock = 0 WHERE venium_package_id = 'ff-310'").run();
  }
});

test("con la billetera en cero no se intenta ninguna recarga", async () => {
  const order = parkedOrder("ff-310", 5);
  const summary = await autoRetryVeniumPending(db, { getBalance: async () => ({ data: { balance: "0.00" } }) });
  assert.equal(summary.balance, 0);
  assert.equal(summary.attempted, 0);
  assert.equal(summary.sent, 0);
  assert.equal(storedOrder(order.id).status, "venium_pending");
});
