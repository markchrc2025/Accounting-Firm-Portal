// withholding-print.ts — the 0619-E, 1601-EQ and 1601-C as the print engine reads them
// (C9, D57).
//
// These returns are printed, never exported: there is no eBIRForms XML for them (the
// server answers PRINTED_NOT_XML). This builds the rows @portal/bir-pdf prints on the BIR's
// own blank (the keys of packages/bir-pdf/maps/0619E-2018-01.json, 1601EQ-2019-01.json and
// 1601C-2018-01.json) from what the draft holds:
//
//   * the taxpayer block (TIN with branch, RDO, name, address, ZIP): the client's record
//     for a draft, the filing snapshot once filed (D12) — the caller passes the Taxpayer
//     (clientToTaxpayer) of whichever applies; the signature goes on the For Individual or
//     the For Non-Individual side by that taxpayer's `kind`;
//   * the period comes from the form's period column, which is the authority
//     (2026-08 or 2026-Q3), never from the typed year, month or quarter;
//   * every typed amount is passed through exactly as typed (the engine writes it in the
//     blank's peso and centavo boxes and refuses a third decimal; it never rounds); every
//     computed total is the exact figure the form's compute function reports, written to
//     the centavo;
//   * the ATC and tax type code the blanks pre-print (WME10 and WE on the 0619-E, WW010 on
//     the 1601-C) are not written.
//
// The blanks have no place for a minus sign: no sign box and no bracket box. A draft with a
// negative figure is refused, naming the first negative item (negativeAmountSentence); the
// editor, the compute and Mark as filed are not affected. The 1601-EQ is the exception the
// form is built for (C9b): Items 26 and 31 are labelled Tax Still Due/(Over-remittance), so an
// over-remittance is the figure in their boxes, printed as its absolute value, with no minus
// sign anywhere, and the filer ticks ONE of the three boxes under Item 31 (refunded, tax credit
// certificate, carried over). A draft with an over-remittance and no choice is refused
// (OVER_REMITTANCE_CHOICE_MISSING). Item 26 negative with Item 31 positive (penalties larger
// than the over-remittance) prints Item 26's absolute value, Item 31 as tax due, and ticks
// nothing.
//
// Pure. Refusals are ExportRefusal (the service answers 409 with the sentence).

import { compute0619E } from "./compute0619E";
import { compute1601C } from "./compute1601C";
import { compute1601EQ, ROWS_ON_THE_FORM } from "./compute1601EQ";
import { tin14, titleTinLine } from "./certificate2307";
import { contactNumberOf, emailOf } from "./contact-number";
import { dec } from "./exact";
import { ExportRefusal } from "./export-refusal";
import type { FilingData, Taxpayer } from "./types";
import { tinParts } from "./xmlkit";
import { sixRowsRefusal } from "../withholding";

export type WithholdingPrintForm = "0619E" | "1601EQ" | "1601C";

/** The form as the paper names it. */
const PAPER_NAME: Record<WithholdingPrintForm, string> = {
  "0619E": "0619-E",
  "1601EQ": "1601-EQ",
  "1601C": "1601-C",
};

/** The version of each blank (the CLEAR_COPY_VERSION entries). */
export const WITHHOLDING_PRINT_VERSION: Record<WithholdingPrintForm, string> = {
  "0619E": "2018-01",
  "1601EQ": "2019-01",
  "1601C": "2018-01",
};

/** The refusal for a draft that holds a negative figure; `where` is "Item 26" or "Schedule I row 2". */
export const negativeAmountSentence = (form: WithholdingPrintForm, where: string) =>
  `A negative amount cannot be printed on the ${PAPER_NAME[form]} yet: the BIR blank has no place for a minus sign. ${where} is negative.`;

/** The 1601-EQ with an over-remittance and none of the three boxes chosen (C9b). */
export const OVER_REMITTANCE_CHOICE_MISSING =
  "Choose what to do with the over-remittance: to be refunded, to be issued a Tax Credit Certificate, or to be carried over.";

type Rows = [string, string][];

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const digitsOf = (v: unknown) => String(v ?? "").replace(/\D/g, "");

/** Centavos as a plain amount, "1234.56" (the print engine adds nothing, it only places). */
function plain(n: number): string {
  const c = Math.round(n * 100);
  const sign = c < 0 ? "-" : "";
  const a = Math.abs(c);
  return `${sign}${Math.floor(a / 100)}.${String(a % 100).padStart(2, "0")}`;
}

