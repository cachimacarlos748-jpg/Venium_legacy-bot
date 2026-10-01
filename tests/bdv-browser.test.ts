import { test } from "node:test";
import assert from "node:assert/strict";
import { parseBs } from "../src/modules/bdv/bdv.browser.js";

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