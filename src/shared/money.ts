import { Decimal } from "decimal.js";

export function decimal(value: string | number): Decimal {
  return new Decimal(value);
}

export function asMoney(value: Decimal): string {
  return value.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2);
}