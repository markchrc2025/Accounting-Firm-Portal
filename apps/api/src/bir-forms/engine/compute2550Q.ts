// compute2550Q.ts — 2550Q (Quarterly VAT return, April 2024 ENCS; full Part IV
// line flow). The Part V schedules feed several Part IV / Part II lines:
//   Schedule 1 Col E total  -> Item 39 (deferred input tax carried over)
//   Schedule 1 Col I total  -> Item 52 (deferred for the succeeding period)
//   Schedule 2 direct+ratable -> Item 53 (input tax on VAT-exempt sales)
//   Schedule 3 Col D total  -> Item 16 (creditable VAT withheld)
//   Schedule 4 Col E total  -> Item 17 (advance VAT payments)
// Each schedule total falls back to the flat line field when no rows exist, so
// hand-keyed Part IV/II values keep working.
//
// Ported verbatim from the Sentire generator (lib/compute/compute2550Q.ts);
// only the relative imports change for the flattened engine/ layout.

import type { FilingData, FilingRow } from "./types";
import { num, roundPeso } from "./format";

/** Sum a numeric column ("c<idx>") across a schedule's stored rows. */
function schedColTotal(d: FilingData, key: string, col: number): number {
  const rows = d[key];
  if (!Array.isArray(rows)) return 0;
  return (rows as FilingRow[]).reduce((t, r) => t + num(r["c" + col]), 0);
}

export interface Comp2550Q {
  // Output side
  i31a: number;
  i31b: number;
  i32a: number;
  i33a: number;
  i34a: number;
  i34b: number;
  i35b: number;
  i36b: number;
  i37: number;
  // Input tax carried over (38-42) -> 43
  i38: number;
  i39: number;
  i40: number;
  i41: number;
  i42: number;
  i43: number;
  // Current transactions (44-50)
  i44a: number;
  i44b: number;
  i45a: number;
  i45b: number;
  i46a: number;
  i46b: number;
  i47a: number;
  i47b: number;
  i48a: number;
  i49a: number;
  i50a: number;
  i50b: number;
  i51: number;
  // Deductions/adjustments (52-60)
  i52: number;
  i53: number;
  i54: number;
  i55: number;
  i56: number;
  i57: number;
  i58: number;
  i59: number;
  i60: number;
  i61: number;
  inputTotal: number;
  // Part II rollup
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
  i25: number;
  i26: number;
  // Part V schedule totals (derived; feed the Part IV / Part II lines above).
  sch1TotalE: number; // Schedule 1 Col E -> Item 39
  sch1TotalH: number; // Schedule 1 Col H (allowable input tax for the period)
  sch1TotalI: number; // Schedule 1 Col I -> Item 52
  sch2Direct: number; // Schedule 2 directly attributable
  sch2Ratable: number; // Schedule 2 ratable portion
  sch2Total: number; // Schedule 2 total -> Item 53
  sch3TotalC: number; // Schedule 3 Col C (income payment)
  sch3TotalD: number; // Schedule 3 Col D -> Item 16
  sch4Total: number; // Schedule 4 Col E (amount paid) -> Item 17
}

