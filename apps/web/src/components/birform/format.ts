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

/**
 * The 14 digits the BIR's TIN boxes hold: nine-digit TIN + five-digit branch
 * code. A TIN already carrying its branch wins; otherwise the branch argument
 * is used. Short/absent TINs come back as-is so the boxes simply run out.
 *
 * A mandated form never invents a digit. Sentire's original padded a MISSING
 * branch to "00000" (head office); that is a guess, so here a branch is padded
 * only when some branch digits were actually given (an old-style three-digit
 * "000" becomes "00000"), and with none the five branch boxes stay blank.
 * Adapted from the Sentire generator (src/lib/taxpayer.ts tin14).
 */
export function tin14(tin: string | null | undefined, branch?: string | null): string {
  const digits = String(tin ?? "").replace(/\D/g, "");
  if (digits.length < 9) return digits;
  const given = digits.slice(9, 14) || String(branch ?? "").replace(/\D/g, "");
  return digits.slice(0, 9) + (given ? given.padStart(5, "0") : "");
}

/**
 * The 8 digits an MM/DD/YYYY box row holds. Accepts "01/01/2026", "2026-01-01"
 * or raw digits; anything that is not eight digits after normalising comes back
 * as the digits it had, so the boxes are partly filled rather than wrong.
 */
export function mmddyyyy(value: string | null | undefined): string {
  const s = String(value ?? "").trim();
  if (s === "") return "";
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (iso) return iso[2]! + iso[3]! + iso[1]!;
  return s.replace(/\D/g, "").slice(0, 8);
}
