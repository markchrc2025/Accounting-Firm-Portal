// build1701.ts — authentic eBIRForms XML export for BIR Form 1701.
// (Annual ITR for individuals — mixed income / business / profession.)
//
// Field keys, namespace (frm1701), the CRLF/tab assembly and the tail match a
// real eBIRForms 1701 offline-package export. This is the largest individual
// form: 4 printed pages + an "Account Information" (txtPg1m…/txtPg2m…/txtPg3m…/
// txtPg4m…) section, ~837 <div> rows. build1701() is pure.
//
// 1701 specifics versus the simpler forms:
//   * Verbose key style: txtPg1I1Month, rdoPg1I2AmendedYes/No, txtPg1I4TIN1…,
//     rdoPg1I6TaxpayerTypeS/P/E/T/C, rdoPg1I7ATC_II012… etc.
//   * Page-1 taxpayer name (txtPg1I8TaxpayerName) is URL-encoded "LAST, FIRST
//     MIDDLE"; pages 2/3/4 (+ all Pg#m headers) carry the RAW last name only.
//   * Empty amount fields are "0.00" (NOT bare "0"); text/desc/date fields are
//     empty; txtPg1I33NumberOfAttachments is zero-padded to 2 ("00").
//   * email is a GLOBAL field (txtEmail), un-namespaced.
//   * tail year is "BIR 2012.0".
//
// Ported verbatim from the Sentire generator (lib/xml/build1701.ts); only the
// relative imports change for the flattened engine/ layout, and the browser-only
// `download` re-export is dropped.

import type { Filing, Taxpayer } from "./types";
import type { Comp1701 } from "./compute1701";
import { amt, dob, enc, parseYear, rb, tinParts, type XmlRow } from "./xmlkit";
import { num } from "./format";

const NS = "frm1701:";

