// build1701Q.ts — authentic eBIRForms XML export for BIR Form 1701Q.
// Field keys, namespace (frm1701q — note lowercase q), the global (un-namespaced)
// fields, and the "All Rights Reserved BIR 2012.0" tail match the offline-package
// output (verified against a real eBIRForms 1701Q export). build1701Q() is pure.
//
// Ported from the Sentire generator (lib/xml/build1701Q.ts); the relative imports
// change for the flattened engine/ layout, and two array/record index reads gain
// `?? ""` guards for the API's stricter noUncheckedIndexedAccess (behaviour is
// unchanged — the fallbacks match the original empty-string outputs).

import type { Filing, Taxpayer } from "./types";
import type { Comp1701Q } from "./compute1701Q";
import { amt, enc, rb, tinParts, type XmlRow } from "./xmlkit";
import { parsePeriod } from "./period";

const NS = "frm1701q:";

/** Page-1 taxpayer name: "LAST, FIRST, MIDDLE" (individuals) or registered name. */
function fullName(tp: Taxpayer | null): string {
  if (!tp) return "";
  if (tp.kind === "individual") return [tp.lastName, tp.firstName, tp.middleName].filter(Boolean).join(", ");
  return tp.regName || "";
}

/** Split an ISO birthdate (yyyy-mm-dd) into { mm, dd, yyyy } parts. */
function birthParts(iso?: string): { mm: string; dd: string; yyyy: string } {
  const p = String(iso || "").split("-");
  if (p.length === 3) return { yyyy: p[0] ?? "", mm: p[1] ?? "", dd: p[2] ?? "" };
  return { mm: "", dd: "", yyyy: "" };
}

