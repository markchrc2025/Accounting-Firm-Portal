// build1702RT.ts — authentic eBIRForms XML export for BIR Form 1702-RT.
// Field keys, namespace (frm1702RT), CRLF/tab assembly and tail match a real
// eBIRForms 1702-RT offline-package export (a 4-page form — the largest). Pure.
//
// 1702-RT specifics versus the simpler forms:
//   * TIN is FOUR parts (TIN1/2/3/4); TIN4 is the 3-digit branch code.
//   * Pages 2/3/4 repeat the TIN + a RAW (un-encoded) registered name.
//   * Email stays namespaced (frm1702RT:txtPg1Pt1I12Email), not a global txtEmail.
//   * Most numeric fields are emitted as bare "0" (NOT "0.00"); only the
//     amount fields we actually compute use amt() peso formatting.
//   * Item 40 rate is a string with a "%" suffix (e.g. "25%").
//
// Ported verbatim from the Sentire generator (lib/xml/build1702RT.ts); only the
// relative imports change for the flattened engine/ layout, and the browser-only
// `download` re-export is dropped.

import type { Filing, Taxpayer } from "./types";
import type { Comp1702RT } from "./compute1702RT";
import { num } from "./format";
import { amt, enc, parseYear, rb, tinParts, type XmlRow } from "./xmlkit";

const NS = "frm1702RT:";

/** Number of attachments → the 3-digit "PagesFilled" field ("000" when blank). */
function padAttach(v: unknown): string {
  const n = Math.round(num(v));
  return String(Math.max(0, n)).padStart(3, "0").slice(-3);
}

/**
 * 1702-RT amount formatting: the authentic sample emits a bare "0" for empty
 * numeric fields (never "0.00") but comma/decimal peso formatting for non-zero
 * values. `num1702()` reproduces that — "0" when zero, amt() otherwise.
 */
function num1702(n: number): string {
  return n === 0 ? "0" : amt(n);
}

/** Registered name for a company (or "LAST, FIRST" fallback for individuals). */
function regName(tp: Taxpayer | null): string {
  if (!tp) return "";
  if (tp.kind === "individual") return [tp.lastName, tp.firstName].filter(Boolean).join(", ");
  return tp.regName || "";
}

/** ISO yyyy-mm-dd → MM/DD/YYYY (date of incorporation / item 10). */
function incDate(iso?: string): string {
  if (!iso) return "";
  const [y, m, d] = String(iso).split("-");
  if (!y || !m || !d) return iso;
  return m + "/" + d + "/" + y;
}

