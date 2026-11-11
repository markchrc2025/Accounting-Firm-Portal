import { describe, expect, it } from "vitest";
import {
  FREQUENCIES,
  FREQUENCY_LABELS,
  MAX_OCCURRENCES,
  RecurrenceError,
  addDays,
  isCalendarDate,
  isFrequency,
  nextOccurrences,
  occurrenceDate,
  occurrencesBetween,
  validateRecurrence,
  type Frequency,
} from "../src";
import { DASHES } from "./helpers";

const nth = (start: string, f: Frequency, count: number, from = 0): string[] =>
  Array.from({ length: count }, (_, i) => occurrenceDate(start, f, from + i));

describe("the frequencies", () => {
  it("are the six the owner named, with the words the form shows", () => {
    expect(FREQUENCIES).toEqual([
      "DAILY",
      "WEEKLY",
      "BI_WEEKLY",
      "MONTHLY",
      "QUARTERLY",
      "ANNUALLY",
    ]);
    expect(FREQUENCY_LABELS).toEqual({
      DAILY: "Daily",
      WEEKLY: "Weekly",
      BI_WEEKLY: "Bi-Weekly",
      MONTHLY: "Monthly",
      QUARTERLY: "Quarterly",
      ANNUALLY: "Annually",
    });
    expect(FREQUENCIES.every(isFrequency)).toBe(true);
    expect(isFrequency("Daily")).toBe(false);
    expect(isFrequency("daily")).toBe(false);
    expect(isFrequency(undefined)).toBe(false);
  });
});

describe("calendar dates", () => {
  it("accepts real dates and refuses the rest", () => {
    for (const ok of ["2026-11-11", "2028-02-29", "0001-01-01", "9999-12-31"])
      expect(isCalendarDate(ok), ok).toBe(true);
    for (const bad of [
      "2026-02-29",
      "2026-02-30",
      "2026-13-01",
      "2026-00-10",
      "2026-04-31",
      "2026-2-3",
      "26-02-03",
      "",
      "2026-11-11T00:00",
      " 2026-11-11",
      null,
      undefined,
      20261111,
    ]) {
      expect(isCalendarDate(bad), String(bad)).toBe(false);
    }
    expect(isCalendarDate("2100-02-29")).toBe(false); // 2100 is not a leap year
    expect(isCalendarDate("2000-02-29")).toBe(true);
  });

  it("adds days across month, year and leap days", () => {
    expect(addDays("2026-11-30", 1)).toBe("2026-12-01");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(addDays("2028-02-29", 1)).toBe("2028-03-01");
    expect(addDays("2026-02-28", 1)).toBe("2026-03-01");
    expect(addDays("2027-01-01", -1)).toBe("2026-12-31");
    expect(addDays("2026-11-11", 0)).toBe("2026-11-11");
  });

  it("agrees with the JavaScript calendar over 200 years", () => {
    for (let k = 0; k < 2000; k++) {
      const days = k * 37;
      const expected = new Date(Date.UTC(1950, 0, 1 + days)).toISOString().slice(0, 10);
      expect(addDays("1950-01-01", days)).toBe(expected);
    }
  });

  it("refuses a date outside years 1 to 9999, or a bad date, with a sentence", () => {
    expect(() => addDays("9999-12-31", 1)).toThrow(
      "That date is outside the years 0001 to 9999.",
    );
    expect(() => addDays("0001-01-01", -1)).toThrow(RecurrenceError);
    expect(() => addDays("2026-02-30", 1)).toThrow(
      "The date must be a real date written YYYY-MM-DD.",
    );
  });
});

