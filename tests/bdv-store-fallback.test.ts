// El verificador de la web es BDV a traves del proxy, con Pabilo como
// proveedor anterior. Regla critica: si BDV RESPONDE (pago encontrado o no),
// manda BDV; si BDV no pudo responder (proxy caido, timeout, 5xx), la compra
// debe continuar con Pabilo y no dejar al cliente a medio pago.
//
// Estos tests no importan los modulos de la tienda (arrastran codigo de
// navegador y el cliente Base44); verifican el CODIGO FUENTE que se publica,
// que es lo que corre en vexstorevzla.com.
import "./helpers/mock-env.js";

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const storeUrl = new URL("../webpage/src/lib/pabiloClient.js", import.meta.url);
const workerUrl = new URL("../webpage/src/proxy/bdv-verify.worker.js", import.meta.url);

async function source(url: URL): Promise<string> {
  return readFile(url, "utf8");
}

test("la tienda usa BDV como verificador activo y Pabilo como respaldo", async () => {
  const src = await source(storeUrl);
  assert.match(src, /verifyWithBdvViaProxy\(bankReference, amount\)/, "debe intentar BDV primero");
  assert.match(src, /getPabiloConfig\(\)/, "debe conservar el proveedor anterior como respaldo");
  assert.match(src, /VITE_BDV_VERIFY_PROXY_URL/, "la URL del proxy viene de la variable de la tienda");
});

test("si BDV responde, su respuesta manda aunque el pago no este", async () => {
  const src = await source(storeUrl);
  // La condicion debeHyacer que un fallo de infraestructura (server_error /
  // connection) deje pasar el resultado, y cualquier otra respuesta NO.
  const condicion = /if \(bdv && bdv\.kind !== "server_error" && bdv\.kind !== "connection"\) return bdv;/.test(src);
  assert.ok(condicion, "solo un fallo de infraestructura debe activar el respaldo");
  // Y debe existir, mas abajo, el camino que consulta a Pabilo.
  assert.match(src, /attemptVerification\(ref, amountNum, api_key/, "tras el respaldo debe consultarse Pabilo");
});

test("el corte del navegador y del Worker ocurren antes del limite de Cloudflare", async () => {
  // Cloudflare corta las peticiones a ~100 s con un 524 sin cuerpo: si el
  // navegador espera mas, se queda colgando sin poder caerse al respaldo.
  const store = await source(storeUrl);
  const worker = await source(workerUrl);

  const timeoutCliente = Number(/ctrl\.abort\(\), (\d+)\)/.exec(store)?.[1] ?? "0");
  const timeoutWorker = Number(/controller\.abort\(\), (\d+)\)/.exec(worker)?.[1] ?? "0");

  assert.ok(timeoutCliente > 0, "la pagina debe tener un timeout explicito");
  assert.ok(timeoutWorker > 0, "el Worker debe tener un timeout explicito");
  assert.ok(timeoutCliente <= 99_000, `el corte del cliente (${timeoutCliente}) debe ir bajo los 100 s de Cloudflare`);
  assert.ok(timeoutWorker <= 99_000, `el corte del Worker (${timeoutWorker}) debe ir bajo los 100 s de Cloudflare`);
  assert.ok(
    timeoutWorker < timeoutCliente,
    `el Worker (${timeoutWorker}) debe cortar antes que la pagina (${timeoutCliente}) para devolver un error con cuerpo`,
  );
});

test("el Worker manda la clave solo en la cabecera y devuelve errores legibles", async () => {
  const worker = await source(workerUrl);
  assert.match(worker, /X-BDV-Key/, "la clave viaja en la cabecera");
  assert.match(worker, /"X-BDV-Key": SECRET/);
  // El error por timeout debe ser distinguible, para que la pagina sepa que
  // puede caerse al proveedor anterior.
  assert.match(worker, /el banco tardo demasiado/, "timeout debe devolver un error propio, no un 524");
});
