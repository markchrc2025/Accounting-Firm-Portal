// due-rules.spec.ts — PA8 (D70): the owner-accepted due-date table, in one place, form by form.
// Dates were checked against a calendar (weekdays in the comments).
import { dueDateForReturn, periodsOfForm, RETURN_FORMS, WEEKEND_NOTE } from "./due-rules";

const FY_JULY = "2024-07-01"; // a fiscal year that starts in July and ends in June

describe("dueDateForReturn: calendar returns", () => {
  it.each([
    // 0619E: the 10th of the next month; months 1 and 2 of a quarter
    ["0619E", "2026-01", "2026-02-10"], // Tue
    ["0619E", "2026-02", "2026-03-10"], // Tue
    ["0619E", "2026-04", "2026-05-11"], // 10 May is a Sunday: Monday
    // 1601C: the 10th of the next month; December on 15 January
    ["1601C", "2026-03", "2026-04-10"], // Fri
    ["1601C", "2026-11", "2026-12-10"], // Thu
    ["1601C", "2026-12", "2027-01-15"], // Fri
    // 1601EQ: the last day of the month after the quarter
    ["1601EQ", "2026-Q1", "2026-04-30"], // Thu
    ["1601EQ", "2026-Q2", "2026-07-31"], // Fri
    ["1601EQ", "2026-Q3", "2026-11-02"], // 31 Oct is a Saturday
    ["1601EQ", "2026-Q4", "2027-02-01"], // 31 Jan is a Sunday
    // 2550Q and 2551Q: the 25th day after the quarter ends
    ["2550Q", "2026-Q1", "2026-04-27"], // 25 Apr is a Saturday
    ["2550Q", "2026-Q3", "2026-10-26"], // 25 Oct is a Sunday
    ["2550Q", "2026-Q4", "2027-01-25"], // Mon
    ["2551Q", "2026-Q2", "2026-07-27"], // 25 Jul is a Saturday
    // 1701Q: 15 May, 15 Aug, 15 Nov
    ["1701Q", "2026-Q1", "2026-05-15"], // Fri
    ["1701Q", "2026-Q2", "2026-08-17"], // 15 Aug is a Saturday
    ["1701Q", "2026-Q3", "2026-11-16"], // 15 Nov is a Sunday
    // 1702Q: 60 days after the quarter ends
    ["1702Q", "2026-Q1", "2026-06-01"], // 30 May is a Saturday
    ["1702Q", "2026-Q2", "2026-08-31"], // 29 Aug is a Saturday
    ["1702Q", "2026-Q3", "2026-11-30"], // 29 Nov is a Sunday
    // 1701 and 1701A: 15 April of the next year
    ["1701", "2025", "2026-04-15"], // Wed
    ["1701A", "2026", "2027-04-15"], // Thu
    // 1702RT: the 15th day of the 4th month after the year ends
    ["1702RT", "2025", "2026-04-15"], // Wed
    // 1604C and 2316: 31 January; 1604E: 1 March
    ["1604C", "2025", "2026-02-02"], // 31 Jan is a Saturday
    ["2316", "2025", "2026-02-02"],
    ["1604E", "2025", "2026-03-02"], // 1 Mar is a Sunday
    ["1604E", "2026", "2027-03-01"], // Mon
    // 2307: 20 days after the quarter
    ["2307", "2026-Q1", "2026-04-20"], // Mon
    ["2307", "2026-Q2", "2026-07-20"], // Mon
    ["2307", "2026-Q3", "2026-10-20"], // Tue
    ["2307", "2026-Q4", "2027-01-20"], // Wed
  ])("%s %s is due %s", (form, period, due) => {
    expect(dueDateForReturn(form, period, null)).toBe(due);
  });

  it("a calendar client with a January fiscal start is the same as one with none", () => {
    expect(dueDateForReturn("2550Q", "2026-Q1", "2024-01-01")).toBe("2026-04-27");
    expect(dueDateForReturn("1702RT", "2025", "2024-01-01")).toBe("2026-04-15");
  });
});

