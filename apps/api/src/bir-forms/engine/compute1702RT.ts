// compute1702RT.ts — 1702-RT (Annual ITR, corporations, regular rate; MCIT-aware).
// Faithful to the official 4-page Jan 2018 ENCS form: Part IV computation of tax,
// the credit items 44-54, Part V tax relief, and the Part VI schedules
// (I ordinary deductions, II special deductions, III/IIIA NOLCO, IV excess MCIT,
// V reconciliation). Schedule totals feed Items 34/35/36/47.
//
// Ported verbatim from the Sentire generator (lib/compute/compute1702RT.ts);
// only the relative imports change for the flattened engine/ layout.

import type { FilingData } from "./types";
import { num, roundPeso } from "./format";

// Schedule I — ordinary allowable itemized deduction line items (1-16 + 17a-17i).
const SCHED1_FIELDS: string[] = [
  "s1_1", "s1_2", "s1_3", "s1_4", "s1_5", "s1_6", "s1_7", "s1_8", "s1_9",
  "s1_10", "s1_11", "s1_12", "s1_13", "s1_14", "s1_15", "s1_16",
  "s1_17a", "s1_17b", "s1_17c", "s1_17d", "s1_17e", "s1_17f", "s1_17g", "s1_17h", "s1_17i",
];

// Schedule II — special allowable itemized deduction rows (amounts).
const SCHED2_FIELDS: string[] = ["s2_1amt", "s2_2amt", "s2_3amt", "s2_4amt"];

// Schedule IIIA / IV repeating-row indices.
const NOLCO_ROWS = [4, 5, 6, 7];
const MCIT_ROWS = [1, 2, 3];

export interface Comp1702RT {
  /** Regular/normal rate (%) — default 25. */
  rate: number;
  i27: number;
  i28: number;
  i29: number;
  i30: number;
  i31: number;
  i32: number;
  i33: number;
  /** 'itemized' | 'osd' */
  method: string;
  i34: number;
  i35: number;
  i36: number;
  i37: number;
  i38: number;
  i39: number;
  i40: number;
  /** Income tax due at the normal rate. */
  i41: number;
  /** MCIT — 2% of gross income. */
  i42: number;
  /** Tax due — higher of normal vs MCIT. */
  i43: number;
  mcitApplies: boolean;
  i44: number;
  i45: number;
  i46: number;
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
  i14: number;
  i15: number;
  i16: number;
  i17: number;
  i18: number;
  i19: number;
  i20: number;
  i21: number;
  // ── Part V – Tax Relief Availment (56-59 on the form; exposed as 57-59) ──
  i57: number;
  i58: number;
  i59: number;
  // ── Part VI Schedule totals ──
  /** Schedule I Item 18 — total ordinary allowable itemized deductions. */
  sch1Total: number;
  /** Schedule II Item 5 — total special allowable itemized deductions. */
  sch2Total: number;
  /** Schedule III Item 3 — net operating loss (gross income less ordinary). */
  sch3NetLoss: number;
  /** Schedule IIIA Item 8 — total NOLCO applied this year (sum of D column). */
  sch3aTotal: number;
  /** Schedule IV Item 4 — total excess MCIT applied this year (sum of F column). */
  sch4Total: number;
  // Schedule V — reconciliation of net income per books.
  schV4: number;
  schV9: number;
  schV10: number;
}

/** Sum a list of plain amount fields. */
function sumFields(d: FilingData, fields: string[]): number {
  return fields.reduce((t, f) => t + num(d[f]), 0);
}

