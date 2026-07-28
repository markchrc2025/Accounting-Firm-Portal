// format.ts — numeric parsing + BIR peso rounding.
// PORTED verbatim from the Sentire generator (src/lib/format).

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
