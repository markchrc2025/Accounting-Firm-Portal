// build1702Q.ts — authentic eBIRForms XML export for BIR Form 1702Q
// (Quarterly Income Tax Return for Corporations/Partnerships/Non-Individuals).
// Field keys, namespaces, CRLF/tab assembly and tail reproduce a real
// eBIRForms 1702Q offline-package export. Pure (same bytes for same inputs).
//
// 1702Q quirks (reproduced exactly from the authentic sample):
//   * MOST fields use the `frm1702q:` namespace, BUT the method-of-deduction
//     radios use a bare `1702q:` prefix (no "frm"): 1702q:OptMethodDeduct_1/_2.
//   * Several keys carry a LITERAL colon before the suffix:
//       frm1702q:itemFiscalStartMonth:_1/_2, frm1702q:optQtr:_1/_2/_3,
//       frm1702q:optTreaty:_1/_2.
//   * The amended radios are mis-spelled "Remender": optRemenderRtn_1/_2.
//   * TIN parts use lowercase "Tin": txtTin1/2/3.
//   * txtAtc carries a TRAILING SPACE: default "IC010 " (note the space).
//   * Globals (no namespace): Codename1..18 (Codename1=true, rest false),
//     txt1stQtr/2ndQtr/3rdQtr/Total, txtTaxRate ("2%"), txtMinCorpIncomeTax,
//     txtFinalFlag, txtEnroll, ebirOnline*, txtEmail, driveSelectTPExport.
//   * Tail year is "BIR 2012.0" (not 2014.0); each <div> ends with a bare TAB.
//
// Ported verbatim from the Sentire generator (lib/xml/build1702Q.ts); only the
// relative imports change for the flattened engine/ layout, and the browser-only
// `download` re-export is dropped.

import type { Filing, Taxpayer } from "./types";
import type { Comp1702Q } from "./compute1702Q";
import { amt, enc, parseYear, rb, tinParts, type XmlRow } from "./xmlkit";
import { parsePeriod } from "./period";

const NS = "frm1702q:";

/** Registered name for a company (or "LAST, FIRST" fallback for individuals). */
function regName(tp: Taxpayer | null): string {
  if (!tp) return "";
  if (tp.kind === "individual") return [tp.lastName, tp.firstName].filter(Boolean).join(", ");
  return tp.regName || "";
}