export function compute1702RT(d: FilingData): Comp1702RT {
  const o = {} as Comp1702RT;
  const rate = d.rate == null || d.rate === "" ? 25 : num(d.rate); // % regular/normal
  o.rate = rate;
  o.i27 = num(d.i27); // sales/receipts
  o.i28 = num(d.i28); // returns
  o.i29 = o.i27 - o.i28; // net sales
  o.i30 = num(d.i30); // cost of sales
  o.i31 = o.i29 - o.i30; // gross income from operation
  o.i32 = num(d.i32); // other taxable income
  o.i33 = o.i31 + o.i32; // total taxable income (gross income base for MCIT)
  o.method = (d.method as string) || "itemized";

  // ── Part VI Schedule I — Item 18 total ordinary allowable itemized deductions.
  o.sch1Total = sumFields(d, SCHED1_FIELDS);
  // ── Part VI Schedule II — Item 5 total special allowable itemized deductions.
  o.sch2Total = sumFields(d, SCHED2_FIELDS);
  // ── Part VI Schedule IIIA — Item 8 total NOLCO (sum of the D column).
  o.sch3aTotal = NOLCO_ROWS.reduce((t, r) => t + num(d[`nolco${r}D`]), 0);
  // ── Part VI Schedule IV — Item 4 total excess MCIT applied (sum of the F column).
  o.sch4Total = MCIT_ROWS.reduce((t, r) => t + num(d[`mcit${r}F`]), 0);

  // Items 34/35/36 come from the schedules; if the schedule detail is empty we
  // fall back to the summary field so a direct entry still flows through.
  o.i34 = o.sch1Total > 0 ? o.sch1Total : num(d.i34);
  o.i35 = o.sch2Total > 0 ? o.sch2Total : num(d.i35);
  o.i36 = o.sch3aTotal > 0 ? o.sch3aTotal : num(d.i36);
  o.i37 = o.i34 + o.i35 + o.i36; // total itemized deductions (sum 34-36)
  o.i38 = roundPeso(o.i33 * 0.4); // OSD = 40% of gross income (item 33)
  o.i39 = o.method === "osd" ? o.i33 - o.i38 : o.i33 - o.i37; // net taxable income
  o.i40 = rate;
  o.i41 = roundPeso((o.i39 * rate) / 100); // income tax due (normal)
  o.i42 = roundPeso(o.i33 * 0.02); // MCIT 2% of gross income (item 33)
  o.i43 = Math.max(o.i41, o.i42); // tax due (higher)
  o.mcitApplies = o.i42 > o.i41;

  // Schedule III — net operating loss = gross income (33) less ordinary (Sch I 18).
  o.sch3NetLoss = o.i33 - o.i34;

  // credits 44-54
  o.i44 = num(d.i44);
  o.i45 = num(d.i45);
  o.i46 = num(d.i46);
  // Item 47 (excess MCIT applied) comes from Schedule IV Item 4 when detail exists.
  o.i47 = o.sch4Total > 0 ? o.sch4Total : num(d.i47);
  o.i48 = num(d.i48);
  o.i49 = num(d.i49);
  o.i50 = num(d.i50);
  o.i51 = num(d.i51);
  o.i52 = num(d.i52);
  o.i53 = num(d.i53);
  o.i54 = num(d.i54);
  o.i55 = o.i44 + o.i45 + o.i46 + o.i47 + o.i48 + o.i49 + o.i50 + o.i51 + o.i52 + o.i53 + o.i54;
  o.i56 = o.i43 - o.i55; // net tax payable

  // Part II
  o.i14 = o.i43;
  o.i15 = o.i55;
  o.i16 = o.i56;
  o.i17 = num(d.i17);
  o.i18 = num(d.i18);
  o.i19 = num(d.i19);
  o.i20 = o.i17 + o.i18 + o.i19; // penalties
  o.i21 = o.i16 + o.i20; // total amount payable

  // Part V — Tax Relief Availment (items 57-59 on the printed form).
  o.i57 = roundPeso((o.i35 * rate) / 100); // special deductions × applicable rate
  o.i58 = o.i52; // add: special tax credits (from Item 52)
  o.i59 = o.i57 + o.i58; // total tax relief availment

  // Schedule V — reconciliation of net income per books against taxable income.
  o.schV4 = num(d.schV1) + num(d.schV2) + num(d.schV3); // total (sum 1-3)
  o.schV9 = num(d.schV5) + num(d.schV6) + num(d.schV7) + num(d.schV8); // total (sum 5-8)
  o.schV10 = o.schV4 - o.schV9; // net taxable income (item 4 less item 9)
  return o;
}