/** Build the authentic 1701Q eBIRForms XML string. */
export function build1701Q(filing: Filing, tp: Taxpayer | null, comp: Comp1701Q): string {
  const d = filing.data || {};
  const t = tinParts(tp);
  const { year, quarter } = parsePeriod(filing.period || String(d.year || ""));
  const yyyy = year || String(d.year || "").slice(0, 4);
  // quarter is like "Q2"; the form has Q1/Q2/Q3 only (no Q4).
  const qn = (quarter || "").replace(/\D/g, "") || "1";
  const A = comp.A;
  const B = comp.B;
  const b = birthParts(tp ? tp.birthdate : "");

  const rows: XmlRow[] = [];
  /** namespaced field, value emitted verbatim (pre-formatted). */
  const P = (key: string, val: string) => rows.push([NS + key, val]);
  /** global field (no namespace), verbatim. */
  const G = (key: string, val: string) => rows.push([key, val]);

  // ---- Background ----
  P("txtYear", yyyy);
  P("DateQuarter_1", rb(qn === "1"));
  P("DateQuarter_2", rb(qn === "2"));
  P("DateQuarter_3", rb(qn === "3"));
  P("AmendedRtn_1", rb(d.amended === "yes"));
  P("AmendedRtn_2", rb(d.amended !== "yes"));
  P("txtSheets", String(d.sheets || "0"));
  P("txtTIN1", t.t1);
  P("txtTIN2", t.t2);
  P("txtTIN3", t.t3);
  P("txtBranchCode", t.branch3);
  P("txtRDOCode", (tp && tp.rdo) || "");

  // Taxpayer/Filer Type (item 7): single / prof / estate / trust.
  P("optType_1", rb(d.filerType === "single"));
  P("optType_2", rb(d.filerType === "prof"));
  P("optType_3", rb(d.filerType === "estate"));
  P("optType_4", rb(d.filerType === "trust"));

  // ATC (item 8): II012, II014, II013, II015, II017, II016 (form-grid order).
  P("optATC_1", rb(d.atc === "II012"));
  P("optATC_2", rb(d.atc === "II014"));
  P("optATC_3", rb(d.atc === "II013"));
  P("optATC_4", rb(d.atc === "II015"));
  P("optATC_5", rb(d.atc === "II017"));
  P("optATC_6", rb(d.atc === "II016"));

  P("txtTaxpayerName", enc(fullName(tp)));
  P("txtAddress", enc(tp ? [tp.address, tp.city].filter(Boolean).join(" ") : ""));
  P("txtZipCode", (tp && tp.zip) || "");
  P("txtBirthMonth", b.mm);
  P("txtBirthDay", b.dd);
  P("txtBirthYear", b.yyyy);
  G("txtEmail", (tp && tp.email) || ""); // email is a global (un-namespaced) field
  P("txtCitizenship", (tp && tp.citizenship) || "");
  P("txtForeignTaxNumber", enc(d.foreignTaxNo));
  P("optForeignTaxCredits_1", rb(d.foreignCredit === "yes"));
  P("optForeignTaxCredits_2", rb(d.foreignCredit !== "yes"));

  // Tax rate (item 16): graduated vs 8%.
  const rate = (d.rateA as string) || "graduated";
  P("optTaxRate_1", rb(rate !== "eight"));
  P("optMethodOfDeduction:_1", rb(d.methodA === "itemized"));
  P("optMethodOfDeduction:_2", rb(d.methodA === "osd"));
  P("optTaxRate_2", rb(rate === "eight"));

  // ---- Spouse background (Part II, items 17-25) ----
  const stin = String(d.spouseTin || "").replace(/\D/g, "");
  P("txtSpouseTIN1", stin.slice(0, 3));
  P("txtSpouseTIN2", stin.slice(3, 6));
  P("txtSpouseTIN3", stin.slice(6, 9));
  P("txtSpouseBranchCode", stin ? "000" : "");
  P("txtSpouseRDOCode", (d.spouseRdo as string) || "000");
  // Item 19 — Spouse Type: single / prof / compensation earner.
  P("optSpouseType_1", rb(d.spouseType === "single"));
  P("optSpouseType_2", rb(d.spouseType === "prof"));
  P("optSpouseType_3", rb(d.spouseType === "comp"));
  // Item 20 — Spouse ATC: II012, II014, II013, II011, II015, II017, II016.
  const satc = d.spouseAtc as string | undefined;
  P("optSpouseATC_1", rb(satc === "II012"));
  P("optSpouseATC_2", rb(satc === "II014"));
  P("optSpouseATC_3", rb(satc === "II013"));
  P("optSpouseATC_4", rb(satc === "II011"));
  P("optSpouseATC_5", rb(satc === "II015"));
  P("optSpouseATC_6", rb(satc === "II017"));
  P("optSpouseATC_7", rb(satc === "II016"));
  P("txtSpouseName", enc(d.spouseName));
  P("txtSpouseCitizenship", enc(d.spouseCitizenship));
  P("txtSpouseForeignTaxNum", enc(d.spouseForeignTaxNo));
  // Item 24 — Spouse claiming Foreign Tax Credits?
  P("optSpouseForeignTaxCred_1", rb(d.spouseForeignCredit === "yes"));
  P("optSpouseForeignTaxCred_2", rb(d.spouseForeignCredit !== "yes"));
  // Item 25 / 25A — Spouse Tax Rate + Method of Deduction.
  const srate = (d.rateB as string) || "graduated";
  P("optSpouseTaxRate_1", rb(srate !== "eight"));
  P("optSpouseMethod:_1", rb(d.methodB === "itemized"));
  P("optSpouseMethod:_2", rb(d.methodB === "osd"));
  P("optSpouseTaxRate_2", rb(srate === "eight"));

  // ---- Part III: Total Tax Payable (items 26-31), A = filer, B = spouse ----
  // 26 Tax Due, 27 Tax Credits/Payments, 28 Tax Payable, 29 Penalties,
  // 30 Total Amount Payable, 31 Aggregate (single column).
  P("txt26A", amt(A.taxDue));
  P("txt26B", amt(B.taxDue));
  P("txt27A", amt(A.credits));
  P("txt27B", amt(B.credits));
  P("txt28A", amt(A.payable));
  P("txt28B", amt(B.payable));
  P("txt29A", amt(A.penalties));
  P("txt29B", amt(B.penalties));
  P("txt30A", amt(A.totalPayable));
  P("txt30B", amt(B.totalPayable));
  P("txt31", amt(comp.aggregate));

  // ---- Part IV: Details of Payment (items 32-35) ----
  const payAmt = (k: string) => (d[k] ? amt(d[k]) : "");
  P("txtAgency32", enc(d.p32bank));
  P("txtNumber32", enc(d.p32num));
  P("txtDate32", enc(d.p32date));
  P("txtAmount32", payAmt("p32amt"));
  P("txtAgency33", enc(d.p33bank));
  P("txtNumber33", enc(d.p33num));
  P("txtDate33", enc(d.p33date));
  P("txtAmount33", payAmt("p33amt"));
  P("txtNumber34", enc(d.p34num));
  P("txtDate34", enc(d.p34date));
  P("txtAmount34", payAmt("p34amt"));
  P("txtParticular35", enc(d.p35particular));
  P("txtAgency35", enc(d.p35bank));
  P("txtNumber35", enc(d.p35num));
  P("txtDate35", enc(d.p35date));
  P("txtAmount35", payAmt("p35amt"));

  // ---- Page 2 header ----
  P("txtPg2TIN1", t.t1);
  P("txtPg2TIN2", t.t2);
  P("txtPg2TIN3", t.t3);
  P("txtPg2BranchCode", t.branch3);
  P("txtPg2TaxpayerName", tp ? (tp.kind === "individual" ? tp.lastName : tp.regName) || "" : "");

  // ---- Part V: Computation of Tax (items 36-68), A = filer, B = spouse ----
  // Schedule I (graduated) 36-46: 36 net sales, 37 cost of sales, 38 gross income,
  //   39 itemized deductions, 40 OSD, 41 net income, 42 prev-quarter taxable,
  //   43 non-operating income (specify), 44 GPP share, 45 total taxable to date,
  //   46 tax due. Schedule II (8%) 47-54: 47 net sales, 48 non-op income (specify),
  //   49 total income, 50 prev-quarter taxable, 51 cumulative, 52 P250k reduction,
  //   53 taxable to date, 54 tax due. Schedule III 55-62: 55 prior-year excess,
  //   56 prev-quarter payments, 57 CWT prior quarters, 58 CWT this quarter (2307),
  //   59 tax paid in prior amended return, 60 foreign tax credits, 61 other credits
  //   (specify), 62 total credits. 63 tax payable, Schedule IV 64-67 (surcharge,
  //   interest, compromise, total penalties), 68 total amount payable.
  // Description fields appear at 43/48/61. The "39 vs 40" split depends on method:
  //   itemized → 39 = deductions, 40 = 0; OSD → 39 = 0, 40 = deductions.
  const side = (o: typeof A): Record<number, number | undefined> => ({
    36: o.sales, 37: o.cogs, 38: o.gross,
    39: o.method === "osd" ? 0 : o.deductions, 40: o.method === "osd" ? o.deductions : 0,
    41: o.netIncome, 42: o.prevTaxable, 43: o.nonOpInc, 44: o.gppShare,
    45: o.taxableCum, 46: o.gradTax,
    47: o.sales8, 48: o.nonOpInc8, 49: o.income8, 50: o.prev8, 51: o.cum8,
    52: o.reduce8, 53: o.taxable8, 54: o.tax8,
    55: o.excess, 56: o.prevPaid, 57: o.cwtPrev, 58: o.cwt, 59: o.taxPaidPrev,
    60: o.foreignCredits, 61: o.otherCredits, 62: o.credits,
    63: o.payable, 64: o.surcharge, 65: o.interest, 66: o.compromise,
    67: o.penalties, 68: o.totalPayable,
  });
  const mapA = side(A);
  const mapB = side(B);
  const descFields: Record<number, string> = { 43: "nonOpDescA", 48: "nonOp8DescA", 61: "otherCreditsDescA" };
  for (let i = 36; i <= 68; i++) {
    const df = descFields[i];
    if (df) P(`txt${i}Desc`, enc(d[df]));
    P(`txt${i}A`, amt(mapA[i] ?? 0));
    P(`txt${i}B`, amt(mapB[i] ?? 0));
  }

  // ---- meta / package fields ----
  P("txtCurrentPage", "1");
  P("txtMaxPage", "2");

  // ---- global tail fields ----
  G("txtFinalFlag", filing.status === "filed" ? "1" : "0");
  G("txtEnroll", "Y");
  G("ebirOnlineConfirmUsername", "");
  G("ebirOnlineUsername", "");
  G("ebirOnlineSecret", "");

  P("txtLOB", enc(d.lineBus));
  P("txtTelno", (tp && tp.phone) || "");
  G("driveSelectTPExport", "0");

  // ---- assemble (1701Q style: header + TAB, 12-space lead, TAB trail, BIR 2012.0 tail) ----
  const body = rows.map(([k, v]) => "            <div>" + k + "=" + v + k + "=</div>\t").join("\n");
  return "<?xml version='1.0'?>\t\n" + body + "\n            \t\n            All Rights Reserved BIR 2012.0";
}

/** Canonical eBIRForms filename for a 1701Q export: <tin><br>1701Qv2018<yyyy>Q<n>.xml */
export function fileName1701Q(filing: Filing, tp: Taxpayer | null): string {
  const t = tinParts(tp);
  const d = filing.data || {};
  const { year, quarter } = parsePeriod(filing.period || String(d.year || ""));
  const yyyy = year || String(d.year || "").slice(0, 4);
  const qn = (quarter || "").replace(/\D/g, "") || "1";
  return `${t.t1}${t.t2}${t.t3}${t.branch3}1701Qv2018${yyyy}Q${qn}.xml`;
}
