import { Decimal } from "decimal.js";
import { asMoney, decimal } from "../../shared/money.js";

export type RoundingMode = "nearest" | "ceil" | "floor" | "none";

export interface PricingSettings {
  usdToBsRate: string;
  marginPercent: string;
  roundingMode: RoundingMode;
  roundingIncrementBs: string;
  minimumPriceBs: string;
}

export interface PriceQuote {
  costUsdUnit: string;
  costBsUnit: string;
  marginBsUnit: string;
  priceBeforeRoundingBs: string;
  salePriceBsUnit: string;
  salePriceBsTotal: string;
}

export function calculatePrice(
  costUsdUnitInput: string | number,
  quantity: number,
  settings: PricingSettings,
): PriceQuote {
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 99) {
    throw new Error("quantity must be an integer between 1 and 99");
  }

  const costUsdUnit = decimal(costUsdUnitInput);
  const rate = decimal(settings.usdToBsRate);
  const marginPercent = decimal(settings.marginPercent);
  const increment = decimal(settings.roundingIncrementBs);
  const minimum = decimal(settings.minimumPriceBs);

  if (costUsdUnit.isNegative() || rate.lte(0) || marginPercent.lt(0) || increment.lte(0) || minimum.lt(0)) {
    throw new Error("pricing settings contain invalid negative or zero values");
  }

  const costBsUnit = costUsdUnit.mul(rate);
  const priceBeforeRounding = costBsUnit.mul(new Decimal(1).plus(marginPercent.div(100)));
  const base = Decimal.max(priceBeforeRounding, minimum);
  let salePrice = base;

  switch (settings.roundingMode) {
    case "nearest":
      salePrice = base.div(increment).toDecimalPlaces(0, Decimal.ROUND_HALF_UP).mul(increment);
      break;
    case "ceil":
      salePrice = base.div(increment).ceil().mul(increment);
      break;
    case "floor":
      salePrice = base.div(increment).floor().mul(increment);
      break;
    case "none":
      break;
  }

  return {
    costUsdUnit: asMoney(costUsdUnit),
    costBsUnit: asMoney(costBsUnit),
    marginBsUnit: asMoney(priceBeforeRounding.minus(costBsUnit)),
    priceBeforeRoundingBs: asMoney(priceBeforeRounding),
    salePriceBsUnit: asMoney(salePrice),
    salePriceBsTotal: asMoney(salePrice.mul(quantity)),
  };
}