/** MM/DD/YYYY from an ISO date; anything else as typed. */
function slashDate(v: unknown): string {
  const s = str(v);
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  return iso ? `${iso[2]}/${iso[3]}/${iso[1]}` : s;
}

/** The taxpayer's name as the form wants it: "LAST, FIRST MIDDLE" for an individual. */
function fullName(tp: Taxpayer): string {
  if (tp.kind === "individual") {
    return [tp.lastName, [tp.firstName, tp.middleName].filter(Boolean).join(" ")]
      .filter(Boolean)
      .join(", ");
  }
  return tp.regName || "";
}

/** The file name (without .pdf): the taxpayer's TIN and branch code, form, period. */
export function withholdingPrintBaseName(
  form: WithholdingPrintForm,
  period: string,
  tp: Taxpayer,
): string {
  const t = tinParts(tp);
  const prefix = digitsOf(tp.tin) ? `${t.t1}${t.t2}${t.t3}${t.branch3}-` : "";
  return `${prefix}${form}${period ? `-${period}` : ""}`;
}

/** A figure that may be negative, and the place the form names it. */
type Check = [where: string, negative: boolean];
const isNeg = (typed: unknown) => dec(typed).lt(0);
const isNegNum = (n: number) => n < 0;

function refuseFirstNegative(form: WithholdingPrintForm, checks: Check[]): void {
  const hit = checks.find(([, neg]) => neg);
  if (hit) throw new ExportRefusal(negativeAmountSentence(form, hit[0]));
}

/** The writer every form uses: `put` skips blanks; `typed`/`computed` write an amount. */
function writer(ns: string) {
  const out: Rows = [];
  const put = (k: string, v: unknown) => {
    const s = typeof v === "string" ? v.trim() : v == null ? "" : String(v);
    if (s !== "") out.push([`${ns}:${k}`, s]);
  };
  return {
    out,
    put,
    /** A typed amount, as typed. */
    typed: (k: string, v: unknown) => put(k, str(v)),
    /** A computed amount, to the centavo. */
    computed: (k: string, n: number) => put(k, plain(n)),
  };
}
type W = ReturnType<typeof writer>;

/** Items every one of the three returns shares, from the taxpayer block and the draft's own data. */
function common(w: W, form: WithholdingPrintForm, d: FilingData, tp: Taxpayer): void {
  const t = tinParts(tp);
  w.put("tin1", t.t1);
  w.put("tin2", t.t2);
  w.put("tin3", t.t3);
  w.put("branch", t.branch5);
  w.put("rdo", tp.rdo);
  w.put("name", fullName(tp));
  w.put("address", [tp.address, tp.city].filter(Boolean).join(", "));
  w.put("zip", tp.zip);
  // U21: the number typed in the draft, else the client's own; U24: the e-mail the same way.
  w.put("contact", contactNumberOf(form, d, tp.phone));
  w.put("email", emailOf(form, d, tp.email));
  const cat = str(d.category).toLowerCase();
  if (cat === "private") w.put("catPrivate", "true");
  if (cat === "government") w.put("catGovernment", "true");
}

/** Yes or No from the draft's data; `noByDefault`: anything but "yes" is No (a return is amended or not). */
function yesNo(w: W, base: string, v: unknown, noByDefault: boolean): void {
  const s = str(v).toLowerCase();
  if (s === "yes") w.put(`${base}Yes`, "true");
  else if (s === "no" || (noByDefault && s !== "yes")) w.put(`${base}No`, "true");
}

/** The signature area, the tax agent and the details of payment (Part III) — the same on all three. */
function signAndPay(w: W, d: FilingData, tp: Taxpayer): void {
  const side = tp.kind === "individual" ? "Ind" : "Non";
  w.put(`sig${side}Name`, d.signatoryName);
  w.put(`sig${side}TitleTin`, titleTinLine(d.signatoryTitle, d.signatoryTin));
  w.put("agentNo", d.taxAgentNo);
  w.put("agentIssue", slashDate(d.taxAgentIssueDate));
  w.put("agentExpiry", slashDate(d.taxAgentExpiryDate));
  for (const [row, key] of [
    ["payCash", "cash"],
    ["payCheck", "check"],
  ] as const) {
    w.put(`${key}Bank`, d[`${row}Bank`]);
    w.put(`${key}Number`, d[`${row}Number`]);
    w.put(`${key}Date`, slashDate(d[`${row}Date`]));
    w.typed(`${key}Amount`, d[`${row}Amount`]);
  }
  // The Tax Debit Memo row has no Drawee Bank/Agency box on the blank (it is greyed out):
  // payTaxDebitBank has no place on the paper and is not printed.
  w.put("debitNumber", d.payTaxDebitNumber);
  w.put("debitDate", slashDate(d.payTaxDebitDate));
  w.typed("debitAmount", d.payTaxDebitAmount);
  w.put("othersSpecify", d.payOthersSpecify);
  w.put("othersBank", d.payOthersBank);
  w.put("othersNumber", d.payOthersNumber);
  w.put("othersDate", slashDate(d.payOthersDate));
  w.typed("othersAmount", d.payOthersAmount);
}

