// recurrence.ts: the dates of a recurring project. Each occurrence becomes a task due that day.
//
// Dates are plain calendar dates, YYYY-MM-DD (the Portal's days are Asia/Manila days; no time or
// time zone is used anywhere in here). Pure: nothing is read from the clock.

export const FREQUENCIES = [
  "DAILY",
  "WEEKLY",
  "BI_WEEKLY",
  "MONTHLY",
  "QUARTERLY",
  "ANNUALLY",
] as const;
export type Frequency = (typeof FREQUENCIES)[number];

/** The words the form shows. */
export const FREQUENCY_LABELS: Readonly<Record<Frequency, string>> = {
  DAILY: "Daily",
  WEEKLY: "Weekly",
  BI_WEEKLY: "Bi-Weekly",
  MONTHLY: "Monthly",
  QUARTERLY: "Quarterly",
  ANNUALLY: "Annually",
};

/** The most dates one call returns. A longer range is refused with a sentence. */
export const MAX_OCCURRENCES = 10_000;

export class RecurrenceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RecurrenceError";
  }
}

const LABEL_LIST = "Daily, Weekly, Bi-Weekly, Monthly, Quarterly or Annually";

export function isFrequency(value: unknown): value is Frequency {
  return typeof value === "string" && (FREQUENCIES as readonly string[]).includes(value);
}

// ---------------------------------------------------------------------------------------------
// Calendar arithmetic on whole days (proleptic Gregorian, years 1 to 9999). No Date object.

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

const isLeap = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
const daysInMonth = (y: number, m: number) =>
  m === 2 ? (isLeap(y) ? 29 : 28) : [4, 6, 9, 11].includes(m) ? 30 : 31;

function parse(date: string): { y: number; m: number; d: number } | null {
  const match = typeof date === "string" ? DATE.exec(date) : null;
  if (!match) return null;
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  if (y < 1 || m < 1 || m > 12 || d < 1 || d > daysInMonth(y, m)) return null;
  return { y, m, d };
}

/** True for a real calendar date written YYYY-MM-DD (2026-02-30 is not). */
export function isCalendarDate(value: unknown): value is string {
  return typeof value === "string" && parse(value) !== null;
}

const pad = (n: number, width: number) => String(n).padStart(width, "0");
const format = (y: number, m: number, d: number) =>
  `${pad(y, 4)}-${pad(m, 2)}-${pad(d, 2)}`;

/** Days since 1970-01-01 (Howard Hinnant's days_from_civil). */
function toDayNumber(y: number, m: number, d: number): number {
  const yy = m <= 2 ? y - 1 : y;
  const era = Math.floor(yy / 400);
  const yoe = yy - era * 400;
  const doy = Math.floor((153 * (m + (m > 2 ? -3 : 9)) + 2) / 5) + d - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}

function fromDayNumber(days: number): string {
  const z = days + 719468;
  const era = Math.floor(z / 146097);
  const doe = z - era * 146097;
  const yoe = Math.floor(
    (doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) /
      365,
  );
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const d = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const m = mp + (mp < 10 ? 3 : -9);
  const y = yoe + era * 400 + (m <= 2 ? 1 : 0);
  return format(y, m, d);
}

const FIRST_DAY = toDayNumber(1, 1, 1);
const LAST_DAY = toDayNumber(9999, 12, 31);

function need(date: string, what: string): { y: number; m: number; d: number } {
  const p = parse(date);
  if (!p)
    throw new RecurrenceError(`The ${what} must be a real date written YYYY-MM-DD.`);
  return p;
}

/** The date `n` days after `date` (before it when n is negative). */
export function addDays(date: string, n: number): string {
  const p = need(date, "date");
  const target = toDayNumber(p.y, p.m, p.d) + n;
  if (!Number.isInteger(n) || target < FIRST_DAY || target > LAST_DAY) {
    throw new RecurrenceError("That date is outside the years 0001 to 9999.");
  }
  return fromDayNumber(target);
}

/** The date `k` months after `date`, on the same day of the month, or the month's last day if it has none. */
function addMonths(date: string, k: number): string {
  const p = need(date, "date");
  const total = p.y * 12 + (p.m - 1) + k;
  const y = Math.floor(total / 12);
  const m = (total % 12) + 1;
  if (y < 1 || y > 9999)
    throw new RecurrenceError("That date is outside the years 0001 to 9999.");
  return format(y, m, Math.min(p.d, daysInMonth(y, m)));
}

/** Days between occurrences for the day-based frequencies, months for the month-based ones. */
const STEP: Record<Frequency, { days: number } | { months: number }> = {
  DAILY: { days: 1 },
  WEEKLY: { days: 7 },
  BI_WEEKLY: { days: 14 },
  MONTHLY: { months: 1 },
  QUARTERLY: { months: 3 },
  ANNUALLY: { months: 12 },
};

function checkFrequency(frequency: unknown): Frequency {
  if (!isFrequency(frequency)) {
    throw new RecurrenceError(`The frequency must be one of ${LABEL_LIST}.`);
  }
  return frequency;
}

// ---------------------------------------------------------------------------------------------
// The occurrences