describe("occurrenceDate: each frequency", () => {
  it("Daily adds n days", () => {
    expect(nth("2026-11-30", "DAILY", 4)).toEqual([
      "2026-11-30",
      "2026-12-01",
      "2026-12-02",
      "2026-12-03",
    ]);
    expect(nth("2028-02-27", "DAILY", 4)).toEqual([
      "2028-02-27",
      "2028-02-28",
      "2028-02-29",
      "2028-03-01",
    ]);
    expect(occurrenceDate("2026-01-01", "DAILY", 365)).toBe("2027-01-01");
    expect(occurrenceDate("2028-01-01", "DAILY", 366)).toBe("2029-01-01");
  });

  it("Weekly adds 7n days and keeps the weekday", () => {
    expect(nth("2026-11-11", "WEEKLY", 5)).toEqual([
      "2026-11-11",
      "2026-11-18",
      "2026-11-25",
      "2026-12-02",
      "2026-12-09",
    ]);
    for (let n = 0; n < 60; n++)
      expect(
        new Date(`${occurrenceDate("2026-11-11", "WEEKLY", n)}T00:00:00Z`).getUTCDay(),
      ).toBe(3);
  });

  it("Bi-Weekly adds 14n days", () => {
    expect(nth("2026-12-20", "BI_WEEKLY", 5)).toEqual([
      "2026-12-20",
      "2027-01-03",
      "2027-01-17",
      "2027-01-31",
      "2027-02-14",
    ]);
  });

  it("Monthly adds n months on the same day", () => {
    expect(nth("2026-01-15", "MONTHLY", 13)).toEqual([
      "2026-01-15",
      "2026-02-15",
      "2026-03-15",
      "2026-04-15",
      "2026-05-15",
      "2026-06-15",
      "2026-07-15",
      "2026-08-15",
      "2026-09-15",
      "2026-10-15",
      "2026-11-15",
      "2026-12-15",
      "2027-01-15",
    ]);
    expect(occurrenceDate("2026-11-11", "MONTHLY", 14)).toBe("2028-01-11");
  });

  it("Quarterly adds 3n months: the owner's example", () => {
    expect(occurrenceDate("2026-08-15", "QUARTERLY", 1)).toBe("2026-11-15");
    expect(nth("2026-08-15", "QUARTERLY", 5)).toEqual([
      "2026-08-15",
      "2026-11-15",
      "2027-02-15",
      "2027-05-15",
      "2027-08-15",
    ]);
  });

  it("Annually adds n years", () => {
    expect(nth("2026-08-15", "ANNUALLY", 4)).toEqual([
      "2026-08-15",
      "2027-08-15",
      "2028-08-15",
      "2029-08-15",
    ]);
  });

  it("n = 0 is the start for every frequency", () => {
    for (const f of FREQUENCIES)
      expect(occurrenceDate("2026-03-31", f, 0), f).toBe("2026-03-31");
  });
});

