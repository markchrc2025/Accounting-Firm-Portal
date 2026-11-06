// bir-form-types.ts — U20 (D60): what the connector can draft, and how a period is named.
// The list is the Portal's own (AVAILABLE_FORMS and the catalogue); nothing is added here
// but how each form's period is read, whether its figures come from the books, and its
// due-date rule in words.
import { BIR_FORM_CATALOG } from "../../bir-forms/bir-forms.constants";
import { AVAILABLE_FORMS } from "../../bir-forms/bir-forms.service";
import { dueDateFor } from "../../bir-confirmation/return-timing";
import { dueDate1601C } from "../../bir-forms/engine/withholding-dates";
import { checkWithholdingPeriod } from "../../bir-forms/withholding";

export type PeriodKind = "month" | "quarter" | "year";

/** How each form's period is named. */
const PERIOD_KIND: Record<string, PeriodKind> = {
  "2551Q": "quarter",
  "2550Q": "quarter",
  "1701Q": "quarter",
  "1702Q": "quarter",
  "1601EQ": "quarter",
  "2307": "quarter",
  "0619E": "month",
  "1601C": "month",
  "1701": "year",
  "1701A": "year",
  "1702RT": "year",
  "2316": "year",
};

/** The forms whose figures the Portal fills from the client's posted records (GET book-figures). */
export const BOOKS_FED = new Set(["2551Q", "2550Q", "0619E", "1601EQ"]);

const DUE_RULE: Record<string, string> = {
  "2551Q":
    "The 25th of the month after the quarter ends; a Saturday or Sunday moves to Monday.",
  "2550Q":
    "The 25th of the month after the (fiscal) quarter ends; a Saturday or Sunday moves to Monday.",
  "0619E":
    "The 10th of the next month, for months 1 and 2 of a quarter; a weekend moves to Monday.",
  "1601EQ": "The last day of the month after the quarter; a weekend moves to Monday.",
  "1601C":
    "The 10th of the next month (December: 15 January); a weekend moves to Monday.",
};
const NO_DUE_RULE = "The Portal does not compute a due date for this form.";

export interface BirFormType {
  code: string;
  name: string;
  periodKind: PeriodKind;
  /** "books": filled from the client's posted records; "typed": the figures are typed. */
  figures: "books" | "typed";
  dueDateRule: string;
}

/** The forms the Portal can draft, in the catalogue's order. */
export function birFormTypes(): BirFormType[] {
  return BIR_FORM_CATALOG.filter((f) => AVAILABLE_FORMS.has(f.code)).map((f) => ({
    code: f.code,
    name: f.title,
    periodKind: PERIOD_KIND[f.code] ?? "year",
    figures: BOOKS_FED.has(f.code) ? ("books" as const) : ("typed" as const),
    dueDateRule: DUE_RULE[f.code] ?? NO_DUE_RULE,
  }));
}

export function periodKindOf(form: string): PeriodKind | null {
  return PERIOD_KIND[form] ?? null;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** The draft's period column from the tool's year (and quarter or month), or the sentence refusing it. */
export function periodFrom(
  form: string,
  input: { year: number; quarter?: number | undefined; month?: number | undefined },
): { period: string } | { error: string } {
  const kind = periodKindOf(form);
  if (!kind || !AVAILABLE_FORMS.has(form))
    return { error: `Form ${form} is not available yet.` };
  if (!Number.isInteger(input.year) || input.year < 2000 || input.year > 2100) {
    return { error: "The year must be between 2000 and 2100." };
  }
  let period: string;
  if (kind === "quarter") {
    if (input.month !== undefined)
      return {
        error: `The ${form} is filed for a quarter; give quarter (1 to 4), not month.`,
      };
    if (!Number.isInteger(input.quarter) || input.quarter! < 1 || input.quarter! > 4) {
      return { error: `The ${form} is filed for a quarter; give quarter (1 to 4).` };
    }
    period = `${input.year}-Q${input.quarter}`;
  } else if (kind === "month") {
    if (input.quarter !== undefined)
      return {
        error: `The ${form} is filed for a month; give month (1 to 12), not quarter.`,
      };
    if (!Number.isInteger(input.month) || input.month! < 1 || input.month! > 12) {
      return { error: `The ${form} is filed for a month; give month (1 to 12).` };
    }
    period = `${input.year}-${pad(input.month!)}`;
  } else {
    if (input.quarter !== undefined || input.month !== undefined) {
      return { error: `The ${form} is filed for a year; give year only.` };
    }
    period = String(input.year);
  }
  // The Portal's own refusal (the third month of a quarter is a 1601-EQ month, not a 0619-E).
  const refusal = checkWithholdingPeriod(form, period);
  return refusal ? { error: refusal } : { period };
}

/** The due date of a return (ISO), or null where the Portal has no rule. */
export function dueDateOf(
  form: string,
  period: string,
  fiscalYearStart: string | null,
): string | null {
  if (form === "1601C") {
    const m = /^(\d{4})-(\d{2})$/.exec(period);
    return m ? dueDate1601C(m[1]!, m[2]!) || null : null;
  }
  return dueDateFor(form, period, fiscalYearStart);
}

/** Whole days from `todayIso` to `dueIso` (negative once past). */
export function daysLeft(dueIso: string, todayIso: string): number {
  return Math.round(
    (Date.parse(`${dueIso}T00:00:00Z`) - Date.parse(`${todayIso}T00:00:00Z`)) /
      86_400_000,
  );
}
