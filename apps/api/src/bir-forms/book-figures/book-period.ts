/**
 * book-period.ts — the dates a business-tax return's quarter covers (U15). Every
 * date is a calendar date written yyyy-mm-dd, the same Manila dates the books
 * store (a record's txnDate is a date, not a moment).
 *
 * The quarter follows the client's fiscal year as the 2550Q's clear copy does
 * (build2550Q.ts, U13 F4): with a fiscal year starting in month S (2 to 12), the
 * return's year is the year the fiscal year ENDS and quarter n runs from month
 * S + 3(n − 1) of the year before. Calendar quarters otherwise (no fiscal year
 * start, or January).
 */
export interface BookQuarter {
  from: string;
  to: string;
}

const PERIOD = /^(\d{4})-(Q[1-4])$/i;

const pad = (n: number) => String(n).padStart(2, "0");

/** The quarter of a period like "2026-Q3", or null when it is not one. */
export function bookQuarter(
  period: string,
  fiscalYearStart: Date | null | undefined,
): BookQuarter | null {
  const m = PERIOD.exec(period.trim());
  if (!m) return null;
  const year = Number(m[1]);
  const quarter = Number(m[2]!.slice(1));
  const start = fiscalYearStart ? fiscalYearStart.getUTCMonth() + 1 : 1;
  const startMonth = start >= 2 && start <= 12 ? start : 1;

  // A fiscal year that ends in `year` began in the year before.
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
  const lastDay = new Date(Date.UTC(y1, m1, 0)).getUTCDate();
  return { from: `${y0}-${pad(m0)}-01`, to: `${y1}-${pad(m1)}-${pad(lastDay)}` };
}