/** The payment amounts, as the items the paper numbers them, in order. */
function paymentChecks(d: FilingData, items: [number, number, number, number]): Check[] {
  return [
    [`Item ${items[0]}`, isNeg(d.payCashAmount)],
    [`Item ${items[1]}`, isNeg(d.payCheckAmount)],
    [`Item ${items[2]}`, isNeg(d.payTaxDebitAmount)],
    [`Item ${items[3]}`, isNeg(d.payOthersAmount)],
  ];
}

/** A month period "2026-08" as MMYYYY; falls back on the typed year and month. */
function monthBoxes(period: string, d: FilingData): string {
  const m = /^(\d{4})-(\d{2})$/.exec(period);
  if (m) return `${m[2]}${m[1]}`;
  const mm = digitsOf(d.month).padStart(2, "0");
  const yy = digitsOf(d.year).slice(0, 4);
  return mm !== "00" && yy.length === 4 ? `${mm}${yy}` : "";
}

// ---- 0619-E -------------------------------------------------------------------------------

export function build0619EPrintRows(d: FilingData, tp: Taxpayer, period: string): Rows {
  // The month is the period's (the authority), so the default due date follows it too.
  const m = /^(\d{4})-(\d{2})$/.exec(period);
  const c = compute0619E(m ? { ...d, year: m[1]!, month: m[2]! } : d);
  refuseFirstNegative("0619E", [
    ["Item 14", isNeg(d.remittance)],
    ["Item 15", isNeg(d.previouslyRemitted)],
    ["Item 16", isNegNum(c.i16)],
    ["Item 17A", isNeg(d.surcharge)],
    ["Item 17B", isNeg(d.interest)],
    ["Item 17C", isNeg(d.compromise)],
    ["Item 17D", isNegNum(c.i17d)],
    ["Item 18", isNegNum(c.i18)],
    ...paymentChecks(d, [19, 20, 21, 22]),
  ]);
  const w = writer("f0619E");
  w.put("month", monthBoxes(period, d));
  // Item 2 is saved with a date even when none was typed (the server's default for the month).
  w.put("dueDate", slashDate(d.dueDate) || slashDate(c.defaultDueDate));
  yesNo(w, "amended", d.amended, true);
  yesNo(w, "any", d.anyWithheld, false);
  common(w, "0619E", d, tp);
  w.typed("i14", d.remittance);
  w.typed("i15", d.previouslyRemitted);
  w.computed("i16", c.i16);
  w.typed("i17a", d.surcharge);
  w.typed("i17b", d.interest);
  w.typed("i17c", d.compromise);
  w.computed("i17d", c.i17d);
  w.computed("i18", c.i18);
  signAndPay(w, d, tp);
  return w.out;
}

// ---- 1601-EQ ------------------------------------------------------------------------------

/** A rate typed as a percentage (2 or 0.5), printed with its percent sign. */
function rateText(v: unknown): string {
  const s = str(v).replace(/%$/, "").trim();
  return s === "" ? "" : `${s}%`;
}

