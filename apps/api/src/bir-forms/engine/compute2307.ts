// compute2307.ts — 2307 (Certificate of Creditable Tax Withheld at source).
// Ported verbatim from the Sentire generator (lib/compute/compute2307.ts, itself
// a port of B.compute2307 in bir-compute2.jsx); only the relative imports change
// for the flattened engine/ layout.

import type { FilingData, Row2307 } from "./types";
import { num } from "./format";
import { centavos, dec, sum } from "./exact";

export interface Comp2307Row {
  /** Quarter total for this income-payment row (m1 + m2 + m3). */
  total: number;
}

/** One Part III block's totals: every row's quarter total and the Total row. */
export interface Comp2307Block {
  rows: Comp2307Row[];
  totalIncome: number;
  totalTax: number;
  tM1: number;
  tM2: number;
  tM3: number;
}

export interface Comp2307 {
  rows: Comp2307Row[];
  totalIncome: number;
  totalTax: number;
  tM1: number;
  tM2: number;
  tM3: number;
  /**
   * C8: block B (money payments subject to withholding of business tax, `data.rowsB`),
   * totalled the same way — each figure the exact sum of the typed amounts to the
   * centavo (exact.ts), never floating point. Block A above is unchanged.
   */
  blockB: Comp2307Block;
}

/** Block B's totals: exact decimals, reported to the centavo. */
function computeBlockB(rows: Row2307[]): Comp2307Block {
  const m1 = rows.map((r) => dec(r.m1));
  const m2 = rows.map((r) => dec(r.m2));
  const m3 = rows.map((r) => dec(r.m3));
  const total = rows.map((_, i) => sum(m1[i]!, m2[i]!, m3[i]!));
  return {
    rows: total.map((t) => ({ total: centavos(t) })),
    totalIncome: centavos(sum(...total)),
    totalTax: centavos(sum(...rows.map((r) => dec(r.tax)))),
    tM1: centavos(sum(...m1)),
    tM2: centavos(sum(...m2)),
    tM3: centavos(sum(...m3)),
  };
}

export function compute2307(d: FilingData): Comp2307 {
  const rows = (d.rows as Row2307[]) || [];
  let tIncome = 0;
  let tTax = 0;
  let tM1 = 0;
  let tM2 = 0;
  let tM3 = 0;
  const out = rows.map((r) => {
    const m1 = num(r.m1);
    const m2 = num(r.m2);
    const m3 = num(r.m3);
    const total = m1 + m2 + m3;
    tIncome += total;
    tTax += num(r.tax);
    tM1 += m1;
    tM2 += m2;
    tM3 += m3;
    return { total };
  });
  return {
    rows: out,
    totalIncome: tIncome,
    totalTax: tTax,
    tM1,
    tM2,
    tM3,
    blockB: computeBlockB((d.rowsB as Row2307[] | undefined) || []),
  };
}
