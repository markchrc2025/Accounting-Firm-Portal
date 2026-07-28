// build2550Q.ts — authentic eBIRForms XML export for BIR Form 2550Q
// (Quarterly Value-Added Tax Return, April 2024 ENCS).
//
// The namespace is `frm2550qv2024:` (note lowercase q). MANY fields are GLOBAL
// (no namespace) — chiefly the Part V schedule grids (capital goods, withholding,
// miller) and the package/online tail fields. Field keys, the global set, and the
// "All Rights Reserved BIR 2012.0" tail match the offline-package output (verified
// against a real eBIRForms 2550Q export). build2550Q() is pure.
//
// Ported verbatim from the Sentire generator (lib/xml/build2550Q.ts); only the
// relative imports change for the flattened engine/ layout, and the browser-only
// `download` re-export is dropped.

import type { Filing, FilingRow, Taxpayer } from "./types";
import type { Comp2550Q } from "./compute2550Q";
import { amt, enc, rb, tinParts, type XmlRow } from "./xmlkit";
import { parsePeriod } from "./period";

const NS = "frm2550qv2024:";

/** Read the stored rows for a Part V schedule (empty array if none). */
function schedRows(d: { [k: string]: unknown }, key: string): FilingRow[] {
  const v = d[key];
  return Array.isArray(v) ? (v as FilingRow[]) : [];
}

/** A single cell value of a schedule row, as a raw string ("" if missing). */
function cell(rows: FilingRow[], i: number, c: number): string {
  const r = rows[i];
  const v = r ? r["c" + c] : undefined;
  return v == null ? "" : String(v);
}