describe("dueDateForReturn: the client's fiscal year (2550Q, 1702Q, 1702RT only)", () => {
  // a year is named by the calendar year in which the fiscal year ends: FY2026 is Jul 2025 to Jun 2026
  it("1702RT is the 15th of the 4th month after the year ends", () => {
    expect(dueDateForReturn("1702RT", "2026", FY_JULY)).toBe("2026-10-15"); // Thu
  });
  it("1702Q is 60 days after the fiscal quarter ends", () => {
    expect(dueDateForReturn("1702Q", "2026-Q1", FY_JULY)).toBe("2025-12-01"); // Jul-Sep 2025, 29 Nov is a Saturday
    expect(dueDateForReturn("1702Q", "2026-Q2", FY_JULY)).toBe("2026-03-02"); // Oct-Dec 2025, 1 Mar is a Sunday
    expect(dueDateForReturn("1702Q", "2026-Q3", FY_JULY)).toBe("2026-06-01"); // Jan-Mar 2026, 30 May is a Saturday
  });
  it("2550Q is the 25th after the fiscal quarter ends", () => {
    expect(dueDateForReturn("2550Q", "2026-Q1", FY_JULY)).toBe("2025-10-27"); // 25 Oct 2025 is a Saturday
  });
  it("the withholding, percentage tax, 1701 and certificate returns ignore the fiscal year", () => {
    expect(dueDateForReturn("1601EQ", "2026-Q1", FY_JULY)).toBe("2026-04-30");
    expect(dueDateForReturn("2551Q", "2026-Q1", FY_JULY)).toBe("2026-04-27");
    expect(dueDateForReturn("1701", "2025", FY_JULY)).toBe("2026-04-15");
    expect(dueDateForReturn("2307", "2026-Q1", FY_JULY)).toBe("2026-04-20");
  });
});

describe("dueDateForReturn: what it refuses", () => {
  it.each([
    ["0619E", "2026-03"], // the third month of a quarter is the 1601EQ's
    ["0619E", "2026-Q1"],
    ["1601C", "2026"],
    ["1601EQ", "2026-01"],
    ["1701Q", "2026-Q4"], // Q4 is the annual return
    ["1702Q", "2026-Q4"],
    ["2550Q", "garbage"],
    ["9999", "2026"],
  ])("%s %s has no due date", (form, period) => {
    expect(dueDateForReturn(form, period, null)).toBeNull();
  });
});

describe("periodsOfForm", () => {
  it("lists a form's periods of one year", () => {
    expect(periodsOfForm("0619E", 2026)).toEqual([
      "2026-01",
      "2026-02",
      "2026-04",
      "2026-05",
      "2026-07",
      "2026-08",
      "2026-10",
      "2026-11",
    ]);
    expect(periodsOfForm("1601C", 2026)).toHaveLength(12);
    expect(periodsOfForm("1601EQ", 2026)).toEqual([
      "2026-Q1",
      "2026-Q2",
      "2026-Q3",
      "2026-Q4",
    ]);
    expect(periodsOfForm("1701Q", 2026)).toEqual(["2026-Q1", "2026-Q2", "2026-Q3"]);
    expect(periodsOfForm("1702Q", 2026)).toEqual(["2026-Q1", "2026-Q2", "2026-Q3"]);
    expect(periodsOfForm("1702RT", 2026)).toEqual(["2026"]);
    expect(periodsOfForm("nope", 2026)).toEqual([]);
  });
  it("every form the table knows has periods and a due date for each", () => {
    for (const form of RETURN_FORMS) {
      const periods = periodsOfForm(form, 2026);
      expect(periods.length).toBeGreaterThan(0);
      for (const p of periods)
        expect(dueDateForReturn(form, p, null)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });
  it("never lands on a Saturday or Sunday", () => {
    for (const form of RETURN_FORMS) {
      for (const year of [2024, 2025, 2026, 2027]) {
        for (const p of periodsOfForm(form, year)) {
          for (const fy of [null, FY_JULY]) {
            const due = dueDateForReturn(form, p, fy)!;
            const day = new Date(`${due}T00:00:00Z`).getUTCDay();
            expect([0, 6]).not.toContain(day);
          }
        }
      }
    }
  });
});

it("says plainly that holidays are not in the table", () => {
  expect(WEEKEND_NOTE).toBe(
    "A due date on a Saturday or Sunday moves to Monday. The Portal has no holiday table yet, so public holidays are not considered.",
  );
});
