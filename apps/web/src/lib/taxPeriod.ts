// taxPeriod.ts — the period a tax estimate is asked for (W11 R1). The pages
// open on the most recent quarter that has ended, by the Manila date, and send
// the API `year` and, unless "Whole year" is chosen, `quarter`.

import { manilaQuarter } from "./manilaQuarter";

/** The first year GET /clients/:id/tax-estimate accepts (U10 R1's query schema). */
export const FIRST_ESTIMATE_YEAR = 2018;

export interface EstimatePeriodChoice {
  year: number;
  /** 1–4, or null for the whole year. */
  quarter: number | null;
}

/** The most recent calendar quarter that has ended, on the Manila calendar. */
export function lastEndedQuarter(now: Date = new Date()): {
  year: number;
  quarter: number;
} {
  const current = manilaQuarter(now);
  return current.quarter === 1
    ? { year: current.year - 1, quarter: 4 }
    : { year: current.year, quarter: current.quarter - 1 };
}

/** The years the picker offers: the Manila year down to the first the API accepts. */
export function yearOptions(now: Date = new Date()): number[] {
  const out: number[] = [];
  for (let y = manilaQuarter(now).year; y >= FIRST_ESTIMATE_YEAR; y--) out.push(y);
  return out;
}

/** The estimate's query string: `year=…`, plus `&quarter=…` unless the whole year. */
export function estimateQuery(year: number, quarter: number | null): string {
  return quarter === null ? `year=${year}` : `year=${year}&quarter=${quarter}`;
}
