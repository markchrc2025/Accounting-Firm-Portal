// contactNumber.ts - W25: the contact number and email the 0619-E, 1601-EQ and 1601-C carry
// (Items 11 and 13 and their like), filled from the client record when the draft has none.
//
// normalisedContact mirrors apps/api/src/bir-forms/engine/contact-number.ts exactly (U22):
// spaces, dashes, dots and brackets dropped; a number that then reads +63 or 63 and ten digits
// is written as 0 and those ten digits; anything else is kept as typed. The API decides whether
// the number will do; the web only fills the box the way the API writes it.

/** Said under a box the client record filled, until the owner edits it. */
export const PREFILL_HINT = "Filled from the client record.";

/** Spaces, dashes, dots and brackets are not part of the number. */
const SPACING = /[\s\-.()]/g;

export function normalisedContact(raw: string): string {
  const s = raw.replace(SPACING, "");
  const m = /^\+?63(\d{10})$/.exec(s);
  return m ? `0${m[1]}` : s;
}

type Field = "contact" | "email";
const FIELDS: Field[] = ["contact", "email"];

/** What the prefill wrote, for which client; a field the owner edited is dropped from it. */
export interface PartyPrefill {
  clientId: string;
  contact?: string;
  email?: string;
}

/**
 * The boxes after the client record is read. A blank box takes the client's value (the phone
 * normalised, the email trimmed). A box that still holds what the prefill wrote for a client
 * before (the client was changed on a new form) takes the new client's value, or goes blank
 * when the new client has none. Anything else (typed or saved) is left exactly as it is.
 * `patch` holds only the boxes that change; `prefill` records what is now prefilled.
 */
export function partyPrefill(
  current: { contact: string; email: string },
  client: { id: string; phone?: string | null; email?: string | null },
  prev: PartyPrefill | null,
): { patch: Partial<Record<Field, string>>; prefill: PartyPrefill } {
  const source: Record<Field, string> = {
    contact: normalisedContact(client.phone ?? ""),
    email: (client.email ?? "").trim(),
  };
  const patch: Partial<Record<Field, string>> = {};
  const prefill: PartyPrefill = { clientId: client.id };
  for (const f of FIELDS) {
    const cur = current[f];
    const heldPrev = !!prev && prev[f] !== undefined && cur === prev[f];
    if (cur.trim() !== "" && !heldPrev) continue; // typed or saved: never touched
    if (source[f] !== "") {
      if (cur !== source[f]) patch[f] = source[f];
      prefill[f] = source[f];
    } else if (heldPrev && cur !== "") {
      patch[f] = ""; // the previous client's value, and this client has none
    }
  }
  return { patch, prefill };
}
