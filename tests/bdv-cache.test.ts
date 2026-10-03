// El verificador de BDV no tiene API: cada consulta al banco cuesta 15-40 s de
// navegador. Estos tests fijan las dos decisiones que hacen que la verificacion
// sea rapida sin debilitar la seguridad:
//   1. Una lectura vigente de movimientos se reutiliza (sin volver al banco).
//   2. Dos verificaciones simultaneas de la MISMA referencia entran una sola vez
//      al portal (WhatsApp + web a la vez no = dos sesiones atascadas).
import "./helpers/mock-env.js";

import test from "node:test";
import assert from "node:assert/strict";
import { MovementCache, SingleFlight, BankBusyError } from "../src/modules/bdv/bdv-cache.js";

const MOVIMIENTOS = [
  { reference: "0677228032099", amount: 790, date: "2026-04-26", description: "pago" },
  { reference: "0677228032000", amount: 100, date: "2026-04-25", description: "pago" },
];

// --- Cache ------------------------------------------------------------------

test("una lectura reciente se reutiliza sin volver al banco", () => {
  let ahora = 1000;
  const cache = new MovementCache({ ttlMs: 45_000, now: () => ahora });

  assert.equal(cache.get(), null, "sin lectura previa no hay cache");

  cache.set(MOVIMIENTOS);
  assert.deepEqual(cache.get(), MOVIMIENTOS);
  assert.equal(cache.isFresh, true);

  // 44 s despues sigue vigente.
  ahora += 44_000;
  assert.equal(cache.isFresh, true, "a los 44 s la lectura sigue sirviendo");

  // A los 46 s ya no: el banco pudo recibir un pago nuevo.
  ahora += 2_000;
  assert.equal(cache.get(), null, "pasada la ventana hay que volver a preguntar al banco");
  assert.equal(cache.isFresh, false);
});

test("cerrar la sesion del banco invalida la cache", () => {
  const cache = new MovementCache({ ttlMs: 45_000, now: () => 1000 });
  cache.set(MOVIMIENTOS);
  cache.clear();
  assert.equal(cache.get(), null, "tras un logout la lectura vieja no vale");
});

test("con TTL 0 la cache nunca sirve (comportamiento del modo anterior)", () => {
  let ahora = 0;
  const cache = new MovementCache({ ttlMs: 0, now: () => ahora });
  cache.set(MOVIMIENTOS);
  ahora += 1;
  assert.equal(cache.get(), null);
});

// --- Deduplicacion de consultas simultaneas --------------------------------

test("dos verificaciones de la misma referencia entran UNA sola vez al portal", async () => {
  const vuelo = new SingleFlight<string, string>();
  let entradasAlBanco = 0;
  const consulta = async () => {
    entradasAlBanco++;
    await new Promise((r) => setTimeout(r, 50));
    return "movimientos";
  };

  const [a, b] = await Promise.all([
    vuelo.run("953712", consulta),
    vuelo.run("953712", consulta),
  ]);

  assert.equal(a, "movimientos");
  assert.equal(b, "movimientos");
  assert.equal(entradasAlBanco, 1, "el banco no debe recibir dos consultas identicas simultaneas");
  assert.equal(vuelo.pending, 0, "al terminar no queda nada colgado");
});

test("referencias DISTINTAS si pueden ir a la vez (no se bloquean entre si)", async () => {
  const vuelo = new SingleFlight<string, string>();
  let entradasAlBanco = 0;
  let simultaneas = 0;
  let activas = 0;
  const consulta = async () => {
    entradasAlBanco++;
    activas++;
    simultaneas = Math.max(simultaneas, activas);
    await new Promise((r) => setTimeout(r, 30));
    activas--;
    return "ok";
  };

  await Promise.all([vuelo.run("ref-1", consulta), vuelo.run("ref-2", consulta)]);

  assert.equal(entradasAlBanco, 2, "cada referencia entra una vez");
  assert.equal(simultaneas, 2, "no se serializan entre si en esta capa");
});

test("tras terminar, una consulta nueva vuelve a entrar (no queda cacheado para siempre)", async () => {
  const vuelo = new SingleFlight<string, number>();
  let llamadas = 0;
  const primera = vuelo.run("ref", async () => ++llamadas);
  await primera;
  const segunda = vuelo.run("ref", async () => ++llamadas);
  await segunda;
  assert.equal(llamadas, 2, "la deduplicacion solo aplica mientras la consulta esta en vuelo");
});

test("un fallo en vuelo no envenena la siguiente consulta", async () => {
  const vuelo = new SingleFlight<string, string>();
  await assert.rejects(
    vuelo.run("ref", async () => { throw new Error("se cayo el portal"); }),
    /se cayo el portal/,
  );
  const ok = await vuelo.run("ref", async () => "funciona");
  assert.equal(ok, "funciona", "despues de un fallo la siguiente consulta entra normal");
});

// --- Banco ocupado ----------------------------------------------------------

test("el error de banco ocupado se distingue de una caida del portal", () => {
  const busy = new BankBusyError(15_000);
  assert.equal(busy.code, "BDV_BUSY");
  assert.ok(busy instanceof Error);
  assert.match(busy.message, /ocupado/);
  assert.ok(busy.message.includes("15"), "el mensaje dice cuanto se espero");
  // Un error generico del navegador NO es "ocupado": el cliente no debe
  // reintentar como si el banco solo estuviera lleno.
  const caida = new Error("net::ERR_CONNECTION_RESET") as Error & { code?: string };
  assert.equal(caida.code, undefined);
});
