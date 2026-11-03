// compute1601EQ.ts — BIR Form 1601-EQ, Quarterly Remittance Return of Creditable Income
// Taxes Withheld (Expanded) (U17). Part II has six rows (items 13 to 18); this file adds
// every row it is given, so a seventh is never dropped (the Portal refuses to file,
// preview or copy such a return instead). Written on the model of compute2551Q, in exact
// decimals to the centavo (exact.ts): no peso rounding.

import type { FilingData } from "./types";
import { centavos, dec, sum } from "./exact";

/** The rows Part II of the form has room for (items 13 to 18). */
export const ROWS_ON_THE_FORM = 6;

export type OverRemittanceChoice = "" | "refunded" | "tcc" | "carried";

export interface Comp1601EQ {
  /** Each row's tax withheld, as recorded. */
  rows: Array<{ withheld: number }>;
  /** Rows in use: an ATC, or a base or an amount withheld. */
  rowCount: number;
  /** Item 19: total taxes withheld for the quarter (items 13 to 18). */
  i19: number;
  i20: number;
  i21: number;
  i22: number;
  i23: number;
  i24: number;
  /** Item 25: total remittances made (20 to 24). */
  i25: number;
  /** Item 26: tax still due, or over-remittance when negative (19 less 25). */
  i26: number;
  i27: number;
  i28: number;
  i29: number;
  /** Item 30: total penalties (27 to 29). */
  i30: number;
  /** Item 31: total amount still due or over-remittance (26 plus 30). */
  i31: number;
  /** True only when item 31 is negative. */
  overRemittance: boolean;
  /** The over-remittance as a positive amount; 0 when there is none. */
  overRemittanceAmount: number;
  /**
   * The one box marked. Only valid when there is an over-remittance, and "carried" is
   * not applicable in the 4th quarter (the blank: "not applicable for succeeding year").
   * Anything else is "".
   */
  overRemittanceChoice: OverRemittanceChoice;
}

const CHOICES = new Set(["refunded", "tcc", "carried"]);

function rowsOf(d: FilingData): Array<Record<string, unknown>> {
  return Array.isArray(d.rows)
    ? (d.rows as unknown as Array<Record<string, unknown>>)
    : [];
}

export function compute1601EQ(d: FilingData): Comp1601EQ {
  const rows = rowsOf(d);
  const withheld = rows.map((r) => dec(r.withheld));
  const rowCount = rows.filter(
    (r) =>
      String(r.atc ?? "").trim() !== "" ||
      !dec(r.base).isZero() ||
      !dec(r.withheld).isZero(),
  ).length;

  const i19 = sum(...withheld);
  const i20 = dec(d.remittance1);
  const i21 = dec(d.remittance2);
  const i22 = dec(d.previouslyRemitted);
  const i23 = dec(d.overRemittancePrior);
  const i24 = dec(d.otherPayments);
  const i25 = sum(i20, i21, i22, i23, i24);
  const i26 = i19.minus(i25);
  const i27 = dec(d.surcharge);
  const i28 = dec(d.interest);
  const i29 = dec(d.compromise);
  const i30 = sum(i27, i28, i29);
  const i31 = i26.plus(i30);

  const over = i31.lt(0);
  const quarter = String(d.quarter ?? "").replace(/\D/g, "");
  const picked = String(d.overRemittanceChoice ?? "")
    .trim()
    .toLowerCase();
  const choice: OverRemittanceChoice =
    over && CHOICES.has(picked) && !(picked === "carried" && quarter === "4")
      ? (picked as OverRemittanceChoice)
      : "";

  return {
    rows: withheld.map((w) => ({ withheld: centavos(w) })),
    rowCount,
    i19: centavos(i19),
    i20: centavos(i20),
    i21: centavos(i21),
    i22: centavos(i22),
    i23: centavos(i23),
    i24: centavos(i24),
    i25: centavos(i25),
    i26: centavos(i26),
    i27: centavos(i27),
    i28: centavos(i28),
    i29: centavos(i29),
    i30: centavos(i30),
    i31: centavos(i31),
    overRemittance: over,
    overRemittanceAmount: over ? centavos(i31.negated()) : 0,
    overRemittanceChoice: choice,
  };
}