/** Page-1/registered taxpayer name (raw, un-encoded). */
function fullName(tp: Taxpayer | null): string {
  if (!tp) return "";
  if (tp.kind === "individual")
    return [tp.lastName, [tp.firstName, tp.middleName].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  return tp.regName || "";
}

/** Quarter number (1-4) from a period string ("2026-Q1") or the quarter field ("1st"). */
function quarterNo(period: string, quarterField: unknown): number {
  const { quarter } = parsePeriod(period || "");
  if (quarter) return Number(quarter.replace(/\D/g, "")) || 1;
  const q = String(quarterField || "").replace(/\D/g, "");
  return q ? Number(q) : 1;
}

/** Calendar-quarter date range, eBIRForms style ("1/01/2026" .. "3/31/2026"). */
function quarterRange(qn: number, yyyy: string): { from: string; to: string } {
  // month is NOT zero-padded; day IS zero-padded; year is 4-digit.
  const ranges: Record<number, [string, string]> = {
    1: ["1/01", "3/31"],
    2: ["4/01", "6/30"],
    3: ["7/01", "9/30"],
    4: ["10/01", "12/31"],
  };
  const [from, to] = ranges[qn] ?? ["1/01", "3/31"];
  return { from: `${from}/${yyyy}`, to: `${to}/${yyyy}` };
}

/** Build the authentic 2550Q eBIRForms XML string. */
export function build2550Q(filing: Filing, tp: Taxpayer | null, comp: Comp2550Q): string {
  const d = filing.data || {};
  const t = tinParts(tp);
  const { year } = parsePeriod(filing.period || "");
  const yyyy = year || String(d.year || "").slice(0, 4);
  const qn = quarterNo(filing.period || "", d.quarter);
  const range = quarterRange(qn, yyyy);

  const rows: XmlRow[] = [];
  /** namespaced field, value emitted verbatim (pre-formatted). */
  const P = (key: string, val: string) => rows.push([NS + key, val]);
  /** global field (no namespace), verbatim. */
  const G = (key: string, val: string) => rows.push([key, val]);

  const classification = (d.classification as string) || (tp && tp.classification) || "";

  // ---- Period (items 1-6) ----
  const isFiscal = d.periodType === "fiscal";
  P("calendarNo1", rb(!isFiscal));
  P("fiscalNo1", rb(isFiscal));
  P("selectedMonthNo2", "12");
  P("txtYearNo2", yyyy);
  P("OptQuarter1", rb(qn === 1));
  P("OptQuarter2", rb(qn === 2));
  P("OptQuarter3", rb(qn === 3));
  P("OptQuarter4", rb(qn === 4));
  P("RtnPeriodFromNo4", range.from);
  P("RtnPeriodToNo4", range.to);
  P("amendedReturnYesNo5", rb(d.amended === "yes"));
  P("amendedReturnNo5", rb(d.amended !== "yes"));
  P("OptShortPrd1", rb(d.shortPeriod === "yes"));
  P("OptShortPrd2", rb(d.shortPeriod !== "yes"));

  // ---- Part I: Background (TIN / RDO / identity) ----
  P("txtTIN1", t.t1);
  P("txtTIN2", t.t2);
  P("txtTIN3", t.t3);
  P("branchCode", t.branch3);
  P("txtRDOCode", (tp && tp.rdo) || "");
  P("taxpayerName", enc(fullName(tp)));
  P("taxpayerAddress", enc(tp ? [tp.address, tp.city].filter(Boolean).join(", ") : ""));
  P("taxpayerZip", (tp && tp.zip) || "");
  P("taxpayerContactNumber", (tp && tp.phone) || "");
  P("taxpayerEmailAddress", (tp && tp.email) || "");

  // Classification (item 13): Micro / Small / Medium / Large.
  P("taxPayerClassification1", rb(classification === "Micro"));
  P("taxPayerClassification2", rb(classification === "Small"));
  P("taxPayerClassification3", rb(classification === "Medium"));
  P("taxPayerClassification4", rb(classification === "Large"));

  // Tax relief (item 14): Special Law vs International Tax Treaty.
  const relief = d.taxRelief === "yes";
  P("internationalTreatyYn", rb(relief && d.reliefKind === "treaty"));
  P("specialRateYn", rb(relief && d.reliefKind !== "treaty"));
  P("specifyInternationalTreaty", enc(d.taxReliefSpec));

  // ---- Part II: Total Tax Payable (items 15-26) ----
  // Item 15 net VAT payable lives at the bottom of Part IV (netVatPayable);
  // 16-19 credits, 20 total credits, 21 tax still payable, 22-24 penalties,
  // 25 total penalties, 26 total amount payable.
  P("excessInputTax", amt(0)); // item 16 sub-line: not separately modelled
  P("creditableVat", amt(comp.i16));
  P("advVatPayment", amt(comp.i17));
  P("vatPaidReturn", amt(comp.i18));
  P("addSpecifyNo19", enc(d.i19label));
  P("otherCreditsNo19", amt(comp.i19));
  P("totalTaxCredits", amt(comp.i20));
  P("excessCredits", amt(comp.i21));
  P("surcharge", amt(comp.i22));
  P("interest", amt(comp.i23));
  P("compromise", amt(comp.i24));
  P("penalties", amt(comp.i25));
  P("totalPayable", amt(comp.i26));

  // ---- Page 2 header ----
  P("txtPg2TIN1", t.t1);
  P("txtPg2TIN2", t.t2);
  P("txtPg2TIN3", t.t3);
  P("txtPg2BranchCode", t.branch3);
  P("Pg2TaxPayer", fullName(tp)); // RAW (un-encoded)

  // ---- Part IV: Details of VAT Computation ----
  // Output side (31-37).
  P("vatableSales", amt(comp.i31a));
  P("outputVatSales", amt(comp.i31b));
  P("zeroRatedSales", amt(comp.i32a));
  P("exemptSales", amt(comp.i33a));
  P("totalSales", amt(comp.i34a));
  P("outputTaxDue", amt(comp.i34b));
  P("lessOutputVat", amt(comp.i35b));
  P("addOutputVat", amt(comp.i36b));
  P("totalAdjOutput", amt(comp.i37));

  // Input tax carried over (38-43).
  P("inputTaxCarried", amt(comp.i38));
  P("inputTaxDeferred", amt(comp.i39));
  P("transitionalInputTax", amt(comp.i40));
  P("presumptiveInputTax", amt(comp.i41));
  P("addSpecifyNo42", enc(d.i42label));
  P("otherSpecify42", amt(comp.i42));
  P("total43", amt(comp.i43));

  // Current transactions (44-51).
  P("domesticPurchase", amt(comp.i44a));
  P("domesticInputTax", amt(comp.i44b));
  P("servicesPurchase", amt(comp.i45a));
  P("serviceInputTax", amt(comp.i45b));
  P("importPurchase", amt(comp.i46a));
  P("importInputTax", amt(comp.i46b));
  P("addSpecifyNo47", enc(d.i47label));
  P("otherSpecify47", amt(comp.i47a));
  G("otherSpecify47B", amt(comp.i47b)); // GLOBAL: the 47 B-column input tax
  P("domesticPurchaseNoTax", amt(comp.i48a));
  P("vatExemptImports", amt(comp.i49a));
  P("totalCurPurchase", amt(comp.i50a));
  P("totalCurInputTax", amt(comp.i50b));
  P("totalAvailInputTax", amt(comp.i51));

  // Deductions/adjustments (52-61).
  P("importCapitalInputTax", amt(comp.i52));
  P("inputTaxAttr", amt(comp.i53));
  P("vatRefund", amt(comp.i54));
  P("inputVatUnpaid", amt(comp.i55));
  P("addSpecifyNo56", enc(d.i56label));
  P("otherSpecify56", amt(comp.i56));
  P("totalDeductions", amt(comp.i57));
  P("addInputVat", amt(comp.i58));
  P("adjDeductions", amt(comp.i59));
  P("totalAllowInputTax", amt(comp.i60));
  P("netVatPayable", amt(comp.i61));

  // ---- Part V – Schedule 1: Amortized Input Tax on Capital Goods (GLOBAL) ----
  // Two display rows ("10" and "11") mirror the official grid. Cells map:
  //   c0 Date / c1 Source / c2 Description / c3 Amount>P1M (D) /
  //   c4 Balance prev (E) / c5 Est life (F) / c6 Recognized life (G) /
  //   c7 Allowable input tax (H) / c8 Balance to next period (I).
  const sch1 = schedRows(d, "sch1");
  ["10", "11"].forEach((n, i) => {
    G(`txtDatePurchase${n}`, cell(sch1, i, 0));
    G(`txtSourceCode${n}`, cell(sch1, i, 1));
    G(`txtDescription${n}`, enc(cell(sch1, i, 2)));
    G(`txtAmountPurchase${n}`, amt(cell(sch1, i, 3)));
    G(`txtInputTax${n}`, amt(cell(sch1, i, 4))); // Col E balance prev
    G(`txtEstimatedLife${n}`, amt(cell(sch1, i, 5)));
    G(`txtRecognizedLife${n}`, amt(cell(sch1, i, 6)));
    G(`txtAllowedInputTax${n}`, amt(cell(sch1, i, 7))); // Col H
    G(`txtBalanceInputTax${n}`, amt(cell(sch1, i, 8))); // Col I
  });
  G("sched1TotalBalPrev", amt(comp.sch1TotalE)); // Col E total -> Item 39B
  G("sched1TotalBalNext", amt(comp.sch1TotalI)); // Col I total -> Item 52B

  // ---- Part V – Schedule 2: Input Tax on VAT Exempt Sales (namespaced) ----
  // The form captures the directly-attributable input tax and the computed
  // ratable portion; the intermediate ratio fields (exempt sale / total sales /
  // amount of input tax not directly attributable) are not modelled -> 0.00.
  P("sched2InputTaxDirect", amt(comp.sch2Direct));
  P("sched2VatExemptSale", amt(0));
  P("sched2AmountInputTax", amt(0));
  P("sched2TotalSales", amt(0));
  P("sched2TotalRatable", amt(comp.sch2Ratable));
  P("sched2TotalAttr", amt(comp.sch2Total)); // -> Part IV, Item 53

  // ---- Part V – Schedule 3: Creditable VAT Withheld (GLOBAL) ----
  // Cells: c0 Period Covered (A) / c1 Withholding Agent (B) /
  //        c2 Income Payment (C) / c3 Total Tax Withheld (D).
  const sch3 = schedRows(d, "sch3");
  ["30", "31"].forEach((n, i) => {
    G(`txtDateCovered${n}`, cell(sch3, i, 0));
    G(`txtDateCovered3To${n.slice(-1)}`, "");
    G(`txtNameWithHoldingAgent${n}`, enc(cell(sch3, i, 1)));
    G(`txtIncomePayment${n}`, amt(cell(sch3, i, 2)));
    G(`txtTotalTaxWithHeld${n}`, amt(cell(sch3, i, 3)));
  });
  G("sched3TotalIncome", amt(comp.sch3TotalC));
  G("sched3TotalTax", amt(comp.sch3TotalD)); // Col D total -> Item 16

  // ---- Part V – Schedule 4: Advance VAT Payment / Miller (GLOBAL) ----
  // Cells: c0 Period Covered (A) / c1 Name of Miller (B) /
  //        c2 Name of Taxpayer (C) / c3 OR Number (D) / c4 Amount Paid (E).
  const sch4 = schedRows(d, "sch4");
  ["40", "41"].forEach((n, i) => {
    G(`txtDate${n}`, cell(sch4, i, 0));
    G(`txtDate4To${n.slice(-1)}`, "");
    G(`txtNameOfMiller${n}`, enc(cell(sch4, i, 1)));
    G(`txtNameOfTaxpayer${n}`, enc(cell(sch4, i, 2)));
    G(`txtOfficialReceiptNumber${n}`, cell(sch4, i, 3) ? enc(cell(sch4, i, 3)) : amt(0));
    G(`txtAmountPaid${n}`, amt(cell(sch4, i, 4)));
  });
  G("sched4AmountPaid", amt(comp.sch4Total)); // Col E total -> Item 17

  // ---- meta / package fields ----
  P("txtCurrentPage", "1");
  P("txtMaxPage", "2");

  // ---- global result / schedule-total mirrors ----
  G("resultOtherCreditsNo19", amt(comp.i19));
  G("resultOtherCreditsNo42", amt(comp.i42));
  G("resultOtherCreditsNo47", amt(comp.i47b));
  G("resultOtherCreditsNo56", amt(comp.i56));
  G("txtTotalAmountOfBalanceofInputTaxFromPrevious", amt(comp.sch1TotalE)); // Sched 1 Col E
  G("txtTotalAmountOfBalanceofInputTaxToBeCarried", amt(comp.sch1TotalI)); // Sched 1 Col I
  G("txtTotalAmountofIncomePayment", amt(comp.sch3TotalC)); // Sched 3 Col C
  G("txtTotalAmoungOfTaxWithHeld", amt(comp.sch3TotalD)); // Sched 3 Col D
  G("txtAmountPaidSched4", amt(comp.sch4Total)); // Sched 4 Col E

  // ---- global tail fields ----
  G("txtFinalFlag", filing.status === "filed" ? "1" : "0");
  G("txtEnroll", "Y");
  G("ebirOnlineConfirmUsername", "");
  G("ebirOnlineUsername", "");
  G("ebirOnlineSecret", "");
  G("txtEmail", "");
  G("driveSelectTPExport", "0");
  G("dateFiled", `${yyyy}/04/25`);

  // ---- assemble (2550Q style: first div on the header line; the rest each on
  // their own line with no lead; tail "All Rights Reserved BIR 2012.0") ----
  const divs = rows.map(([k, v]) => `<div>${k}=${v}${k}=</div>`);
  const first = divs[0] || "";
  const rest = divs.slice(1).join("\n");
  return (
    "<?xml version='1.0'?>        " +
    first +
    (rest ? "\n" + rest : "") +
    "\n        All Rights Reserved BIR 2012.0"
  );
}

/** Canonical eBIRForms filename for a 2550Q export: <tin><br>2550Qv2024<mm><yyyy>Q<n>.xml */
export function fileName2550Q(filing: Filing, tp: Taxpayer | null): string {
  const t = tinParts(tp);
  const d = filing.data || {};
  const { year } = parsePeriod(filing.period || "");
  const yyyy = year || String(d.year || "").slice(0, 4);
  const qn = quarterNo(filing.period || "", d.quarter);
  // mm is fixed at 12 (calendar year-end) to match the package filename.
  return `${t.t1}${t.t2}${t.t3}${t.branch3}2550Qv2024${"12"}${yyyy}Q${qn}.xml`;
}