/** Build the authentic 1702-RT eBIRForms XML string. */
export function build1702RT(filing: Filing, tp: Taxpayer | null, comp: Comp1702RT): string {
  const d = filing.data || {};
  const t = tinParts(tp);
  const yr = parseYear(d.year);
  const yy = yr.yyyy.slice(-2); // 2-digit year ("25")
  const rdo = (tp && tp.rdo) || "";
  const calendar = d.periodType !== "fiscal"; // default calendar
  const itemized = (d.method as string) !== "osd"; // default itemized
  const name = regName(tp);

  const rows: XmlRow[] = [];
  /** namespaced field, value emitted verbatim (pre-formatted). */
  const P = (key: string, val: string) => rows.push([NS + key, val]);
  /** global field (no namespace), verbatim. */
  const G = (key: string, val: string) => rows.push([key, val]);
  /** bare integer "0" for the schedule fields the app does not capture. */
  const Z = (key: string) => P(key, "0");
  /** empty namespaced field. */
  const E = (key: string) => P(key, "");
  /** raw string value (text fields). */
  const S = (key: string, v: unknown) => P(key, v == null ? "" : String(v));

  // ---------------------------------------------------------------- PAGE 1
  // Background
  P("rdoPg1I1Calendar", rb(calendar));
  P("rdoPg1I1Fiscal", rb(!calendar));
  P("ddlPg1I2Month", yr.mm);
  P("txtPg1I2Year", yy);
  P("rdoPg1I3AmmendYes", rb(d.amended === "yes"));
  P("rdoPg1I3AmmendNo", rb(d.amended !== "yes"));
  P("rdoPg1I4ShortPeriodYes", rb(d.shortPeriod === "yes"));
  P("rdoPg1I4ShortPeriodNo", rb(d.shortPeriod !== "yes"));
  // Item 5 — ATC. "IC 055" (MCIT) selects the dedicated radio; any other ATC is
  // emitted via the "Other" dropdown (spaces stripped to match the package code).
  const atcRaw = ((d.atc as string) || "").trim();
  const atcCode = atcRaw.replace(/\s+/g, "").toUpperCase();
  const atcIsMcit = atcCode === "IC055";
  P("rdoPg1I5Atc", rb(atcIsMcit));
  P("drpPg1I5AtcOther", atcIsMcit ? "" : atcCode || "IC010");
  P("rdoPg1I5AtcOther", rb(!atcIsMcit && atcCode !== ""));

  // TIN (4 parts; TIN4 = branch)
  P("txtPg1Pt1I6TIN1", t.t1);
  P("txtPg1Pt1I6TIN2", t.t2);
  P("txtPg1Pt1I6TIN3", t.t3);
  P("txtPg1Pt1I6TIN4", t.branch3);
  G("BranchMaskP1", "00000");
  P("txtRDO", rdo);
  P("drpPg1Pt1I7RDOCode", rdo);

  // Name (registered name on page 1 is URL-encoded) + address
  P("txtPg1Pt1I8Name1", enc(name));
  E("txtPg1Pt1I8Name2");
  E("txtPg1Pt1I8Name3");
  P("txtPg1Pt1I9Address1", enc(tp ? [tp.address, tp.city].filter(Boolean).join(" ") : ""));
  E("txtPg1Pt1I9Address2");
  E("txtPg1Pt1I9Address3");
  P("txtZIP", (tp && tp.zip) || "");
  P("txtPg1Pt1I10", incDate(tp ? tp.incorpDate : ""));
  P("txtPg1Pt1I11Contact", (tp && tp.phone) || "");
  P("txtPg1Pt1I12Email", (tp && tp.email) || ""); // namespaced on 1702RT

  // Method of deductions
  P("rdoPg1Pt1I13ItemizedDeduction", rb(itemized));
  P("rdoPg1Pt1I13OptionalStandard", rb(!itemized));

  // Part II — Total Tax Payable (items 14-21)
  P("txtPg1Pt2I14IncomeTax", num1702(comp.i14));
  P("txtPg1Pt2I15TotalTaxCredits", num1702(comp.i15));
  P("txtPg1Pt2I16NetTax", num1702(comp.i16));
  P("txtPg1Pt2I17Surcharge", num1702(comp.i17));
  P("txtPg1Pt2I18Interest", num1702(comp.i18));
  P("txtPg1Pt2I19Compromise", num1702(comp.i19));
  P("txtPg1Pt2I20TotalPenalties", num1702(comp.i20));
  P("txtPg1Pt2I21TotalAmount", num1702(comp.i21));
  P("rdoPg1Pt2I21OverpaymentRefunded", rb(d.over === "refund"));
  P("rdoPg1Pt2I21OverpaymentIssued", rb(d.over === "tcc"));
  P("rdoPg1Pt2I21OverpaymentCarried", rb(d.over === "carry"));

  // Signatories — President/Principal Officer + Treasurer/Asst. Treasurer.
  S("txtSignaturePresident", name);
  S("txtSignatureTreasurer", d.treasurer);
  S("txtPg1Pt2PagesFilled", padAttach(d.attachments));
  S("txtPg1Pt2Signatory1", d.presTitle); // Title of Signatory (President)
  S("txtPg1Pt2SignatoryTin1", d.presTin);
  S("txtPg1Pt2Signatory2", d.treasTitle); // Title of Signatory (Treasurer)
  S("txtPg1Pt2SignatoryTin2", d.treasTin);

  // Part III — Details of Payment (items 23-26; from the payNN* fields).
  S("txtPg1Pt3I23DebitMemoC1", d.pay23bank);
  S("txtPg1Pt3I23DebitMemoC2", d.pay23num);
  S("txtPg1Pt3I23DebitMemoC3Date", d.pay23date);
  P("txtPg1Pt3I23DebitMemoC4Amount", num1702(num(d.pay23amt)));
  S("txtPg1Pt3I24CheckC1", d.pay24bank);
  S("txtPg1Pt3I24CheckC2", d.pay24num);
  S("txtPg1Pt3I24CheckC3Date", d.pay24date);
  P("txtPg1Pt3I24CheckC4Amount", num1702(num(d.pay24amt)));
  S("txtPg1Pt3I25TaxDebitC2", d.pay25num);
  S("txtPg1Pt3I25TaxDebitDate", d.pay25date);
  P("txtPg1Pt3I25TaxDebitC4Amount", num1702(num(d.pay25amt)));
  E("txtPg1Pt3I26Others"); // "specify" text — not separately captured
  S("txtPg1Pt3I26OthersC1", d.pay26bank);
  S("txtPg1Pt3I26OthersC2", d.pay26num);
  S("txtPg1Pt3I26OthersC3Date", d.pay26date);
  P("txtPg1Pt3I26OthersC4Amount", num1702(num(d.pay26amt)));

  // ---------------------------------------------------------------- PAGE 2
  P("txtPg2TIN1", t.t1);
  P("txtPg2TIN2", t.t2);
  P("txtPg2TIN3", t.t3);
  P("txtPg2TIN4", t.branch3);
  G("txtBranchMaskP2", "00000");
  P("txtPg2RegisteredName", name); // RAW (not encoded) on pages 2-4

  // Part IV — Computation of Tax (items 27-56)
  P("txtPg2Pt4I27Sales", num1702(comp.i27));
  P("txtPg2Pt4I28LessSales", num1702(comp.i28));
  P("txtPg2Pt4I29NetSales", num1702(comp.i29));
  P("txtPg2Pt4I30LessCost", num1702(comp.i30));
  P("txtPg2Pt4I31GrossIncome", num1702(comp.i31));
  P("txtPg2Pt4I32AddOtherTaxable", num1702(comp.i32));
  P("txtPg2Pt4I33TotalGross", num1702(comp.i33));
  P("txtPg2Pt4I34OrdinaryAllowable", num1702(comp.i34));
  P("txtPg2Pt4I35SpecialAllowable", num1702(comp.i35));
  P("txtPg2Pt4I36Nolco", num1702(comp.i36));
  P("txtPg2Pt4I37TotalItemized", num1702(comp.i37));
  P("txtPg2Pt4I38OptionalStandard", num1702(comp.i38));
  P("txtPg2Pt4I39NetTaxable", num1702(comp.i39));
  P("Pg2Pt4I40IncomeTaxRate", `${comp.rate}%`);
  P("txtPg2Pt4I41IncomeTaxDue", num1702(comp.i41));
  P("txtPg2Pt4I42MinimumCorporate", num1702(comp.i42));
  P("txtPg2Pt4I43TotalIncomeTax", num1702(comp.i43));
  P("txtPg2Pt4I44ExcessCredits", num1702(comp.i44));
  P("txtPg2Pt4I45IncomeTaxPaymentUnderMCIT", num1702(comp.i45));
  P("txtPg2Pt4I46IncomeTaxUnderRegular", num1702(comp.i46));
  P("txtPg2Pt4I47ExcessMCIT", num1702(comp.i47));
  P("txtPg2Pt4I48CreditableTaxWithheldFromPrevious", num1702(comp.i48));
  P("txtPg2Pt4I49CreditableTaxWithheldFor4thQuarter", num1702(comp.i49));
  P("txtPg2Pt4I50ForeignTaxCredits", num1702(comp.i50));
  P("txtPg2Pt4I51TaxPaidInReturn", num1702(comp.i51));
  P("txtPg2Pt452SpecialTaxCredits", num1702(comp.i52));
  S("txtPg2Pt4I53C1", d.i53desc);
  P("txtPg2Pt4I53C2", num1702(comp.i53));
  S("txtPg2Pt4I54C1", d.i54desc);
  P("txtPg2Pt4I54C2", num1702(comp.i54));
  P("txtPg2Pt4I55TotalTaxCredits", num1702(comp.i55));
  P("txtPg2Pt4I56NetTax", num1702(comp.i56));
  // Part V — Tax Relief Availment (items 57-59).
  P("txtPg2Pt5I57SpecialAllowable", num1702(comp.i57));
  P("txtPg2Pt5I58AddSpecialTax", num1702(comp.i58));
  P("txtPg2Pt5I59TotalTax", num1702(comp.i59));

  // ---------------------------------------------------------------- PAGE 3
  // Schedule 1 (itemized deduction detail) + Schedule 2 (special allowable).
  // The app does not capture this line-item detail → emit "0"/empty.
  P("txtPg3TIN1", t.t1);
  P("txtPg3TIN2", t.t2);
  P("txtPg3TIN3", t.t3);
  P("txtPg3TIN4", t.branch3);
  G("txtBranchMaskP3", "00000");
  P("txtPg3RegisteredName", name);

  // Schedule I — Ordinary Allowable Itemized Deductions (items 1-16, 17a-17i).
  const sc1 = (key: string, field: string) => P(key, num1702(num(d[field])));
  sc1("txtPg3Sc1I1Amortization", "s1_1");
  sc1("txtPg3Sc1I2BadDebts", "s1_2");
  sc1("txtPg3Sc1I3CharitableContributions", "s1_3");
  sc1("txtPg3Sc1I4Depletion", "s1_4");
  sc1("txtPg3Sc1I5Depreciation", "s1_5");
  sc1("txtPg3Sc1I6Entertainment", "s1_6");
  sc1("txtPg3Sc1I7FringeBenefits", "s1_7");
  sc1("txtPg3Sc1I8Interest", "s1_8");
  sc1("txtPg3Sc1I9Losses", "s1_9");
  sc1("txtPg3Sc1I10PensionTrust", "s1_10");
  sc1("txtPg3Sc1I11Rental", "s1_11");
  sc1("txtPg3Sc1I12Research", "s1_12");
  sc1("txtPg3Sc1I13Salaries", "s1_13");
  sc1("txtPg3Sc1I14Contributions", "s1_14");
  sc1("txtPg3Sc1I15TaxesandLicenses", "s1_15");
  sc1("txtPg3Sc1I16TransportationandTravel", "s1_16");
  sc1("txtPg3Sc1I17aJanitorial", "s1_17a");
  sc1("txtPg3Sc1I17bProfessionalFees", "s1_17b");
  sc1("txtPg3Sc1I17cSecurityServices", "s1_17c");
  for (const r of ["d", "e", "f", "g", "h", "i"]) {
    S(`txtPg3Sc1I17${r}C1`, d[`s1_17${r}desc`]);
    P(`txtPg3Sc1I17${r}C2`, num1702(num(d[`s1_17${r}`])));
  }
  P("txtPg3Sc1I18TotalOrdinaryAllowable", num1702(comp.sch1Total));
  // Schedule II — Special Allowable Itemized Deductions (rows 1-4: desc/legal/amt).
  for (let i = 1; i <= 4; i++) {
    S(`txtPg3Sc2I${i}C1`, d[`s2_${i}desc`]);
    S(`txtPg3Sc2I${i}C2`, d[`s2_${i}legal`]);
    P(`txtPg3Sc2I${i}C3`, num1702(num(d[`s2_${i}amt`])));
  }
  P("txtPg3Sc2I5TotalSpecialAllowable", num1702(comp.sch2Total));

  // ---------------------------------------------------------------- PAGE 4
  // Schedules 3 (NOLCO), 4 (Excess MCIT) and 5 (reconciliation) — detail
  // the app does not capture → "0"/empty.
  P("txtPg4TIN1", t.t1);
  P("txtPg4TIN2", t.t2);
  P("txtPg4TIN3", t.t3);
  P("txtPg4TIN4", t.branch3);
  G("txtBranchMaskP4", "00000");
  P("txtPg4RegisteredName", name);

  // Schedule III — NOLCO computation (gross income, ordinary deductions, net loss).
  P("txtPg4Sc3I1GrossIncome", num1702(comp.i33));
  P("txtPg4Sc3I2TotalDeductions", num1702(comp.i34));
  P("txtPg4Sc3I3NetOperatingLoss", num1702(comp.sch3NetLoss));
  // Schedule IIIA — Available NOLCO table (rows 4-7).
  //   C1=Year, C2=A Amount, C3=B Applied Prev, C4=C Expired, C5=D Applied Current,
  //   C6=E Net Operating Loss (Unapplied) = A − (B + C + D).
  for (let i = 4; i <= 7; i++) {
    S(`txtPg4Sc3AI${i}C1`, d[`nolco${i}Year`]);
    P(`txtPg4Sc3AI${i}C2`, num1702(num(d[`nolco${i}A`])));
    P(`txtPg4Sc3AI${i}C3`, num1702(num(d[`nolco${i}B`])));
  }
  for (let i = 4; i <= 7; i++) {
    P(`txtPg4Sc3AI${i}C4`, num1702(num(d[`nolco${i}C`])));
    P(`txtPg4Sc3AI${i}C5`, num1702(num(d[`nolco${i}D`])));
    P(
      `txtPg4Sc3AI${i}C6`,
      num1702(num(d[`nolco${i}A`]) - (num(d[`nolco${i}B`]) + num(d[`nolco${i}C`]) + num(d[`nolco${i}D`]))),
    );
  }
  P("txtPg4Sc4I8TotalNOLCO", num1702(comp.sch3aTotal));

  // Schedule IV — Excess MCIT (rows 1-3).
  //   C1=Year, C2=A Normal Income Tax, C3=B MCIT, C4=C Excess MCIT,
  //   C5=D Applied Prev, C6=E Expired, C7=F Applied Current,
  //   C8=G Balance = C − (D + E + F).
  for (let i = 1; i <= 3; i++) {
    S(`txtPg4Sc4I${i}C1`, d[`mcit${i}Year`]);
    P(`txtPg4Sc4I${i}C2`, num1702(num(d[`mcit${i}A`])));
    P(`txtPg4Sc4I${i}C3`, num1702(num(d[`mcit${i}B`])));
    P(`txtPg4Sc4I${i}C4`, num1702(num(d[`mcit${i}C`])));
  }
  for (let i = 1; i <= 3; i++) {
    P(`txtPg4Sc4I${i}C5`, num1702(num(d[`mcit${i}D`])));
    P(`txtPg4Sc4I${i}C6`, num1702(num(d[`mcit${i}E`])));
    P(`txtPg4Sc4I${i}C7`, num1702(num(d[`mcit${i}F`])));
    P(
      `txtPg4Sc4I${i}C8`,
      num1702(num(d[`mcit${i}C`]) - (num(d[`mcit${i}D`]) + num(d[`mcit${i}E`]) + num(d[`mcit${i}F`]))),
    );
  }
  P("txtPg4Sc4I4TotalExcessMCIT", num1702(comp.sch4Total));

  // Schedule V — reconciliation of net income per books vs taxable.
  P("txtPg4Sc5I1NetIncome", num1702(num(d.schV1)));
  for (let i = 2; i <= 3; i++) {
    S(`txtPg4Sc5I${i}C1`, d[`schV${i}desc`]);
    P(`txtPg4Sc5I${i}C2`, num1702(num(d[`schV${i}`])));
  }
  P("txtPg4Sc5I4Total", num1702(comp.schV4));
  for (let i = 5; i <= 8; i++) {
    S(`txtPg4Sc5I${i}C1`, d[`schV${i}desc`]);
    P(`txtPg4Sc5I${i}C2`, num1702(num(d[`schV${i}`])));
  }
  P("txtPg4Sc5I9Total", num1702(comp.schV9));
  P("txtPg4Sc5I10NetTaxableIncome", num1702(comp.schV10));

  // ---- counter / subtotal helper fields (UI controls; always "0") ----
  Z("txtPg2Pt4I54CtrModal");
  Z("txtPg3Sc1I17iCtrModal");
  Z("txtPg3Sc2I4CtrModal");
  Z("txtPg4Sc5I3CtrModal");
  Z("txtPg4Sc5I6CtrModal");
  Z("txtPg4Sc5I8CtrModal");
  P("txtCurrentPage", "1");
  P("txtMaxPage", "4");
  Z("txtPg4Sc3I3Subtotal");
  Z("txtPg4Sc4I4Subtotal");
  Z("txtPg3Sc1I17iSubtotal");
  Z("txtPg3Sc2I4Subtotal");
  Z("txtPg4Sc3AI7C2Subtotal");
  Z("txtPg4Sc3AI7C3Subtotal");
  Z("txtPg4Sc3AI7C4Subtotal");
  Z("txtPg4Sc3AI7C5Subtotal");
  Z("txtPg4Sc3AI7C6Subtotal");
  Z("txtPg2Pt4I54Subtotal");
  Z("txtPg4Sc5I3Subtotal");
  Z("txtPg4Sc5I6Subtotal");
  Z("txtPg4Sc5I8Subtotal");

  // ---- global tail fields ----
  G("driveSelectTPExport", "0");
  G("txtFinalFlag", filing.status === "filed" ? "1" : "0");
  G("txtEnroll", "Y");
  G("ebirOnlineConfirmUsername", "");
  G("ebirOnlineUsername", "");
  G("ebirOnlineSecret", "");

  // ---- assemble (CRLF + trailing TAB per div, 12-space lead, BIR 2014.0 tail) ----
  const lead = "            ";
  const trail = "\t\r";
  const sep = "\n";
  const head = "<?xml version='1.0'?>\t\r\n";
  const body = rows.map(([k, v]) => `${lead}<div>${k}=${v}${k}=</div>${trail}`).join(sep);
  const tail = `${lead}\t\r\n${lead}All Rights Reserved BIR 2014.0`;
  return `${head}${body}${sep}${tail}`;
}

/** eBIRForms filename: <tin><branch>1702RTv2018<mm><yyyy>.xml (annual, mm=12). */
export function fileName1702RT(filing: Filing, tp: Taxpayer | null): string {
  const t = tinParts(tp);
  const yr = parseYear((filing.data || {}).year);
  return `${t.t1}${t.t2}${t.t3}${t.branch3}1702RTv2018${yr.mm}${yr.yyyy}.xml`;
}

