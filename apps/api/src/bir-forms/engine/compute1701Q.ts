// compute1701Q.ts — 1701Q (Quarterly ITR, individuals/estates/trusts).
// Aligned with the official Jan-2018 (ENCS) form: Part V Schedule I (graduated,
// items 36-46), Schedule II (8%, items 47-54), Schedule III tax credits/payments
// (items 55-62), Part III total tax payable (items 26-31), Schedule IV penalties
// (items 64-67). Computed values are always derived, never stored.
//
// Ported verbatim from the Sentire generator (lib/compute/compute1701Q.ts);
// only the relative imports change for the flattened engine/ layout.

import type { FilingData } from "./types";
import { num, roundPeso } from "./format";
import { graduatedTax as grad } from "./taxTables";

export interface Side1701Q {
  // ── Schedule I (graduated) items 36-46 ──
  /** Item 36 — sales/receipts net of returns, allowances and discounts. */
  sales: number;
  /** Item 37 — less: cost of sales/services (itemized only). */
  cogs: number;
  /** Item 38 — gross income from operation (36 less 37). */
  gross: number;
  /** 'itemized' | 'osd' */
  method: string;
  /** Item 39/40 — total allowable deductions (itemized entry OR 40% OSD). */
  deductions: number;
  /** Item 41 — net income this quarter (38 less deductions). */
  netIncome: number;
  /** Item 42 — taxable income from previous quarter(s). */
  prevTaxable: number;
  /** Item 43 — non-operating income (specify). */
  nonOpInc: number;
  /** Item 44 — share in income from a GPP. */
  gppShare: number;
  /** Item 45 — total taxable income to date (sum of 41-44). */
  taxableCum: number;
  /** Item 46 — tax due (graduated). */
  gradTax: number;

  // ── Schedule II (8%) items 47-54 ──
  /** Item 47 — sales/receipts net of returns, allowances and discounts. */
  sales8: number;
  /** Item 48 — non-operating income (specify). */
  nonOpInc8: number;
  /** Item 49 — total income for the quarter (47 + 48). */
  income8: number;
  /** Item 50 — total taxable income from previous quarter(s). */
  prev8: number;
  /** Item 51 — cumulative taxable income as of this quarter (49 + 50). */
  cum8: number;
  /** Item 52 — allowable reduction (₱250,000 — filer only). */
  reduce8: number;
  /** Item 53 — taxable income to date (51 less 52). */
  taxable8: number;
  /** Item 54 — tax due (8%). */
  tax8: number;

  /** 'graduated' | 'eight' */
  rate: string;
  /** Item 26 — tax due (Item 46 OR Item 54). */
  taxDue: number;

  // ── Schedule III tax credits/payments items 55-61 → 62 ──
  /** Item 55 — prior year's excess credits. */
  excess: number;
  /** Item 56 — tax payment(s) for the previous quarter(s). */
  prevPaid: number;
  /** Item 57 — creditable tax withheld for the previous quarter(s). */
  cwtPrev: number;
  /** Item 58 — creditable tax withheld per BIR Form 2307 for this quarter. */
  cwt: number;
  /** Item 59 — tax paid in return previously filed (amended return). */
  taxPaidPrev: number;
  /** Item 60 — foreign tax credits, if applicable. */
  foreignCredits: number;
  /** Item 61 — other tax credits/payments (specify). */
  otherCredits: number;
  /** Item 62 — total tax credits/payments (sum of 55-61). */
  credits: number;

  /** Item 28/63 — tax payable/(overpayment) (26 less 62). */
  payable: number;

  // ── Schedule IV penalties items 64-67 ──
  /** Item 64 — surcharge. */
  surcharge: number;
  /** Item 65 — interest. */
  interest: number;
  /** Item 66 — compromise. */
  compromise: number;
  /** Item 67 — total penalties (sum of 64-66). */
  penalties: number;

  /** Item 30/68 — total amount payable/(overpayment) (28 + 29). */
  totalPayable: number;
}

