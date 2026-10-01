import { test } from "node:test";
import assert from "node:assert/strict";
import { extractMovements, parseBs } from "../src/modules/bdv/bdv.client.js";

// El banco no publica documentacion de su API, asi que el extractor esta hecho
// para tolerar distintas formas de respuesta. Estos tests fijan ese comportamiento.
test("parseBs entiende formato venezolano y plano", () => {
  assert.equal(parseBs("18.500,00"), 18500);
  assert.equal(parseBs("18500.00"), 18500);
  assert.equal(parseBs("1.250,50"), 1250.5);
  assert.equal(parseBs("160"), 160);
  assert.equal(parseBs(160), 160);
  assert.equal(parseBs("Bs 800"), 800);
});

test("parseBs no inventa numeros donde no hay", () => {
  assert.equal(parseBs(""), null);
  assert.equal(parseBs(null), null);
  assert.equal(parseBs(undefined), null);
  assert.equal(parseBs("sin datos"), null);
});

test("extractMovimientos encuentra el movimiento dentro de una respuesta anidada", () => {
  const payload = {
    success: true,
    data: {
      cuenta: { numero: "0102..." },
      movimientos: [
        { fecha: "2026-09-30", descripcion: "PAGO MOVIL RECIBIDO", referencia: "953712", monto: 160 },
        { fecha: "2026-09-29", descripcion: "COMPRA", referencia: "111222", monto: 45.5 },
      ],
    },
  };
  const found = extractMovements(payload);
  assert.equal(found.length, 2);
  const hit = found.find((m) => m.reference === "953712");
  assert.ok(hit);
  assert.equal(hit.amount, 160);
  assert.equal(hit.description, "PAGO MOVIL RECIBIDO");
});

test("extractMovimientos tolera otro nombre de campo para el monto", () => {
  const payload = { resultado: [{ referenciaOperacion: "8888", importe: "1.200,00", fechaOperacion: "2026-09-30" }] };
  const found = extractMovements(payload);
  assert.equal(found.length, 1);
  assert.equal(found[0].amount, 1200);
  assert.equal(found[0].reference, "8888");
});

test("extractMovimientos ignora objetos que no son movimientos", () => {
  const payload = {
    cliente: { nombre: "PEDRO", monto: 999 },
    vacio: {},
    texto: "sin movimientos",
    lista: [{ saldo: 100 }, { referencia: "123", monto: 50 }],
  };
  const found = extractMovements(payload);
  // 'cliente' tiene monto pero no referencia, asi que no cuenta como movimiento.
  assert.equal(found.length, 1);
  assert.equal(found[0].reference, "123");
});

test("extractMovimientos no duplica el mismo movimiento aunque aparezca dos veces", () => {
  const m = { fecha: "2026-09-30", referencia: "953712", monto: 160 };
  const found = extractMovements({ a: [m], b: { lista: [m] } });
  assert.equal(found.length, 1);
});