// format.ts — numeric parsing, BIR peso rounding, and amount formatting.
// Ported verbatim from bir-data.jsx (window.BIR.num / roundPeso / fmtAmt).

/** Parse a raw field value into a number. Commas are stripped; blanks → 0. */
export function num(v: unknown): number {
  if (v === "" || v == null) return 0;
  const n = Number(String(v).replace(/,/g, ""));
  return Number.isNaN(n) ? 0 : n;
}

/**
 * BIR rounding rule: do not enter centavos — 49 centavos or less drop down,
 * 50 or more round up. Applied symmetrically around zero.
 */
export function roundPeso(n: number): number {
  if (n == null || Number.isNaN(n)) return 0;
  return Math.sign(n) * Math.round(Math.abs(n));
}

export interface FmtAmtOptions {
  /** Reserved flag from the prototype; both states render "" for empty input. */
  blankZero?: boolean;
  /** Skip BIR peso rounding (keep the raw value). */
  noRound?: boolean;
  /** Number of decimal places (default 0 — pesos only). */
  dec?: number;
}

/**
 * Format an amount for display: thousands-separated, no centavos by default,
 * negatives in parentheses. Empty/invalid input renders as "".
 */
export function fmtAmt(
  n: number | string | null | undefined,
  opts: FmtAmtOptions = {},
): string {
  const asNum = Number(n);
  if (n === "" || n == null || Number.isNaN(asNum)) return "";
  const v = opts.noRound ? asNum : roundPeso(asNum);
  const neg = v < 0;
  const dec = opts.dec != null ? opts.dec : 0;
  const s = Math.abs(v).toLocaleString("en-PH", {
    minimumFractionDigits: dec,
    maximumFractionDigits: dec,
  });
  return neg ? "(" + s + ")" : s;
}

/** Display a peso amount with the leading "₱ " used throughout the UI. */
export function peso(n: number | string | null | undefined): string {
  return "₱ " + fmtAmt(n);
}
