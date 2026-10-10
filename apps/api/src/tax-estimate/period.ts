/**
 * period.ts — the dates a tax estimate covers (U10 R1). Every date is a Manila
 * calendar date (UTC+8 all year), written as yyyy-mm-dd.
 *  - With a quarter: income tax runs 1 January → the quarter's end (cumulative,
 *    as a quarterly income-tax return is); business tax covers the quarter alone.
 *  - Without: both cover the year to date — through today for the current year,
 *    through 31 December for any other year.
 */
const MANILA_OFFSET_MS = 8 * 60 * 60 * 1000;
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

/** Today's Manila date as yyyy-mm-dd. */
export function manilaToday(now: Date = new Date()): string {
  return new Date(now.getTime() + MANILA_OFFSET_MS).toISOString().slice(0, 10);
}

function lastDay(year: number, month: number): string {
  const d = new Date(Date.UTC(year, month, 0)); // month is 1-based → day 0 of next
  return d.toISOString().slice(0, 10);
}

function words(iso: string): string {
  const [, m, d] = iso.split("-").map(Number) as [number, number, number];
  return `${d} ${MONTHS[m - 1]}`;
}

export interface EstimatePeriod {
  year: number;
  quarter: number | null;
  label: string;
  incomeTaxFrom: string;
  incomeTaxTo: string;
  businessTaxFrom: string;
  businessTaxTo: string;
}

export function estimatePeriod(
  year: number | undefined,
  quarter: number | undefined,
  now: Date = new Date(),
): EstimatePeriod {
  const today = manilaToday(now);
  const y = year ?? Number(today.slice(0, 4));
  const from = `${y}-01-01`;
  if (quarter) {
    const qStart = `${y}-${String((quarter - 1) * 3 + 1).padStart(2, "0")}-01`;
    const qEnd = lastDay(y, quarter * 3);
    return {
      year: y,
      quarter,
      label:
        `Q${quarter} ${y}: income tax ${words(from)} – ${words(qEnd)} (cumulative); ` +
        `business tax ${words(qStart)} – ${words(qEnd)}`,
      incomeTaxFrom: from,
      incomeTaxTo: qEnd,
      businessTaxFrom: qStart,
      businessTaxTo: qEnd,
    };
  }
  const to = today.startsWith(`${y}-`) ? today : `${y}-12-31`;
  return {
    year: y,
    quarter: null,
    label: `${y} year to date: ${words(from)} – ${words(to)}`,
    incomeTaxFrom: from,
    incomeTaxTo: to,
    businessTaxFrom: from,
    businessTaxTo: to,
  };
}
