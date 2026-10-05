// Regresion del bug reportado: "el bot dice que esta verificando mas lento y
// no confirma el pago", con captura Y con la referencia escrita.
//
// La causa: el despliegue quedo con PAYMENT_PROVIDER=bdv y BDV_ENABLED=false.
// Antes, esa combinacion lanzaba un error antes de tocar cualquier banco ->
// TODOS los pagos caian en status "error" -> el cliente leia "estamos
// verificando mas lento de lo normal" y creia que su pago se habia perdido.
//
// Aqui se fija la salida correcta: con el verificador BDV apagado, la
// verificacion sigue con Pabilo (es con quien verifica la tienda) y el cliente
// recibe el pago confirmado. El desajuste queda anotado y avisa al dueno.
import "./helpers/mock-env.js";
import "./helpers/pabilo-live-env.js";
process.env.PAYMENT_PROVIDER = "bdv";
process.env.BDV_ENABLED = "false";

import test from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";

// Pabilo falso: cuenta las consultas y responde un pago nuevo.
let consultas = 0;
function pabiloFalso(): Promise<Server> {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      consultas += 1;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(req.method === "POST" ? { data: { is_new: true } } : { user_banks: [] }));
    });
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

const pabilo = await pabiloFalso();
process.env.PABILO_BASE_URL = `http://127.0.0.1:${(pabilo.address() as any).port}`;

const { createDatabase, migrate } = await import("../src/db/connection.js");
const { syncCatalog } = await import("../src/modules/catalog/catalog.service.js");
const { updateSettings } = await import("../src/modules/admin/settings.service.js");
const { createLocalOrder } = await import("../src/modules/orders/order.service.js");
const { submitReceipt, describePaymentFailure } = await import("../src/modules/payments/payment.service.js");
const { bdvHabilitado } = await import("../src/modules/bdv/bdv.browser.js");
const { env } = await import("../src/config/env.js");

test.after(() => pabilo.close());

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
  pabiloUserBankId: "banco-viejo-del-panel",
  pabiloMovementType: "GENERIC",
  paymentDestinationJson: JSON.stringify({ banco: "0102 (BDV)" }),
}, "test");

test("el mensaje del bug solo sale cuando la verificacion se cae: asi se veia", () => {
  // Deja escrito de donde venia el texto que reporto el cliente, para que nadie
  // lo confunda con un banco caido: es un fallo NUESTRO, no del pago.
  assert.equal(describePaymentFailure("error", null).title, "⏳ Estamos verificando más lento de lo normal");
  assert.equal(describePaymentFailure("pabilo_disabled", null).title, "⏳ Estamos verificando más lento de lo normal");
});

test("con PAYMENT_PROVIDER=bdv y BDV apagado, la verificacion sigue con Pabilo", async () => {
  assert.equal(env.PAYMENT_PROVIDER, "bdv");
  assert.equal(bdvHabilitado(), false, "el verificador del portal del banco sigue apagado");

  const order: any = createLocalOrder(db, {
    whatsappJid: "584123100009@s.whatsapp.invalid",
    phoneDisplay: "584123100009",
    packageId: "ff-100",
    playerData: { playerid: "7430929951" },
  });

  const antes = consultas;
  // Exactamente lo que mando el cliente: la referencia escrita, sin monto.
  const result: any = await submitReceipt(db, order.id, { text: "Referencia 9155566225" });

  assert.equal(consultas, antes + 1, "el pago SI se consulto en Pabilo");
  assert.equal(result.pabilo?.verified, true, `no se verifico: ${JSON.stringify(result.pabilo)}`);
  assert.equal(result.pabilo?.status, "verified_new");
  assert.notEqual(result.pabilo?.status, "error", "un desajuste de variables no puede leerse como fallo del pago");

  const stored: any = db.prepare("SELECT payment_status, status FROM orders WHERE id = ?").get(order.id);
  assert.equal(stored.payment_status, "verified_new");
  assert.notEqual(stored.status, "quote_created", "el pedido avanzo, no quedo en el limbo");
});

test("el desajuste queda anotado y avisa al dueno, en vez de fallar en silencio", async () => {
  const order: any = createLocalOrder(db, {
    whatsappJid: "584123100010@s.whatsapp.invalid",
    phoneDisplay: "584123100010",
    packageId: "ff-100",
    playerData: { playerid: "7430929952" },
  });
  await submitReceipt(db, order.id, { text: "Referencia 9155566226" });

  // El intento guarda el desajuste: cuando el cliente escriba "soporte", el
  // panel tiene la causa exacta sin adivinar.
  const fila: any = db.prepare(
    "SELECT provider_response_json FROM payment_attempts WHERE order_id = ? ORDER BY id DESC LIMIT 1",
  ).get(order.id);
  const guardado = JSON.parse(String(fila.provider_response_json));
  assert.match(String(guardado.configWarning ?? ""), /PAYMENT_PROVIDER=bdv/);
  assert.match(String(guardado.configWarning ?? ""), /BDV_ENABLED=false/);
});
