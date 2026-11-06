// default-period.ts — U20b (D61): the period a draft is for when the owner names none.
//
// A form with a due-date rule in the Portal (the 2550Q, 2551Q, 0619-E, 1601-EQ and 1601-C):
// the period due next from today's date, never one that has a filed return (then the next).
// A form with no rule (the 1701 family, 1702 family, 2307, 2316): the latest period that has
// ended, and if that one is filed, the next. The sentence says which and why, in words.
import { longDate } from "../../bir-confirmation/confirmation-checks";
import { periodEndFor } from "../../bir-confirmation/return-timing";
import { dueDateOf, periodKindOf, periodFrom } from "./bir-form-types";
import { daysLeft } from "./bir-form-types";

const p2 = (n: number) => String(n).padStart(2, "0");
const MONTHS = [
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

/** Every period of a form from `fromYear` to `toYear`, oldest first (a period the Portal refuses is left out). */
export function periodsOf(form: string, fromYear: number, toYear: number): string[] {
  const kind = periodKindOf(form);
  const out: string[] = [];
  for (let year = fromYear; year <= toYear; year++) {
    if (kind === "year") {
      if ("error" in periodFrom(form, { year })) continue;
      out.push(String(year));
    } else if (kind === "quarter") {
      for (let quarter = 1; quarter <= 4; quarter++) {
        if (!("error" in periodFrom(form, { year, quarter })))
          out.push(`${year}-Q${quarter}`);
      }
    } else if (kind === "month") {
      for (let month = 1; month <= 12; month++) {
        if (!("error" in periodFrom(form, { year, month })))
          out.push(`${year}-${p2(month)}`);
      }
    }
  }
  return out;
}

/** "Q3 2026", "October 2026" or "2025". */
export function periodWords(period: string): string {
  const q = /^(\d{4})-Q([1-4])$/.exec(period);
  if (q) return `Q${q[2]} ${q[1]}`;
  const m = /^(\d{4})-(\d{2})$/.exec(period);
  if (m) return `${MONTHS[Number(m[2]) - 1]} ${m[1]}`;
  return period;
}

export interface ChosenPeriod {
  period: string;
  dueDate: string | null;
  /** "due-next" or "latest-ended". */
  basis: "due-next" | "latest-ended";
  /** A sentence Claude can tell the owner. */
  reason: string;
}

export function chooseDefaultPeriod(
  form: string,
  today: string,
  fiscalYearStart: string | null,
  isFiled: (period: string) => boolean,
): ChosenPeriod | null {
  const year = Number(today.slice(0, 4));
  const all = periodsOf(form, year - 2, year + 1);
  const hasRule = all.some((p) => dueDateOf(form, p, fiscalYearStart) !== null);

  if (hasRule) {
    const skipped: string[] = [];
    for (const period of all) {
      const due = dueDateOf(form, period, fiscalYearStart);
      if (!due || due < today) continue;
      if (isFiled(period)) {
        skipped.push(periodWords(period));
        continue;
      }
      const left = daysLeft(due, today);
      const when = left === 0 ? "today" : left === 1 ? "in 1 day" : `in ${left} days`;
      return {
        period,
        dueDate: due,
        basis: "due-next",
        reason:
          `I chose ${periodWords(period)} (${period}) because it is the ${form} due next, on ${longDate(due)}, ${when}.` +
          (skipped.length > 0
            ? ` ${skipped.join(" and ")} ${skipped.length === 1 ? "is" : "are"} already filed.`
            : ""),
      };
    }
    return null;
  }

  // No due-date rule in the Portal: the latest period that has ended; if filed, the next.
  let latest = -1;
  all.forEach((p, i) => {
    const end = periodEndFor(form, p, fiscalYearStart);
    if (end && end < today) latest = i;
  });
  if (latest < 0) return null;
  for (let i = latest; i < all.length; i++) {
    const period = all[i]!;
    if (isFiled(period)) continue;
    const end = periodEndFor(form, period, fiscalYearStart);
    const ended = end !== null && end < today;
    return {
      period,
      dueDate: null,
      basis: "latest-ended",
      reason: ended
        ? `I chose ${periodWords(period)} (${period}) because it is the latest ${form} period that has ended${i > latest ? "" : ""}; the Portal has no due-date rule for the ${form}.`
        : `I chose ${periodWords(period)} (${period}) because the latest ${form} period that has ended is already filed; the Portal has no due-date rule for the ${form}.`,
    };
  }
  return null;
}
