import { Prisma } from "@prisma/client";

/**
 * D54: an amount taken from the Portal's books is shown on a return in whole pesos,
 * to the nearest peso, with 50 centavos and above going up. This is the ONLY place
 * that rule lives; if it changes, it changes here.
 *
 * It is applied once per reported line, to that line's exact sum, never to the
 * rows that make the line up. The arithmetic is exact decimal (decimal.js, as
 * Prisma returns money), so ₱0.50 is always ₱1 and 100 rows of ₱0.30 are ₱30.
 *
 * The result is never -0.
 */
export function roundToNearestWholePesoHalfUp(amount: Prisma.Decimal.Value): number {
  const rounded = new Prisma.Decimal(amount)
    .toDecimalPlaces(0, Prisma.Decimal.ROUND_HALF_UP)
    .toNumber();
  return rounded === 0 ? 0 : rounded;
}
