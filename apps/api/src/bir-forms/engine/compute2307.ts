// compute2307.ts — 2307 (Certificate of Creditable Tax Withheld at source).
// Ported verbatim from the Sentire generator (lib/compute/compute2307.ts, itself
// a port of B.compute2307 in bir-compute2.jsx); only the relative imports change
// for the flattened engine/ layout.

import type { FilingData, Row2307 } from "./types";
import { num } from "./format";

export interface Comp2307Row {
  /** Quarter total for this income-payment row (m1 + m2 + m3). */
  total: number;
}

export interface Comp2307 {
  rows: Comp2307Row[];
  totalIncome: number;
  totalTax: number;
  tM1: number;
  tM2: number;
  tM3: number;
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
  return { rows: out, totalIncome: tIncome, totalTax: tTax, tM1, tM2, tM3 };
}
