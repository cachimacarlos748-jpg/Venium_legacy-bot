import test from "node:test";
import assert from "node:assert/strict";
import { calculatePrice } from "../src/modules/pricing/pricing.service.js";

test("calculates the approved 0.77 USD example at 790 Bs", () => {
  const quote = calculatePrice("0.77", 1, {
    usdToBsRate: "990",
    marginPercent: "3",
    roundingMode: "nearest",
    roundingIncrementBs: "10",
    minimumPriceBs: "0",
  });

  assert.equal(quote.costBsUnit, "762.30");
  assert.equal(quote.priceBeforeRoundingBs, "785.17");
  assert.equal(quote.salePriceBsUnit, "790.00");
});

test("ceil rounding never undercuts the configured minimum", () => {
  const quote = calculatePrice("0.01", 1, {
    usdToBsRate: "990",
    marginPercent: "0",
    roundingMode: "ceil",
    roundingIncrementBs: "10",
    minimumPriceBs: "100",
  });

  assert.equal(quote.salePriceBsUnit, "100.00");
});