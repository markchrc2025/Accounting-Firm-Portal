// compute1702Q.ts — 1702Q (Quarterly ITR, corporations/non-individuals; MCIT-aware).
// Faithful to BIR Form 1702Q (January 2018 ENCS) Part IV schedules:
//   * Schedule 1 — Declaration this Quarter for EXEMPT (col A) / SPECIAL (col B)
//     income; items 1-13 ending in the net income tax due → Part II Item 17.
//   * Schedule 2 — Declaration this Quarter, REGULAR/NORMAL RATE; items 1-13
//     ending in the income tax due (higher of normal tax or MCIT) → Part II Item 14.
//   * Schedule 3 — MCIT computation: cumulative gross income (1st-3rd quarter)
//     × 2% → Schedule 2 Item 12.
//   * Schedule 4 — Tax Credits/Payments: items 1-6b summed → Part II Item 19.
//
// Ported verbatim from the Sentire generator (lib/compute/compute1702Q.ts);
// only the relative imports change for the flattened engine/ layout.

import type { FilingData } from "./types";
import { num, roundPeso } from "./format";

export interface Comp1702Q {
  /** Regular/normal rate (%) — default 25. */
  rate: number;
  // ── Schedule 1 — Special / Exempt rate (A = Exempt, B = Special) ──
  /** Applicable income-tax rate for the SPECIAL column (%), default 0. */
  sch1Rate: number;
  // Exempt column (A)
  sch1_1A: number;
  sch1_2A: number;
  sch1_3A: number;
  sch1_4A: number;
  sch1_5A: number;
  sch1_6A: number;
  sch1_7A: number;
  sch1_8A: number;
  sch1_9A: number;
  sch1_11A: number;
  sch1_12A: number;
  sch1_13A: number;
  // Special column (B)
  sch1_1B: number;
  sch1_2B: number;
  sch1_3B: number;
  sch1_4B: number;
  sch1_5B: number;
  sch1_6B: number;
  sch1_7B: number;
  sch1_8B: number;
  sch1_9B: number;
  sch1_11B: number;
  sch1_12B: number;
  sch1_13B: number;
  /** Schedule 1 total net income tax due (exempt 0 + special) → Part II Item 17. */
  sch1_13: number;
  // ── Schedule 2 — Regular/Normal Rate ──
  s2_1: number;
  s2_2: number;
  s2_3: number;
  s2_4: number;
  s2_5: number;
  /** 'itemized' | 'osd' */
  method: string;
  s2_6: number;
  s2_7: number;
  s2_8: number;
  s2_9: number;
  s2_10: number;
  /** Income tax due at the normal rate. */
  s2_11: number;
  /** MCIT — 2% of gross income (from Schedule 3 Item 6). */
  mcit: number;
  /** Income tax due — higher of normal vs MCIT. */
  s2_13: number;
  mcitApplies: boolean;
  // ── Schedule 3 — MCIT computation ──
  sch3_1: number;
  sch3_2: number;
  sch3_3: number;
  sch3_4: number;
  /** MCIT rate (%) — always 2. */
  sch3_5: number;
  sch3_6: number;
  // ── Schedule 4 — Tax Credits/Payments ──
  sch4_1: number;
  sch4_2: number;
  sch4_3: number;
  sch4_4: number;
  sch4_5: number;
  sch4_6: number;
  sch4_6a: number;
  sch4_6b: number;
  /** Total tax credits/payments (sum of items 1 to 6b) → Part II Item 19. */
  sch4_7: number;
  // ── Part II ──
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
  i25: number;
}

