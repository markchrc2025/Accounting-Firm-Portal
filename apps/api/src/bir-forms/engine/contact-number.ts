// contact-number.ts — U21: a return does not leave the Portal without a contact number.
//
// eBIRForms will not submit a return that has none. The client's contact number is
// Client.phone (the filing snapshot's `phone` once filed); it is printed in Item 10 of
// the 2551Q (telNo) and the same item of the other returns (see CONTACT_ITEM). The three
// withholding returns carry a contact number of their own typed in the draft
// (data.contact); when that is blank they use the client's.
//
// U22: eBIRForms accepts the contact number only as plain 11 digits (09171234567). The
// number is normalised first (spaces, dashes, dots and brackets dropped; +63 or 63 and ten
// digits written as 0 and those ten), then it must be exactly 11 digits. Pure.
import type { FilingData } from "./types";

export const CONTACT_MUST_BE_11 =
  "The client's contact number must be 11 digits, like 09171234567. eBIRForms accepts no other form.";

export const CONTACT_NUMBER_REQUIRED =
  "Add the client's contact number before this return leaves the Portal. eBIRForms will not submit a return without one.";

/** The returns that print a contact number: the seven eBIRForms returns and the three withholding returns. */
export const CONTACT_FORMS: ReadonlySet<string> = new Set([
  "2551Q",
  "2550Q",
  "1701",
  "1701A",
  "1701Q",
  "1702Q",
  "1702RT",
  "0619E",
  "1601EQ",
  "1601C",
]);

/** The separators the print engine drops from a contact number (the maps' `drop`). */
const SEPARATORS = " -()+.";

/**
 * Where each form prints the client's contact number: the map version, the field key and
 * the item number. The 1701Q's blank has no box for it, so it has no entry.
 */
export const CONTACT_ITEM: Record<
  string,
  { version: string; key: string; item: string }
> = {
  "0619E": { version: "2018-01", key: "f0619E:contact", item: "contact" },
  "1601EQ": { version: "2019-01", key: "f1601EQ:contact", item: "contact" },
  "1601C": { version: "2018-01", key: "f1601C:contact", item: "contact" },
  "1701": { version: "2018-01", key: "frm1701:txtPg1I15TelNum", item: "15" },
  "1701A": { version: "2018-01", key: "frm1701A:txtTelNum", item: "15" },
  "1702Q": { version: "2018-01", key: "frm1702q:txtTelNum", item: "10" },
  "1702RT": { version: "2018-01", key: "frm1702RT:txtPg1Pt1I11Contact", item: "11" },
  "2550Q": { version: "2024-04", key: "frm2550qv2024:taxpayerContactNumber", item: "11" },
  "2551Q": { version: "2018-01", key: "frm2551Qv2018:telNo", item: "10" },
};

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");

/** The number as the paper carries it: the separators dropped. */
export const contactDigits = (raw: string) =>
  [...raw].filter((c) => !SEPARATORS.includes(c)).join("");

/**
 * The contact number a return prints: the client's, or for a withholding return the one
 * typed in the draft when there is one.
 */
export function contactNumberOf(
  form: string,
  data: FilingData | Record<string, unknown> | null | undefined,
  clientPhone: string | null | undefined,
): string {
  if (form === "0619E" || form === "1601EQ" || form === "1601C") {
    const typed = str((data as Record<string, unknown> | null | undefined)?.contact);
    if (typed !== "") return typed;
  }
  return str(clientPhone);
}

/** Spaces, dashes, dots and brackets are not part of the number. */
const SPACING = /[\s\-.()]/g;

/**
 * The contact number as eBIRForms takes it: spaces, dashes, dots and brackets dropped; a
 * number that then reads +63 or 63 and ten digits is written as 0 and those ten digits.
 * Anything else is kept as typed (and is refused by contactRefusal unless it is 11 digits).
 */
export function normalisedContact(raw: string): string {
  const s = raw.replace(SPACING, "");
  const m = /^\+?63(\d{10})$/.exec(s);
  return m ? `0${m[1]}` : s;
}

/** True when the number, normalised, is exactly 11 digits. */
export const validContact = (raw: string) => /^\d{11}$/.test(normalisedContact(raw));

/** The sentence that refuses this contact number, or null when it will do. */
export function contactRefusal(form: string, raw: string): string | null {
  if (!CONTACT_FORMS.has(form)) return null;
  const n = normalisedContact(raw);
  if (n === "") return CONTACT_NUMBER_REQUIRED;
  return /^\d{11}$/.test(n) ? null : CONTACT_MUST_BE_11;
}

/**
 * The rows the print engine reads for one of the seven eBIRForms returns, with the contact
 * number set as the withholding returns' maps already set it (the separators dropped): the
 * seven maps have no `drop`, so "0917 123 4567" would overflow their boxes. The XML itself
 * is not changed.
 */
export function printRowsWithContact(
  form: string,
  rows: [string, string][],
): [string, string][] {
  const key = CONTACT_ITEM[form]?.key;
  if (!key) return rows;
  return rows.map(([k, v]) => (k === key ? [k, contactDigits(v)] : [k, v]));
}