/**
 * The n-th occurrence of a schedule (n = 0 is the start itself).
 *
 * Daily adds n days, Weekly 7n, Bi-Weekly 14n. Monthly adds n months, Quarterly 3n, Annually 12n.
 * Months are counted from the START date, not from the previous occurrence, so a schedule that
 * starts on the 31st gives Jan 31, Feb 28 (29 in a leap year), Mar 31, Apr 30, May 31: a month
 * without that day uses its last day, and the next month that has the day gets it back.
 * Start 2026-08-15 quarterly: 2026-08-15, 2026-11-15, 2027-02-15 ...
 * Start Feb 29 annually: Feb 29 in leap years, Feb 28 in the others.
 */
export function occurrenceDate(start: string, frequency: Frequency, n: number): string {
  const f = checkFrequency(frequency);
  need(start, "start date");
  if (!Number.isInteger(n) || n < 0) {
    throw new RecurrenceError("The occurrence number must be a whole number, 0 or more.");
  }
  const step = STEP[f];
  if ("days" in step) return addDays(start, step.days * n);
  return addMonths(start, step.months * n);
}

/** Smallest n whose occurrence is on or after `date` (never below 0). */
function firstIndexOnOrAfter(start: string, frequency: Frequency, date: string): number {
  const s = need(start, "start date");
  const t = need(date, "date");
  const gap = toDayNumber(t.y, t.m, t.d) - toDayNumber(s.y, s.m, s.d);
  if (gap <= 0) return 0;
  const step = STEP[frequency];
  if ("days" in step) return Math.ceil(gap / step.days);
  const months = t.y * 12 + t.m - (s.y * 12 + s.m);
  let n = Math.max(0, Math.floor(months / step.months) - 1);
  try {
    while (occurrenceDate(start, frequency, n) < date) n++;
  } catch {
    // the next occurrence would be past year 9999: there is none, and the caller stops there
  }
  return n;
}

function checkRange(start: string, end: string | null) {
  need(start, "start date");
  if (end !== null) {
    need(end, "end date");
    if (end < start)
      throw new RecurrenceError("The end date cannot be before the start date.");
  }
}

const tooMany = () =>
  new RecurrenceError(
    `That range holds more than ${MAX_OCCURRENCES} dates. Use a shorter range.`,
  );

/**
 * Every occurrence between `from` and `to`, both included, that is on or after the start and on or
 * before the end (when the end is set; `null` means endless). Oldest first. An empty list when
 * `from` is after `to` or the window holds none. More than {@link MAX_OCCURRENCES} throws.
 */
export function occurrencesBetween(
  start: string,
  frequency: Frequency,
  end: string | null,
  from: string,
  to: string,
): string[] {
  const f = checkFrequency(frequency);
  checkRange(start, end);
  need(from, "from date");
  need(to, "to date");
  const last = end !== null && end < to ? end : to;
  if (from > last) return [];
  const out: string[] = [];
  for (let n = firstIndexOnOrAfter(start, f, from); ; n++) {
    let date: string;
    try {
      date = occurrenceDate(start, f, n);
    } catch {
      break; // past year 9999
    }
    if (date > last) break;
    if (out.length >= MAX_OCCURRENCES) throw tooMany();
    out.push(date);
  }
  return out;
}

/**
 * The next `count` occurrences strictly after `after` (the form's preview of the next 5 dates).
 * Fewer come back when the schedule ends first. `after` before the start gives the start first.
 */
export function nextOccurrences(
  start: string,
  frequency: Frequency,
  end: string | null,
  after: string,
  count: number,
): string[] {
  const f = checkFrequency(frequency);
  checkRange(start, end);
  need(after, "date to start after");
  if (!Number.isInteger(count) || count < 0) {
    throw new RecurrenceError("The number of dates must be a whole number, 0 or more.");
  }
  if (count > MAX_OCCURRENCES) throw tooMany();
  const out: string[] = [];
  for (let n = firstIndexOnOrAfter(start, f, after); out.length < count; n++) {
    let date: string;
    try {
      date = occurrenceDate(start, f, n);
    } catch {
      break; // past year 9999
    }
    if (end !== null && date > end) break;
    if (date > after) out.push(date);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Validation for the form

export interface RecurrenceInput {
  /** When false the schedule is off and nothing is checked. Default true. */
  recurring?: boolean;
  start?: string | null;
  /** Blank, null or missing means the schedule never ends. */
  end?: string | null;
  frequency?: string | null;
}

const blank = (v: string | null | undefined) =>
  v === null || v === undefined || String(v).trim() === "";

/**
 * Plain sentences about what is wrong with a recurring project's schedule; an empty list means it
 * can be saved. The start date is required, the end date is optional but not before the start,
 * and the frequency is one of the six.
 */
export function validateRecurrence(input: RecurrenceInput): string[] {
  if (input.recurring === false) return [];
  const out: string[] = [];
  let startOk = false;
  if (blank(input.start)) {
    out.push("Choose a start date for the recurring project.");
  } else if (!isCalendarDate(input.start)) {
    out.push("The start date must be a real date written YYYY-MM-DD.");
  } else {
    startOk = true;
  }
  if (!blank(input.end)) {
    if (!isCalendarDate(input.end)) {
      out.push("The end date must be a real date written YYYY-MM-DD.");
    } else if (startOk && input.end < (input.start as string)) {
      out.push("The end date cannot be before the start date.");
    }
  }
  if (blank(input.frequency)) {
    out.push(`Choose how often the project repeats: ${LABEL_LIST}.`);
  } else if (!isFrequency(input.frequency)) {
    out.push(`"${String(input.frequency)}" is not a frequency. Choose ${LABEL_LIST}.`);
  }
  return out;
}