export function compute2550Q(d: FilingData): Comp2550Q {
  const o = {} as Comp2550Q;
  // Output side
  o.i31a = num(d.i31a);
  o.i31b = roundPeso(o.i31a * 0.12); // output tax 12%
  o.i32a = num(d.i32a);
  o.i33a = num(d.i33a);
  o.i34a = o.i31a + o.i32a + o.i33a; // total sales
  o.i34b = o.i31b; // total output tax due
  o.i35b = num(d.i35b);
  o.i36b = num(d.i36b);
  o.i37 = o.i34b - o.i35b + o.i36b; // adjusted output tax due

  // Input tax carried over block (38-42) -> 43
  o.i38 = num(d.i38);
  // Item 39 — input tax deferred on capital goods >P1M from the previous
  // quarter = Part V Schedule 1, Column E total (falls back to the flat field).
  const sch1ColE = schedColTotal(d, "sch1", 4);
  o.i39 = sch1ColE || num(d.i39);
  o.i40 = num(d.i40);
  o.i41 = num(d.i41);
  o.i42 = num(d.i42);
  o.i43 = o.i38 + o.i39 + o.i40 + o.i41 + o.i42;

  // Current transactions (44-50)
  o.i44a = num(d.i44a);
  o.i44b = num(d.i44b);
  o.i45a = num(d.i45a);
  o.i45b = num(d.i45b);
  o.i46a = num(d.i46a);
  o.i46b = num(d.i46b);
  o.i47a = num(d.i47a);
  o.i47b = num(d.i47b);
  o.i48a = num(d.i48a);
  o.i49a = num(d.i49a);
  o.i50a = o.i44a + o.i45a + o.i46a + o.i47a + o.i48a + o.i49a; // total current purchases
  o.i50b = o.i44b + o.i45b + o.i46b + o.i47b; // total current input tax
  o.i51 = o.i43 + o.i50b; // total available input tax

  // Deductions/adjustments (52-60)
  // Item 52 — input tax on capital goods >P1M deferred for the succeeding period
  // = Part V Schedule 1, Column I total (falls back to the flat field).
  const sch1ColI = schedColTotal(d, "sch1", 8);
  o.i52 = sch1ColI || num(d.i52);
  // Item 53 — input tax attributable to VAT-exempt sales = Part V Schedule 2
  // (directly attributable + ratable portion). Falls back to the flat field.
  const sch2 = num(d.sch2_direct) + num(d.sch2_ratable);
  o.i53 = sch2 || num(d.i53);
  o.i54 = num(d.i54);
  o.i55 = num(d.i55);
  o.i56 = num(d.i56);
  o.i57 = o.i52 + o.i53 + o.i54 + o.i55 + o.i56;
  o.i58 = num(d.i58);
  o.i59 = o.i57 + o.i58; // adjusted deductions
  o.i60 = o.i51 - o.i59; // total allowable input tax
  o.i61 = o.i37 - o.i60; // net VAT payable (To Part II Item 15)
  o.inputTotal = o.i60; // backward-compat

  // Part II rollup
  o.i15 = o.i61;
  // Item 16 — creditable VAT withheld = Part V Schedule 3, Column D total
  // (falls back to the flat field). Item 17 — advance VAT payments = Part V
  // Schedule 4, Column E (Amount Paid) total (falls back to the flat field).
  o.i16 = schedColTotal(d, "sch3", 3) || num(d.i16);
  o.i17 = schedColTotal(d, "sch4", 4) || num(d.i17);
  o.i18 = num(d.i18);
  o.i19 = num(d.i19);
  o.i20 = o.i16 + o.i17 + o.i18 + o.i19; // total credits
  o.i21 = o.i15 - o.i20; // tax still payable
  o.i22 = num(d.i22);
  o.i23 = num(d.i23);
  o.i24 = num(d.i24);
  o.i25 = o.i22 + o.i23 + o.i24; // penalties
  o.i26 = o.i21 + o.i25; // total payable

  // Part V schedule totals (exposed so the form/XML can render real totals).
  o.sch1TotalE = sch1ColE;
  o.sch1TotalH = schedColTotal(d, "sch1", 7); // Col H allowable input tax
  o.sch1TotalI = sch1ColI;
  o.sch2Direct = num(d.sch2_direct);
  o.sch2Ratable = num(d.sch2_ratable);
  o.sch2Total = o.sch2Direct + o.sch2Ratable;
  o.sch3TotalC = schedColTotal(d, "sch3", 2); // Col C income payment
  o.sch3TotalD = schedColTotal(d, "sch3", 3); // Col D total tax withheld
  o.sch4Total = schedColTotal(d, "sch4", 4); // Col E amount paid
  return o;
}
