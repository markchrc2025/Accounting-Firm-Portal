// return-timing.ts — U18: where a return's period ends and when it is due, for the two
// WARNINGS of check 8 (received before the period ended; received after the due date).
// A due date is given only where the Portal already has one: the 2550Q and 2551Q (the
// 25th after the quarter closes, as on the dashboard), the 0619-E and the 1601-EQ
// (withholding-dates.ts, U17). The 1701, 1701A, 1701Q, 1702Q and 1702RT have none in the
// Portal, so they get no late warning (said in the report; the owner can supply the rules).
// A due date that falls on a Saturday or Sunday moves to the Monday, as in U17.
import {
  dueDate0619E,
  dueDate1601EQ,
  moveOffWeekend,
} from "../bir-forms/engine/withholding-dates";

const p2 = (n: number) => String(n).padStart(2, "0");

function lastDay(year: number, month: number): string {
  return `${year}-${p2(month)}-${p2(new Date(Date.UTC(year, month, 0)).getUTCDate())}`;
}

/** The quarter's last day. 2550Q follows the client's fiscal year; every other form is calendar. */
function quarterEnd(
  form: string,
  year: number,
  quarter: number,
  fiscalYearStart: string | null,
) {
  const start =
    form === "2550Q" && fiscalYearStart ? Number(fiscalYearStart.slice(5, 7)) : 1;
  const startMonth = Number.isInteger(start) && start >= 1 && start <= 12 ? start : 1;
  let m0 = startMonth + 3 * (quarter - 1);
  let y0 = startMonth === 1 ? year : year - 1; // a fiscal year that ends in `year` began the year before
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
  return lastDay(y1, m1);
}

function parts(
  period: string,
): { year: number; quarter: number | null; month: number | null } | null {
  const q = /^(\d{4})-Q([1-4])$/i.exec(period.trim());
  if (q) return { year: Number(q[1]), quarter: Number(q[2]), month: null };
  const m = /^(\d{4})-(\d{2})$/.exec(period.trim());
  if (m && Number(m[2]) >= 1 && Number(m[2]) <= 12) {
    return { year: Number(m[1]), quarter: null, month: Number(m[2]) };
  }
  const y = /^(\d{4})$/.exec(period.trim());
  if (y) return { year: Number(y[1]), quarter: null, month: null };
  return null;
}

/** The last day of the return's period ("2026-03-31"), or null if the period is not understood. */
export function periodEndFor(
  form: string,
  period: string,
  fiscalYearStart: string | null,
): string | null {
  const p = parts(period);
  if (!p) return null;
  if (p.quarter !== null) return quarterEnd(form, p.year, p.quarter, fiscalYearStart);
  if (p.month !== null) return lastDay(p.year, p.month);
  return `${p.year}-12-31`;
}

/** The due date ("2026-04-27"), weekend moved, or null where the Portal has none. */
export function dueDateFor(
  form: string,
  period: string,
  fiscalYearStart: string | null,
): string | null {
  const p = parts(period);
  if (!p) return null;
  if ((form === "2550Q" || form === "2551Q") && p.quarter !== null) {
    const end = quarterEnd(form, p.year, p.quarter, fiscalYearStart);
    const y = Number(end.slice(0, 4));
    const m = Number(end.slice(5, 7));
    const ny = m === 12 ? y + 1 : y;
    const nm = m === 12 ? 1 : m + 1;
    return moveOffWeekend(`${ny}-${p2(nm)}-25`);
  }
  if (form === "0619E" && p.month !== null) return dueDate0619E(p.year, p.month);
  if (form === "1601EQ" && p.quarter !== null) return dueDate1601EQ(p.year, p.quarter);
  return null;
}