describe("occurrenceDate: month ends are anchored to the start day", () => {
  it("start on the 31st, a full year", () => {
    expect(nth("2026-01-31", "MONTHLY", 13)).toEqual([
      "2026-01-31",
      "2026-02-28",
      "2026-03-31",
      "2026-04-30",
      "2026-05-31",
      "2026-06-30",
      "2026-07-31",
      "2026-08-31",
      "2026-09-30",
      "2026-10-31",
      "2026-11-30",
      "2026-12-31",
      "2027-01-31",
    ]);
  });

  it("start on the 30th, a full year", () => {
    expect(nth("2026-01-30", "MONTHLY", 13)).toEqual([
      "2026-01-30",
      "2026-02-28",
      "2026-03-30",
      "2026-04-30",
      "2026-05-30",
      "2026-06-30",
      "2026-07-30",
      "2026-08-30",
      "2026-09-30",
      "2026-10-30",
      "2026-11-30",
      "2026-12-30",
      "2027-01-30",
    ]);
  });

  it("start on the 29th, a full year", () => {
    expect(nth("2026-01-29", "MONTHLY", 13)).toEqual([
      "2026-01-29",
      "2026-02-28",
      "2026-03-29",
      "2026-04-29",
      "2026-05-29",
      "2026-06-29",
      "2026-07-29",
      "2026-08-29",
      "2026-09-29",
      "2026-10-29",
      "2026-11-29",
      "2026-12-29",
      "2027-01-29",
    ]);
  });

  it("is not carried from the previous result: March is the 31st again, not the 28th", () => {
    expect(occurrenceDate("2026-01-31", "MONTHLY", 2)).toBe("2026-03-31");
    expect(occurrenceDate("2026-01-31", "MONTHLY", 3)).toBe("2026-04-30");
    expect(occurrenceDate("2026-01-31", "MONTHLY", 4)).toBe("2026-05-31");
  });

  it("leap year 2028: February has 29 days", () => {
    expect(nth("2028-01-31", "MONTHLY", 3)).toEqual([
      "2028-01-31",
      "2028-02-29",
      "2028-03-31",
    ]);
    expect(nth("2028-01-30", "MONTHLY", 3)).toEqual([
      "2028-01-30",
      "2028-02-29",
      "2028-03-30",
    ]);
    expect(nth("2028-01-29", "MONTHLY", 3)).toEqual([
      "2028-01-29",
      "2028-02-29",
      "2028-03-29",
    ]);
    expect(nth("2027-12-31", "MONTHLY", 3)).toEqual([
      "2027-12-31",
      "2028-01-31",
      "2028-02-29",
    ]);
  });

  it("quarterly from a month end", () => {
    expect(nth("2026-08-31", "QUARTERLY", 4)).toEqual([
      "2026-08-31",
      "2026-11-30",
      "2027-02-28",
      "2027-05-31",
    ]);
    expect(nth("2026-11-30", "QUARTERLY", 4)).toEqual([
      "2026-11-30",
      "2027-02-28",
      "2027-05-30",
      "2027-08-30",
    ]);
    expect(nth("2027-11-30", "QUARTERLY", 2)).toEqual(["2027-11-30", "2028-02-29"]);
  });

  it("Annually from February 29: the 29th in leap years, the 28th otherwise", () => {
    expect(nth("2024-02-29", "ANNUALLY", 9)).toEqual([
      "2024-02-29",
      "2025-02-28",
      "2026-02-28",
      "2027-02-28",
      "2028-02-29",
      "2029-02-28",
      "2030-02-28",
      "2031-02-28",
      "2032-02-29",
    ]);
    expect(occurrenceDate("2096-02-29", "ANNUALLY", 4)).toBe("2100-02-28"); // 2100 is not a leap year
    expect(occurrenceDate("2096-02-29", "ANNUALLY", 8)).toBe("2104-02-29");
    expect(occurrenceDate("2000-02-29", "ANNUALLY", 100)).toBe("2100-02-28");
  });

  it("Annually from the 31st of a month keeps the day", () => {
    expect(nth("2026-12-31", "ANNUALLY", 3)).toEqual([
      "2026-12-31",
      "2027-12-31",
      "2028-12-31",
    ]);
  });

  it("every occurrence is a real date, in order, for any start day of any month", () => {
    for (const f of ["MONTHLY", "QUARTERLY", "ANNUALLY"] as const) {
      for (let m = 1; m <= 12; m++) {
        for (const d of [1, 15, 28, 29, 30, 31]) {
          const day = String(
            Math.min(d, [4, 6, 9, 11].includes(m) ? 30 : m === 2 ? 29 : 31),
          ).padStart(2, "0");
          const start = `2028-${String(m).padStart(2, "0")}-${day}`;
          if (!isCalendarDate(start)) continue;
          let prev = "";
          for (let n = 0; n < 40; n++) {
            const date = occurrenceDate(start, f, n);
            expect(isCalendarDate(date), `${f} ${start} #${n} ${date}`).toBe(true);
            expect(date > prev, `${f} ${start} #${n}`).toBe(true);
            prev = date;
          }
        }
      }
    }
  });
});

