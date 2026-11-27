// spouse-on-return.ts — U27 addendum (D74): whether a 1701-family return carries the spouse.
//
// The spouse is on the return when the draft holds something of the spouse's own: a figure
// of the spouse's column (a key ending in "B" with a value, other than the rate and method
// selectors the editor used to carry with the column off) or a spouse background answer the
// preparer typed. With none, Part II (the spouse's background: type, ATC, foreign tax
// credits, tax rate and method of deduction) stays blank in the XML and on the paper. The
// web shows the spouse column on the same test (a B-column value entered).

import type { FilingData } from "./types";

/** The spouse's own background answers, typed by the preparer. */
const SPOUSE_KEYS = [
  "spouseName",
  "spouseTin",
  "spouseAtc",
  "spouseType",
  "spouseCitizenship",
  "spouseForeignTaxNo",
  "spouseContact",
] as const;

/** The selectors that say nothing of their own (the editor defaulted them). */
const SELECTORS = new Set(["rateB", "methodB"]);

const filled = (v: unknown) => v != null && String(v).trim() !== "";

export function spouseOnReturn(
  data: FilingData | Record<string, unknown> | null | undefined,
): boolean {
  const d = (data ?? {}) as Record<string, unknown>;
  if (SPOUSE_KEYS.some((k) => filled(d[k]))) return true;
  return Object.entries(d).some(
    ([k, v]) => /^[a-z][A-Za-z0-9_]*B$/.test(k) && !SELECTORS.has(k) && filled(v),
  );
}