export function compute1702Q(d: FilingData): Comp1702Q {
  const o = {} as Comp1702Q;
  const rate = d.rate == null || d.rate === "" ? 25 : num(d.rate);
  o.rate = rate;

  // ── Schedule 1 — Declaration this Quarter — EXEMPT (A) / SPECIAL (B) ──
  // Mirrors Schedule 2's structure per column; the SPECIAL column carries an
  // applicable rate (Item 10) while the EXEMPT column is taxed at 0%.
  o.sch1Rate = d.sch1Rate == null || d.sch1Rate === "" ? 0 : num(d.sch1Rate);
  // Exempt column (A) — applicable rate fixed at 0%.
  o.sch1_1A = num(d.sch1_1A);
  o.sch1_2A = num(d.sch1_2A);
  o.sch1_3A = o.sch1_1A - o.sch1_2A;
  o.sch1_4A = num(d.sch1_4A);
  o.sch1_5A = o.sch1_3A + o.sch1_4A;
  o.sch1_6A = num(d.sch1_6A);
  o.sch1_7A = o.sch1_5A - o.sch1_6A;
  o.sch1_8A = num(d.sch1_8A);
  o.sch1_9A = o.sch1_7A + o.sch1_8A;
  o.sch1_11A = 0; // income tax due other than MCIT (0% on exempt activities)
  o.sch1_12A = num(d.sch1_12A);
  o.sch1_13A = o.sch1_11A - o.sch1_12A;
  // Special column (B) — applicable rate from Item 10 (sch1Rate).
  o.sch1_1B = num(d.sch1_1B);
  o.sch1_2B = num(d.sch1_2B);
  o.sch1_3B = o.sch1_1B - o.sch1_2B;
  o.sch1_4B = num(d.sch1_4B);
  o.sch1_5B = o.sch1_3B + o.sch1_4B;
  o.sch1_6B = num(d.sch1_6B);
  o.sch1_7B = o.sch1_5B - o.sch1_6B;
  o.sch1_8B = num(d.sch1_8B);
  o.sch1_9B = o.sch1_7B + o.sch1_8B;
  o.sch1_11B = roundPeso((o.sch1_9B * o.sch1Rate) / 100); // income tax due
  o.sch1_12B = num(d.sch1_12B);
  o.sch1_13B = o.sch1_11B - o.sch1_12B;
  // Schedule 1 Item 13 total → Part II Item 17 (exempt 0% + special-rate tax).
  o.sch1_13 = o.sch1_13A + o.sch1_13B;

  // ── Schedule 2 — Regular/Normal Rate ──
  o.s2_1 = num(d.s2_1); // sales
  o.s2_2 = num(d.s2_2); // cost of sales
  o.s2_3 = o.s2_1 - o.s2_2; // gross income from operation
  o.s2_4 = num(d.s2_4); // non-operating/other
  o.s2_5 = o.s2_3 + o.s2_4; // total gross income
  o.method = (d.method as string) || "itemized";
  o.s2_6 = o.method === "osd" ? roundPeso(o.s2_5 * 0.4) : num(d.s2_6); // deductions
  o.s2_7 = o.s2_5 - o.s2_6; // taxable income this quarter
  o.s2_8 = num(d.s2_8); // taxable income previous quarters
  o.s2_9 = o.s2_7 + o.s2_8; // total taxable income to date
  o.s2_10 = rate;
  o.s2_11 = roundPeso((o.s2_9 * rate) / 100); // income tax due (normal)

  // ── Schedule 3 — MCIT computation ──
  // Cumulative gross income per quarter (1st-3rd) × 2%. The current quarter's
  // gross income (Schedule 2 Item 5) seeds the matching quarter when the user
  // has not entered it explicitly, so a fresh return still computes MCIT.
  const qStr = String(d.quarter || "");
  o.sch3_1 = num(d.sch3_1) || (qStr.startsWith("1") ? o.s2_5 : 0);
  o.sch3_2 = num(d.sch3_2) || (qStr.startsWith("2") ? o.s2_5 : 0);
  o.sch3_3 = num(d.sch3_3) || (qStr.startsWith("3") ? o.s2_5 : 0);
  o.sch3_4 = o.sch3_1 + o.sch3_2 + o.sch3_3; // total gross income
  o.sch3_5 = 2; // MCIT rate
  // When no per-quarter detail was entered the total equals this quarter's gross
  // income, so MCIT stays 2% of the cumulative gross income to date either way.
  const mcitBase = o.sch3_4 > 0 ? o.sch3_4 : o.s2_5;
  o.sch3_6 = roundPeso(mcitBase * 0.02); // minimum corporate income tax
  o.mcit = o.sch3_6; // → Schedule 2 Item 12

  o.s2_13 = Math.max(o.s2_11, o.mcit); // income tax due (higher)
  o.mcitApplies = o.mcit > o.s2_11;

  // ── Schedule 4 — Tax Credits/Payments (items 1-6b → Item 7) ──
  o.sch4_1 = num(d.sch4_1); // prior year's excess credits
  o.sch4_2 = num(d.sch4_2); // tax payments previous quarters (other than MCIT)
  o.sch4_3 = num(d.sch4_3); // MCIT payments previous quarters
  o.sch4_4 = num(d.sch4_4); // creditable tax withheld previous quarters
  o.sch4_5 = num(d.sch4_5); // creditable tax withheld per 2307 this quarter
  o.sch4_6 = num(d.sch4_6); // tax paid in previously-filed return (amended)
  o.sch4_6a = num(d.sch4_6a); // other tax credits/payments (a)
  o.sch4_6b = num(d.sch4_6b); // other tax credits/payments (b)
  o.sch4_7 =
    o.sch4_1 + o.sch4_2 + o.sch4_3 + o.sch4_4 + o.sch4_5 + o.sch4_6 + o.sch4_6a + o.sch4_6b;

  // ── Part II ──
  o.i14 = o.s2_13; // income tax due — regular/normal rate (Sch 2 Item 13)
  o.i15 = num(d.i15); // less: unexpired excess prior year MCIT over regular
  o.i16 = o.i14 - o.i15; // balance/income tax still due — regular rate
  o.i17 = o.sch1_13; // add: income tax due — special rate (Sch 1 Item 13)
  o.i18 = o.i16 + o.i17; // aggregate income tax due
  o.i19 = o.sch4_7; // less: total tax credits/payments (Sch 4 Item 7)
  o.i20 = o.i18 - o.i19; // net tax payable / (overpayment)
  o.i21 = num(d.i21); // surcharge
  o.i22 = num(d.i22); // interest
  o.i23 = num(d.i23); // compromise
  o.i24 = o.i21 + o.i22 + o.i23; // total penalties
  o.i25 = o.i20 + o.i24; // total amount payable / (overpayment)
  return o;
}