describe("occurrenceDate: refusals", () => {
  it("refuses a bad start, frequency or number with a sentence", () => {
    expect(() => occurrenceDate("2026-02-30", "DAILY", 1)).toThrow(
      "The start date must be a real date written YYYY-MM-DD.",
    );
    expect(() => occurrenceDate("", "DAILY", 1)).toThrow(RecurrenceError);
    expect(() => occurrenceDate("2026-01-01", "HOURLY" as Frequency, 1)).toThrow(
      "The frequency must be one of Daily, Weekly, Bi-Weekly, Monthly, Quarterly or Annually.",
    );
    expect(() => occurrenceDate("2026-01-01", "Daily" as Frequency, 1)).toThrow(
      RecurrenceError,
    );
    expect(() => occurrenceDate("2026-01-01", "DAILY", -1)).toThrow(
      "The occurrence number must be a whole number, 0 or more.",
    );
    expect(() => occurrenceDate("2026-01-01", "DAILY", 1.5)).toThrow(RecurrenceError);
    expect(() => occurrenceDate("2026-01-01", "DAILY", Number.NaN)).toThrow(
      RecurrenceError,
    );
  });

  it("refuses a date past year 9999", () => {
    expect(() => occurrenceDate("9999-06-15", "ANNUALLY", 1)).toThrow(
      "outside the years 0001 to 9999",
    );
    expect(() => occurrenceDate("9999-12-30", "DAILY", 2)).toThrow(RecurrenceError);
  });
});

