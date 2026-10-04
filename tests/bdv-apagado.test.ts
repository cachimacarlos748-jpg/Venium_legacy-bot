// El verificador contra el portal del banco quedó APAGADO: la tienda verifica
// con Pabilo y el banco bloquea la cuenta del titular cuando se le insiste
// (el espejo releia la tabla cada 2-3 minutos, día y noche). Estos tests fijan
// que "apagado" significa de verdad apagado:
//   - ninguna llamada abre Chrome ni inicia sesión
//   - el espejo no se calienta (nada de lecturas programadas)
//   - la sesión tibia no se construye, así el panel no muestra una sesión viva
// Y que se pueda volver a encender con una sola variable, sin tocar el código.
import "./helpers/bdv-off-env.js";

import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bdvHabilitado, BDV_APAGADO_NOTA, createBdvClient } from "../src/modules/bdv/bdv.browser.js";
import { getBdvWarmClient } from "../src/modules/bdv/bdv-warm.js";

function dbVacia() {
  const dir = mkdtempSync(join(tmpdir(), "bdv-apagado-"));
  return new Database(join(dir, "app.db"));
}

test("por defecto el verificador esta apagado", () => {
  assert.equal(bdvHabilitado(), false);
});

test("una verificacion devuelve 'no se pudo verificar', nunca un rechazo", async () => {
  // Si alguien dejara PAYMENT_PROVIDER=bdv puesto por error, el cliente tiene
  // que poder reintentar: un "error" definitivo lo hace pagar otra vez.
  const bdv = createBdvClient(dbVacia());
  const r = await bdv.verifyPayment({ amount: "790.00", bankReference: "953712" });
  assert.equal(r.verified, false);
  assert.equal(r.status, "bank_unavailable");
  assert.match(String((r.raw as any)?.error ?? ""), /apagado/i);
  await bdv.close();
});

test("listar movimientos no abre sesion: devuelve la nota y nada mas", async () => {
  const db = dbVacia();
  const bdv = createBdvClient(db);
  const rows = await bdv.listMovements();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].reference, null, "no puede haber ninguna lectura real del banco");
  assert.match(rows[0].description ?? "", /apagado/i);
  await bdv.close();
});

test("el espejo no se calienta (es lo que repetia el acceso al banco)", async () => {
  const bdv = createBdvClient(dbVacia());
  const r: any = await bdv.refreshMirror();
  assert.equal(r.ok, true);
  assert.equal(r.skipped, true, "debe saltarse sin tocar el banco");
  await bdv.close();
});

test("no se construye la sesion tibia, asi el panel no muestra una sesion viva", () => {
  // Aunque las credenciales de sesion esten puestas, con el verificador apagado
  // no hay cliente: nada que renovar por debajo ni que mostrar en el panel.
  assert.equal(getBdvWarmClient(), null);
});

test("forzar cierre de sesion es inocuo cuando esta apagado", async () => {
  const bdv = createBdvClient(dbVacia());
  const r = await bdv.forceLogout();
  assert.equal(r.ok, true);
  assert.match(r.note ?? "", /apagado/i);
  await bdv.close();
});

test("la nota explica como volver a encenderlo", () => {
  assert.match(BDV_APAGADO_NOTA, /BDV_ENABLED/);
});
