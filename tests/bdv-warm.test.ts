// El lector de "sesion caliente": la via que reemplaza al scraping.
//
// Aqui se prueban las dos cosas que importan de verdad:
//
//  1. Que NINGUNA regla de negocio cambie. Si una referencia no aparece, el
//     verificador NO puede decir "no pago": el pago movil tarda y ese "no" es
//     el rechazo falso que ya costo una venta.
//
//  2. Que un fallo de red NUNCA se convierta en "el cliente no pago".
//
import "./helpers/mock-env.js";

import test from "node:test";
import assert from "node:assert/strict";
import {
  BdvWarmClient,
  BdvSessionError,
  findMovements,
  normalizeMovement,
  parseIsoDate,
} from "../src/modules/bdv/bdv-warm.js";
import { amountsMatch, parseBs, referencesMatch } from "../src/modules/bdv/bdv-match.js";
import type { BdvMovement } from "../src/modules/bdv/bdv.browser.js";

// ---------------------------------------------------------------------------
// Matchers compartidos
// ---------------------------------------------------------------------------

test("referencias: compara la cola, pero nunca por debajo de 6 digitos", () => {
  // Una cola demasiado corta empareja con facilidad con otro pago: acceptarla
  // entregaria un pedido que nadie ha pagado.
  assert.equal(referencesMatch("677228032099", "0677228032099"), true);
  assert.equal(referencesMatch("0677228032099", "228032099"), true);
  assert.equal(referencesMatch("0677228032099", "99"), false);
  assert.equal(referencesMatch("", "677228032099"), false);
});

test("montos: la tolerancia no falla por error de coma flotante", () => {
  // Sin epsilon, |100 - 100.01| da 0.010000000000005116 > 0.01 y un pago
  // valido se rechazaba por aritmetica binaria.
  assert.equal(amountsMatch(100, 100.01, 0.01), true);
  assert.equal(amountsMatch(1250.5, "1.250,50"), true);
  assert.equal(amountsMatch(100, 101, 0.01), false);
  assert.equal(parseBs("1.234,56"), 1234.56);
  assert.equal(parseBs("790,00"), 790);
});

// ---------------------------------------------------------------------------
// Lectura del JSON del banco
// ---------------------------------------------------------------------------

test("busca los movimientos aunque el banco los anide donde quiera", () => {
  // Devolver [] por no haber adivinado la clave es justo el fallo que este
  // lector viene a evitar.
  const enRaiz = findMovements([{ referencia: "111", monto: 10 }]);
  assert.equal(enRaiz.length, 1);
  const anidado = findMovements({ data: { resultado: { movimientos: [{ referencia: "222", monto: 20 }] } } });
  assert.equal(anidado.length, 1);
  assert.equal(String(anidado[0].referencia), "222");
});

test("normaliza los campos en los dos idiomas del portal", () => {
  const es = normalizeMovement({ referencia: "0677228032099", monto: "790,00", fecha: "01/10/2026", descripcion: "PAGO MOVIL" });
  assert.equal(es.reference, "0677228032099");
  assert.equal(es.amount, 790);
  const en = normalizeMovement({ reference: "0677228032099", amount: 790, date: "2026-10-01" });
  assert.equal(en.reference, "0677228032099");
  assert.equal(en.amount, 790);
  assert.equal(parseIsoDate("01/10/2026"), "2026-10-01");
  assert.equal(parseIsoDate("2026-10-01"), "2026-10-01");
});

test("descarta los debitos: una compra del titular no es un pago", () => {
  const debito = normalizeMovement({ referencia: "111122223333", monto: 45, descripcion: "COMPRA EN LINEA DEBITO" });
  assert.equal(debito.incoming, false);
  const credito = normalizeMovement({ referencia: "111122223333", monto: 45, descripcion: "PAGO RECIBIDO CREDITO" });
  assert.equal(credito.incoming, true);
});

// ---------------------------------------------------------------------------
// La regla de negocio: un negativo nunca es "no pago"
// ---------------------------------------------------------------------------

const pago: BdvMovement = { reference: "0677228032099", amount: 790, date: "2026-10-01", description: "PAGO MOVIL", incoming: true };

test("referencia correcta y monto correcto = verificado", () => {
  const v = BdvWarmClient.evaluate([pago], "228032099", 790);
  assert.equal(v.kind, "verified");
});