describe("occurrencesBetween", () => {
  it("lists the dates in a window, both ends included", () => {
    expect(
      occurrencesBetween("2026-08-15", "QUARTERLY", null, "2026-11-15", "2027-08-15"),
    ).toEqual(["2026-11-15", "2027-02-15", "2027-05-15", "2027-08-15"]);
    expect(
      occurrencesBetween("2026-11-11", "WEEKLY", null, "2026-11-18", "2026-12-02"),
    ).toEqual(["2026-11-18", "2026-11-25", "2026-12-02"]);
  });

  it("never lists a date before the start", () => {
    expect(
      occurrencesBetween("2026-11-11", "DAILY", null, "2026-11-01", "2026-11-13"),
    ).toEqual(["2026-11-11", "2026-11-12", "2026-11-13"]);
    expect(
      occurrencesBetween("2026-11-11", "DAILY", null, "2020-01-01", "2026-11-10"),
    ).toEqual([]);
  });

  it("an endless schedule (end null) runs as far as the window", () => {
    const dates = occurrencesBetween(
      "2026-01-01",
      "MONTHLY",
      null,
      "2030-01-01",
      "2030-12-31",
    );
    expect(dates).toHaveLength(12);
    expect(dates[0]).toBe("2030-01-01");
    expect(dates[11]).toBe("2030-12-01");
  });

  it("an ended schedule stops at its end, which is included when it is an occurrence", () => {
    expect(
      occurrencesBetween(
        "2026-01-31",
        "MONTHLY",
        "2026-04-30",
        "2026-01-01",
        "2026-12-31",
      ),
    ).toEqual(["2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30"]);
    expect(
      occurrencesBetween(
        "2026-01-31",
        "MONTHLY",
        "2026-04-29",
        "2026-01-01",
        "2026-12-31",
      ),
    ).toEqual(["2026-01-31", "2026-02-28", "2026-03-31"]);
    expect(
      occurrencesBetween(
        "2026-01-01",
        "WEEKLY",
        "2026-01-01",
        "2025-01-01",
        "2030-01-01",
      ),
    ).toEqual(["2026-01-01"]);
  });

  it("is empty after the end, before the start, for a window with none, and when from is after to", () => {
    expect(
      occurrencesBetween("2026-01-01", "DAILY", "2026-01-10", "2026-02-01", "2026-03-01"),
    ).toEqual([]);
    expect(
      occurrencesBetween("2026-01-31", "MONTHLY", null, "2026-02-01", "2026-02-27"),
    ).toEqual([]);
    expect(
      occurrencesBetween("2026-01-01", "DAILY", null, "2026-02-10", "2026-02-09"),
    ).toEqual([]);
  });

  it("finds a window far from the start without walking from the start", () => {
    expect(
      occurrencesBetween("2026-01-31", "MONTHLY", null, "2050-01-01", "2050-12-31"),
    ).toEqual([
      "2050-01-31",
      "2050-02-28",
      "2050-03-31",
      "2050-04-30",
      "2050-05-31",
      "2050-06-30",
      "2050-07-31",
      "2050-08-31",
      "2050-09-30",
      "2050-10-31",
      "2050-11-30",
      "2050-12-31",
    ]);
    expect(
      occurrencesBetween("2024-02-29", "ANNUALLY", null, "2100-01-01", "2100-12-31"),
    ).toEqual(["2100-02-28"]);
    expect(
      occurrencesBetween("2026-08-15", "QUARTERLY", null, "2027-01-01", "2027-12-31"),
    ).toEqual(["2027-02-15", "2027-05-15", "2027-08-15", "2027-11-15"]);
    expect(
      occurrencesBetween("2026-11-11", "BI_WEEKLY", null, "3000-01-01", "3000-02-15"),
    ).toEqual(["3000-01-01", "3000-01-15", "3000-01-29", "3000-02-12"]);
  });

  it("agrees with occurrenceDate for every frequency, start and window", () => {
    const starts = ["2026-01-31", "2028-02-29", "2026-11-11", "2026-12-31", "2027-03-30"];
    const windows: [string, string][] = [
      ["2026-01-01", "2027-01-01"],
      ["2027-06-15", "2029-03-01"],
      ["2026-12-31", "2026-12-31"],
      ["2031-02-28", "2031-03-31"],
    ];
    for (const f of FREQUENCIES) {
      for (const start of starts) {
        const all = nth(start, f, 3000);
        for (const [from, to] of windows) {
          const expected = all.filter((d) => d >= from && d <= to);
          expect(
            occurrencesBetween(start, f, null, from, to),
            `${f} ${start} ${from}..${to}`,
          ).toEqual(expected);
        }
      }
    }
  });

  it("1000 daily occurrences", () => {
    const dates = occurrencesBetween(
      "2026-01-01",
      "DAILY",
      null,
      "2026-01-01",
      "2028-09-26",
    );
    expect(dates).toHaveLength(1000);
    expect(dates[0]).toBe("2026-01-01");
    expect(dates[999]).toBe("2028-09-26");
    expect(dates[59]).toBe("2026-03-01");
    expect(dates[789]).toBe("2028-02-29");
    expect(new Set(dates).size).toBe(1000);
    for (let i = 1; i < dates.length; i++)
      expect(dates[i]).toBe(addDays(dates[i - 1]!, 1));
    expect(dates).toEqual(nth("2026-01-01", "DAILY", 1000));
    expect(nextOccurrences("2026-01-01", "DAILY", null, "2025-12-31", 1000)).toEqual(
      dates,
    );
  });

  it("holds at most the limit, and refuses a longer range with a sentence", () => {
    expect(MAX_OCCURRENCES).toBe(10_000);
    expect(
      occurrencesBetween("2026-01-01", "DAILY", null, "2026-01-01", "2053-05-18"),
    ).toHaveLength(10_000);
    expect(() =>
      occurrencesBetween("2026-01-01", "DAILY", null, "2026-01-01", "2053-05-19"),
    ).toThrow("That range holds more than 10000 dates. Use a shorter range.");
  });

  it("refuses bad input with a sentence", () => {
    expect(() =>
      occurrencesBetween("2026-02-30", "DAILY", null, "2026-01-01", "2026-02-01"),
    ).toThrow("start date");
    expect(() =>
      occurrencesBetween("2026-01-01", "DAILY", "2025-12-31", "2026-01-01", "2026-02-01"),
    ).toThrow("The end date cannot be before the start date.");
    expect(() =>
      occurrencesBetween("2026-01-01", "DAILY", "nope", "2026-01-01", "2026-02-01"),
    ).toThrow("end date");
    expect(() =>
      occurrencesBetween("2026-01-01", "DAILY", null, "x", "2026-02-01"),
    ).toThrow("from date");
    expect(() =>
      occurrencesBetween("2026-01-01", "DAILY", null, "2026-01-01", "x"),
    ).toThrow("to date");
    expect(() =>
      occurrencesBetween(
        "2026-01-01",
        "NEVER" as Frequency,
        null,
        "2026-01-01",
        "2026-02-01",
      ),
    ).toThrow("frequency");
  });

  it("stops cleanly at the last day of year 9999", () => {
    expect(
      occurrencesBetween("9999-12-29", "DAILY", null, "9999-12-01", "9999-12-31"),
    ).toEqual(["9999-12-29", "9999-12-30", "9999-12-31"]);
    expect(
      occurrencesBetween("9999-06-15", "ANNUALLY", null, "9999-01-01", "9999-12-31"),
    ).toEqual(["9999-06-15"]);
  });
});

