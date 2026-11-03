// withholding-dates.ts — when the withholding returns are due (U17 R6, A5).
//
// Calendar dates, yyyy-mm-dd, from the calendar (never a client's fiscal year). The
// Portal holds no holiday table and invents none: a due date that falls on a Saturday
// or Sunday moves forward to the Monday, and nothing else moves it. The date is a
// default; the 0619-E's date is an editable field of the draft, and the editor says it
// ignores holidays.
//
//   0619-E  month M (the 1st or 2nd of a quarter)  the 10th of the month after
//   1601-C  month M                                the 10th of the month after;
//                                                  December: 15 January of the next year
//                                                  (printed in the BIR's instructions, page 2)
//   1601-EQ quarter Q                              the last day of the month after the
//                                                  quarter ends: 30 April, 31 July,
//                                                  31 October, 31 January

const pad = (n: number) => String(n).padStart(2, "0");

/** A whole number in a range, from a typed or numeric field; otherwise null. */
function whole(v: string | number, lo: number, hi: number): number | null {
  const text = String(v).trim();
  if (!/^\d{1,4}$/.test(text)) return null;
  const n = Number(text);
  return n >= lo && n <= hi ? n : null;
}

/** A date moved forward to Monday when it is a Saturday (+2) or a Sunday (+1). */
export function moveOffWeekend(iso: string): string {
  const d = new Date(`${iso}T00:00:00.000Z`);
  const day = d.getUTCDay(); // 0 Sunday … 6 Saturday
  if (day === 6) d.setUTCDate(d.getUTCDate() + 2);
  else if (day === 0) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/** The 10th of the month after `month` of `year`, weekend moved: "" for a bad month. */
function tenthOfNextMonth(year: string | number, month: string | number): string {
  const y = whole(year, 2000, 2100);
  const m = whole(month, 1, 12);
  if (y === null || m === null) return "";
  const nextYear = m === 12 ? y + 1 : y;
  const nextMonth = m === 12 ? 1 : m + 1;
  return moveOffWeekend(`${nextYear}-${pad(nextMonth)}-10`);
}

/** 0619-E item 2's default: the 10th of the following month. */
export function dueDate0619E(year: string | number, month: string | number): string {
  return tenthOfNextMonth(year, month);
}

/** 1601-C: the 10th of the following month; December is due 15 January. */
export function dueDate1601C(year: string | number, month: string | number): string {
  const y = whole(year, 2000, 2100);
  const m = whole(month, 1, 12);
  if (y === null || m === null) return "";
  if (m === 12) return moveOffWeekend(`${y + 1}-01-15`);
  return tenthOfNextMonth(y, m);
}

/** 1601-EQ: the last day of the month after the quarter ends, weekend moved. */
export function dueDate1601EQ(year: string | number, quarter: string | number): string {
  const y = whole(year, 2000, 2100);
  const q = whole(quarter, 1, 4);
  if (y === null || q === null) return "";
  const dueYear = q === 4 ? y + 1 : y;
  const dueMonth = q === 4 ? 1 : q * 3 + 1; // April, July, October, January
  const lastDay = new Date(Date.UTC(dueYear, dueMonth, 0)).getUTCDate();
  return moveOffWeekend(`${dueYear}-${pad(dueMonth)}-${pad(lastDay)}`);
}

// --- the filing calendar: the next return of each kind that is still due ----------------
//
// `today` is a Manila calendar date, yyyy-mm-dd. A return is "next" while its due date
// has not passed (today counts), so it stays listed through its own due day. The 0619-E
// is listed for the 1st and 2nd month of a quarter only; the 3rd month is the 1601-EQ's.

export interface WithholdingDue {
  /** The return's period: "2026-10" for a month, "2026-Q4" for a quarter. */
  period: string;
  /** Its due date, yyyy-mm-dd, weekend moved. */
  due: string;
}

/** The first month, from the one before today's, whose return is still due. */
function nextMonthly(
  today: string,
  isFiled: (month: number) => boolean,
  dueOf: (year: number, month: number) => string,
): WithholdingDue {
  let year = Number(today.slice(0, 4));
  let month = Number(today.slice(5, 7)) - 1; // the month just ended
  if (month < 1) {
    month = 12;
    year -= 1;
  }
  for (let i = 0; i < 14; i++) {
    const due = dueOf(year, month);
    if (isFiled(month) && due >= today) return { period: `${year}-${pad(month)}`, due };
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }
  return { period: "", due: "" };
}

/** The next 0619-E: months 1 and 2 of a quarter, due the 10th after. */
export function nextDue0619E(today: string): WithholdingDue {
  return nextMonthly(today, (m) => m % 3 !== 0, dueDate0619E);
}

/** The next 1601-C: every month; December is due 15 January. */
export function nextDue1601C(today: string): WithholdingDue {
  return nextMonthly(today, () => true, dueDate1601C);
}

/** The next 1601-EQ: the quarter whose due date has not passed. */
export function nextDue1601EQ(today: string): WithholdingDue {
  const thisYear = Number(today.slice(0, 4));
  for (let year = thisYear - 1; year <= thisYear + 1; year++) {
    for (let quarter = 1; quarter <= 4; quarter++) {
      const due = dueDate1601EQ(year, quarter);
      if (due >= today) return { period: `${year}-Q${quarter}`, due };
    }
  }
  return { period: "", due: "" };
}
