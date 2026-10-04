// Prueba de integracion: que el verificador USE de verdad la via rapida.
//
// Los tests unitarios comprueban el lector caliente por separado, pero lo que
// importa aqui es el CABLEADO: cuando hay sesion configurada, la verificacion
// tiene que responder por la API JSON del banco y NO abriendo un navegador. Si
// ese cableado se rompe, el sintoma vuelve a ser "tarda 95 s" sin que ningun
// test unitario se de cuenta.
//
// El entorno se fija ANTES de importar los modulos porque la configuracion se
// lee una sola vez al cargar (src/config/env.ts). Ademas se usa un servidor
// HTTP real en localhost para que el lector llegue a hacer fetch de verdad:
// un mock de fetch solo probaria el mock.
import test from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";

// Sesion tibia ficticia + BDV en modo live: lo que se prueba es que se elige
// la via de la API, no una sesion real del banco.
process.env.BDV_MODE = "live";
process.env.BDV_SESSION_ACCOUNT = "01020000000123456789";
process.env.BDV_SESSION_ACCESS_TOKEN = "token-de-prueba";
process.env.BDV_SESSION_REFRESH_TOKEN = "";
process.env.BDV_SESSION_RIP = "huella-de-prueba";

/** Banco falso que devuelve movimientos en JSON, como el portal real. */
function bancoFalso(movimientos: unknown): Promise<Server> {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ data: { movimientos } }));
    });
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

function puertoDe(server: Server): number {
  const address = server.address();
  assert.ok(address && typeof address === "object");
  return address.port;
}

// Los bancos se levantan ANTES de importar los modulos porque la configuracion
// se lee una sola vez al cargar (src/config/env.ts): si se moviera despues,
// el cliente ya habria guardado la URL real del banco y la prueba estaria
// midiendo una ida a produccion en vez de una ida a la API.
const bancoConPago = await bancoFalso([
  { referencia: "0677228032099", monto: "790,00", fecha: "01/10/2026", descripcion: "PAGO MOVIL RECIBIDO" },
]);
const bancoVacio = await bancoFalso([]);
process.env.BDV_BASE_URL = `http://127.0.0.1:${puertoDe(bancoConPago)}`;

const { createBdvClient } = await import("../src/modules/bdv/bdv.browser.js");
const { getBdvWarmClient, BdvSessionError, resetBdvWarmClient } = await import("../src/modules/bdv/bdv-warm.js");

test.after(() => {
  bancoConPago.close();
  bancoVacio.close();
});

/** Esquema COPIADO del de la app (src/db/connection.ts). */
function dbVacio(): Database.Database {
  const dir = mkdtempSync(join(tmpdir(), "vex-bdv-"));
  const db = new Database(join(dir, "app.db"));
  db.exec(`
    CREATE TABLE IF NOT EXISTS bdv_mirror (
      row_key TEXT PRIMARY KEY,
      reference TEXT NOT NULL,
      amount REAL,
      date TEXT,
      description TEXT,
      incoming INTEGER NOT NULL DEFAULT 1,
      first_seen_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS bdv_mirror_reference ON bdv_mirror(reference);
    CREATE TABLE IF NOT EXISTS bdv_sync (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      synced_at TEXT,
      ok INTEGER NOT NULL DEFAULT 0,
      error TEXT NOT NULL DEFAULT '',
      movements INTEGER NOT NULL DEFAULT 0
    );
  `);
  return db;
}

test("con sesion configurada se elige la via de la API, no el navegador", () => {
  const cliente = getBdvWarmClient();
  assert.ok(cliente, "deberia existir cliente caliente con la sesion configurada");
  assert.equal(cliente.configured, true);
});

test("un pago real en el banco se verifica por la API en milisegundos", async () => {
  const bdv = createBdvClient(dbVacio());
  try {
    const inicio = Date.now();
    const res = await bdv.verifyPayment({ amount: "790,00", bankReference: "228032099" });
    const ms = Date.now() - inicio;
    assert.equal(res.status, "verified_new");
    assert.equal(res.verified, true);
    // La prueba de que NO se abrio el navegador: esa ruta tarda 15-40 s.
    assert.ok(ms < 5_000, `tardo ${ms} ms: sigue yendo por el navegador`);
  } finally {
    await bdv.close();
  }
});

test("referencia correcta con monto distinto se distingue de 'no encontrado'", async () => {
  const bdv = createBdvClient(dbVacio());
  try {
    const res = await bdv.verifyPayment({ amount: "500,00", bankReference: "228032099" });
    assert.equal(res.status, "amount_mismatch");
  } finally {
    await bdv.close();
  }
});

test("si el banco responde vacio, el veredicto es 'pending', jamas 'no encontrado'", async () => {
  // Este es EL caso que costaba la venta: cero movimientos se traducía a
  // "not_found" y el cliente recibia un rechazo falso.
  const { BdvWarmClient } = await import("../src/modules/bdv/bdv-warm.js");
  const cliente = new BdvWarmClient({
    baseUrl: `http://127.0.0.1:${puertoDe(bancoVacio)}`,
    account: "01020000000123456789",
    accessToken: "token-de-prueba",
    refreshToken: "",
    rip: "huella",
  });
  const v = await cliente.verify("999999999", 790);
  assert.equal(v.kind, "pending");
});

test("si el banco no responde, el lector lanza en vez de devolver una lista vacia", async () => {
  // Puerto cerrado: el fetch falla de verdad. Devolver [] aqui seria
  // exactamente el rechazo falso que motiva todo este modulo.
  const original = process.env.BDV_BASE_URL;
  process.env.BDV_BASE_URL = "http://127.0.0.1:1";
  resetBdvWarmClient();
  const { BdvWarmClient } = await import("../src/modules/bdv/bdv-warm.js");
  const cliente = new BdvWarmClient({
    baseUrl: "http://127.0.0.1:1",
    account: "01020000000123456789",
    accessToken: "token-de-prueba",
    refreshToken: "",
    rip: "huella",
    timeoutMs: 2_000,
  });
  try {
    await assert.rejects(
      () => cliente.listMovements(),
      (error: unknown) => error instanceof BdvSessionError,
    );
  } finally {
    process.env.BDV_BASE_URL = original;
    resetBdvWarmClient();
  }
});
