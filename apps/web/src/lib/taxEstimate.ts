// taxEstimate.ts — how the tax pages word the API's estimate (W11 R1). These
// only name what the API sent; none of them computes a figure.

import type { TaxEstimate } from "./api";

const METHOD_LABELS: Record<string, string> = {
  graduated: "Graduated rates",
  simplified8: "Optional rate on gross receipts",
  flat: "Flat rate on taxable income",
  // U10-A1: a saved "percentage" rule is percentage tax (a business tax), not an
  // income-tax method; the API estimates income tax on the graduated rates and
  // says so in an assumption, which methodNote finds (W12-A1 R3).
  percentage: "Percentage",
};

/** The method as the reader sees it, with the API's rate when it has one. */
export function methodLabel(method: TaxEstimate["method"]): string {
  const name = METHOD_LABELS[method.name] ?? method.name;
  return method.rate === null ? name : `${name} · ${method.rate}%`;
}

/**
 * The API's own sentence about the method, word for word, when the method
 * needs one: a saved "percentage" rule (U10-A1). The response carries it among
 * the assumptions; null when there is none.
 */
export function methodNote(
  estimate: Pick<TaxEstimate, "method" | "assumptions">,
): string | null {
  if (estimate.method.name !== "percentage") return null;
  return estimate.assumptions.find((a) => /\bsaved rule is 'Percentage'/.test(a)) ?? null;
}

/** Where the rule came from: saved on Tax Rules, or the TRAIN default. */
export function sourceLabel(source: TaxEstimate["method"]["source"]): string {
  return source === "saved" ? "Saved rule" : "Default (TRAIN)";
}

/**
 * The API's own sentence for a business tax it did not estimate ("No business
 * tax: …", "No percentage tax: …"). The response carries it among the
 * assumptions, after the income-tax ones; the last assumption is the fallback.
 */
export function businessTaxNote(estimate: TaxEstimate): string | null {
  const said = estimate.assumptions.find((a) =>
    /^No (business|percentage) tax\b/.test(a),
  );
  if (said) return said;
  if (estimate.businessTax.kind === "none")
    return estimate.assumptions[estimate.assumptions.length - 1] ?? null;
  return null;
}