test("referencia correcta con otro monto se distingue de 'no existe'", () => {
  // Si esto volviera a "not_found", la tienda no podria decirle al cliente
  // "pagaste un monto distinto".
  const v = BdvWarmClient.evaluate([pago], "228032099", 500);
  assert.equal(v.kind, "amount_mismatch");
});

test("banco sin movimientos es PENDING, nunca 'el cliente no pago'", () => {
  // Este es el caso exacto que costaba la venta: 0 movimientos significa que
  // aun no ha reflejado, no que el cliente no haya pagado.
  const v = BdvWarmClient.evaluate([], "228032099", 790);
  assert.equal(v.kind, "pending");
});

test("con movimientos pero sin esa referencia, si es 'not_found'", () => {
  const v = BdvWarmClient.evaluate([pago], "999999999999", 790);
  assert.equal(v.kind, "not_found");
});

// ---------------------------------------------------------------------------
// Fallos del banco: nunca se confunden con "no pago"
// ---------------------------------------------------------------------------

function clienteConFetch(fake: typeof fetch): BdvWarmClient {
  return new BdvWarmClient({
    baseUrl: "https://bdvenlinea.banvenez.com",
    account: "01020000000123456789",
    accessToken: "token-actual",
    refreshToken: "refresh-actual",
    rip: "huella",
    fetchImpl: fake,
  });
}

test("si el banco no responde, se lanza un error: no se inventa un veredicto", async () => {
  const cliente = clienteConFetch((() => {
    throw new Error("ECONNREFUSED");
  }) as unknown as typeof fetch);
  await assert.rejects(
    () => cliente.listMovements(),
    (error: unknown) => error instanceof BdvSessionError,
  );
});

test("un 401 con refresh fallido se propaga como error, no como lista vacia", async () => {
  let llamadas = 0;
  const cliente = clienteConFetch((async () => {
    llamadas++;
    return new Response("{}", { status: 401 });
  }) as unknown as typeof fetch);
  await assert.rejects(
    () => cliente.listMovements(),
    (error: unknown) => error instanceof BdvSessionError,
  );
  assert.ok(llamadas >= 1);
});

test("un 401 con refresh bueno reintenta UNA vez y lee los movimientos", async () => {
  let llamadas = 0;
  const cliente = clienteConFetch((async (url: string) => {
    llamadas++;
    if (String(url).includes("/oauthaccess/actualizar")) {
      return new Response(JSON.stringify({ data: { accessToken: "token-nuevo", refreshToken: "refresh-nuevo" } }), { status: 200 });
    }
    if (llamadas === 1) return new Response("{}", { status: 401 });
    return new Response(JSON.stringify({ data: { movimientos: [{ referencia: "0677228032099", monto: 790 }] } }), { status: 200 });
  }) as unknown as typeof fetch);
  const movements = await cliente.listMovements();
  assert.equal(movements.length, 1);
  assert.equal(movements[0].reference, "0677228032099");
});

test("muchas verificaciones con la sesion caducada refrescan UNA sola vez", async () => {
  // El refresh es single-flight a proposito: sin esto, diez clientes esperando
  // dispararían diez refreshes contra el banco.
  let refreshes = 0;
  const cliente = clienteConFetch((async (url: string) => {
    if (String(url).includes("/oauthaccess/actualizar")) {
      refreshes++;
      await new Promise((r) => setTimeout(r, 20));
      return new Response(JSON.stringify({ data: { accessToken: "token-nuevo" } }), { status: 200 });
    }
    return new Response("{}", { status: 401 });
  }) as unknown as typeof fetch);
  await Promise.allSettled([cliente.listMovements(), cliente.listMovements(), cliente.listMovements()]);
  assert.equal(refreshes, 1);
});

test("las cabeceras viajan como el portal las espera", async () => {
  let vistas: Record<string, string> = {};
  const cliente = clienteConFetch((async (_url: string, init: RequestInit) => {
    vistas = init.headers as Record<string, string>;
    return new Response(JSON.stringify({ movimientos: [] }), { status: 200 });
  }) as unknown as typeof fetch);
  await cliente.listMovements();
  assert.equal(vistas.Authorization, "Bearer token-actual");
  assert.equal(vistas.Rip, "huella");
  assert.match(String(vistas.Accept), /application\/json/);
});
