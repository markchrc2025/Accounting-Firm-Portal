// contact-number.ts — U21: a return does not leave the Portal without a contact number.
//
// eBIRForms will not submit a return that has none. The client's contact number is
// Client.phone (the filing snapshot's `phone` once filed); it is printed in Item 10 of
// the 2551Q (telNo) and the same item of the other returns (see CONTACT_ITEM). The three
// withholding returns carry a contact number of their own typed in the draft
// (data.contact); when that is blank they use the client's.
//
// The digits rule is the one the print engine already applies to the 0619-E, 1601-EQ and
// 1601-C (C9): the separators " -()+." are not characters of the number, and the number
// has at most 12 digits. Pure.
import type { FilingData } from "./types";

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
export const CONTACT_MAX = 12;

/**
 * Where each form prints the client's contact number: the map version, the field key and
 * the item, as the print engine words them in its own refusals ("<form> <version> <key>
 * (item <item>)"). The 1701Q's blank has no box for it, so it has no entry.
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
const kept = contactDigits;

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

/** The sentence that refuses this contact number, or null when it will do. */
export function contactRefusal(form: string, raw: string): string | null {
  if (!CONTACT_FORMS.has(form)) return null;
  const digits = kept(raw);
  if (!/\d/.test(digits)) return CONTACT_NUMBER_REQUIRED;
  if (digits.length > CONTACT_MAX) {
    const at = CONTACT_ITEM[form];
    const where = at
      ? `${form} ${at.version} ${at.key} (item ${at.item})`
      : `${form} contact number`;
    return `${where}: "${raw}" is ${digits.length} characters but the paper has ${CONTACT_MAX} boxes`;
  }
  return null;
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
