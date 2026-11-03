// compute1601C.ts — BIR Form 1601-C, Monthly Remittance Return of Income Taxes Withheld
// on Compensation (U17). Every figure is typed: the Portal holds no payroll records.
// Written on the model of compute2551Q, in exact decimals to the centavo (exact.ts):
// no peso rounding.
//
// Items that can legitimately be negative: 26 (an adjustment "Add/(Less)"), 31 and 36
// (an over-remittance; this form has no refund or credit boxes), and Schedule I's
// adjustments (6 less 5). Item 27 can be too, when the adjustment taken off is larger
// than the month's withholding. Items 22 and 24 are negative only if the typed figures
// contradict each other (more non-taxable pay than total pay); they are shown as the
// arithmetic gives them, never clamped.

import type { FilingData } from "./types";
import { centavos, dec, sum } from "./exact";

export interface Comp1601C {
  i14: number;
  /** Item 21: total non-taxable compensation (items 15 to 20). */
  i21: number;
  /** Item 22: total taxable compensation (14 less 21). */
  i22: number;
  i23: number;
  /** Item 24: net taxable compensation (22 less 23). */
  i24: number;
  i25: number;
  /** Schedule I's three adjustments, each item 6 less item 5. */
  adjustments: [number, number, number];
  /** Schedule I item 4: their total. */
  scheduleTotal: number;
  /** Item 26: the schedule's total. */
  i26: number;
  /** Item 27: taxes withheld for remittance (25 plus 26). */
  i27: number;
  i28: number;
  i29: number;
  /** Item 30: total tax remittances made (28 plus 29). */
  i30: number;
  /** Item 31: tax still due, or over-remittance when negative (27 less 30). */
  i31: number;
  i32: number;
  i33: number;
  i34: number;
  /** Item 35: total penalties (32 to 34). */
  i35: number;
  /** Item 36: total amount still due or over-remittance (31 plus 35). */
  i36: number;
}

function scheduleRows(d: FilingData): Array<Record<string, unknown>> {
  return Array.isArray(d.scheduleRows)
    ? (d.scheduleRows as unknown as Array<Record<string, unknown>>)
    : [];
}

export function compute1601C(d: FilingData): Comp1601C {
  const i14 = dec(d.compensation);
  const i21 = sum(
    dec(d.mwe),
    dec(d.holiday),
    dec(d.thirteenth),
    dec(d.deMinimis),
    dec(d.contributions),
    dec(d.otherNonTaxable),
  );
  const i22 = i14.minus(i21);
  const i23 = dec(d.notSubjectToWithholding);
  const i24 = i22.minus(i23);
  const i25 = dec(d.taxesWithheld);

  // Schedule I has three rows; a missing row is a row of nothing.
  const rows = scheduleRows(d);
  const adj = [0, 1, 2].map((i) => dec(rows[i]?.shouldBe).minus(dec(rows[i]?.taxPaid)));
  const scheduleTotal = sum(...adj);
  const i26 = scheduleTotal;
  const i27 = i25.plus(i26);

  const i28 = dec(d.previouslyRemitted);
  const i29 = dec(d.otherRemittances);
  const i30 = i28.plus(i29);
  const i31 = i27.minus(i30);
  const i32 = dec(d.surcharge);
  const i33 = dec(d.interest);
  const i34 = dec(d.compromise);
  const i35 = sum(i32, i33, i34);

  return {
    i14: centavos(i14),
    i21: centavos(i21),
    i22: centavos(i22),
    i23: centavos(i23),
    i24: centavos(i24),
    i25: centavos(i25),
    adjustments: [centavos(adj[0]!), centavos(adj[1]!), centavos(adj[2]!)],
    scheduleTotal: centavos(scheduleTotal),
    i26: centavos(i26),
    i27: centavos(i27),
    i28: centavos(i28),
    i29: centavos(i29),
    i30: centavos(i30),
    i31: centavos(i31),
    i32: centavos(i32),
    i33: centavos(i33),
    i34: centavos(i34),
    i35: centavos(i35),
    i36: centavos(i31.plus(i35)),
  };
}
