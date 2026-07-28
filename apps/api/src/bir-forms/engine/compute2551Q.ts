// compute2551Q.ts — 2551Q (Quarterly Percentage Tax; Schedule 1 ATC × rate).
// PORTED verbatim from the Sentire generator (src/lib/compute/compute2551Q).

import type { FilingData, Row2551Q } from "./types";
import { num, roundPeso } from "./format";

export interface Comp2551QRow {
  due: number;
}

export interface Comp2551Q {
  rows: Comp2551QRow[];
  /** Total tax due (sum of per-line dues). */
  i14: number;
  i15: number;
  i16: number;
  i17: number;
  i18: number;
  i19: number;
  i20: number;
  i21: number;
  i22: number;
  i23: number;
  i24: number;
}

export function compute2551Q(d: FilingData): Comp2551Q {
  const rows = (d.rows as Row2551Q[]) || [];
  let totalDue = 0;
  const out = rows.map((r) => {
    const taxable = num(r.taxable);
    const rate = num(r.rate);
    const due = roundPeso((taxable * rate) / 100);
    totalDue += due;
    return { due };
  });
  const o = { rows: out } as Comp2551Q;
  o.i14 = totalDue; // total tax due
  o.i15 = num(d.i15);
  o.i16 = num(d.i16);
  o.i17 = num(d.i17);
  o.i18 = o.i15 + o.i16 + o.i17; // total credits
  o.i19 = o.i14 - o.i18; // tax still payable
  o.i20 = num(d.i20);
  o.i21 = num(d.i21);
  o.i22 = num(d.i22);
  o.i23 = o.i20 + o.i21 + o.i22; // total penalties
  o.i24 = o.i19 + o.i23; // total amount payable
  return o;
}
