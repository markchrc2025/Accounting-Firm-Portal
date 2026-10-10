// manilaQuarter.ts — the calendar quarter a moment falls in, in Manila time
// (W7 R3). The Expenses page's "Posted total for the quarter" asks the server
// for exactly these dates.

export interface CalendarQuarter {
  year: number;
  /** 1–4. */
  quarter: number;
  /** First day, YYYY-MM-DD. */
  dateFrom: string;
  /** Last day, YYYY-MM-DD. */
  dateTo: string;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** The calendar quarter `now` falls in, on the Manila calendar. */
export function manilaQuarter(now: Date = new Date()): CalendarQuarter {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(now);
  const year = Number(parts.find((p) => p.type === "year")?.value);
  const month = Number(parts.find((p) => p.type === "month")?.value);
  const quarter = Math.floor((month - 1) / 3) + 1;
  const first = (quarter - 1) * 3 + 1;
  const last = first + 2;
  // Day 0 of the next month is the last day of `last`.
  const lastDay = new Date(Date.UTC(year, last, 0)).getUTCDate();
  return {
    year,
    quarter,
    dateFrom: `${year}-${pad(first)}-01`,
    dateTo: `${year}-${pad(last)}-${pad(lastDay)}`,
  };
}
