// build1701A.ts — authentic eBIRForms XML export for BIR Form 1701A.
// Field keys, namespace (frm1701A), and tail match the offline-package output
// (verified against a real eBIRForms 1701A export). build1701A() is pure.
//
// Ported from the Sentire generator (lib/xml/build1701A.ts); the relative
// imports change for the flattened engine/ layout, the browser-only `download`
// re-export is dropped, and the filename helper is named fileName1701A (it was
// the bare `fileName` there, which would collide in a shared barrel).

import type { Filing, Taxpayer } from "./types";
import type { Comp1701A } from "./compute1701A";
import { amt, dob, enc, parseYear, rb, tinParts, type XmlRow } from "./xmlkit";

const NS = "frm1701A:";

/** Page-1 taxpayer name: "LAST, FIRST MIDDLE" (individuals) or registered name. */
function fullName(tp: Taxpayer | null): string {
  if (!tp) return "";
  if (tp.kind === "individual")
    return [tp.lastName, [tp.firstName, tp.middleName].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  return tp.regName || "";
}

/** Build the authentic 1701A eBIRForms XML string. */
export function build1701A(filing: Filing, tp: Taxpayer | null, comp: Comp1701A): string {
  const d = filing.data || {};
  const t = tinParts(tp);
  const yr = parseYear(d.year);
  const rate = (d.taxRate as string) || "graduated";
  const A = comp.A;
  const B = comp.B;

  const rows: XmlRow[] = [];
  /** namespaced field, value emitted verbatim (pre-formatted). */
  const P = (key: string, val: string) => rows.push([NS + key, val]);
  /** global field (no namespace), verbatim. */
  const G = (key: string, val: string) => rows.push([key, val]);

  // ---- Background ----
  P("txtMonth", yr.mm);
  P("txtYear", yr.yyyy);
  P("optAmendedReturn_1", rb(d.amended === "yes"));
  P("optAmendedReturn_2", rb(d.amended !== "yes"));
  P("optShortPeriod_1", rb(d.shortPeriod === "yes"));
  P("optShortPeriod_2", rb(d.shortPeriod !== "yes"));
  P("txtTIN1", t.t1);
  P("txtTIN2", t.t2);
  P("txtTIN3", t.t3);
  P("txtBranchCode", t.branch3);
  P("txtRDOCode", (tp && tp.rdo) || "");
  P("optTaxType_1", rb(d.taxpayerType === "single"));
  P("optTaxType_2", rb(d.taxpayerType === "prof"));
  P("optATC_1", rb(d.atc === "II012"));
  P("optATC_2", rb(d.atc === "II014"));
  P("optATC_3", rb(d.atc === "II015"));
  P("optATC_4", rb(d.atc === "II017"));
  P("txtTaxpayerName", enc(fullName(tp)));
  P("txtAddress", enc(tp ? [tp.address, tp.city].filter(Boolean).join(", ") : ""));
  P("txtZipCode", (tp && tp.zip) || "");
  P("txtBirthDate", dob(tp ? tp.birthdate : ""));
  G("txtEmail", (tp && tp.email) || ""); // email is a global (un-namespaced) field
  P("txtCitizenship", (tp && tp.citizenship) || "");
  P("optForeignTaxCredits_1", rb(d.foreignCredit === "yes"));
  P("optForeignTaxCredits_2", rb(d.foreignCredit !== "yes"));
  P("txtForeignTaxNumber", enc(d.foreignTaxNo));
  P("txtTelNum", (tp && tp.phone) || "");
  P("optCivilStatus_1", rb(d.civil === "single"));
  P("optCivilStatus_2", rb(d.civil === "married"));
  P("optCivilStatus_3", rb(d.civil === "sep"));
  P("optCivilStatus_4", rb(d.civil === "widow"));
  P("optSpouseIncome_1", rb(d.spouseIncome === "yes"));
  P("optSpouseIncome_2", rb(d.spouseIncome === "no"));
  P("optFilingStatus_1", rb(d.filing === "joint"));
  P("optFilingStatus_2", rb(d.filing === "separate"));
  P("optTaxRate_1", rb(rate !== "eight"));
  P("optTaxRate_2", rb(rate === "eight"));

  // ---- Part II: Total Tax Payable (items 20-30) ----
  for (let i = 20; i <= 29; i++) {
    P(`txt${i}A`, amt(A[("i" + i) as keyof typeof A]));
    P(`txt${i}B`, amt(B[("i" + i) as keyof typeof B]));
  }
  P("txt30", amt(comp.i30));
  P("optRefund_1", rb(d.over === "refund"));
  P("optRefund_2", rb(d.over === "tcc"));
  P("optRefund_3", rb(d.over === "carry"));
  P("txtNumberAttachments", String(d.attachments || "0"));

  // ---- Part III: Details of Payment (items 32-35) ----
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

  // ---- Part IV: items 36-65 (A = filer, B = spouse), with description lines ----
  const descFields: Record<number, string> = { 41: "i41label", 42: "i42label", 50: "i50label", 51: "i51label", 63: "i63label" };
  for (let i = 36; i <= 65; i++) {
    const df = descFields[i];
    if (df) P(`txt${i}Desc`, enc(d[df]));
    P(`txt${i}A`, amt(A[("i" + i) as keyof typeof A]));
    P(`txt${i}B`, amt(B[("i" + i) as keyof typeof B]));
  }

  // ---- Spouse background (items 66-75) ----
  const stin = String(d.spouseTin || "").replace(/\D/g, "");
  P("txtSpouseTIN1", stin.slice(0, 3));
  P("txtSpouseTIN2", stin.slice(3, 6));
  P("txtSpouseTIN3", stin.slice(6, 9));
  P("txtSpouseBranchCode", "");
  P("txtSpouseRDOCode", (d.spouseRdo as string) || "000");
  P("optSpouseTaxType_1", rb(d.spouseType === "single"));
  P("optSpouseTaxType_2", rb(d.spouseType === "prof"));
  // 69 Alphanumeric Tax Code (ATC)
  P("optSpouseATC_1", rb(d.spouseAtc === "II012"));
  P("optSpouseATC_2", rb(d.spouseAtc === "II014"));
  P("optSpouseATC_3", rb(d.spouseAtc === "II015"));
  P("optSpouseATC_4", rb(d.spouseAtc === "II017"));
  P("txtSpouseName", enc(d.spouseName));
  // 71 Contact Number | 72 Citizenship
  P("txtSpouseTelNum", enc(d.spouseContact));
  P("txtSpouseCitizenship", enc(d.spouseCitizenship));
  // 73 Claiming Foreign Tax Credits? | 74 Foreign Tax Number
  P("optSpouseFTC_1", rb(d.spouseForeignCredit === "yes"));
  P("optSpouseFTC_2", rb(d.spouseForeignCredit === "no"));
  P("txtSpouseFTN", enc(d.spouseForeignTaxNo));
  // 75 Tax Rate
  P("optSpouseTaxRate_1", rb(d.spouseTaxRate === "graduated"));
  P("optSpouseTaxRate_2", rb(d.spouseTaxRate === "eight"));

  // ---- meta / package fields ----
  P("txtCurrentPage", "1");
  P("txtMaxPage", "2");
  P("txtLineBus", enc(d.lineBus));
  P("txtCtrmodalPartIVA", "0");
  P("txtCtrmodalPartIVB", "0");
  P("txtZIP", "");
  P("txtEnabledInputsOnValidation", "");
  P("txtDisabledInputs", "");
  P("txtEnabledLinks", "");
  P("txtIsSpouseDisabled", "");
  P("txtIsTaxFilerDisabled", "false");
  P("txtAttachmentTypes", "");
  P("txtTIN4", "");
  P("txtDisabledOnSave", "");
  P("txtEnabledOnSave", "");
  P("txtVersion", "11112018");
  P("txtdisabledID", "");
  P("txtmodalPartIVA_C1", "0.00");
  P("txtmodalPartIVA_C2", "0.00");
  P("txtmodalPartIVB_C1", "0.00");
  P("txtmodalPartIVB_C2", "0.00");

  // ---- global tail fields ----
  G("driveSelectTPExport", "0");
  G("txtFinalFlag", filing.status === "filed" ? "1" : "0");
  G("txtEnroll", "N");
  G("ebirOnlineConfirmUsername", "");
  G("ebirOnlineUsername", "");
  G("ebirOnlineSecret", "");

  // ---- assemble (1701A style: 12-space indent, 2-space trail, BIR 2014. tail) ----
  const body = rows.map(([k, v]) => "            <div>" + k + "=" + v + k + "=</div>  ").join("\n");
  return "<?xml version='1.0'?>  \n" + body + "\n              \n            All Rights Reserved BIR 2014.";
}

/** Canonical eBIRForms filename for a 1701A export: <tin><br>1701A<mm><yyyy>.xml */
export function fileName1701A(filing: Filing, tp: Taxpayer | null): string {
  const t = tinParts(tp);
  const yr = parseYear((filing.data || {}).year);
  return `${t.t1}${t.t2}${t.t3}${t.branch3}1701A${yr.mm}${yr.yyyy}.xml`;
}
