// withholding.ts — the model behind the 0619-E, 1601-EQ and 1601-C editors (W17,
// Track A U17): periods, the draft's data keys, what a draft starts with, how the
// editors' state becomes the data the server saves and back, and the few sentences
// the web itself says. Every figure on these returns is typed or comes from the
// books; the web adds nothing up and recomputes no date — the server does both.

export type WithholdingForm = "0619E" | "1601EQ" | "1601C";

export const WITHHOLDING_FORMS: readonly WithholdingForm[] = ["0619E", "1601EQ", "1601C"];

export const isWithholdingForm = (form: string | undefined): form is WithholdingForm =>
  form === "0619E" || form === "1601EQ" || form === "1601C";

/** The three returns' names as the BIR prints them. */
export const FORM_NAME: Record<WithholdingForm, string> = {
  "0619E": "Monthly Remittance Form of Creditable Income Taxes Withheld (Expanded)",
  "1601EQ": "Quarterly Remittance Return of Creditable Income Taxes Withheld (Expanded)",
  "1601C": "Monthly Remittance Return of Income Taxes Withheld on Compensation",
};

/** The codes as the BIR writes them, and the line over each editor. */
export const FORM_TITLE: Record<WithholdingForm, { code: string; eyebrow: string }> = {
  "0619E": {
    code: "0619-E",
    eyebrow: "BIR Forms · Monthly Remittance of Expanded Withholding",
  },
  "1601EQ": {
    code: "1601-EQ",
    eyebrow: "BIR Forms · Quarterly Remittance of Expanded Withholding",
  },
  "1601C": {
    code: "1601-C",
    eyebrow: "BIR Forms · Monthly Remittance of Compensation Withholding",
  },
};

/** The two boxes of a Yes/No question. */
export const YES_NO: [string, string][] = [
  ["yes", "Yes"],
  ["no", "No"],
];

// --- sentences the web says itself -----------------------------------------------

/** Above the 1601-C: it has no books source. */
export const NO_PAYROLL_NOTE =
  "The Portal has no payroll records yet. Type the figures from your payroll.";

/** The form has six rows; the Portal never drops or merges an ATC (U17). */
export const ROWS_ON_THE_FORM = 6;
export const sixRowsSentence = (n: number): string => `${n} ATCs; the form has six rows.`;

/** Under the 0619-E's due date: the date is the server's default, weekends moved. */
export const DUE_DATE_NOTE =
  "A due date on a weekend moves to the Monday. Holidays are not considered.";

// --- periods -----------------------------------------------------------------------

export const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

export interface PeriodOption {
  value: string;
  label: string;
}

/**
 * What the New form period picker offers: the 0619-E the 1st and 2nd month of a
 * quarter only (the 3rd is reported on the 1601-EQ), the 1601-EQ the four quarters,
 * the 1601-C every month. Calendar months and quarters only.
 */
export function periodOptions(form: WithholdingForm): PeriodOption[] {
  if (form === "1601EQ") {
    return ["Q1", "Q2", "Q3", "Q4"].map((q) => ({ value: q, label: q }));
  }
  return MONTHS.map((name, i) => ({
    value: String(i + 1).padStart(2, "0"),
    label: name,
  })).filter((m) => form !== "0619E" || Number(m.value) % 3 !== 0);
}

/** The draft's period column: "2026-08" for a month, "2026-Q3" for a quarter. */
export function periodOf(form: WithholdingForm, year: string, sub: string): string {
  return `${year}-${sub}`;
}

/** The year and month ("08") or quarter ("Q3") a saved period names; null if it names none. */
export function splitPeriod(
  form: WithholdingForm,
  period: string,
): { year: string; sub: string } | null {
  const m =
    form === "1601EQ"
      ? /^(\d{4})-(Q[1-4])$/.exec(period)
      : /^(\d{4})-(0[1-9]|1[0-2])$/.exec(period);
  return m ? { year: m[1]!, sub: m[2]! } : null;
}

