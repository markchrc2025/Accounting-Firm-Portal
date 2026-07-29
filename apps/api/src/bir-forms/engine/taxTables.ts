// taxTables.ts — TRAIN graduated income-tax tables and the bracket lookup.
// Ported verbatim from the Sentire generator (lib/taxTables.ts); only the
// relative import changes for the flattened engine/ layout.

import { num } from "./format";

export interface TaxBracket {
  /** Upper bound of the bracket (inclusive); Infinity for the top bracket. */
  upTo: number;
  /** Fixed tax on income up to `over`. */
  base: number;
  /** Marginal rate applied to the excess over `over`. */
  rate: number;
  /** Lower bound of the bracket. */
  over: number;
}

/** Table 1 — effective Jan 1, 2018 to Dec 31, 2022. */
export const TAX_TABLE_1: readonly TaxBracket[] = [
  { upTo: 250000, base: 0, rate: 0, over: 0 },
  { upTo: 400000, base: 0, rate: 0.2, over: 250000 },
  { upTo: 800000, base: 30000, rate: 0.25, over: 400000 },
  { upTo: 2000000, base: 130000, rate: 0.3, over: 800000 },
  { upTo: 8000000, base: 490000, rate: 0.32, over: 2000000 },
  { upTo: Infinity, base: 2410000, rate: 0.35, over: 8000000 },
];

/** Table 2 — effective Jan 1, 2023 and onwards. */
export const TAX_TABLE_2: readonly TaxBracket[] = [
  { upTo: 250000, base: 0, rate: 0, over: 0 },
  { upTo: 400000, base: 0, rate: 0.15, over: 250000 },
  { upTo: 800000, base: 22500, rate: 0.2, over: 400000 },
  { upTo: 2000000, base: 102500, rate: 0.25, over: 800000 },
  { upTo: 8000000, base: 402500, rate: 0.3, over: 2000000 },
  { upTo: Infinity, base: 2202500, rate: 0.35, over: 8000000 },
];

/**
 * Graduated income tax on `taxable`. The 2023-onward table applies for
 * years >= 2023; otherwise the 2018–2022 table. Returns 0 for non-positive
 * taxable income. Result is NOT peso-rounded (callers round as needed).
 */
export function graduatedTax(taxable: unknown, year: unknown): number {
  const t = num(taxable);
  if (t <= 0) return 0;
  const table = Number(year) >= 2023 ? TAX_TABLE_2 : TAX_TABLE_1;
  for (const b of table) {
    if (t <= b.upTo) return b.base + (t - b.over) * b.rate;
  }
  return 0;
}
