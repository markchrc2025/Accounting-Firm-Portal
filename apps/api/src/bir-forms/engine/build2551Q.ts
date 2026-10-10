// build2551Q.ts — authentic eBIRForms XML export for BIR Form 2551Q
// (Quarterly Percentage Tax Return, January 2018 ENCS).
// PORTED verbatim from the Sentire generator (src/lib/xml/build2551Q); the
// browser `download` re-export is dropped (the portal writes to object storage).
//
// Field keys, the namespace (frm2551Qv2018), the GLOBAL (un-namespaced)
// Schedule-1 ATC table fields and the "All Rights Reserved BIR 2012.0" tail all
// match the offline-package output (verified against a real eBIRForms export).
// build2551Q() is pure.

import type { Filing, Row2551Q, Taxpayer } from "./types";
import type { Comp2551Q } from "./compute2551Q";
import { amt, enc, rb, tinParts, type XmlRow } from "./xmlkit";
import { parsePeriod } from "./period";
import { num } from "./format";
import { ExportRefusal } from "./export-refusal";

const NS = "frm2551Qv2018:";

/**
 * Schedule-1 ATC dropdown index map. The eBIRForms dropdown is 1-based and
 * follows the Guided2551Q ATC list order; an empty line is 0. An ATC missing here
 * refuses the export (U13 F1): its dropdown position must come from a real
 * eBIRForms export, never be guessed.
 */
const ATC_INDEX: Record<string, number> = {
  PT010: 1,
  PT040: 2,
  PT041: 3,
  PT060: 4,
  PT070: 5,
  PT090: 6,
  PT120: 7,
  PT130: 8,
};

/** Page-1 registered name: "LAST, FIRST MIDDLE" (individuals) or registered name. */
function fullName(tp: Taxpayer | null): string {
  if (!tp) return "";
  if (tp.kind === "individual")
    return [tp.lastName, [tp.firstName, tp.middleName].filter(Boolean).join(" ")]
      .filter(Boolean)
      .join(", ");
  return tp.regName || "";
}

/** Rate as a one-decimal string the eBIRForms way ("3" → "3.0"). */
function rate1(v: unknown): string {
  const n = Number(String(v ?? "").replace(/[^0-9.]/g, ""));
  if (!Number.isFinite(n)) return "0.0";
  return n.toFixed(1);
}

/** The form's Schedule 1 has six rows. */
const SCHEDULE_1_ROWS = 6;

/**
 * U13 F1: every Schedule 1 row the return counts (item 14 sums them all) must be
 * carried by the export; one it cannot carry refuses the export, naming the row.
 * A row is counted when it has an ATC or a taxable amount.
 */
function assertScheduleEncodable(rows: Row2551Q[]): void {
  rows.forEach((r, i) => {
    const code = (r.atc || "").trim();
    if (!code && num(r.taxable) === 0) return;
    const row = i + 1;
    const fix = "Change the row's ATC or remove the row, then export again.";
    if (!code)
      throw new ExportRefusal(
        `Schedule 1, row ${row} has an amount but no ATC. Choose its ATC or remove the row, then export again.`,
      );
    if (!(code in ATC_INDEX))
      throw new ExportRefusal(
        `Schedule 1, row ${row}: the ATC ${code} cannot be written into the eBIRForms export yet. ${fix}`,
      );
    if (row > SCHEDULE_1_ROWS)
      throw new ExportRefusal(
        `Schedule 1, row ${row}: the form has room for ${SCHEDULE_1_ROWS} rows. Move it into an empty row or remove it, then export again.`,
      );
  });
}