describe("nextOccurrences", () => {
  it("the next 5 dates after a day, strictly after: the owner's quarterly example", () => {
    expect(nextOccurrences("2026-08-15", "QUARTERLY", null, "2026-11-11", 5)).toEqual([
      "2026-11-15",
      "2027-02-15",
      "2027-05-15",
      "2027-08-15",
      "2027-11-15",
    ]);
  });

  it("does not return the day itself when it is an occurrence", () => {
    expect(nextOccurrences("2026-08-15", "QUARTERLY", null, "2026-11-15", 2)).toEqual([
      "2027-02-15",
      "2027-05-15",
    ]);
    expect(nextOccurrences("2026-11-11", "DAILY", null, "2026-11-11", 2)).toEqual([
      "2026-11-12",
      "2026-11-13",
    ]);
  });

  it("after a day before the start, the start comes first", () => {
    expect(nextOccurrences("2026-12-01", "WEEKLY", null, "2026-11-11", 3)).toEqual([
      "2026-12-01",
      "2026-12-08",
      "2026-12-15",
    ]);
    expect(nextOccurrences("2026-12-01", "WEEKLY", null, "2026-12-01", 1)).toEqual([
      "2026-12-08",
    ]);
    expect(nextOccurrences("2026-12-01", "WEEKLY", null, "2026-11-30", 1)).toEqual([
      "2026-12-01",
    ]);
  });

  it("month ends: after the 28th of February comes the 31st of March", () => {
    expect(nextOccurrences("2026-01-31", "MONTHLY", null, "2026-02-28", 4)).toEqual([
      "2026-03-31",
      "2026-04-30",
      "2026-05-31",
      "2026-06-30",
    ]);
    expect(nextOccurrences("2026-01-31", "MONTHLY", null, "2026-01-31", 1)).toEqual([
      "2026-02-28",
    ]);
    expect(nextOccurrences("2027-12-31", "MONTHLY", null, "2028-01-31", 2)).toEqual([
      "2028-02-29",
      "2028-03-31",
    ]);
  });

  it("Feb 29 annually, in the 2028 leap year", () => {
    expect(nextOccurrences("2024-02-29", "ANNUALLY", null, "2026-03-01", 3)).toEqual([
      "2027-02-28",
      "2028-02-29",
      "2029-02-28",
    ]);
  });

  it("an ended schedule returns what is left, or nothing", () => {
    expect(nextOccurrences("2026-11-11", "DAILY", "2026-11-14", "2026-11-11", 5)).toEqual(
      ["2026-11-12", "2026-11-13", "2026-11-14"],
    );
    expect(nextOccurrences("2026-11-11", "DAILY", "2026-11-14", "2026-11-14", 5)).toEqual(
      [],
    );
    expect(nextOccurrences("2026-11-11", "DAILY", "2026-11-14", "2030-01-01", 5)).toEqual(
      [],
    );
    expect(
      nextOccurrences("2026-11-11", "WEEKLY", "2026-11-17", "2020-01-01", 5),
    ).toEqual(["2026-11-11"]);
  });

  it("count 0 is an empty list; an endless schedule always fills the count", () => {
    expect(nextOccurrences("2026-11-11", "DAILY", null, "2026-11-11", 0)).toEqual([]);
    expect(
      nextOccurrences("2026-11-11", "ANNUALLY", null, "2026-11-11", 20),
    ).toHaveLength(20);
  });

  it("agrees with occurrenceDate for every frequency", () => {
    for (const f of FREQUENCIES) {
      for (const start of ["2026-01-31", "2028-02-29", "2026-11-11"]) {
        const all = nth(start, f, 3000);
        for (const after of [
          "2020-01-01",
          start,
          "2026-12-31",
          "2028-02-29",
          "2030-06-15",
        ]) {
          expect(
            nextOccurrences(start, f, null, after, 5),
            `${f} ${start} after ${after}`,
          ).toEqual(all.filter((d) => d > after).slice(0, 5));
        }
      }
    }
  });

  it("stops at year 9999", () => {
    expect(nextOccurrences("9999-06-15", "ANNUALLY", null, "9999-06-14", 3)).toEqual([
      "9999-06-15",
    ]);
    expect(nextOccurrences("9999-06-15", "ANNUALLY", null, "9999-06-15", 3)).toEqual([]);
    expect(nextOccurrences("9999-12-30", "DAILY", null, "9999-12-30", 5)).toEqual([
      "9999-12-31",
    ]);
    expect(nextOccurrences("9999-12-30", "DAILY", null, "9999-12-31", 5)).toEqual([]);
  });

  it("refuses bad input with a sentence", () => {
    expect(() => nextOccurrences("2026-01-01", "DAILY", null, "2026-13-01", 5)).toThrow(
      "date to start after",
    );
    expect(() => nextOccurrences("2026-01-01", "DAILY", null, "2026-01-01", -1)).toThrow(
      "The number of dates must be a whole number, 0 or more.",
    );
    expect(() => nextOccurrences("2026-01-01", "DAILY", null, "2026-01-01", 2.5)).toThrow(
      RecurrenceError,
    );
    expect(() =>
      nextOccurrences("2026-01-01", "DAILY", null, "2026-01-01", MAX_OCCURRENCES + 1),
    ).toThrow("more than 10000 dates");
    expect(() =>
      nextOccurrences("2026-01-02", "DAILY", "2026-01-01", "2026-01-01", 5),
    ).toThrow("The end date cannot be before the start date.");
  });
});

