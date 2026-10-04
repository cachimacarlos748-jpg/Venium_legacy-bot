// Regresion del bug reportado: "el cliente manda la referencia, la vuelve a
// enviar y el bot dice que ya fue usada".
//
// El caso real: el primer intento NO verifica (el banco todavia no muestra el
// movimimiento, o no respondio). El cliente reenvia la MISMA referencia de su
// MISMO pedido y el antifraude la trataba como reutilizacion -> "esa referencia
// ya fue usada", en bucle, con plata ya pagada. Aqui se reproduce el flujo
// COMPLETO (bot -> submitReceipt -> antifraude -> banco) contra un banco falso
// que primero responde vacio y despues muestra el pago:
//
//   1. primer envio  -> el banco no muestra nada: se le dice que espere
//   2. segundo envio -> el banco SI muestra el pago: se verifica, sin "ya fue usada"
//   3. la misma referencia en OTRO pedido -> ahi SI es duplicado (antifraude real)
//   4. reenvio de un pago ya confirmado -> respuesta amable, nunca error
//
// El entorno se fija ANTES de importar los modulos porque src/config/env.ts se
// lee una sola vez al cargar.
import "./helpers/mock-env.js";
process.env.BDV_MODE = "live";
process.env.PAYMENT_PROVIDER = "bdv";
process.env.BDV_SESSION_ACCOUNT = "01020000000123456789";
process.env.BDV_SESSION_ACCESS_TOKEN = "token-de-prueba";
process.env.BDV_SESSION_REFRESH_TOKEN = "";
process.env.BDV_SESSION_RIP = "huella-de-prueba";
// Sin cache: cada envio debe llegar de verdad al banco (lo que se prueba es
// que el reintento CONSULTA de nuevo, no que reutiliza una lectura vieja).
process.env.BDV_CACHE_TTL_MS = "0";

import test from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";

// Banco falso con estado MUTABLE: la lista de movimientos cambia entre el
// primer y el segundo envio, como cambia el banco real cuando el pago se
// refleja unos minutos despues.
const movimientos: Array<Record<string, unknown>> = [];
function bancoFalso(): Promise<Server> {
  return new Promise((resolve) => {
    const server = createServer((_req, res) => {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ data: { movimientos } }));
    });
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

const banco = await bancoFalso();
process.env.BDV_BASE_URL = `http://127.0.0.1:${(banco.address() as any).port}`;

const { createDatabase, migrate } = await import("../src/db/connection.js");
const { syncCatalog } = await import("../src/modules/catalog/catalog.service.js");
const { updateSettings } = await import("../src/modules/admin/settings.service.js");
const { createLocalOrder } = await import("../src/modules/orders/order.service.js");
const { submitReceipt } = await import("../src/modules/payments/payment.service.js");

test.after(() => banco.close());

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
  paymentDestinationJson: JSON.stringify({ banco: "0102 (BDV)" }),
}, "test");

const REFERENCE = "228032099";

function nuevaOrden(jid: string): any {
  return createLocalOrder(db, {
    whatsappJid: jid,
    phoneDisplay: jid.split("@")[0],
    packageId: "ff-100",
    playerData: { playerid: "7430929951" },
  });
}

test("la misma referencia del MISMO pedido se reintenta y se verifica; nunca dice 'ya fue usada'", async () => {
  const order = nuevaOrden("584123100001@s.whatsapp.invalid");
  const text = `Referencia ${REFERENCE}`;

  // El banco todavia no muestra el movimiento: "espera", no un rechazo.
  const first: any = await submitReceipt(db, order.id, { text });
  assert.notEqual(first.duplicate, true, "el primer envio jamas es duplicado");
  assert.equal(first.pabilo?.verified, false);
  assert.equal(first.pabilo?.status, "bank_unavailable", `got ${first.pabilo?.status}`);
  let stored: any = db.prepare("SELECT payment_status, status FROM orders WHERE id = ?").get(order.id);
  assert.equal(stored.payment_status, "bank_unavailable");
  assert.equal(stored.status, "quote_created", "el pedido sigue abierto para reintentar");

  // El pago ya se refleja en el banco con el monto EXACTO del pedido y el
  // cliente reenvia la misma referencia. Debe verificarse, no dar "ya fue usada".
  movimientos.push({
    referencia: REFERENCE,
    monto: Number(order.sale_price_bs_total).toFixed(2).replace(".", ","),
    fecha: "04/10/2026",
    descripcion: "PAGO MOVIL RECIBIDO",
  });
  const second: any = await submitReceipt(db, order.id, { text });
  assert.notEqual(second.duplicate, true, "reenviar la propia referencia NO es reutilizacion");
  assert.equal(second.pabilo?.verified, true, `got status ${second.pabilo?.status}`);
  assert.equal(second.pabilo?.status, "verified_new");
  stored = db.prepare("SELECT payment_status, status FROM orders WHERE id = ?").get(order.id);
  assert.equal(stored.payment_status, "verified_new");
  assert.ok(["venium_processing", "venium_pending"].includes(stored.status), `status ${stored.status}`);

  // Una sola fila para la referencia, ya con el veredicto nuevo: el reintento
  // reutiliza la reserva del mismo pedido en vez de acumular basura.
  const attempts: any[] = db.prepare("SELECT order_id, pabilo_status FROM payment_attempts WHERE reference = ?").all(REFERENCE);
  assert.equal(attempts.length, 1);
  assert.equal(attempts[0].order_id, order.id);
  assert.equal(attempts[0].pabilo_status, "verified_new");

  // Reintentar un pago verificado tampoco inventa un evento de seguridad.
  const events: any[] = db.prepare("SELECT reason FROM payment_security_events WHERE order_id = ?").all(order.id);
  assert.equal(
    events.filter((event) => String(event.reason).includes("reference_already_used")).length,
    0,
    "un reintento legitimo no es un evento de fraude",
  );

  // El cliente vuelve a mandar el comprobante del pedido YA pagado: respuesta
  // amable de "ya esta confirmado", jamas un error.
  const again: any = await submitReceipt(db, order.id, { text });
  assert.equal(again.alreadyVerified, true);
  assert.equal(again.pabilo?.verified, true);
});

test("la misma referencia en OTRO pedido sigue siendo duplicado (antifraude intacto)", async () => {
  const another = nuevaOrden("584123100002@s.whatsapp.invalid");
  const result: any = await submitReceipt(db, another.id, { text: `Referencia ${REFERENCE}` });
  assert.equal(result.duplicate, true, "otro pedido reclamando la referencia SI es reutilizacion");
  const stored: any = db.prepare("SELECT payment_status FROM orders WHERE id = ?").get(another.id);
  assert.equal(stored.payment_status, "duplicate");
  const events: any[] = db.prepare("SELECT reason FROM payment_security_events WHERE order_id = ?").all(another.id);
  assert.ok(
    events.some((event) => String(event.reason).includes("reference_already_used")),
    "el intento de reutilizacion queda auditado",
  );
});