/** Page-1 taxpayer name: "LAST, FIRST MIDDLE" (individuals) or registered name. */
function fullName(tp: Taxpayer | null): string {
  if (!tp) return "";
  if (tp.kind === "individual")
    return [tp.lastName, [tp.firstName, tp.middleName].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  return tp.regName || "";
}

/** Raw last name (individuals) / registered name — used on pages 2/3/4 + Pg#m. */
function rawName(tp: Taxpayer | null): string {
  if (!tp) return "";
  return (tp.kind === "individual" ? tp.lastName : tp.regName) || "";
}

/** Build the authentic 1701 eBIRForms XML string. */
export function build1701(filing: Filing, tp: Taxpayer | null, comp: Comp1701): string {
  const d = filing.data || {};
  const t = tinParts(tp);
  const yr = parseYear(d.year);
  // 1701's guided/form uses taxpayerType=comp_biz|biz|estate|trust and rateA/methodA.
  const taxType = (d.taxpayerType as string) || "";
  const rate = (d.rateA as string) || (d.rate as string) || "graduated";
  const method = (d.methodA as string) || (d.method as string) || "osd";
  const A = comp.A;
  const B = comp.B;

  const rows: XmlRow[] = [];
  /** namespaced field, value emitted verbatim (pre-formatted). */
  const P = (key: string, val: string) => rows.push([NS + key, val]);
  /** global field (no namespace), verbatim. */
  const G = (key: string, val: string) => rows.push([key, val]);
  /** zero-amount namespaced field ("0.00"). */
  const Z = (key: string) => P(key, amt(0));
  /** empty namespaced field. */
  const E = (key: string) => P(key, "");

  // ============================================================ PAGE 1
  // Background
  P("txtPg1I1Month", yr.mm);
  P("txtPg1I1Year", yr.yyyy);
  P("rdoPg1I2AmendedYes", rb(d.amended === "yes"));
  P("rdoPg1I2AmendedNo", rb(d.amended !== "yes"));
  P("rdoPg1I3ShortPeriodYes", rb(d.shortPeriod === "yes"));
  P("rdoPg1I3ShortPeriodNo", rb(d.shortPeriod !== "yes"));
  P("txtPg1I4TIN1", t.t1);
  P("txtPg1I4TIN2", t.t2);
  P("txtPg1I4TIN3", t.t3);
  P("txtPg1I4BranchCode", t.branch3);
  P("txtPg1I5RDOCode", (tp && tp.rdo) || "");

  // Taxpayer type — 5 options (Single/Professional/Estate/Trust/Corp). The 1701
  // app captures comp_biz/biz/estate/trust; map single→S, prof|biz→P, estate→E,
  // trust→T (C reserved for the corp/registered-name case).
  P("rdoPg1I6TaxpayerTypeS", rb(taxType === "single"));
  P("rdoPg1I6TaxpayerTypeP", rb(taxType === "prof" || taxType === "biz" || taxType === "comp_biz"));
  P("rdoPg1I6TaxpayerTypeE", rb(taxType === "estate"));
  P("rdoPg1I6TaxpayerTypeT", rb(taxType === "trust"));
  P("rdoPg1I6TaxpayerTypeC", rb(taxType === "comp")); // Compensation Earner

  // ATC — 7 radios in the authentic order II012/014/013/011/015/017/016.
  const atc = (d.atc as string) || "";
  P("rdoPg1I7ATC_II012", rb(atc === "II012"));
  P("rdoPg1I7ATC_II014", rb(atc === "II014"));
  P("rdoPg1I7ATC_II013", rb(atc === "II013"));
  P("rdoPg1I7ATC_II011", rb(atc === "II011"));
  P("rdoPg1I7ATC_II015", rb(atc === "II015"));
  P("rdoPg1I7ATC_II017", rb(atc === "II017"));
  P("rdoPg1I7ATC_II016", rb(atc === "II016"));

  // Name / address / contact
  P("txtPg1I8TaxpayerName", enc(fullName(tp)));
  P("txtPg1I9Address", enc(tp ? [tp.address, tp.city].filter(Boolean).join(" ") : ""));
  P("txtPg1I9AZipCode", (tp && tp.zip) || "");
  P("txtPg1I10BirthDate", dob(tp ? tp.birthdate : ""));
  G("txtEmail", (tp && tp.email) || ""); // email is a global (un-namespaced) field
  P("txtPg1I12Citizenship", (tp && tp.citizenship) || "");
  P("rdoPg1I13ForeignTaxCreditsYes", rb(d.foreignCredit === "yes"));
  P("rdoPg1I13ForeignTaxCreditsNo", rb(d.foreignCredit !== "yes"));
  P("txtPg1I14ForeignTaxNumber", enc(d.foreignTaxNo));
  P("txtPg1I15TelNum", (tp && tp.phone) || "");

  // Civil status (Single / Married / Legally separated / Widow-er)
  P("rdoPg1I16CivilStatusS", rb(d.civil === "single"));
  P("rdoPg1I16CivilStatusM", rb(d.civil === "married"));
  P("rdoPg1I16CivilStatusLS", rb(d.civil === "sep"));
  P("rdoPg1I16CivilStatusW", rb(d.civil === "widow"));
  P("rdoPg1I17SpouseIncomeYes", rb(d.spouseIncome === "yes"));
  P("rdoPg1I17SpouseIncomeNo", rb(d.spouseIncome !== "yes"));
  P("rdoPg1I18FilingStatusJ", rb(d.filing === "joint"));
  P("rdoPg1I18FilingStatusS", rb(d.filing !== "joint"));
  P("rdoPg1I19IncomeExemptYes", rb(d.incomeExempt === "yes"));
  P("rdoPg1I19IncomeExemptNo", rb(d.incomeExempt !== "yes"));
  P("rdoPg1I20IncomeSpecialYes", rb(d.incomeSpecial === "yes"));
  P("rdoPg1I20IncomeSpecialNo", rb(d.incomeSpecial !== "yes"));

  // Tax rate / method of deduction (item 21)
  P("rdoPg1I21TaxRateG", rb(rate !== "eight"));
  P("rdoPg1I21AMethodDeductionI", rb(rate !== "eight" && method === "itemized"));
  P("rdoPg1I21AMethodDeductionO", rb(rate !== "eight" && method !== "itemized"));
  P("rdoPg1I21TaxRateP", rb(rate === "eight"));

  // Part II — Total Tax Payable (items 22-32; A = filer, B = spouse)
  P("txtPg1I22ATaxDue", amt(A.taxDue));
  P("txtPg1I22BTaxDue", amt(B.taxDue));
  P("txtPg1I23A", amt(A.credits)); // less tax credits/payments
  P("txtPg1I23B", amt(B.credits));
  P("txtPg1I24ATaxPayable", amt(A.payable));
  P("txtPg1I24BTaxPayable", amt(B.payable));
  P("txtPg1I25A", amt(A.installment)); // less portion for 2nd installment
  P("txtPg1I25B", amt(B.installment));
  P("txtPg1I26A", amt(A.afterInstall)); // amount still payable
  P("txtPg1I26B", amt(B.afterInstall));
  Z("txtPg1I27A"); // add penalties: surcharge
  Z("txtPg1I27B");
  Z("txtPg1I28A"); // interest
  Z("txtPg1I28B");
  Z("txtPg1I29A"); // compromise
  Z("txtPg1I29B");
  P("txtPg1I30A", amt(A.penalties)); // total penalties
  P("txtPg1I30B", amt(B.penalties));
  P("txtPg1I31ATotalAmtPyble", amt(A.totalPayable));
  P("txtPg1I31BTotalAmtPyble", amt(B.totalPayable));
  P("txtPg1I32AggregateAmtPyble", amt(comp.aggregate));

  // Overpayment disposition (item 32 sub-options)
  P("rdoPg1OverpaymentRefund", rb(d.over === "refund"));
  P("rdoPg1OverpaymentTCC", rb(d.over === "tcc"));
  P("rdoPg1OverpaymentCarryOver", rb(d.over === "carry"));
  P("txtPg1I33NumberOfAttachments", String(d.attachments || "0").replace(/\D/g, "").padStart(2, "0").slice(-2));

  // Part III — Details of Payment (items 34-37; user-entry, not captured)
  E("txtPg1I34Agency");
  E("txtPg1I34Number");
  E("txtPg1I34Date");
  E("txtPg1I34Amount");
  E("txtPg1I35Agency");
  E("txtPg1I235Number"); // (authentic key carries the stray "2")
  E("txtPg1I35Date");
  E("txtPg1I35Amount");
  E("txtPg1I36Number");
  E("txtPg1I36Date");
  E("txtPg1I36Amount");
  E("txtPg1I37Particular");
  E("txtPg1I37Agency");
  E("txtPg1I37Number");
  E("txtPg1I37Date");
  E("txtPg1I37Amount");

  // ============================================================ PAGE 2
  P("txtPg2TIN1", t.t1);
  P("txtPg2TIN2", t.t2);
  P("txtPg2TIN3", t.t3);
  P("txtPg2BranchCode", t.branch3);
  P("txtPg2TaxpayerName", rawName(tp)); // RAW last name on pages 2-4

  // Spouse background (item 1-12)
  const stin = String(d.spouseTin || "").replace(/\D/g, "");
  P("txtPg2I1TIN1", stin.slice(0, 3));
  P("txtPg2I1TIN2", stin.slice(3, 6));
  P("txtPg2I1TIN3", stin.slice(6, 9));
  E("txtPg2I1BranchCode");
  P("txtPg2I2SpouseRDOCode", (d.spouseRdo as string) || "000");
  P("rdoPg2I3SpouseTypeS", rb(d.spouseType === "single"));
  P("rdoPg2I3SpouseTypeP", rb(d.spouseType === "prof" || d.spouseType === "biz"));
  P("rdoPg2I3SpouseTypeC", rb(d.spouseType === "comp")); // Compensation Earner
  const satc = (d.spouseAtc as string) || "";
  P("rdoPg2I4ATC_II012", rb(satc === "II012"));
  P("rdoPg2I4ATC_II014", rb(satc === "II014"));
  P("rdoPg2I4ATC_II013", rb(satc === "II013"));
  P("rdoPg2I4ATC_II011", rb(satc === "II011"));
  P("rdoPg2I4ATC_II015", rb(satc === "II015"));
  P("rdoPg2I4ATC_II017", rb(satc === "II017"));
  P("rdoPg2I4ATC_II016", rb(satc === "II016"));
  P("txtPg2I5SpouseName", enc(d.spouseName));
  P("txtPg2I6TelNum", enc(d.spouseContact));
  P("txtPg2I7Citizenship", enc(d.spouseCitizenship));
  P("rdoPg2I8ForeignTaxCreditsYes", rb(d.spouseForeignCredit === "yes"));
  P("rdoPg2I8ForeignTaxCreditsNo", rb(d.spouseForeignCredit === "no"));
  P("txtPg2I9ForeignTaxNumber", enc(d.spouseForeignTaxNo));
  P("rdoPg2I10IncomeExemptYes", rb(d.spouseIncomeExempt === "yes"));
  P("rdoPg2I10IncomeExemptNo", rb(d.spouseIncomeExempt === "no"));
  P("rdoPg2I11IncomeSpecialYes", rb(d.spouseIncomeSpecial === "yes"));
  P("rdoPg2I11IncomeSpecialNo", rb(d.spouseIncomeSpecial === "no"));
  const srate = (d.spouseRate as string) || "";
  const smethod = (d.spouseMethod as string) || "osd";
  P("rdoPg2I12TaxRateG", rb(srate === "graduated"));
  P("rdoPg2I12AMethodDeductionI", rb(srate !== "eight" && srate !== "" && smethod === "itemized"));
  P("rdoPg2I12AMethodDeductionO", rb(srate !== "eight" && srate !== "" && smethod !== "itemized"));
  P("rdoPg2I12TaxRateP", rb(srate === "eight"));

  // Schedule 1a — claimed dependents / qualified dependent (checkbox + name + TIN)
  P("chkPg2IShed1a_1Taxpayer", rb(false));
  E("txtPg2IShed1a_1TPName");
  P("chkPg2IShed1a_1Spouse", rb(false));
  E("txtPg2IShed1a_1SName");
  E("txtPg2IShed1a_TIN1");
  E("txtPg2IShed1a_TIN2");
  E("txtPg2IShed1a_TIN3");
  E("txtPg2IShed1a_BranchCode");
  P("chkPg2IShed2a_2Taxpayer", rb(false));
  E("txtPg2IShed2a_2TPName");
  P("chkPg2IShed2a_2Spouse", rb(false));
  E("txtPg2IShed2a_2SName");
  E("txtPg2IShed2a_TIN1");
  E("txtPg2IShed2a_TIN2");
  E("txtPg2IShed2a_TIN3");
  E("txtPg2IShed2a_BranchCode");

  // Schedule 1c — gross compensation income & tax withheld (col CI / TW; rows 1-3a/3b)
  // 1 = filer compensation; 3A = aggregate gross income (sales). TW columns not captured.
  P("txtPg2IShed1c_1CI", amt(A.comp));
  Z("txtPg2IShed1c_1TW");
  Z("txtPg2IShed1c_2CI");
  Z("txtPg2IShed1c_2TW");
  P("txtPg2IShed1c_3ACI", amt(A.netSales + A.otherInc));
  Z("txtPg2IShed1c_3ATW");
  Z("txtPg2IShed1c_3BCI");
  Z("txtPg2IShed1c_3BTW");

  // Schedule 2 — taxable income (A = filer, B = spouse).
  // 4 = sales/gross income, 5 = less deductions, 6 = net/taxable, 7 = special.
  P("txtPg2IShed2_4A", amt(A.netSales + A.otherInc));
  P("txtPg2IShed2_4B", amt(B.netSales + B.otherInc));
  P("txtPg2IShed2_5A", amt(A.netBizTotal));
  P("txtPg2IShed2_5B", amt(B.netBizTotal));
  P("txtPg2IShed2_6A", amt(A.taxableTotal));
  P("txtPg2IShed2_6B", amt(B.taxableTotal));
  Z("txtPg2IShed2_7A");
  Z("txtPg2IShed2_7B");

  // Schedule 3 (page 2 portion) — itemized deductions, rows 8-25 (cols A/B; 19/20 have Desc)
  for (let i = 8; i <= 25; i++) {
    if (i === 19 || i === 20) E(`txtPg2IShed3_${i}Desc`);
    Z(`txtPg2IShed3_${i}A`);
    Z(`txtPg2IShed3_${i}B`);
  }

  // ============================================================ PAGE 3
  P("txtPg3TIN1", t.t1);
  P("txtPg3TIN2", t.t2);
  P("txtPg3TIN3", t.t3);
  P("txtPg3BranchCode", t.branch3);
  P("txtPg3TaxpayerName", rawName(tp));

  // Schedule 3 (continued) — rows 26-32 (27 has Desc)
  for (let i = 26; i <= 32; i++) {
    if (i === 27) E(`txtPg3IShed3_${i}Desc`);
    Z(`txtPg3IShed3_${i}A`);
    Z(`txtPg3IShed3_${i}B`);
  }

  // Schedule 4 — tax credits/payments, rows 1-16 + 17a-17d (17d has Desc) + 18
  for (let i = 1; i <= 16; i++) {
    Z(`txtPg3IShed4_${i}A`);
    Z(`txtPg3IShed4_${i}B`);
  }
  for (const r of ["a", "b", "c"]) {
    Z(`txtPg3IShed4_17${r}A`);
    Z(`txtPg3IShed4_17${r}B`);
  }
  E("txtPg3IShed4_17dDesc");
  Z("txtPg3IShed4_17dA");
  Z("txtPg3IShed4_17dB");
  Z("txtPg3IShed4_18A");
  Z("txtPg3IShed4_18B");

  // Schedule 5 — tax relief availment (rows 1/2/4/5 = Desc+Legal+Amt; 3/6 = subtotals)
  for (const i of [1, 2]) {
    E(`txtPg3IShed5_${i}Desc`);
    E(`txtPg3IShed5_${i}Legal`);
    Z(`txtPg3IShed5_${i}Amt`);
  }
  Z("txtPg3IShed5_3");
  for (const i of [4, 5]) {
    E(`txtPg3IShed5_${i}Desc`);
    E(`txtPg3IShed5_${i}Legal`);
    Z(`txtPg3IShed5_${i}Amt`);
  }
  Z("txtPg3IShed5_6");

  // Schedule 6 — reconciliation, rows 1-3 (A/B) + rows 4-7 (Year + A..E) + 8D total
  for (let i = 1; i <= 3; i++) {
    Z(`txtPg3IShed6_${i}A`);
    Z(`txtPg3IShed6_${i}B`);
  }
  for (let i = 4; i <= 7; i++) {
    E(`txtPg3IShed6_${i}Year`);
    for (const c of ["A", "B", "C", "D", "E"]) Z(`txtPg3IShed6_${i}${c}`);
  }
  Z("txtPg3IShed6_8D");

  // ============================================================ PAGE 4
  P("txtPg4TIN1", t.t1);
  P("txtPg4TIN2", t.t2);
  P("txtPg4TIN3", t.t3);
  P("txtPg4BranchCode", t.branch3);
  P("txtPg4TaxpayerName", rawName(tp));

  // Schedule 6 (continued) — rows 9-12 (Year + A..E) + 13D total
  for (let i = 9; i <= 12; i++) {
    E(`txtPg4IShed6_${i}Year`);
    for (const c of ["A", "B", "C", "D", "E"]) Z(`txtPg4IShed6_${i}${c}`);
  }
  Z("txtPg4IShed6_13D");

  // Sched6 sub-table (Sc6_1..5, A/B)
  for (let i = 1; i <= 5; i++) {
    Z(`txtPg4ISc6_${i}A`);
    Z(`txtPg4ISc6_${i}B`);
  }

  // Part VII — supplemental income, rows 1-8 (A/B), 9 (Specify+A/B), 10 (A/B)
  for (let i = 1; i <= 8; i++) {
    Z(`txtPg4IPart7_${i}A`);
    Z(`txtPg4IPart7_${i}B`);
  }
  E("txtPg4IPart7_9Specify");
  Z("txtPg4IPart7_9A");
  Z("txtPg4IPart7_9B");
  Z("txtPg4IPart7_10A");
  Z("txtPg4IPart7_10B");

  // Part VIII — balance sheet, rows 1-10 (A/B)
  for (let i = 1; i <= 10; i++) {
    Z(`txtPg4IPart8_${i}A`);
    Z(`txtPg4IPart8_${i}B`);
  }

  // Part IX — reconciliation of net income per books against taxable income:
  // row 1 (A/B), specify rows 2-4 (Particulars + A/B), 5 total (derived),
  // specify rows 6-9, totals 10/11 (derived). Same key order as the authentic
  // sample — only the values are now wired from the filing.
  P("txtPg4IPart9_1A", amt(num(d.ix1A)));
  P("txtPg4IPart9_1B", amt(num(d.ix1B)));
  for (let i = 2; i <= 4; i++) {
    P(`txtPg4IPart9_${i}Particulars`, enc(String(d[`ix${i}descA`] || "")));
    P(`txtPg4IPart9_${i}A`, amt(num(d[`ix${i}A`])));
    P(`txtPg4IPart9_${i}B`, amt(num(d[`ix${i}B`])));
  }
  P("txtPg4IPart9_5A", amt(A.ixTotalAdd));
  P("txtPg4IPart9_5B", amt(comp.B.ixTotalAdd));
  for (let i = 6; i <= 9; i++) {
    P(`txtPg4IPart9_${i}Particulars`, enc(String(d[`ix${i}descA`] || "")));
    P(`txtPg4IPart9_${i}A`, amt(num(d[`ix${i}A`])));
    P(`txtPg4IPart9_${i}B`, amt(num(d[`ix${i}B`])));
  }
  P("txtPg4IPart9_10A", amt(A.ixTotalLess));
  P("txtPg4IPart9_10B", amt(comp.B.ixTotalLess));
  P("txtPg4IPart9_11A", amt(A.ixNetTaxable));
  P("txtPg4IPart9_11B", amt(comp.B.ixNetTaxable));

  // ================================================ ACCOUNT INFO (Pg1m: Schedule A & B)
  P("txtPg1mTIN1", t.t1);
  P("txtPg1mTIN2", t.t2);
  P("txtPg1mTIN3", t.t3);
  P("txtPg1mBranchCode", t.branch3);
  P("txtPg1mTaxpayerName", rawName(tp));
  P("rdoPg1mOption1", rb(true));
  P("rdoPg1mOption2", rb(false));

  // Schedule A (txtPg1mI#XSchdA) — rows 1-3 + 5-6 carry cols A-F (text/empty);
  // row 4 carries only B & E (amount "0.00").
  for (const i of [1, 2, 3]) for (const c of ["A", "B", "C", "D", "E", "F"]) E(`txtPg1mI${i}${c}SchdA`);
  Z("txtPg1mI4BSchdA");
  Z("txtPg1mI4ESchdA");
  for (const i of [5, 6]) for (const c of ["A", "B", "C", "D", "E", "F"]) E(`txtPg1mI${i}${c}SchdA`);

  // Schedule B (txtPg1mI#XSchdB) — rows 1-7 cols A-H amounts; row 8 only C/D/G/H;
  // rows 9 cols A-H; row 10 only C/D/G/H; row 11 cols A-H; rows 12/13 Desc+A-H;
  // row 14 only C/D/G/H; rows 15-17 cols A-H.
  const schBfull = (i: number) => { for (const c of ["A", "B", "C", "D", "E", "F", "G", "H"]) Z(`txtPg1mI${i}${c}SchdB`); };
  const schBcdgh = (i: number) => { for (const c of ["C", "D", "G", "H"]) Z(`txtPg1mI${i}${c}SchdB`); };
  schBfull(1); schBfull(2); schBfull(3); schBfull(4); schBfull(5); schBfull(6); schBfull(7);
  schBcdgh(8);
  schBfull(9);
  schBcdgh(10);
  schBfull(11);
  E("txtPg1mI12DescSchdB"); schBfull(12);
  E("txtPg1mI13DescSchdB"); schBfull(13);
  schBcdgh(14);
  schBfull(15); schBfull(16); schBfull(17);

  // ---- Pg2m: Schedule C (cost of sales detail) + Schedule D ----
  P("txtPg2mTIN1", t.t1);
  P("txtPg2mTIN2", t.t2);
  P("txtPg2mTIN3", t.t3);
  P("txtPg2mBranchCode", t.branch3);
  P("txtPg2mTaxpayerName", rawName(tp));
  // Schedule C rows 1-16 (cols A-D), 17a-17d (17d has Desc), 18.
  for (let i = 1; i <= 16; i++) for (const c of ["A", "B", "C", "D"]) Z(`txtPg2mI${i}${c}SchdC`);
  for (const r of ["a", "b", "c"]) for (const c of ["A", "B", "C", "D"]) Z(`txtPg2mI17${r}${c}SchdC`);
  E("txtPg2mI17dDescSchdC");
  for (const c of ["A", "B", "C", "D"]) Z(`txtPg2mI17d${c}SchdC`);
  for (const c of ["A", "B", "C", "D"]) Z(`txtPg2mI18${c}SchdC`);
  // Schedule D rows 1-4 (Desc+LB+A+B), row 5 (A/B only)
  for (let i = 1; i <= 4; i++) {
    E(`txtPg2mI${i}DescSchdD`);
    E(`txtPg2mI${i}LBSchdD`);
    Z(`txtPg2mI${i}ASchdD`);
    Z(`txtPg2mI${i}BSchdD`);
  }
  Z("txtPg2mI5ASchdD");
  Z("txtPg2mI5BSchdD");

  // Attachment counters (globals embedded here in the authentic stream)
  G("attachmentCurrent", "1");
  G("attachmentTotal", "0");

  // ---- Pg3m: Schedule A (exempt/special) + Schedule B + Schedule C (TYPE suffix) ----
  P("txtPg3mTIN1", t.t1);
  P("txtPg3mTIN2", t.t2);
  P("txtPg3mTIN3", t.t3);
  P("txtPg3mBranchCode", t.branch3);
  P("txtPg3mTaxpayerName", rawName(tp));
  P("rdoPg3mExemptTYPE", rb(false));
  P("rdoPg3mSpecialRateTYPE", rb(false));
  // Sched A: rows 1-3 + 5-6 cols A/B text; row 4 cols A/B amount.
  for (const i of [1, 2, 3]) { E(`txtPg3mSchedA_${i}ATYPE`); E(`txtPg3mSchedA_${i}BTYPE`); }
  Z("txtPg3mSchedA_4ATYPE"); Z("txtPg3mSchedA_4BTYPE");
  for (const i of [5, 6]) { E(`txtPg3mSchedA_${i}ATYPE`); E(`txtPg3mSchedA_${i}BTYPE`); }
  // Sched B: rows 1-9 (A/B amount), 10/11 (Desc + A/B), 12-13 (A/B), 14 (A/B, sample shows 0.0), 15 (A/B)
  for (let i = 1; i <= 9; i++) { Z(`txtPg3mSchedB_${i}ATYPE`); Z(`txtPg3mSchedB_${i}BTYPE`); }
  E("txtPg3mSchedB_10TYPE"); Z("txtPg3mSchedB_10ATYPE"); Z("txtPg3mSchedB_10BTYPE");
  E("txtPg3mSchedB_11TYPE"); Z("txtPg3mSchedB_11ATYPE"); Z("txtPg3mSchedB_11BTYPE");
  Z("txtPg3mSchedB_12ATYPE"); Z("txtPg3mSchedB_12BTYPE");
  Z("txtPg3mSchedB_13ATYPE"); Z("txtPg3mSchedB_13BTYPE");
  P("txtPg3mSchedB_14ATYPE", "0.0"); P("txtPg3mSchedB_14BTYPE", "0.0"); // authentic sample shows single-decimal
  Z("txtPg3mSchedB_15ATYPE"); Z("txtPg3mSchedB_15BTYPE");
  // Sched C rows 1-3 (A/B) on page 3
  for (let i = 1; i <= 3; i++) { Z(`txtPg3mSchedC_${i}ATYPE`); Z(`txtPg3mSchedC_${i}BTYPE`); }

  // ---- Pg4m: Schedule C (continued) + Schedule D1 + Schedule D2 ----
  P("txtPg4mTIN1", t.t1);
  P("txtPg4mTIN2", t.t2);
  P("txtPg4mTIN3", t.t3);
  P("txtPg4mBranchCode", t.branch3);
  P("txtPg4mTaxpayerName", rawName(tp));
  // Sched C rows 4-16 (A/B), 17a-17c (A/B), 17d (Desc+A/B), 18 (A/B)
  for (let i = 4; i <= 16; i++) { Z(`txtPg4mSchedC_${i}ATYPE`); Z(`txtPg4mSchedC_${i}BTYPE`); }
  for (const r of ["a", "b", "c"]) { Z(`txtPg4mSchedC_17${r}ATYPE`); Z(`txtPg4mSchedC_17${r}BTYPE`); }
  E("txtPg4mSchedC_17dTYPE"); Z("txtPg4mSchedC_17dATYPE"); Z("txtPg4mSchedC_17dBTYPE");
  Z("txtPg4mSchedC_18ATYPE"); Z("txtPg4mSchedC_18BTYPE");
  // Sched D1 rows 1-4 (Desc + ALB + A amount), row 5 (A only)
  for (let i = 1; i <= 4; i++) {
    E(`txtPg4mSchedD1_${i}TYPE`);
    E(`txtPg4mSchedD1_${i}ALBTYPE`);
    Z(`txtPg4mSchedD1_${i}ATYPE`);
  }
  Z("txtPg4mSchedD1_5ATYPE");
  // Sched D2 rows 6-9 (Desc + (B)LB + B amount), row 10 (B only)
  E("txtPg4mSchedD2_6TYPE"); E("txtPg4mSchedD2_6BLBTYPE"); Z("txtPg4mSchedD2_6BTYPE");
  E("txtPg4mSchedD2_7TYPE"); E("txtPg4mSchedD2_7BLBTYPE"); Z("txtPg4mSchedD2_7BTYPE");
  E("txtPg4mSchedD2_8TYPE"); E("txtPg4mSchedD2_8LBBTYPE"); Z("txtPg4mSchedD2_8BTYPE");
  E("txtPg4mSchedD2_9TYPE"); E("txtPg4mSchedD2_9BLBTYPE"); Z("txtPg4mSchedD2_9BTYPE");
  Z("txtPg4mSchedD2_10BTYPE");

  // ---- meta / package control fields ----
  P("txtCurrentPage", "1");
  P("txtMaxPage", "4");
  E("txtZIP");
  E("txtEnabledInputsOnValidation");
  E("txtDisabledInputs");
  E("txtEnabledLinks");
  E("txtIsSpouseDisabled");
  P("txtIsTaxFilerDisabled", "FALSE");
  E("txtAttachmentTypes");
  E("txtTIN4");
  E("txtDisabledOnSave");
  E("txtEnabledOnSave");
  P("txtVersion", "051414");
  E("txtdisabledID");
  P("rdoEXAttachmentTF", rb(false));
  P("rdoEXAttachmentS", rb(false));
  P("rdoSPAttachmentTF", rb(false));
  P("rdoSPAttachmentS", rb(false));

  // ---- global tail fields ----
  G("txtFinalFlag", filing.status === "filed" ? "1" : "0");
  G("txtEnroll", "N");
  G("ebirOnlineConfirmUsername", "");
  G("ebirOnlineUsername", "");
  G("ebirOnlineSecret", "");
  P("txtLineBus", enc(d.lineBus));
  G("driveSelectTPExport", "0");

  // ---- assemble (CRLF-free: 12-space lead, trailing TAB per div, BIR 2012.0 tail) ----
  const lead = "            ";
  const trail = "\t";
  const sep = "\n";
  const head = "<?xml version='1.0'?>\t\n";
  const body = rows.map(([k, v]) => `${lead}<div>${k}=${v}${k}=</div>${trail}`).join(sep);
  const tail = `${lead}\t\n${lead}All Rights Reserved BIR 2012.0`;
  return `${head}${body}${sep}${tail}`;
}

/** eBIRForms filename: <tin><branch>1701v2018<mm><yyyy>.xml (annual, mm=12). */
export function fileName1701(filing: Filing, tp: Taxpayer | null): string {
  const t = tinParts(tp);
  const yr = parseYear((filing.data || {}).year);
  return `${t.t1}${t.t2}${t.t3}${t.branch3}1701v2018${yr.mm}${yr.yyyy}.xml`;
}