export function build1601EQPrintRows(d: FilingData, tp: Taxpayer, period: string): Rows {
  // Six rows only; a seventh ATC is never dropped (the service answers this first, too).
  const tooMany = sixRowsRefusal("1601EQ", d);
  if (tooMany) throw new ExportRefusal(tooMany);
  // The period is the authority for the quarter, so the rule that clears a "carried" choice in
  // the 4th quarter (compute1601EQ) follows the period too.
  const pq = /^\d{4}-Q([1-4])$/.exec(period);
  const c = compute1601EQ(pq ? { ...d, quarter: pq[1]! } : d);
  const rows = (Array.isArray(d.rows) ? d.rows : []) as unknown as Array<
    Record<string, unknown>
  >;
  const used = rows.slice(0, ROWS_ON_THE_FORM);
  const checks: Check[] = [];
  used.forEach((r, i) => {
    checks.push([`Item ${13 + i}`, isNeg(r.base) || isNeg(r.withheld)]);
  });
  checks.push(
    ["Item 19", isNegNum(c.i19)],
    ["Item 20", isNeg(d.remittance1)],
    ["Item 21", isNeg(d.remittance2)],
    ["Item 22", isNeg(d.previouslyRemitted)],
    ["Item 23", isNeg(d.overRemittancePrior)],
    ["Item 24", isNeg(d.otherPayments)],
    ["Item 25", isNegNum(c.i25)],
    // Items 26 and 31 are not refused when negative: that is an over-remittance (C9b).
    ["Item 27", isNeg(d.surcharge)],
    ["Item 28", isNeg(d.interest)],
    ["Item 29", isNeg(d.compromise)],
    ["Item 30", isNegNum(c.i30)],
    ...paymentChecks(d, [32, 33, 34, 35]),
  );
  refuseFirstNegative("1601EQ", checks);
  // An over-remittance needs the box the filer chose; none, or a choice that does not apply (a
  // "carried" choice in the 4th quarter is already cleared by the compute), is refused.
  if (c.overRemittance && c.overRemittanceChoice === "")
    throw new ExportRefusal(OVER_REMITTANCE_CHOICE_MISSING);

  const w = writer("f1601EQ");
  const m = /^(\d{4})-Q([1-4])$/.exec(period);
  const year = m ? m[1]! : digitsOf(d.year).slice(0, 4);
  const quarter = m ? m[2]! : digitsOf(d.quarter).slice(0, 1);
  w.put("year", year);
  if (/^[1-4]$/.test(quarter)) w.put(`q${quarter}`, "true");
  yesNo(w, "amended", d.amended, true);
  yesNo(w, "any", d.anyWithheld, false);
  w.put("sheets", digitsOf(d.sheetsAttached));
  common(w, "1601EQ", d, tp);
  const p2 = tin14(tp.tin, tp.branch);
  w.put("p2Tin", p2);
  w.put("p2Name", fullName(tp));

  used.forEach((r, i) => {
    const n = i + 1;
    const hasRow = [r.atc, r.base, r.rate, r.withheld].some((v) => str(v) !== "");
    if (!hasRow) return;
    w.put(`r${n}Atc`, r.atc);
    w.typed(`r${n}Base`, r.base);
    w.put(`r${n}Rate`, rateText(r.rate));
    w.typed(`r${n}Withheld`, r.withheld);
  });
  w.computed("i19", c.i19);
  w.typed("i20", d.remittance1);
  w.typed("i21", d.remittance2);
  w.typed("i22", d.previouslyRemitted);
  w.typed("i23", d.overRemittancePrior);
  w.typed("i24", d.otherPayments);
  w.computed("i25", c.i25);
  // An over-remittance is the figure in the boxes: its absolute value, never a minus sign.
  w.computed("i26", Math.abs(c.i26));
  w.typed("i27", d.surcharge);
  w.typed("i28", d.interest);
  w.typed("i29", d.compromise);
  w.computed("i30", c.i30);
  w.computed("i31", Math.abs(c.i31));
  // Only an over-remittance (Item 31 negative) ticks one of the three boxes.
  if (c.overRemittance) {
    const box = {
      refunded: "overRefunded",
      tcc: "overTcc",
      carried: "overCarried",
    } as const;
    w.put(box[c.overRemittanceChoice as "refunded" | "tcc" | "carried"], "true");
  }
  signAndPay(w, d, tp);
  return w.out;
}

// ---- 1601-C -------------------------------------------------------------------------------