/** Build the authentic 2551Q eBIRForms XML string. */
export function build2551Q(filing: Filing, tp: Taxpayer | null, comp: Comp2551Q): string {
  const d = filing.data || {};
  const t = tinParts(tp);
  const { year, quarter } = parsePeriod(filing.period || String(d.year || ""));
  const yyyy = year || String(d.year || "").slice(0, 4);
  // quarter is like "Q1"; fall back to the data.quarter ("1st".."4th") digit.
  const qn = (quarter || String(d.quarter || "")).replace(/\D/g, "") || "1";
  const sched = (d.rows as Row2551Q[] | undefined) || [];
  assertScheduleEncodable(sched);

  const rows: XmlRow[] = [];
  /** namespaced field, value emitted verbatim (pre-formatted). */
  const P = (key: string, val: string) => rows.push([NS + key, val]);
  /** global field (no namespace), verbatim. */
  const G = (key: string, val: string) => rows.push([key, val]);

  // ---- Period / amended ----
  P("forThe_1", rb(d.periodType !== "fiscal"));
  P("forThe_2", rb(d.periodType === "fiscal"));
  P("rtnMonth", "12");
  P("txtYear", yyyy);
  P("qtr_1", rb(qn === "1"));
  P("qtr_2", rb(qn === "2"));
  P("qtr_3", rb(qn === "3"));
  P("qtr_4", rb(qn === "4"));
  P("amendedRtn_1", rb(d.amended === "yes"));
  P("amendedRtn_2", rb(d.amended !== "yes"));
  P("txtSheets", String(d.sheets || "0"));

  // ---- Background ----
  P("txtTIN1", t.t1);
  P("txtTIN2", t.t2);
  P("txtTIN3", t.t3);
  P("txtBranchCode", t.branch3);
  P("txtRDOCode", (tp && tp.rdo) || "");
  P("registeredName", enc(fullName(tp)));
  P("registeredAddress", enc(tp ? [tp.address, tp.city].filter(Boolean).join(", ") : ""));
  P("zipCode", (tp && tp.zip) || "");
  P("telNo", (tp && tp.phone) || "");
  G("txtEmail", (tp && tp.email) || ""); // email is a global (un-namespaced) field

  // ---- Tax relief / rate availed ----
  P("taxTreaty_1", rb(d.taxRelief === "yes"));
  P("taxTreaty_2", rb(d.taxRelief !== "yes"));
  P("txtTaxReliefSpecify", enc(d.taxReliefSpec) || "0");
  // U13 F2: item 13 (graduated or 8%) is asked only of an individual, and only in
  // the first quarter of the taxable year, as the form says on its face; any
  // other return leaves both boxes unmarked.
  const itRate = (d.itRate as string) || "graduated";
  const asks13 = !!tp && tp.kind === "individual" && qn === "1";
  P("taxRate1", rb(asks13 && itRate !== "eight"));
  P("taxRate2", rb(asks13 && itRate === "eight"));

  // ---- Part II: Total Tax Payable (items 14-24) ----
  for (let i = 14; i <= 24; i++) {
    if (i === 17) P("txt17Specify", enc(d.i17label));
    P(`txt${i}`, amt(comp[("i" + i) as keyof Comp2551Q] as number));
  }
  P("overPayment1", rb(d.over === "refund"));
  P("overPayment2", rb(d.over === "tcc"));

  // ---- Tax agent (globals) ----
  G("txtTaxAgentNo", enc(d.taxAgentNo));
  G("txtDateIssue", enc(d.taxAgentIssue));
  G("txtDateExpiry", enc(d.taxAgentExpiry));

  // ---- Part III: Details of Payment (items 25-28) ----
  const payAmt = (k: string) => (d[k] ? amt(d[k]) : "");
  for (let no = 25; no <= 28; no++) {
    if (no === 28) P("txtParticular28", enc(d.pay28particular));
    P(`txtAgency${no}`, enc(d[`pay${no}bank`]));
    P(`txtNumber${no}`, enc(d[`pay${no}num`]));
    P(`txtDate${no}`, enc(d[`pay${no}date`]));
    P(`txtAmount${no}`, payAmt(`pay${no}amt`));
  }

  // ---- Page 2 header ----
  P("txtPg2TIN1", t.t1);
  P("txtPg2TIN2", t.t2);
  P("txtPg2TIN3", t.t3);
  P("txtPg2BranchCode", t.branch3);
  // Page-2 taxpayer name is emitted RAW (not URL-encoded).
  P("txtPg2TaxpayerName", fullName(tp));

  // ---- Schedule 1: 6 ATC rows (GLOBAL fields, no namespace) ----
  for (let i = 0; i < SCHEDULE_1_ROWS; i++) {
    const r = sched[i] || {};
    const code = (r.atc || "").trim();
    const idx = ATC_INDEX[code] ?? 0;
    const cRow = comp.rows[i];
    G(`drpATC${i + 1}`, String(idx));
    G(`txtATCAmt${i + 1}`, amt(idx ? r.taxable : 0));
    G(`txtATCRate${i + 1}`, idx ? rate1(r.rate) : "0.00");
    G(`txtATCDue${i + 1}`, amt(idx && cRow ? cRow.due : 0));
  }
  G("txtTotalSched1", amt(comp.i14));

  // ---- meta / package fields ----
  P("txtCurrentPage", "2");
  P("txtMaxPage", "2");

  // ---- global tail fields ----
  G("txtFinalFlag", filing.status === "filed" ? "1" : "0");
  G("txtEnroll", "Y");
  G("ebirOnlineConfirmUsername", "");
  G("ebirOnlineUsername", "");
  G("ebirOnlineSecret", "");
  G("driveSelectTPExport", "0");

  // ---- assemble (2551Q style: single line; header + TAB-TAB lead, divs joined
  // by TAB-TAB, tail prefixed with TAB-TAB-TAB-TAB; tail "BIR 2012.0") ----
  const body = rows.map(([k, v]) => `<div>${k}=${v}${k}=</div>`).join("\t\t");
  return `<?xml version='1.0'?>\t\t${body}\t\t\t\tAll Rights Reserved BIR 2012.0`;
}

/** Canonical eBIRForms filename: <tin><br>2551Qv2018<mm><yyyy>Q<n>.xml (mm=12). */
export function fileName2551Q(filing: Filing, tp: Taxpayer | null): string {
  const t = tinParts(tp);
  const d = filing.data || {};
  const { year, quarter } = parsePeriod(filing.period || String(d.year || ""));
  const yyyy = year || String(d.year || "").slice(0, 4);
  const qn = (quarter || String(d.quarter || "")).replace(/\D/g, "") || "1";
  return `${t.t1}${t.t2}${t.t3}${t.branch3}2551Qv201812${yyyy}Q${qn}.xml`;
}