/** A quarter as the 1601-EQ's Item 2 words it. */
export const QUARTER_WORD: Record<string, string> = {
  Q1: "1st",
  Q2: "2nd",
  Q3: "3rd",
  Q4: "4th",
};

// --- the draft's data keys -----------------------------------------------------------

/** The boxes every one of the three returns shares: who files, who signs, how it was paid. */
const PAYMENT_ROWS = ["payCash", "payCheck", "payTaxDebit"] as const;
const PAYMENT_COLUMNS = ["Bank", "Number", "Date", "Amount"] as const;

export const SIGN_AND_PAY_KEYS: readonly string[] = [
  "signatoryName",
  "signatoryTitle",
  "signatoryTin",
  "taxAgentNo",
  "taxAgentIssueDate",
  "taxAgentExpiryDate",
  ...PAYMENT_ROWS.flatMap((r) => PAYMENT_COLUMNS.map((c) => `${r}${c}`)),
  "payOthersSpecify",
  "payOthersBank",
  "payOthersNumber",
  "payOthersDate",
  "payOthersAmount",
];

const PENALTY_KEYS = ["surcharge", "interest", "compromise"] as const;

/** The typed boxes of each return (the year, month or quarter and "amended" are not: they
 *  come from the period and from the draft's place in an amendment). */
export const VALUE_KEYS: Record<WithholdingForm, readonly string[]> = {
  "0619E": [
    "dueDate",
    "anyWithheld",
    "category",
    "contact",
    "email",
    "remittance",
    "previouslyRemitted",
    ...PENALTY_KEYS,
    ...SIGN_AND_PAY_KEYS,
  ],
  "1601EQ": [
    "anyWithheld",
    "sheetsAttached",
    "category",
    "contact",
    "email",
    "remittance1",
    "remittance2",
    "previouslyRemitted",
    "overRemittancePrior",
    "otherPayments",
    ...PENALTY_KEYS,
    "overRemittanceChoice",
    ...SIGN_AND_PAY_KEYS,
  ],
  "1601C": [
    "anyWithheld",
    "sheetsAttached",
    "category",
    "contact",
    "email",
    "reliefYesNo",
    "reliefSpecify",
    "compensation",
    "mwe",
    "holiday",
    "thirteenth",
    "deMinimis",
    "contributions",
    "otherNonTaxable",
    "otherNonTaxableSpecify",
    "notSubjectToWithholding",
    "taxesWithheld",
    "previouslyRemitted",
    "otherRemittances",
    "otherRemittancesSpecify",
    ...PENALTY_KEYS,
    ...SIGN_AND_PAY_KEYS,
  ],
};

/** The draft data keys the books can fill (U17: not the 1601-C). */
export const BOOK_KEYS: Record<"0619E" | "1601EQ", readonly string[]> = {
  "0619E": ["anyWithheld", "remittance"],
  "1601EQ": ["anyWithheld", "rows", "remittance1", "remittance2", "overRemittancePrior"],
};

/** The editor's words for a box the books give no line for (the dialog's `<label>:`). */
export const BOOK_LABELS: Record<"0619E" | "1601EQ", Record<string, string>> = {
  "0619E": { anyWithheld: "Any taxes withheld? (Item 4)" },
  "1601EQ": {
    anyWithheld: "Any taxes withheld? (Item 4)",
    remittance1: "Remittances made: 1st month of the quarter (Item 20)",
    remittance2: "Remittances made: 2nd month of the quarter (Item 21)",
    overRemittancePrior:
      "Over-remittance from previous quarter of the same taxable year (Item 23)",
  },
};

export type Values = Record<string, string>;

/** What a new draft starts with: empty boxes, a private withholding agent, no taxes
 *  withheld, and no tax relief. */
export function emptyValues(form: WithholdingForm): Values {
  const v: Values = {};
  for (const k of VALUE_KEYS[form]) v[k] = "";
  v.category = "private";
  v.anyWithheld = "no";
  if (form === "1601C") v.reliefYesNo = "no";
  return v;
}

