/**
 * withholding.ts — what is shared by the three withholding returns (U17, D57): BIR Form
 * 0619-E (months 1 and 2 of a quarter), BIR Form 1601-EQ (the quarter) and BIR Form
 * 1601-C (every month; compensation). Their periods, the sentences a person reads, the
 * six-row rule, and which clients are expected to file them.
 *
 * Withholding returns follow the calendar, never a client's fiscal year.
 */
import { compute1601EQ, ROWS_ON_THE_FORM } from "./engine/compute1601EQ";
import type { FilingData } from "./engine/types";

/** The returns this unit adds. All are printed; none has an eBIRForms XML. */
export const WITHHOLDING_FORMS: ReadonlySet<string> = new Set([
  "0619E",
  "1601EQ",
  "1601C",
]);

// --- every sentence a person reads ---------------------------------------------------
export const PRINTED_NOT_XML =
  "This form is printed; eBIRForms XML is not available for it.";
export const THIRD_MONTH_REFUSAL =
  "The third month of a quarter is reported on the 1601-EQ, not on a 0619-E.";
export const TYPED_1601C =
  "1601-C figures are typed; the Portal has no payroll records yet.";
export const badPeriodFor = (form: string) =>
  `That isn't a valid period for the ${form}.`;
export const sixRowsSentence = (n: number) => `${n} ATCs; the form has six rows.`;

const MONTH = /^(\d{4})-(0[1-9]|1[0-2])$/;
const QUARTER = /^(\d{4})-Q([1-4])$/;
/** The years a return's period may name (as the 2551Q and 2550Q feeders). */
const realYear = (y: string) => Number(y) >= 2000 && Number(y) <= 2100;

/**
 * Whether a draft's period fits its withholding return: a calendar month "2026-09" for
 * the 0619-E (not the 3rd month of a quarter: March, June, September, December) and the
 * 1601-C (every month), a calendar quarter "2026-Q3" for the 1601-EQ. Null when it
 * fits; otherwise the sentence to refuse it with. Any other form: null.
 */
export function checkWithholdingPeriod(form: string, period: string): string | null {
  if (!WITHHOLDING_FORMS.has(form)) return null;
  if (form === "1601EQ") {
    const q = QUARTER.exec(period);
    return q && realYear(q[1]!) ? null : badPeriodFor(form);
  }
  const m = MONTH.exec(period);
  if (!m || !realYear(m[1]!)) return badPeriodFor(form);
  if (form === "0619E" && Number(m[2]) % 3 === 0) return THIRD_MONTH_REFUSAL;
  return null;
}

/**
 * The 1601-EQ has six rows and the Portal never drops or merges an ATC: a draft that
 * uses more cannot be marked filed, previewed or copied. The sentence, or null.
 */
export function sixRowsRefusal(form: string, data: unknown): string | null {
  if (form !== "1601EQ") return null;
  const { rowCount } = compute1601EQ((data ?? {}) as FilingData);
  return rowCount > ROWS_ON_THE_FORM ? sixRowsSentence(rowCount) : null;
}

/**
 * Which withholding returns a client is expected to file, from its registered tax types
 * (Client.taxTypesJson, read from the certificate of registration): matched on the
 * TYPE, not the form. "Withholding Tax - Expanded" brings the 0619-E and the 1601-EQ;
 * "Withholding Tax - Compensation" brings the 1601-C. Nothing else is read, so the
 * seed's hyphenated form codes ("0619-E") and the unhyphenated ones never matter.
 */
export function registeredWithholding(taxTypesJson: unknown): {
  expanded: boolean;
  compensation: boolean;
} {
  let expanded = false;
  let compensation = false;
  if (Array.isArray(taxTypesJson)) {
    for (const row of taxTypesJson) {
      const type = (row as { type?: unknown } | null)?.type;
      if (typeof type !== "string") continue;
      const t = type.toLowerCase();
      if (!t.includes("withholding")) continue;
      if (t.includes("expanded")) expanded = true;
      if (t.includes("compensation")) compensation = true;
    }
  }
  return { expanded, compensation };
}
