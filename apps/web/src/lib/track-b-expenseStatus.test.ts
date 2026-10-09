// track-b-expenseStatus.test.ts — T5 (W5): the Expenses status filter and the
// Held / Needs review badges, as pure logic.

import { describe, expect, it } from "vitest";
import {
  EXPENSE_STATUS_FILTERS,
  expenseBadges,
  isHeld,
  matchesStatusFilter,
  statusFilterParams,
  type ExpenseStatusFilter,
} from "./expenseStatus";

/** Every combination the list can return. `legacy` is a record written before
 *  the import through the API existed: no status, no needsReview. */
const RECORDS = {
  legacy: {},
  posted: { status: "posted" as const, needsReview: false },
  postedReview: { status: "posted" as const, needsReview: true },
  held: { status: "held" as const, needsReview: false },
  heldReview: { status: "held" as const, needsReview: true },
};
type Key = keyof typeof RECORDS;

const shown = (filter: ExpenseStatusFilter): Key[] =>
  (Object.keys(RECORDS) as Key[]).filter((k) => matchesStatusFilter(RECORDS[k], filter));

describe("T5 the Expenses status filter", () => {
  it("offers All, Posted, Held and Needs review, in that order", () => {
    expect(EXPENSE_STATUS_FILTERS.map((f) => f.label)).toEqual([
      "All",
      "Posted",
      "Held",
      "Needs review",
    ]);
  });

  it("puts every record under exactly the filters it belongs to", () => {
    expect(shown("all")).toEqual([
      "legacy",
      "posted",
      "postedReview",
      "held",
      "heldReview",
    ]);
    expect(shown("posted")).toEqual(["legacy", "posted", "postedReview"]);
    expect(shown("held")).toEqual(["held", "heldReview"]);
    expect(shown("review")).toEqual(["postedReview", "heldReview"]);
  });

  it("never shows a held record under Posted, and reads no status as posted", () => {
    for (const k of Object.keys(RECORDS) as Key[]) {
      const r = RECORDS[k];
      expect(matchesStatusFilter(r, "posted") && matchesStatusFilter(r, "held")).toBe(
        false,
      );
    }
    expect(isHeld(RECORDS.legacy)).toBe(false);
  });

  it("asks the server with the matching query parameters", () => {
    expect(statusFilterParams("all")).toEqual({});
    expect(statusFilterParams("posted")).toEqual({ status: "posted" });
    expect(statusFilterParams("held")).toEqual({ status: "held" });
    expect(statusFilterParams("review")).toEqual({ needsReview: "true" });
  });
});

describe("T5 the Held and Needs review badges", () => {
  it("shows Held, then Needs review, and nothing on a plain posted record", () => {
    const labels = (k: Key) => expenseBadges(RECORDS[k]).map((b) => b.label);
    expect(labels("legacy")).toEqual([]);
    expect(labels("posted")).toEqual([]);
    expect(labels("postedReview")).toEqual(["Needs review"]);
    expect(labels("held")).toEqual(["Held"]);
    expect(labels("heldReview")).toEqual(["Held", "Needs review"]);
    expect(expenseBadges(RECORDS.heldReview).map((b) => b.variant)).toEqual([
      "warn",
      "gold",
    ]);
  });
});
