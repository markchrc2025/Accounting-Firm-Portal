// due-rules.ts — PA8 (D70): when each BIR return is due. The owner-accepted table, in ONE place.
//
// The three withholding rules (0619E, 1601C, 1601EQ) already lived in engine/withholding-dates.ts
// and stay there (the editor and the dashboard use them); this file calls them and adds the rest,
// so every rule is written once. A due date on a Saturday or Sunday moves to Monday; the Portal has
// no holiday table, and says so (WEEKEND_NOTE).
//
//   0619E   10th of the next month (months 1 and 2 of a quarter)
//   1601C   10th of the next month; December on 15 January
//   1601EQ  last day of the month after the quarter
//   2550Q   25th day after the quarter ends (the client's fiscal year)
//   2551Q   25th day after the quarter ends
//   1701Q   15 May, 15 Aug, 15 Nov
//   1702Q   60 days after the quarter ends (the client's fiscal year)
//   1701, 1701A  15 April of the next year
//   1702RT  15th day of the 4th month after the year ends (the client's fiscal year)
//   1604C, 2316  31 January of the next year;  1604E  1 March of the next year
//   2307    20 days after the quarter
//
// A year period ("2025") is the tax year; for a fiscal-year client it is the calendar year in which
// the fiscal year ends, and a quarter "2026-Q1" is the first quarter of that fiscal year (the
// convention the 2550Q has always had here).
import {
  dueDate0619E,
  dueDate1601C,
  dueDate1601EQ,
  moveOffWeekend,
} from "../engine/withholding-dates";

export const WEEKEND_NOTE =
  "A due date on a Saturday or Sunday moves to Monday. The Portal has no holiday table yet, so public holidays are not considered.";

const p2 = (n: number) => String(n).padStart(2, "0");

/** The last day of a month, "2026-03-31". */
export function lastDayOf(year: number, month: number): string {
  return `${year}-${p2(month)}-${p2(new Date(Date.UTC(year, month, 0)).getUTCDate())}`;
}

/** The month a fiscal year starts in (1 to 12) from the client's fiscalYearStart; 1 for none. */
export function fiscalStartMonth(fiscalYearStart: string | null): number {
  const m = fiscalYearStart ? Number(fiscalYearStart.slice(5, 7)) : 1;
  return Number.isInteger(m) && m >= 1 && m <= 12 ? m : 1;
}

/**
 * The last day of quarter `quarter` of the year named `year`. A fiscal year that starts after
 * January is named by the year it ends in, so it began the year before.
 */
export function quarterEndDate(
  year: number,
  quarter: number,
  startMonth: number,
): string {
  let m0 = startMonth + 3 * (quarter - 1);
  let y0 = startMonth === 1 ? year : year - 1;
  if (m0 > 12) {
    m0 -= 12;
    y0 += 1;
  }
  let m1 = m0 + 2;
  let y1 = y0;
  if (m1 > 12) {
    m1 -= 12;
    y1 += 1;
  }
  return lastDayOf(y1, m1);
}

const addDays = (iso: string, n: number) =>
  new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

const MONTH = /^(\d{4})-(0[1-9]|1[0-2])$/;
const QUARTER = /^(\d{4})-Q([1-4])$/;
const YEAR = /^(\d{4})$/;
const inRange = (y: number) => y >= 2000 && y <= 2100;

function month(period: string): { y: number; m: number } | null {
  const r = MONTH.exec(period);
  return r && inRange(Number(r[1])) ? { y: Number(r[1]), m: Number(r[2]) } : null;
}
function quarter(period: string): { y: number; q: number } | null {
  const r = QUARTER.exec(period);
  return r && inRange(Number(r[1])) ? { y: Number(r[1]), q: Number(r[2]) } : null;
}
function year(period: string): number | null {
  const r = YEAR.exec(period);
  return r && inRange(Number(r[1])) ? Number(r[1]) : null;
}

type Kind = "month" | "quarter" | "year";
interface Rule {
  kind: Kind;
  title: string;
  /** The periods of a year, "2026-02", "2026-Q3" or "2026". */
  periods: (year: number) => string[];
  /** The unmoved due date of a period, or null when the period does not belong to the form. */
  due: (period: string, startMonth: number) => string | null;
  /** Whether the client's fiscal year decides this return. */
  fiscal?: true;
}

const months = (y: number, keep: (m: number) => boolean = () => true) =>
  Array.from({ length: 12 }, (_, i) => i + 1)
    .filter(keep)
    .map((m) => `${y}-${p2(m)}`);
const quarters = (y: number, n = 4) =>
  Array.from({ length: n }, (_, i) => `${y}-Q${i + 1}`);

/** Quarter end plus days, for the returns due a number of days after the quarter. */
const afterQuarter =
  (days: number, fiscal: boolean, maxQuarter = 4) =>
  (period: string, start: number) => {
    const q = quarter(period);
    if (!q || q.q > maxQuarter) return null;
    return addDays(quarterEndDate(q.y, q.q, fiscal ? start : 1), days);
  };
const nextYearOn = (mmdd: string) => (period: string) => {
  const y = year(period);
  return y === null ? null : `${y + 1}-${mmdd}`;
};

