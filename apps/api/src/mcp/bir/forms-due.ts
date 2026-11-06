// forms-due.ts — U20b (D61): which returns a client must file, and which are due soon or late.
// From the client's registered tax types (the withholding rows decide by type, as the
// dashboard does) and its business-tax regime, with the filing calendar the Portal already
// has. A return with no due-date rule in the Portal (the income-tax returns) cannot be
// listed by date, and the answer says so.
import { registeredWithholding } from "../../bir-forms/withholding";
import { daysLeft, dueDateOf } from "./bir-form-types";
import { periodsOf, periodWords } from "./default-period";

/** How far ahead "coming" looks, and how far back an unfiled period is still called overdue. */
export const COMING_DAYS = 45;
export const OVERDUE_LOOKBACK_DAYS = 365;

export interface FormsDueClient {
  taxType: string | null;
  taxTypesJson: unknown;
  fiscalYearStart: string | null;
}

/** The forms the Portal can tell this client must file by date. */
export function formsFor(c: Pick<FormsDueClient, "taxType" | "taxTypesJson">): string[] {
  const forms: string[] = [];
  if (c.taxType === "VAT") forms.push("2550Q");
  if (c.taxType === "PERCENTAGE") forms.push("2551Q");
  const w = registeredWithholding(c.taxTypesJson);
  if (w.expanded) forms.push("0619E", "1601EQ");
  if (w.compensation) forms.push("1601C");
  return forms;
}

export interface ExistingReturns {
  draft: { id: string } | null;
  filed: { id: string } | null;
}

export interface DueItem {
  form: string;
  period: string;
  periodWords: string;
  dueDate: string;
  status: "due" | "overdue";
  daysLeft: number | null;
  daysLate: number | null;
  existing: ExistingReturns;
}

const addDays = (iso: string, n: number) =>
  new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

export function dueItems(
  c: FormsDueClient,
  today: string,
  lookup: (form: string, period: string) => ExistingReturns,
): { items: DueItem[]; notes: string[] } {
  const items: DueItem[] = [];
  const horizon = addDays(today, COMING_DAYS);
  const floor = addDays(today, -OVERDUE_LOOKBACK_DAYS);
  const year = Number(today.slice(0, 4));
  for (const form of formsFor(c)) {
    for (const period of periodsOf(form, year - 2, year + 1)) {
      const due = dueDateOf(form, period, c.fiscalYearStart);
      if (!due || due > horizon || due < floor) continue;
      const existing = lookup(form, period);
      if (existing.filed) continue; // filed: nothing to do
      const left = daysLeft(due, today);
      items.push({
        form,
        period,
        periodWords: periodWords(period),
        dueDate: due,
        status: left < 0 ? "overdue" : "due",
        daysLeft: left >= 0 ? left : null,
        daysLate: left < 0 ? -left : null,
        existing,
      });
    }
  }
  items.sort(
    (a, b) => a.dueDate.localeCompare(b.dueDate) || a.form.localeCompare(b.form),
  );
  const notes = [
    `Lists what is due in the next ${COMING_DAYS} days and what was due in the last ${OVERDUE_LOOKBACK_DAYS / 365} year and has no filed return in the Portal (a return filed outside the Portal shows as overdue).`,
    "The Portal has no due-date rule for the income-tax returns (1701, 1701A, 1701Q, 1702Q, 1702RT), so they are not listed here; ask the owner which period.",
  ];
  return { items, notes };
}
