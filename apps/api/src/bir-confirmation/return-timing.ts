// return-timing.ts — U18: where a return's period ends and when it is due, for the two
// WARNINGS of check 8 (received before the period ended; received after the due date).
// A due date is given only where the Portal already has one: the 2550Q and 2551Q (the
// 25th after the quarter closes, as on the dashboard), the 0619-E and the 1601-EQ
// (withholding-dates.ts, U17). The 1701, 1701A, 1701Q, 1702Q and 1702RT have none in the
// Portal, so they get no late warning (said in the report; the owner can supply the rules).
// A due date that falls on a Saturday or Sunday moves to the Monday, as in U17.
// PA8 (D70): the rules moved to bir-forms/deadlines/due-rules.ts; this file keeps which forms warn.
import {
  dueDateForReturn,
  fiscalStartMonth,
  lastDayOf,
  quarterEndDate,
} from "../bir-forms/deadlines/due-rules";

/** The quarter's last day. 2550Q follows the client's fiscal year; every other form is calendar. */
function quarterEnd(
  form: string,
  year: number,
  quarter: number,
  fiscalYearStart: string | null,
) {
  return quarterEndDate(
    year,
    quarter,
    form === "2550Q" ? fiscalStartMonth(fiscalYearStart) : 1,
  );
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
  if (p.month !== null) return lastDayOf(p.year, p.month);
  return `${p.year}-12-31`;
}

/**
 * The due date ("2026-04-27"), weekend moved, or null where the confirmation check gives no late
 * warning: only the 2550Q, 2551Q, 0619-E and 1601-EQ have one. The rules themselves live in
 * bir-forms/deadlines/due-rules.ts, once.
 */
const LATE_WARNING_FORMS: ReadonlySet<string> = new Set([
  "2550Q",
  "2551Q",
  "0619E",
  "1601EQ",
]);
export function dueDateFor(
  form: string,
  period: string,
  fiscalYearStart: string | null,
): string | null {
  if (!LATE_WARNING_FORMS.has(form)) return null;
  return dueDateForReturn(form, period, fiscalYearStart);
}