// --- tables -------------------------------------------------------------------------

/** One row of the 1601-EQ's Part II (Items 13 to 18). `rate` is a percentage (2 or
 *  0.5), empty when the table has no rate for the ATC. */
export interface EqRow {
  atc: string;
  base: string;
  rate: string;
  withheld: string;
}
export const emptyEqRow = (): EqRow => ({ atc: "", base: "", rate: "", withheld: "" });

/** One row of the 1601-C's Schedule I. */
export interface ScheduleRow {
  /** The previous month, YYYY-MM. */
  month: string;
  datePaid: string;
  bank: string;
  number: string;
  taxPaid: string;
  shouldBe: string;
}
export const emptyScheduleRow = (): ScheduleRow => ({
  month: "",
  datePaid: "",
  bank: "",
  number: "",
  taxPaid: "",
  shouldBe: "",
});
/** Schedule I has three rows. */
export const emptySchedule = (): ScheduleRow[] => [
  emptyScheduleRow(),
  emptyScheduleRow(),
  emptyScheduleRow(),
];

// --- state <-> data -----------------------------------------------------------------

export interface DraftState {
  year: string;
  /** "08" for a month, "Q3" for a quarter. */
  sub: string;
  amended: "yes" | "no";
  values: Values;
  rows: EqRow[];
  schedule: ScheduleRow[];
}

const text = (v: unknown): string =>
  typeof v === "string" ? v : typeof v === "number" ? String(v) : "";

/** The data the server saves and computes from. The period decides year, month and
 *  quarter; the web never types them. */
export function buildData(form: WithholdingForm, s: DraftState): Record<string, unknown> {
  const data: Record<string, unknown> = { year: s.year };
  if (form === "1601EQ") data.quarter = QUARTER_WORD[s.sub] ?? "";
  else data.month = s.sub;
  data.amended = s.amended;
  for (const k of VALUE_KEYS[form]) data[k] = s.values[k] ?? "";
  if (form === "1601EQ") data.rows = s.rows.map((r) => ({ ...r }));
  if (form === "1601C") data.scheduleRows = s.schedule.map((r) => ({ ...r }));
  return data;
}

/** The editor's state from a saved draft. */
export function hydrate(
  form: WithholdingForm,
  data: Record<string, unknown>,
): Pick<DraftState, "values" | "rows" | "schedule"> {
  const values = emptyValues(form);
  for (const k of VALUE_KEYS[form]) if (data[k] != null) values[k] = text(data[k]);
  const rowsIn = Array.isArray(data.rows) ? (data.rows as Record<string, unknown>[]) : [];
  const rows: EqRow[] =
    form === "1601EQ"
      ? rowsIn.length > 0
        ? rowsIn.map((r) => ({
            atc: text(r.atc),
            base: text(r.base),
            rate: text(r.rate),
            withheld: text(r.withheld),
          }))
        : [emptyEqRow()]
      : [];
  const schedIn = Array.isArray(data.scheduleRows)
    ? (data.scheduleRows as Record<string, unknown>[])
    : [];
  const schedule = emptySchedule().map((blank, i) => {
    const r = schedIn[i];
    return r
      ? {
          month: text(r.month),
          datePaid: text(r.datePaid),
          bank: text(r.bank),
          number: text(r.number),
          taxPaid: text(r.taxPaid),
          shouldBe: text(r.shouldBe),
        }
      : blank;
  });
  return { values, rows, schedule };
}

// --- figures as a person reads them ---------------------------------------------------

/** An amount in pesos with a minus sign when it is below zero (Item 27 and the
 *  adjustments can legitimately be negative; nothing is clamped). */
export function signedPeso(n: number | null | undefined): string {
  const v = typeof n === "number" && Number.isFinite(n) ? n : 0;
  const abs = Math.abs(v).toLocaleString("en-PH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${v < 0 ? "-" : ""}₱${abs}`;
}
