// compute1701A.ts — 1701A (Annual ITR, individuals purely business/profession).
// Ported verbatim from the Sentire generator (lib/compute/compute1701A.ts);
// only the relative imports change for the flattened engine/ layout.

import type { FilingData } from "./types";
import { num, roundPeso } from "./format";
import { graduatedTax } from "./taxTables";

/** Computed values for one column (A = taxpayer/filer, B = spouse). */
export interface Side1701A {
  // Part IV.A — Graduated / OSD (items 36–46)
  i36: number;
  i37: number;
  i38: number;
  i39: number;
  i40: number;
  i41: number;
  i42: number;
  i43: number;
  i44: number;
  i45: number;
  i46: number;
  // Part IV.B — 8% flat (items 47–56)
  i47: number;
  i48: number;
  i49: number;
  i50: number;
  i51: number;
  i52: number;
  i53: number;
  i54: number;
  i55: number;
  i56: number;
  /** Chosen tax due (item 46 graduated OR item 56 8%). */
  taxDue: number;
  // Part IV.C — credits (items 57–65)
  i57: number;
  i58: number;
  i59: number;
  i60: number;
  i61: number;
  i62: number;
  i63: number;
  i64: number;
  i65: number;
  // Part II rollup (items 20–29)
  i20: number;
  i21: number;
  i22: number;
  i23: number;
  i24: number;
  i25: number;
  i26: number;
  i27: number;
  i28: number;
  i29: number;
}

export interface Comp1701A {
  A: Side1701A;
  B: Side1701A;
  /** Aggregate amount payable / (overpayment) — item 30. */
  i30: number;
}

export function compute1701A(d: FilingData): Comp1701A {
  const year = String(d.year || "").slice(0, 4);
  const rate = (d.taxRate as string) || "graduated"; // 'graduated' | 'eight'
  const out = { A: {}, B: {} } as Comp1701A;

  (["A", "B"] as const).forEach((s) => {
    const o = {} as Side1701A;
    // Graduated (OSD) — items 36-46
    o.i36 = num(d["i36" + s]);
    o.i37 = num(d["i37" + s]);
    o.i38 = o.i36 - o.i37; // net sales
    o.i39 = roundPeso(o.i38 * 0.4); // OSD 40% of net sales
    o.i40 = o.i38 - o.i39; // net income
    o.i41 = num(d["i41" + s]);
    o.i42 = num(d["i42" + s]);
    o.i43 = num(d["i43" + s]);
    o.i44 = o.i41 + o.i42 + o.i43; // total other income
    o.i45 = o.i40 + o.i44; // total taxable income
    o.i46 = roundPeso(graduatedTax(o.i45, year)); // tax due (graduated)

    // 8% — items 47-56
    o.i47 = num(d["i47" + s]);
    o.i48 = num(d["i48" + s]);
    o.i49 = o.i47 - o.i48; // net sales
    o.i50 = num(d["i50" + s]);
    o.i51 = num(d["i51" + s]);
    o.i52 = o.i50 + o.i51; // total other non-op
    o.i53 = o.i49 + o.i52; // total taxable
    o.i54 = 250000; // allowable reduction (first 250k of one taxpayer)
    o.i55 = Math.max(0, o.i53 - o.i54); // taxable income
    o.i56 = roundPeso(o.i55 * 0.08); // tax due (8%)

    // chosen tax due
    o.taxDue = rate === "eight" ? o.i56 : o.i46;

    // credits 57-63
    o.i57 = num(d["i57" + s]);
    o.i58 = num(d["i58" + s]);
    o.i59 = num(d["i59" + s]);
    o.i60 = num(d["i60" + s]);
    o.i61 = num(d["i61" + s]);
    o.i62 = num(d["i62" + s]);
    o.i63 = num(d["i63" + s]);
    o.i64 = o.i57 + o.i58 + o.i59 + o.i60 + o.i61 + o.i62 + o.i63; // total credits
    o.i65 = o.taxDue - o.i64; // net tax payable

    // Part II rollup
    o.i20 = o.taxDue;
    o.i21 = o.i64;
    o.i22 = o.i20 - o.i21;
    o.i23 = num(d["i23" + s]); // 2nd installment portion (user)
    o.i24 = o.i22 - o.i23;
    o.i25 = num(d["i25" + s]); // surcharge
    o.i26 = num(d["i26" + s]); // interest
    o.i27 = num(d["i27" + s]); // compromise
    o.i28 = o.i25 + o.i26 + o.i27; // total penalties
    o.i29 = o.i24 + o.i28; // total amount payable

    out[s] = o;
  });

  out.i30 = out.A.i29 + out.B.i29; // aggregate
  return out;
}
