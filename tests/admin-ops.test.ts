// Panel: procesar a mano las recargas en cola y descargar los chats.
//
// 1. Las recargas pagadas que se quedaron sin saldo en Venium ya NO se
//    reenvían solas: el dueño recarga la billetera y aprieta el botón del
//    panel. Antes, una recarga vieja que nadie miraba se disparaba sola en el
//    instante en que entraba saldo (y salió un paquete distinto al pedido).
// 2. Descargar TODAS las conversaciones en un CSV para leerlas fuera del panel.
//
// Se ejerce la app real (buildApp + inject), o sea el mismo camino que usa el
// navegador, contra una base de datos temporal.
import "./helpers/mock-env.js";
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "vex-admin-ops-"));
const dbPath = join(dir, "app.db");
process.env.DATABASE_PATH = dbPath;
process.env.ADMIN_USERNAME = "admin";
process.env.ADMIN_PASSWORD = "test-password";
process.env.WHATSAPP_PROVIDER = "cloud";
process.env.WHATSAPP_MODE = "disabled";
process.env.BDV_ENABLED = "false";
process.env.TELEGRAM_BOT_TOKEN = "";
process.env.TELEGRAM_CHAT_ID = "";
// Deja explícito el comportamiento pedido: nada se reenvía en automático.
process.env.AUTO_RETRY_VENIUM_PENDING = "false";

const JID = "584120001111@s.whatsapp.invalid";
const auth = { authorization: "Basic " + Buffer.from("admin:test-password").toString("base64") };

let app: Awaited<ReturnType<typeof import("../src/server.js")["buildApp"]>>;
let db: import("better-sqlite3").Database;
let pendingOrderId = "";

test.before(async () => {
  const { buildApp } = await import("../src/server.js");
  const { createDatabase } = await import("../src/db/connection.js");
  const { syncCatalog } = await import("../src/modules/catalog/catalog.service.js");
  const { createLocalOrder } = await import("../src/modules/orders/order.service.js");
  const { logCustomerMessage, logBotMessage } = await import("../src/modules/chats/chat.service.js");

  app = await buildApp();
  db = createDatabase(dbPath);
  syncCatalog(db, [
    {
      productId: "free-fire",
      name: "Free Fire",
      category: "Juegos móviles",
      packages: [{ packageId: "ff-100", name: "100 + 10 Diamantes", price: 0.55, outOfStock: false }],
      playerFields: [{ label: "Player ID", type: "text", required: true, key: "playerid" }],
    },
  ]);
  // Una conversación con salto de línea, para comprobar el escapado del CSV.
  logCustomerMessage(db, JID, "hola, quiero 110 diamantes\ncon salto de línea", "text");
  logBotMessage(db, JID, "¡Listo! Total Bs 560,00");
  // Una recarga pagada que quedó en cola hace una hora por falta de saldo.
  const order = createLocalOrder(db, { whatsappJid: JID, packageId: "ff-100", playerData: { playerid: "12345678" } });
  pendingOrderId = order.id;
  db.prepare("UPDATE orders SET status = 'venium_pending', payment_status = 'verified_new', updated_at = ? WHERE id = ?")
    .run(new Date(Date.now() - 60 * 60 * 1000).toISOString(), order.id);
});

test.after(async () => {
  await app?.close();
  rmSync(dir, { recursive: true, force: true });
});

test("los endpoints del panel exigen credenciales", async () => {
  const chats = await app.inject({ method: "GET", url: "/api/admin/export/chats.csv" });
  const pending = await app.inject({ method: "POST", url: "/api/admin/orders/process-pending" });
  assert.equal(chats.statusCode, 401);
  assert.equal(pending.statusCode, 401);
});

test("descargar chats: CSV completo, escapado y con nombre de archivo", async () => {
  const res = await app.inject({ method: "GET", url: "/api/admin/export/chats.csv", headers: auth });
  assert.equal(res.statusCode, 200);
  const csv = res.payload;
  assert.ok(csv.startsWith("telefono,nombre,jid,fecha,quien,origen,tipo,mensaje,adjunto"), csv.split("\n")[0]);
  assert.ok(csv.includes("584120001111@s.whatsapp.invalid"));
  assert.ok(csv.includes(",cliente,"), "el mensaje del cliente debe ir marcado como cliente");
  assert.ok(csv.includes(",bot,"), "la respuesta del bot debe ir marcada como bot");
  // Un mensaje con salto de línea no puede romper el CSV.
  assert.ok(csv.includes('"hola, quiero 110 diamantes\ncon salto de línea"'));
  assert.match(String(res.headers["content-disposition"]), /attachment; filename="venium-chats-\d{4}-\d{2}-\d{2}\.csv"/);
});

test("la cola de recargas pendientes se lista y NO se reenvía sola", async () => {
  const res = await app.inject({ method: "GET", url: "/api/admin/orders/pending-venium", headers: auth });
  assert.equal(res.statusCode, 200);
  const body = res.json() as any;
  assert.equal(body.count, 1);
  assert.equal(body.autoRetry, false, "sin AUTO_RETRY_VENIUM_PENDING no se reenvía nada solo");
  assert.equal(body.orders[0].id, pendingOrderId);
  assert.equal(body.orders[0].packageName, "100 + 10 Diamantes");
  // Y el pedido sigue en cola: nadie lo tocó por su cuenta.
  const row = db.prepare("SELECT status FROM orders WHERE id = ?").get(pendingOrderId) as any;
  assert.equal(row.status, "venium_pending");
});

test("el botón del panel envía toda la cola y reporta el detalle", async () => {
  const res = await app.inject({ method: "POST", url: "/api/admin/orders/process-pending", headers: auth });
  assert.equal(res.statusCode, 200);
  const body = res.json() as any;
  assert.equal(body.attempted, 1);
  assert.equal(body.sent, 1, JSON.stringify(body));
  assert.equal(body.failed, 0);
  assert.equal(body.results[0].id, pendingOrderId);
  const row = db.prepare("SELECT status, venium_order_id AS veniumOrderId FROM orders WHERE id = ?").get(pendingOrderId) as any;
  assert.notEqual(row.status, "venium_pending");
  assert.ok(row.veniumOrderId, "el pedido debe quedar con su orden de Venium");

  const after = await app.inject({ method: "GET", url: "/api/admin/orders/pending-venium", headers: auth });
  assert.equal((after.json() as any).count, 0);
});
