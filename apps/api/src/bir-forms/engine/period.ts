// period.ts — taxable-period helpers. PORTED from the Sentire generator.
// Annual forms key on the year ("2024"); quarterly forms on year+quarter
// ("2024-Q1").

import type { FormCode } from "./types";

/** The four forms filed per quarter. */
export const QUARTERLY_FORMS: readonly FormCode[] = ["1701Q", "1702Q", "2550Q", "2551Q"];

export function isQuarterlyForm(form: FormCode | string | undefined): boolean {
  return !!form && QUARTERLY_FORMS.includes(form as FormCode);
}

/** Build a period segment from a year and optional quarter ("Q1".."Q4"). */
export function buildPeriod(year: string, quarter?: string): string {
  const y = year.trim();
  return quarter ? `${y}-${quarter}` : y;
}

/** Parse a period segment into its year and (if quarterly) quarter. */
export function parsePeriod(period: string): { year: string; quarter?: string } {
  const m = /^(\d{4})-(Q[1-4])$/i.exec(period.trim());
  if (m) return { year: m[1]!, quarter: m[2]!.toUpperCase() };
  return { year: period.trim() };
}