describe("validateRecurrence", () => {
  const ok = { start: "2026-08-15", end: null, frequency: "QUARTERLY" };

  it("accepts a complete schedule, with or without an end", () => {
    expect(validateRecurrence(ok)).toEqual([]);
    expect(validateRecurrence({ ...ok, end: "2027-08-15" })).toEqual([]);
    expect(validateRecurrence({ ...ok, end: "2026-08-15" })).toEqual([]); // ends on the start day
    expect(validateRecurrence({ start: "2026-08-15", frequency: "DAILY" })).toEqual([]);
  });

  it("every frequency is accepted", () => {
    for (const f of FREQUENCIES)
      expect(validateRecurrence({ ...ok, frequency: f }), f).toEqual([]);
  });

  it("a blank end means endless", () => {
    for (const end of [null, undefined, "", "   "])
      expect(validateRecurrence({ ...ok, end }), String(end)).toEqual([]);
  });

  it("needs a start date", () => {
    for (const start of [null, undefined, "", "  "]) {
      expect(validateRecurrence({ ...ok, start }), String(start)).toEqual([
        "Choose a start date for the recurring project.",
      ]);
    }
  });

  it("refuses a start or end that is not a real date", () => {
    expect(validateRecurrence({ ...ok, start: "2026-02-30" })).toEqual([
      "The start date must be a real date written YYYY-MM-DD.",
    ]);
    expect(validateRecurrence({ ...ok, start: "15/08/2026" })).toEqual([
      "The start date must be a real date written YYYY-MM-DD.",
    ]);
    expect(validateRecurrence({ ...ok, end: "2027-13-01" })).toEqual([
      "The end date must be a real date written YYYY-MM-DD.",
    ]);
  });

  it("refuses an end before the start", () => {
    expect(validateRecurrence({ ...ok, end: "2026-08-14" })).toEqual([
      "The end date cannot be before the start date.",
    ]);
  });

  it("does not compare the end with a start that is missing or not a date", () => {
    expect(validateRecurrence({ ...ok, start: "", end: "2020-01-01" })).toEqual([
      "Choose a start date for the recurring project.",
    ]);
    expect(validateRecurrence({ ...ok, start: "nope", end: "2020-01-01" })).toEqual([
      "The start date must be a real date written YYYY-MM-DD.",
    ]);
  });

  it("needs one of the six frequencies", () => {
    expect(validateRecurrence({ ...ok, frequency: null })).toEqual([
      "Choose how often the project repeats: Daily, Weekly, Bi-Weekly, Monthly, Quarterly or Annually.",
    ]);
    expect(validateRecurrence({ ...ok, frequency: "" })).toHaveLength(1);
    expect(validateRecurrence({ start: "2026-08-15" })).toHaveLength(1);
    expect(validateRecurrence({ ...ok, frequency: "HOURLY" })).toEqual([
      '"HOURLY" is not a frequency. Choose Daily, Weekly, Bi-Weekly, Monthly, Quarterly or Annually.',
    ]);
    expect(validateRecurrence({ ...ok, frequency: "Daily" })).toHaveLength(1);
    expect(validateRecurrence({ ...ok, frequency: "daily" })).toHaveLength(1);
  });

  it("reports every problem, start first, then end, then frequency", () => {
    expect(validateRecurrence({ start: "", end: "2026-02-30", frequency: "x" })).toEqual([
      "Choose a start date for the recurring project.",
      "The end date must be a real date written YYYY-MM-DD.",
      '"x" is not a frequency. Choose Daily, Weekly, Bi-Weekly, Monthly, Quarterly or Annually.',
    ]);
    expect(validateRecurrence({})).toEqual([
      "Choose a start date for the recurring project.",
      "Choose how often the project repeats: Daily, Weekly, Bi-Weekly, Monthly, Quarterly or Annually.",
    ]);
  });

  it("checks nothing when the schedule is off", () => {
    expect(validateRecurrence({ recurring: false })).toEqual([]);
    expect(
      validateRecurrence({
        recurring: false,
        start: "nope",
        end: "nope",
        frequency: "nope",
      }),
    ).toEqual([]);
    expect(validateRecurrence({ recurring: true })).toHaveLength(2);
  });

  it("every sentence is plain text without a dash and ends with a full stop", () => {
    const all = [
      ...validateRecurrence({}),
      ...validateRecurrence({ start: "x", end: "y", frequency: "z" }),
      ...validateRecurrence({
        start: "2026-08-15",
        end: "2026-01-01",
        frequency: "DAILY",
      }),
    ];
    expect(all.length).toBeGreaterThanOrEqual(6);
    for (const s of all) {
      expect(s).not.toMatch(DASHES);
      expect(s.endsWith(".")).toBe(true);
    }
  });
});
