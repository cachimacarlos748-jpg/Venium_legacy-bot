import { test } from "node:test";
import assert from "node:assert/strict";
import { parseBs, referencesMatch } from "../src/modules/bdv/bdv.browser.js";

// El banco no publica documentacion de su API, asi que el parser esta hecho
// para tolerar distintas formas. Estos tests fijan ese comportamiento.
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

test("parseBs tolera espacios y simbolos de la tabla del banco", () => {
  assert.equal(parseBs("1.600,00 Bs"), 1600);
  assert.equal(parseBs("  250.00 "), 250);
  assert.equal(parseBs("-50,00"), -50);
});

// Referencias reales del BDV (13 digitos, con ceros a la izquierda) contra lo
// que el cliente escribe a mano desde el comprobante.
test("referencesMatch acepta la referencia completa tal cual", () => {
  assert.equal(referencesMatch("0677228032099", "0677228032099"), true);
});

test("referencesMatch tolera los ceros iniciales que el banco antepone", () => {
  assert.equal(referencesMatch("0677228032099", "677228032099"), true);
  assert.equal(referencesMatch("677228032099", "0677228032099"), true);
});

test("referencesMatch funciona entre bancos con longitudes distintas", () => {
  // Cliente escribe los ultimos 6-8 digitos de una referencia de 13.
  assert.equal(referencesMatch("0677228032099", "32099"), false);
  assert.equal(referencesMatch("0677228032099", "8032099"), true);
  assert.equal(referencesMatch("0677228032099", "228032099"), true);
});

test("referencesMatch NO acepta una referencia corta cualquiera", () => {
  // Menos de 6 digitos es demasiado ambiguo: rechazarlo evita dar por pagado
  // un comprobante equivocado.
  assert.equal(referencesMatch("0677228032099", "099"), false);
  assert.equal(referencesMatch("0677228032099", "2"), false);
});

test("referencesMatch rechaza referencias que no son la cola una de la otra", () => {
  assert.equal(referencesMatch("0677228032099", "123456"), false);
  assert.equal(referencesMatch("0677228032099", "0677228032999"), false);
});

test("referencesMatch rechaza vacios y basura", () => {
  assert.equal(referencesMatch("", "0677228032099"), false);
  assert.equal(referencesMatch("0677228032099", ""), false);
  assert.equal(referencesMatch("abc", "def"), false);
});