/** Build the authentic 1702Q eBIRForms XML string. */
export function build1702Q(filing: Filing, tp: Taxpayer | null, comp: Comp1702Q): string {
  const d = filing.data || {};
  const t = tinParts(tp);
  const yr = parseYear(d.year);
  const rdo = (tp && tp.rdo) || "";
  const calendar = d.periodType !== "fiscal"; // default calendar
  const itemized = (d.method as string) !== "osd"; // default itemized
  const name = regName(tp);

  // Quarter: prefer the structured filing.period ("2025-Q2"); fall back to the
  // form's `quarter` field ("1st"/"2nd"/"3rd"). 1702Q has only Q1..Q3.
  const { quarter } = parsePeriod(filing.period || "");
  const qFromData = ((): string => {
    const q = String(d.quarter || "");
    if (q.startsWith("1")) return "Q1";
    if (q.startsWith("2")) return "Q2";
    if (q.startsWith("3")) return "Q3";
    return "";
  })();
  const q = quarter || qFromData || "Q1";

  const rows: XmlRow[] = [];
  /** namespaced (frm1702q:) field, value emitted verbatim. */
  const P = (key: string, val: string) => rows.push([NS + key, val]);
  /** global field (no namespace), verbatim. */
  const G = (key: string, val: string) => rows.push([key, val]);
  /** bare 1702q: namespace (no "frm" prefix) — method radios only. */
  const M = (key: string, val: string) => rows.push(["1702q:" + key, val]);
  /** peso-formatted amount field ("0.00" when zero, comma-formatted otherwise). */
  const A = (key: string, n: number) => P(key, amt(n));

  // ---- Period / fiscal-or-calendar (literal colon in the key) ----
  P("itemFiscalStartMonth:_1", rb(calendar));
  P("itemFiscalStartMonth:_2", rb(!calendar));

  // ---- Quarter (literal colon; Q1..Q3) ----
  P("optQtr:_1", rb(q === "Q1"));
  P("optQtr:_2", rb(q === "Q2"));
  P("optQtr:_3", rb(q === "Q3"));

  // ---- Amended return (mis-spelled "Remender"; _1=yes, _2=no) ----
  P("optRemenderRtn_1", rb(d.amended === "yes"));
  P("optRemenderRtn_2", rb(d.amended !== "yes"));

  // ---- Sheets (Item 26 Number of Attachments) / year-end ----
  P("txtSheets", String(d.attachments || d.sheets || "0"));
  P("itemYearEndMonth", "12");
  P("txtYearEnded", yr.yyyy);

  // ---- TIN (lowercase "Tin") + branch + RDO ----
  P("txtTin1", t.t1);
  P("txtTin2", t.t2);
  P("txtTin3", t.t3);
  P("txtBranchCode", t.branch3);
  P("txtRdoCode", rdo);

  // ---- Line of business / name / contact / address (URL-encoded) ----
  P("txtDescription", enc((tp && tp.classification) || d.lineBus || ""));
  P("txtTaxpayerName", enc(name));
  P("txtTelNum", (tp && tp.phone) || "");
  P("txtTaxPayerAdd", enc(tp ? [tp.address, tp.city].filter(Boolean).join(" ") : ""));
  P("txtTaxPayerZip", (tp && tp.zip) || "");

  // ---- Method of deductions (BARE 1702q: namespace, no "frm") ----
  M("OptMethodDeduct_1", rb(itemized));
  M("OptMethodDeduct_2", rb(!itemized));

  // ---- Tax treaty (Item 13/13A; literal colon; default: no treaty → _2=true) ----
  P("optTreaty:_1", rb(d.treaty === "yes"));
  P("optTreaty:_2", rb(d.treaty !== "yes"));
  P("lstTaxTreaty", "0");

  // ---- ATC (trailing space is authentic — keep it; default IC010 when blank) ----
  // The authentic 1702Q XML captures the treaty only via optTreaty/lstTaxTreaty
  // and carries no signatory title/TIN slots, so none are emitted here.
  P("txtAtc", (d.atc as string) ? String(d.atc) : "IC010 ");

  // ---- Part IV Schedule 1 (special/exempt) amount fields (txt16A..txt24B) ----
  // The authentic positional block carries Schedule 1's per-item, per-column
  // figures: column A = EXEMPT, column B = SPECIAL (the third "C" sub-cells the
  // sample reserves stay 0). Items follow the official Schedule 1 order:
  //   16 Sales · 17 Cost of Sales · 18 Gross Income from Operation ·
  //   19 Non-Operating/Other Income · 20 Total Gross Income · 21 Deductions ·
  //   22 Taxable Income this Quarter · 23 Total Taxable Income to Date ·
  //   24 Net Income Tax Due to National Government (Sch 1 Item 13 → Part II 17).
  A("txt16A", comp.sch1_1A); // Sales/Receipts
  A("txt16B", comp.sch1_1B);
  A("txt16C", 0);
  A("txt17A", comp.sch1_2A); // Less: Cost of Sales/Services
  A("txt17B", comp.sch1_2B);
  A("txt17C", 0);
  A("txt18A", comp.sch1_3A); // Gross Income from Operation
  A("txt18B", comp.sch1_3B);
  A("txt18C", 0);
  A("txt19A", comp.sch1_4A); // Add: Non-Operating / Other Taxable Income
  A("txt19B", comp.sch1_4B);
  A("txt20A", comp.sch1_5A); // Total Gross Income
  A("txt20B", comp.sch1_5B);
  A("txt20C", 0);
  A("txt21A", comp.sch1_6A); // Less: Deductions
  A("txt21B", comp.sch1_6B);
  A("txt21C", 0);
  A("txt22A", comp.sch1_7A); // Taxable Income this Quarter
  A("txt22B", comp.sch1_7B);
  A("txt23A", comp.sch1_9A); // Total Taxable Income to Date
  A("txt23B", comp.sch1_9B);
  A("txt24A", comp.sch1_13A); // Net Income Tax Due (exempt: 0)
  A("txt24B", comp.sch1_13B); // Net Income Tax Due (special) → Part II Item 17
  // txt25A carries the special-rate context; txt25B holds the regular
  // income-tax-rate cell (the authentic sample shows a 30% filer's rate as
  // "30.00" — keep this verified mapping rather than guessing).
  A("txt25A", comp.sch1Rate);
  A("txt25B", comp.rate);
  // ---- Part II – Total Tax Payable (txt26A..txt34) ----
  A("txt26A", comp.i14); // Income Tax Due – Regular/Normal Rate (Sch 2 Item 13)
  A("txt26B", comp.i15); // Less: Unexpired Excess of Prior Year's MCIT
  A("txt27", comp.i16); // Balance/Income Tax Still Due – Regular Rate
  A("txt28", comp.i17); // Add: Income Tax Due – Special Rate (Sch 1 Item 13)
  // Schedule 4 – Tax Credits/Payments detail (Items 1..6b → Part II Item 19).
  A("txt29A", comp.sch4_1); // Prior Year's Excess Credits
  A("txt29B", comp.sch4_2); // Tax payments previous quarter/s (other than MCIT)
  A("txt29C", comp.sch4_3); // MCIT payments previous quarter/s
  A("txt29D", comp.sch4_4); // Creditable Tax Withheld previous quarter/s
  A("txt30", comp.i18); // Aggregate Income Tax Due (Items 16 + 17)
  A("txt31A", comp.sch4_5); // Creditable Tax Withheld per 2307 this quarter
  A("txt31B", comp.sch4_6); // Tax paid in previously-filed return (amended)
  A("txt31C", comp.sch4_6a); // Other Tax Credits/Payments (a)
  A("txt31D", comp.sch4_6b); // Other Tax Credits/Payments (b)
  A("txt31E", comp.sch4_7); // Total Tax Credits/Payments (Sch 4 Item 7 → Item 19)
  A("txt31F", comp.i20); // Net Tax Payable / (Overpayment)
  P("txt31Gothers", "");
  A("txt31G", comp.i21); // Surcharge
  A("txt31H", comp.i22); // Interest
  A("txt32", comp.i23); // Compromise
  A("txt33A", comp.i24); // Total Penalties (Items 21 to 23)
  A("txt33B", 0);
  A("txt33C", 0);
  A("txt33D", 0);
  A("txt34", comp.i25); // TOTAL AMOUNT PAYABLE / (Overpayment)

  // ---- Globals: Codename1..18 (Codename1=true, the rest false) ----
  for (let i = 1; i <= 18; i++) G(`Codename${i}`, rb(i === 1));

  // ---- Globals: Schedule 3 quarterly MCIT gross income + 2% rate + MCIT ----
  G("txt1stQtr", amt(comp.sch3_1));
  G("txt2ndQtr", amt(comp.sch3_2));
  G("txt3rdQtr", amt(comp.sch3_3));
  G("txtTotal", amt(comp.sch3_4));
  G("txtTaxRate", "2%");
  G("txtMinCorpIncomeTax", amt(comp.mcit));

  // ---- Globals: package / enrollment tail ----
  G("txtFinalFlag", filing.status === "draft" ? "0" : "1");
  G("txtEnroll", "Y");
  G("ebirOnlineConfirmUsername", "");
  G("ebirOnlineUsername", "");
  G("ebirOnlineSecret", "");
  G("txtEmail", (tp && tp.email) || "");
  G("driveSelectTPExport", "0");

  // ---- assemble (12-space lead, TAB+CR per div, CRLF lines, BIR 2012.0 tail) ----
  // The authentic sample uses CRLF endings: each <div> ends with TAB+CR, lines
  // are joined by LF, and the head/tail carry TAB+CR+LF.
  const lead = "            ";
  const trail = "\t\r";
  const sep = "\n";
  const head = "<?xml version='1.0'?>\t\r\n";
  const body = rows.map(([k, v]) => `${lead}<div>${k}=${v}${k}=</div>${trail}`).join(sep);
  const tail = `${lead}\t\r\n${lead}All Rights Reserved BIR 2012.0`;
  return `${head}${body}${sep}${tail}`;
}

/** eBIRForms filename: <tin><branch>1702Q<yyyy><Qn>.xml (no v2018, no mm). */
export function fileName1702Q(filing: Filing, tp: Taxpayer | null): string {
  const t = tinParts(tp);
  const yr = parseYear((filing.data || {}).year);
  const { year, quarter } = parsePeriod(filing.period || "");
  const yyyy = year || yr.yyyy;
  const qFromData = ((): string => {
    const q = String((filing.data || {}).quarter || "");
    if (q.startsWith("1")) return "Q1";
    if (q.startsWith("2")) return "Q2";
    if (q.startsWith("3")) return "Q3";
    return "";
  })();
  const qn = quarter || qFromData || "Q1";
  return `${t.t1}${t.t2}${t.t3}${t.branch3}1702Q${yyyy}${qn}.xml`;
}

