// recurrence-plan.spec.ts — PA8 (D70): the pure rules of a recurring project: how far ahead each
// frequency makes its task, what the task is called, and which occurrences are still to make.
import {
  datesToGenerate,
  LEAD_DAYS,
  occurrenceLabel,
  occurrenceTitle,
  recurrenceProblems,
} from "./recurrence-plan";

describe("LEAD_DAYS", () => {
  it("1 day for Daily, 7 for Weekly, 14 for Bi-Weekly, 30 for the others", () => {
    expect(LEAD_DAYS).toEqual({
      DAILY: 1,
      WEEKLY: 7,
      BI_WEEKLY: 14,
      MONTHLY: 30,
      QUARTERLY: 30,
      ANNUALLY: 30,
    });
  });
});

describe("occurrenceLabel and occurrenceTitle", () => {
  it.each([
    ["DAILY", "2026-11-05", "5 November 2026"],
    ["WEEKLY", "2026-11-12", "Week of 12 November 2026"],
    ["BI_WEEKLY", "2026-11-12", "Fortnight of 12 November 2026"],
    ["MONTHLY", "2026-11-12", "November 2026"],
    ["MONTHLY", "2027-01-31", "January 2027"],
    ["QUARTERLY", "2026-08-15", "Q3 2026"],
    ["QUARTERLY", "2026-11-15", "Q4 2026"],
    ["QUARTERLY", "2027-02-15", "Q1 2027"],
    ["ANNUALLY", "2026-11-12", "2026"],
  ] as const)("%s on %s is %s", (frequency, date, label) => {
    expect(occurrenceLabel(frequency, date)).toBe(label);
  });
  it("the title is the project name, a colon and the label; no dashes of the long kind", () => {
    expect(occurrenceTitle("Encoding", "MONTHLY", "2026-11-12")).toBe("Encoding: November 2026");
    for (const f of ["DAILY", "WEEKLY", "BI_WEEKLY", "MONTHLY", "QUARTERLY", "ANNUALLY"] as const) {
      expect(occurrenceTitle("X", f, "2026-11-12")).not.toMatch(/[–—]/);
    }
  });
  it("a long name is cut so the title stays within 300 characters, keeping the label", () => {
    const t = occurrenceTitle("n".repeat(290), "WEEKLY", "2026-11-12");
    expect(t.length).toBeLessThanOrEqual(300);
    expect(t.endsWith(": Week of 12 November 2026")).toBe(true);
  });
  it("two occurrences of one schedule never share a title", () => {
    for (const f of ["DAILY", "WEEKLY", "BI_WEEKLY", "MONTHLY", "QUARTERLY", "ANNUALLY"] as const) {
      const dates = datesToGenerate({
        start: "2026-01-31",
        end: null,
        frequency: f,
        activeFrom: "2026-01-01",
        today: "2030-01-01",
      }).slice(0, 60);
      const titles = dates.map((d) => occurrenceTitle("P", f, d));
      expect(new Set(titles).size).toBe(titles.length);
    }
  });
});

describe("datesToGenerate", () => {
  const base = { end: null, activeFrom: "2026-11-11", today: "2026-11-11" } as const;
  it("makes an occurrence once it is within its lead time of today, today included", () => {
    expect(datesToGenerate({ ...base, start: "2026-11-11", frequency: "DAILY" })).toEqual([
      "2026-11-11",
      "2026-11-12",
    ]);
    expect(datesToGenerate({ ...base, start: "2026-11-11", frequency: "WEEKLY" })).toEqual([
      "2026-11-11",
      "2026-11-18",
    ]);
    expect(datesToGenerate({ ...base, start: "2026-11-11", frequency: "BI_WEEKLY" })).toEqual([
      "2026-11-11",
      "2026-11-25",
    ]);
    expect(datesToGenerate({ ...base, start: "2026-11-11", frequency: "MONTHLY" })).toEqual([
      "2026-11-11",
      "2026-12-11",
    ]);
    expect(datesToGenerate({ ...base, start: "2026-11-11", frequency: "QUARTERLY" })).toEqual([
      "2026-11-11",
    ]);
    expect(datesToGenerate({ ...base, start: "2026-11-11", frequency: "ANNUALLY" })).toEqual([
      "2026-11-11",
    ]);
  });
  it("one day further than the lead time is not made yet", () => {
    expect(datesToGenerate({ ...base, start: "2026-12-12", frequency: "MONTHLY" })).toEqual([]);
    expect(datesToGenerate({ ...base, start: "2026-12-11", frequency: "MONTHLY" })).toEqual([
      "2026-12-11",
    ]);
    expect(datesToGenerate({ ...base, start: "2026-11-19", frequency: "WEEKLY" })).toEqual([]);
    expect(datesToGenerate({ ...base, start: "2026-11-13", frequency: "DAILY" })).toEqual([]);
  });
  it("nothing before the day generation began, even when the start is long past", () => {
    const dates = datesToGenerate({
      start: "2020-01-01",
      end: null,
      frequency: "DAILY",
      activeFrom: "2026-11-09",
      today: "2026-11-11",
    });
    expect(dates).toEqual(["2026-11-09", "2026-11-10", "2026-11-11", "2026-11-12"]);
  });
  it("an end date is respected, and a schedule that has ended makes nothing", () => {
    expect(
      datesToGenerate({ ...base, start: "2026-11-11", end: "2026-11-11", frequency: "DAILY" }),
    ).toEqual(["2026-11-11"]);
    expect(
      datesToGenerate({ ...base, start: "2026-01-01", end: "2026-06-30", frequency: "DAILY" }),
    ).toEqual([]);
  });
  it("no activeFrom means today", () => {
    expect(
      datesToGenerate({ start: "2020-01-01", end: null, frequency: "DAILY", activeFrom: null, today: "2026-11-11" }),
    ).toEqual(["2026-11-11", "2026-11-12"]);
  });
});

describe("recurrenceProblems", () => {
  it("says what is wrong, in PC5's sentences, and nothing when the schedule is off", () => {
    expect(recurrenceProblems({ recurring: true, start: null, end: null, frequency: null })).toEqual([
      "Choose a start date for the recurring project.",
      "Choose how often the project repeats: Daily, Weekly, Bi-Weekly, Monthly, Quarterly or Annually.",
    ]);
    expect(recurrenceProblems({ recurring: false, start: null, end: null, frequency: "x" })).toEqual([]);
    expect(
      recurrenceProblems({ recurring: true, start: "2026-02-01", end: "2026-01-01", frequency: "MONTHLY" }),
    ).toEqual(["The end date cannot be before the start date."]);
    expect(
      recurrenceProblems({ recurring: true, start: "2026-02-01", end: null, frequency: "MONTHLY" }),
    ).toEqual([]);
  });
});
