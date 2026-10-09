// expenseStatus.ts — posted / held / needs-review for expense records (W5 R3).
//
// Records written before the expenses import through the API (Track A U6) carry
// no `status` at all. They were posted the day they were saved, so a missing
// status reads as "posted" here — never as held.

import type { ExpenseImportOutcome, PurchaseTxn } from "./api";

export type ExpenseStatusFilter = "all" | "posted" | "held" | "review";

export const EXPENSE_STATUS_FILTERS: { value: ExpenseStatusFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "posted", label: "Posted" },
  { value: "held", label: "Held" },
  { value: "review", label: "Needs review" },
];

type StatusFields = Pick<PurchaseTxn, "status" | "needsReview">;

/** Held: imported, waiting for a person to post it. Counts nowhere yet. */
export function isHeld(t: StatusFields): boolean {
  return t.status === "held";
}

/** Whether a record belongs under the chosen filter. */
export function matchesStatusFilter(
  t: StatusFields,
  filter: ExpenseStatusFilter,
): boolean {
  switch (filter) {
    case "posted":
      return !isHeld(t);
    case "held":
      return isHeld(t);
    case "review":
      return t.needsReview === true;
    default:
      return true;
  }
}

/** How many records an Expenses list shows: the list endpoint's default page. */
export const EXPENSE_LIST_LIMIT = 50;

/**
 * Query parameters the list endpoint is asked to filter by. R1 does not define
 * them, so the server may ignore them; that is why every page also filters the
 * rows it gets back with `matchesStatusFilter`. Proposed to Track A in W5.
 */
export function statusFilterParams(filter: ExpenseStatusFilter): Record<string, string> {
  if (filter === "posted") return { status: "posted" };
  if (filter === "held") return { status: "held" };
  if (filter === "review") return { needsReview: "true" };
  return {};
}

export interface ExpenseBadge {
  label: "Held" | "Needs review";
  variant: "warn" | "gold";
}

/** The badges a record shows on the Expenses page, in display order. */
export function expenseBadges(t: StatusFields): ExpenseBadge[] {
  const out: ExpenseBadge[] = [];
  if (isHeld(t)) out.push({ label: "Held", variant: "warn" });
  if (t.needsReview === true) out.push({ label: "Needs review", variant: "gold" });
  return out;
}

/** What an import row's outcome is called before (dry run) and after the import. */
export function outcomeLabel(outcome: ExpenseImportOutcome, final: boolean): string {
  if (outcome === "posted") return final ? "Posted" : "Will post";
  if (outcome === "held") return final ? "Held" : "Will be held";
  return "Rejected";
}
