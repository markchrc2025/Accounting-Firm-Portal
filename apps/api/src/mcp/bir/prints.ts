// prints.ts — U24: what a return will print for the client's contact number and e-mail, as the
// connector shows it. The same helpers as the print (contactNumberOf and emailOf), so the answer
// and the paper never disagree. A draft (or a filed return with no snapshot) reads the client, and
// its number is printed normalised to 11 digits; a filed return reads its sealed snapshot.
import {
  CONTACT_FORMS,
  contactDigits,
  contactNumberOf,
  emailOf,
  normalisedContact,
} from "../../bir-forms/engine/contact-number";
import { readFiledSnapshot } from "../../bir-forms/filed-snapshot";

const WITHHOLDING = new Set(["0619E", "1601EQ", "1601C"]);

export interface Prints {
  contactNumber: string | null;
  email: string | null;
}

/** The contact number and e-mail the return prints; null for a form that prints neither. */
export function printsOf(
  form: string,
  data: Record<string, unknown> | null | undefined,
  client: { phone: string | null; email: string | null },
  snapshot: { phone?: string | null; email?: string | null } | null,
): Prints | null {
  if (!CONTACT_FORMS.has(form)) return null;
  const source = snapshot ?? client;
  const raw = contactNumberOf(form, data, source.phone ?? null);
  // a sealed snapshot prints as filed (the eBIRForms returns' print drops the separators);
  // a draft prints the number normalised
  const contact = snapshot
    ? WITHHOLDING.has(form)
      ? raw
      : contactDigits(raw)
    : normalisedContact(raw);
  const email = emailOf(form, data, source.email ?? null);
  return { contactNumber: contact || null, email: email || null };
}

/** The phone and e-mail of a filed return's snapshot; null when it has none (a draft, or filed before U3). */
export function filedSnapshotOf(
  json: unknown,
): { phone: string | null; email: string | null } | null {
  if (json === null || json === undefined) return null;
  try {
    const s = readFiledSnapshot(json);
    return s ? { phone: s.phone, email: s.email } : null;
  } catch {
    return null;
  }
}
