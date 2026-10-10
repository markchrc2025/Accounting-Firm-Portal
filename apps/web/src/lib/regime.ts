// regime.ts — a client's tax regime, as the Portal names it and branches on it
// (W6 R1, decision D39).
//
// `taxType` is "VAT", "PERCENTAGE" or null. Null — the client form's "None
// (exempt from business tax)" — is a regime in its own right: the client is
// exempt from business tax and keeps books. It is never "not set", and never
// percentage tax.

/** What null reads as, everywhere the Portal names a client's regime. */
export const EXEMPT_LABEL = "Exempt from business tax";

/**
 * The label for a client's tax regime: "VAT-registered", "Percentage tax" or
 * "Exempt from business tax". A value the Portal does not know is shown as
 * stored, never guessed into one of the three.
 */
export function regimeLabel(taxType: string | null | undefined): string {
  const t = (taxType ?? "").trim();
  if (t === "") return EXEMPT_LABEL;
  const u = t.toUpperCase();
  if (u === "VAT") return "VAT-registered";
  if (u === "PERCENTAGE") return "Percentage tax";
  return t;
}

/** No tax regime: exempt from business tax (D39). */
export function isExempt(taxType: string | null | undefined): boolean {
  return (taxType ?? "").trim() === "";
}

/** VAT-registered: the records carry VAT. Anything else — percentage tax, exempt
 *  — records no VAT. */
export function isVatRegistered(taxType: string | null | undefined): boolean {
  const t = (taxType ?? "").toUpperCase();
  return t.includes("VAT") && !t.includes("NON");
}

/** A regime the COR's tax types point to (W7 R1). "EXEMPT" is the exempt
 *  regime, stored as no regime. */
export type RegimeProposal = "VAT" | "PERCENTAGE" | "EXEMPT";

/**
 * The regime a COR's tax types propose, as the COR reader names them
 * ("Value-Added Tax", "Percentage Tax", "Income Tax", …): Value-Added Tax
 * proposes VAT-registered, Percentage Tax proposes percentage tax, and income
 * tax with neither proposes exempt from business tax. Anything ambiguous — both
 * business taxes, or no income tax and no business tax — proposes nothing. A
 * proposal is never a choice: the person confirms it before saving.
 */
export function proposeRegime(taxTypes: readonly string[]): RegimeProposal | null {
  const types = new Set(taxTypes.map((t) => t.trim().toLowerCase()));
  const vat = types.has("value-added tax");
  const pct = types.has("percentage tax");
  if (vat && !pct) return "VAT";
  if (pct && !vat) return "PERCENTAGE";
  if (!vat && !pct && types.has("income tax")) return "EXEMPT";
  return null;
}

/**
 * The warning a business-tax return shows when the client's regime does not
 * match it (W7 R2). A warning only: saving and filing stay allowed. Null when
 * the regime matches, or when the form is not one of the two.
 */
export function formRegimeWarning(
  form: "2550Q" | "2551Q",
  taxType: string | null | undefined,
): string | null {
  if (form === "2550Q") {
    return isVatRegistered(taxType)
      ? null
      : "This client is not VAT-registered. A 2550Q is normally filed only by VAT-registered taxpayers.";
  }
  if (isExempt(taxType)) {
    return "This client is exempt from business tax. A 2551Q is not normally filed for it.";
  }
  if (isVatRegistered(taxType)) {
    return "This client is VAT-registered. A 2551Q is normally filed by taxpayers under percentage tax.";
  }
  return null;
}