export function build1601CPrintRows(d: FilingData, tp: Taxpayer, period: string): Rows {
  const c = compute1601C(d);
  const sched = (Array.isArray(d.scheduleRows) ? d.scheduleRows : []) as unknown as Array<
    Record<string, unknown>
  >;
  const sRows = [0, 1, 2].map((i) => sched[i] ?? {});
  const partII: Check[] = [
    ["Item 14", isNeg(d.compensation)],
    ["Item 15", isNeg(d.mwe)],
    ["Item 16", isNeg(d.holiday)],
    ["Item 17", isNeg(d.thirteenth)],
    ["Item 18", isNeg(d.deMinimis)],
    ["Item 19", isNeg(d.contributions)],
    ["Item 20", isNeg(d.otherNonTaxable)],
    ["Item 21", isNegNum(c.i21)],
    ["Item 22", isNegNum(c.i22)],
    ["Item 23", isNeg(d.notSubjectToWithholding)],
    ["Item 24", isNegNum(c.i24)],
    ["Item 25", isNeg(d.taxesWithheld)],
    ["Item 26", isNegNum(c.i26)],
    ["Item 27", isNegNum(c.i27)],
    ["Item 28", isNeg(d.previouslyRemitted)],
    ["Item 29", isNeg(d.otherRemittances)],
    ["Item 30", isNegNum(c.i30)],
    ["Item 31", isNegNum(c.i31)],
    ["Item 32", isNeg(d.surcharge)],
    ["Item 33", isNeg(d.interest)],
    ["Item 34", isNeg(d.compromise)],
    ["Item 35", isNegNum(c.i35)],
    ["Item 36", isNegNum(c.i36)],
  ];
  const schedule: Check[] = sRows.map((r, i) => [
    `Schedule I row ${i + 1}`,
    isNeg(r.taxPaid) || isNeg(r.shouldBe) || isNegNum(c.adjustments[i]!),
  ]);
  refuseFirstNegative("1601C", [
    ...partII,
    ...paymentChecks(d, [37, 38, 39, 40]),
    ...schedule,
    ["Schedule I Item 4", isNegNum(c.scheduleTotal)],
  ]);

  const w = writer("f1601C");
  w.put("month", monthBoxes(period, d));
  yesNo(w, "amended", d.amended, true);
  yesNo(w, "any", d.anyWithheld, false);
  w.put("sheets", digitsOf(d.sheetsAttached));
  common(w, "1601C", d, tp);
  yesNo(w, "relief", d.reliefYesNo, false);
  w.put("reliefSpecify", d.reliefSpecify);
  w.put("p2Tin", tin14(tp.tin, tp.branch));
  w.put("p2Name", fullName(tp));

  w.typed("i14", d.compensation);
  w.typed("i15", d.mwe);
  w.typed("i16", d.holiday);
  w.typed("i17", d.thirteenth);
  w.typed("i18", d.deMinimis);
  w.typed("i19", d.contributions);
  w.typed("i20", d.otherNonTaxable);
  w.put("i20Specify", d.otherNonTaxableSpecify);
  w.computed("i21", c.i21);
  w.computed("i22", c.i22);
  w.typed("i23", d.notSubjectToWithholding);
  w.computed("i24", c.i24);
  w.typed("i25", d.taxesWithheld);
  w.computed("i26", c.i26);
  w.computed("i27", c.i27);
  w.typed("i28", d.previouslyRemitted);
  w.typed("i29", d.otherRemittances);
  w.put("i29Specify", d.otherRemittancesSpecify);
  w.computed("i30", c.i30);
  w.computed("i31", c.i31);
  w.typed("i32", d.surcharge);
  w.typed("i33", d.interest);
  w.typed("i34", d.compromise);
  w.computed("i35", c.i35);
  w.computed("i36", c.i36);
  signAndPay(w, d, tp);

  // Part IV, Schedule I: a row is printed when it holds anything; the total, when any row does.
  let any = false;
  sRows.forEach((r, i) => {
    const n = i + 1;
    const has = ["month", "datePaid", "bank", "number", "taxPaid", "shouldBe"].some(
      (k) => str(r[k]) !== "",
    );
    if (!has) return;
    any = true;
    const mm = /^(\d{4})-(\d{2})$/.exec(str(r.month));
    w.put(`s${n}Month`, mm ? `${mm[2]}${mm[1]}` : str(r.month));
    w.put(`s${n}DatePaid`, slashDate(r.datePaid));
    w.put(`s${n}Bank`, r.bank);
    w.put(`s${n}Number`, r.number);
    w.typed(`s${n}TaxPaid`, r.taxPaid);
    w.typed(`s${n}ShouldBe`, r.shouldBe);
    w.computed(`s${n}Adjustment`, c.adjustments[i]!);
  });
  if (any) w.computed("sTotal", c.scheduleTotal);
  return w.out;
}

/** The rows of whichever of the three forms this is. */
export function buildWithholdingPrintRows(
  form: WithholdingPrintForm,
  d: FilingData,
  tp: Taxpayer,
  period: string,
): Rows {
  switch (form) {
    case "0619E":
      return build0619EPrintRows(d, tp, period);
    case "1601EQ":
      return build1601EQPrintRows(d, tp, period);
    case "1601C":
      return build1601CPrintRows(d, tp, period);
  }
}
