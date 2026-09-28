import { test } from "node:test";
import assert from "node:assert/strict";
import { regexExtractReceipt } from "../src/modules/payments/payment.service.js";

// Regression tests for the REAL messages of customer 584246619762, whose
// typed receipts all failed with "problema técnico" when Gemini was down.
// The deterministic parser must extract reference + amount from all of them.
test("regexExtractReceipt parses 'Monto 800,00 Referencia 953712'", () => {
  const r = regexExtractReceipt("Monto 800,00 Referencia 953712");
  assert.equal(r.reference, "953712");
  assert.equal(r.amountBs, "800.00");
});

test("regexExtractReceipt parses '953712 Trasnferi 800' (no label, misspelled verb)", () => {
  const r = regexExtractReceipt("953712 Trasnferi 800");
  assert.equal(r.reference, "953712");
  assert.equal(r.amountBs, "800");
});

test("regexExtractReceipt parses '3712 monto 800,00' (short unlabeled reference)", () => {
  const r = regexExtractReceipt("3712 monto 800,00");
  assert.equal(r.reference, "3712");
  assert.equal(r.amountBs, "800.00");
});

test("regexExtractReceipt parses thousand separators", () => {
  const r = regexExtractReceipt("Referencia 456789123 Monto 18.500,00");
  assert.equal(r.reference, "456789123");
  assert.equal(r.amountBs, "18500.00");
});

test("regexExtractReceipt parses transfer-verb amounts", () => {
  const r = regexExtractReceipt("referencia 987654 transferi 1500");
  assert.equal(r.reference, "987654");
  assert.equal(r.amountBs, "1500");
});

test("regexExtractReceipt returns nulls when there is nothing receipt-like", () => {
  const r = regexExtractReceipt("hola quiero un paquete de free fire");
  assert.equal(r.reference, null);
  // No decimal figure and no labeled amount: no amount either.
  assert.equal(r.amountBs, null);
});
