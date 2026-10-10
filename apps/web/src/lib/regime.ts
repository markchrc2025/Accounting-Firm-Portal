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