const RULES: Record<string, Rule> = {
  "0619E": {
    kind: "month",
    title: "Monthly Remittance Form of Creditable Income Taxes Withheld (Expanded)",
    periods: (y) => months(y, (m) => m % 3 !== 0),
    due: (p) => {
      const r = month(p);
      return r && r.m % 3 !== 0 ? dueDate0619E(r.y, r.m) || null : null;
    },
  },
  "1601C": {
    kind: "month",
    title: "Monthly Remittance Return of Income Taxes Withheld on Compensation",
    periods: (y) => months(y),
    due: (p) => {
      const r = month(p);
      return r ? dueDate1601C(r.y, r.m) || null : null;
    },
  },
  "1601EQ": {
    kind: "quarter",
    title: "Quarterly Remittance Return of Creditable Income Taxes Withheld (Expanded)",
    periods: (y) => quarters(y),
    due: (p) => {
      const r = quarter(p);
      return r ? dueDate1601EQ(r.y, r.q) || null : null;
    },
  },
  "2550Q": {
    kind: "quarter",
    title: "Quarterly Value-Added Tax Return",
    periods: (y) => quarters(y),
    due: afterQuarter(25, true),
    fiscal: true,
  },
  "2551Q": {
    kind: "quarter",
    title: "Quarterly Percentage Tax Return",
    periods: (y) => quarters(y),
    due: afterQuarter(25, false),
  },
  "1701Q": {
    kind: "quarter",
    title: "Quarterly Income Tax Return for Individuals, Estates and Trusts",
    periods: (y) => quarters(y, 3),
    due: (p) => {
      const r = quarter(p);
      if (!r || r.q > 3) return null;
      return `${r.y}-${["05", "08", "11"][r.q - 1]}-15`;
    },
  },
  "1702Q": {
    kind: "quarter",
    title: "Quarterly Income Tax Return for Corporations and Partnerships",
    periods: (y) => quarters(y, 3),
    due: afterQuarter(60, true, 3),
    fiscal: true,
  },
  "1701": {
    kind: "year",
    title: "Annual Income Tax Return for Individuals, Estates and Trusts",
    periods: (y) => [String(y)],
    due: nextYearOn("04-15"),
  },
  "1701A": {
    kind: "year",
    title: "Annual Income Tax Return for Individuals (1701A)",
    periods: (y) => [String(y)],
    due: nextYearOn("04-15"),
  },
  "1702RT": {
    kind: "year",
    title: "Annual Income Tax Return for Corporations and Partnerships",
    periods: (y) => [String(y)],
    due: (p, start) => {
      const y = year(p);
      if (y === null) return null;
      const endMonth = start === 1 ? 12 : start - 1;
      let m = endMonth + 4;
      let dueYear = y;
      if (m > 12) {
        m -= 12;
        dueYear += 1;
      }
      return `${dueYear}-${p2(m)}-15`;
    },
    fiscal: true,
  },
  "1604C": {
    kind: "year",
    title: "Annual Information Return of Income Taxes Withheld on Compensation",
    periods: (y) => [String(y)],
    due: nextYearOn("01-31"),
  },
  "1604E": {
    kind: "year",
    title: "Annual Information Return of Creditable Income Taxes Withheld (Expanded)",
    periods: (y) => [String(y)],
    due: nextYearOn("03-01"),
  },
  "2307": {
    kind: "quarter",
    title: "Certificate of Creditable Tax Withheld at Source",
    periods: (y) => quarters(y),
    due: afterQuarter(20, false),
  },
  "2316": {
    kind: "year",
    title: "Certificate of Compensation Payment and Tax Withheld",
    periods: (y) => [String(y)],
    due: nextYearOn("01-31"),
  },
};

/** Every return the table knows, in a stable order. */
export const RETURN_FORMS: readonly string[] = Object.keys(RULES);

export function formTitle(form: string): string {
  return RULES[form]?.title ?? form;
}

/** The periods of `form` for one year; none for a form the table does not know. */
export function periodsOfForm(form: string, y: number): string[] {
  return RULES[form]?.periods(y) ?? [];
}

/**
 * The due date ("2026-04-27") of a return, weekend moved, or null: a form with no rule here, or a
 * period that does not belong to it. `fiscalYearStart` ("2024-07-01") matters only to the 2550Q,
 * 1702Q and 1702RT.
 */
export function dueDateForReturn(
  form: string,
  period: string,
  fiscalYearStart: string | null,
): string | null {
  const rule = RULES[form];
  if (!rule) return null;
  const due = rule.due(
    period.trim(),
    rule.fiscal ? fiscalStartMonth(fiscalYearStart) : 1,
  );
  return due ? moveOffWeekend(due) : null;
}

/** "Q3 2026", "October 2026" or "2025". */
const MONTH_NAMES = [
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
];
export function periodWords(period: string): string {
  const q = QUARTER.exec(period);
  if (q) return `Q${q[2]} ${q[1]}`;
  const m = MONTH.exec(period);
  if (m) return `${MONTH_NAMES[Number(m[2]) - 1]} ${m[1]}`;
  return period;
}
