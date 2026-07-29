// compute2316.ts — 2316 (Certificate of Compensation Payment / Tax Withheld).
// Faithful to the official Sep 2021 ENCS layout.
//
// Item map (Part IV-B, Details of Compensation from Present Employer):
//   A. Non-Taxable/Exempt (29-37) -> Item 38.
//   B. Taxable REGULAR: 39 Basic Salary, 40 Representation, 41 Transportation,
//      42 COLA, 43 Fixed Housing Allowance, 44 Others (44A/44B specify).
//   SUPPLEMENTARY: 45 Commission, 46 Profit Sharing, 47 Fees incl. Director's
//      Fees, 48 Taxable 13th Month Benefits, 49 Hazard Pay, 50 Overtime Pay,
//      51 Others (51A/51B specify).
//   Item 52 = Total Taxable Compensation Income (Sum of Items 39 to 51B).
//
// Part IV-A (Summary): 19 Gross Comp (38+52), 20 Less Non-Taxable (=38),
//   21 Taxable Comp Present (19-20 = 52), 22 Add Previous, 23 Gross Taxable
//   (21+22), 24 Tax Due, 25A/25B Taxes Withheld, 26 Total Withheld as adjusted
//   (25A+25B), 27 5% PERA Credit, 28 Total Taxes Withheld (26+27).
//
// Ported verbatim from the Sentire generator (lib/compute/compute2316.ts); only
// the relative imports change for the flattened engine/ layout.

import type { FilingData } from "./types";
import { num, roundPeso } from "./format";
import { graduatedTax as grad } from "./taxTables";

export interface Comp2316 {
  /** Total non-taxable / exempt compensation (items 29–37 → 38). */
  i38: number;
  /** Sum of the REGULAR taxable lines (items 39–44B). */
  reg: number;
  /** Sum of the SUPPLEMENTARY taxable lines (items 45–51B). */
  supp: number;
  /** Item 52 — Total Taxable Compensation Income (Sum of Items 39 to 51B). */
  i52: number;
  /** Item 19 — Gross Compensation Income, present (Sum of Items 38 and 52). */
  i19: number;
  /** Item 20 — Less: Total Non-Taxable/Exempt (From Item 38). */
  i20: number;
  /** Item 21 — Taxable Compensation Income, present (Item 19 Less 20 = Item 52). */
  i21: number;
  /** Item 22 — Add: Taxable Compensation from Previous Employer. */
  i22: number;
  /** Item 23 — Gross Taxable Compensation Income (Sum of Items 21 and 22). */
  i23: number;
  /** Item 24 — Tax Due (graduated on gross taxable comp). */
  i24: number;
  i25A: number;
  i25B: number;
  /** Item 26 — Total Amount of Taxes Withheld as adjusted (Sum of 25A and 25B). */
  i26: number;
  i27: number;
  /** Item 28 — Total Taxes Withheld (Sum of Items 26 and 27). */
  i28: number;
}

export function compute2316(d: FilingData): Comp2316 {
  const o = {} as Comp2316;
  // A. Non-taxable / exempt (items 29-37) -> Item 38.
  o.i38 = [29, 30, 31, 32, 33, 34, 35, 36, 37].reduce((s, n) => s + num(d["i" + n]), 0);

  // B. Taxable REGULAR (items 39-43) + Others (44A/44B).
  const reg =
    [39, 40, 41, 42, 43].reduce((s, n) => s + num(d["i" + n]), 0) +
    num(d.i44A) +
    num(d.i44B);
  // SUPPLEMENTARY (items 45-50) + Others (51A/51B).
  const supp =
    [45, 46, 47, 48, 49, 50].reduce((s, n) => s + num(d["i" + n]), 0) +
    num(d.i51A) +
    num(d.i51B);
  o.reg = reg;
  o.supp = supp;

  // Item 52 — Total Taxable Compensation Income (Sum of Items 39 to 51B).
  o.i52 = reg + supp;

  // Part IV-A summary.
  o.i19 = o.i38 + o.i52; // gross comp income, present
  o.i20 = o.i38; // less non-taxable (from item 38)
  o.i21 = o.i19 - o.i20; // taxable comp, present (= item 52)
  o.i22 = num(d.i22); // add previous employer
  o.i23 = o.i21 + o.i22; // gross taxable comp
  o.i24 = roundPeso(grad(o.i23, String(d.year || "").slice(0, 4))); // tax due
  o.i25A = num(d.i25A);
  o.i25B = num(d.i25B);
  o.i26 = o.i25A + o.i25B; // total amount of taxes withheld as adjusted
  o.i27 = num(d.i27); // PERA 5% credit
  o.i28 = o.i26 + o.i27; // total taxes withheld
  return o;
}