export interface Comp1701Q {
  A: Side1701Q;
  B: Side1701Q;
  /** Item 31 — aggregate amount payable/(overpayment) (30A + 30B). */
  aggregate: number;
}

export function compute1701Q(d: FilingData): Comp1701Q {
  const year = String(d.year || "").slice(0, 4);
  const out = { A: {}, B: {} } as Comp1701Q;
  (["A", "B"] as const).forEach((s) => {
    const o = {} as Side1701Q;

    // ── Schedule I — graduated (items 36-46) ──
    // Item 36 is defined "net of sales returns, allowances and discounts", so the
    // single sales field already holds the net figure; OSD is 40% of it.
    o.sales = num(d["sales" + s]);
    o.cogs = num(d["cogs" + s]);
    o.gross = o.sales - o.cogs; // Item 38
    o.method = (d["method" + s] as string) || "osd";
    o.deductions = o.method === "osd" ? roundPeso(o.sales * 0.4) : num(d["deduct" + s]); // 39 / 40
    o.netIncome = o.gross - o.deductions; // Item 41
    o.prevTaxable = num(d["prevTaxable" + s]); // Item 42
    o.nonOpInc = num(d["nonOp" + s]); // Item 43
    o.gppShare = num(d["gpp" + s]); // Item 44
    o.taxableCum = o.netIncome + o.prevTaxable + o.nonOpInc + o.gppShare; // Item 45 (sum 41-44)
    o.gradTax = roundPeso(grad(o.taxableCum, year)); // Item 46

    // ── Schedule II — 8% (items 47-54) ──
    o.sales8 = o.sales; // Item 47 — same net sales/receipts
    o.nonOpInc8 = o.nonOpInc; // Item 48 — non-operating income
    o.income8 = o.sales8 + o.nonOpInc8; // Item 49
    o.prev8 = num(d["prev8" + s]); // Item 50
    o.cum8 = o.income8 + o.prev8; // Item 51
    o.reduce8 = s === "A" ? 250000 : 0; // Item 52 — ₱250k, filer only
    o.taxable8 = Math.max(0, o.cum8 - o.reduce8); // Item 53
    o.tax8 = roundPeso(o.taxable8 * 0.08); // Item 54

    o.rate = (d["rate" + s] as string) || "graduated";
    o.taxDue = o.rate === "eight" ? o.tax8 : o.gradTax; // Item 26

    // ── Schedule III — tax credits/payments (items 55-62) ──
    o.excess = num(d["excess" + s]); // Item 55
    o.prevPaid = num(d["prevPaid" + s]); // Item 56
    o.cwtPrev = num(d["cwtPrev" + s]); // Item 57
    o.cwt = num(d["cwt" + s]); // Item 58
    o.taxPaidPrev = num(d["taxPaidPrev" + s]); // Item 59
    o.foreignCredits = num(d["foreignCredits" + s]); // Item 60
    o.otherCredits = num(d["otherCredits" + s]); // Item 61
    o.credits =
      o.excess + o.prevPaid + o.cwtPrev + o.cwt + o.taxPaidPrev + o.foreignCredits + o.otherCredits; // Item 62

    o.payable = o.taxDue - o.credits; // Item 28 / 63

    // ── Schedule IV — penalties (items 64-67) ──
    o.surcharge = num(d["surcharge" + s]); // Item 64
    o.interest = num(d["interest" + s]); // Item 65
    o.compromise = num(d["compromise" + s]); // Item 66
    // The faithful form splits penalties into surcharge / interest / compromise;
    // the guided wizard uses a single "pen" bucket. Sum the split lines when
    // present, else fall back to the single field.
    const split = o.surcharge + o.interest + o.compromise;
    o.penalties = split > 0 ? split : num(d["pen" + s]); // Item 67 / 29

    o.totalPayable = o.payable + o.penalties; // Item 30 / 68
    out[s] = o;
  });
  out.aggregate = out.A.totalPayable + out.B.totalPayable; // Item 31
  return out;
}
