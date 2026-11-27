// taxpayer-background.ts — C5/C6 (D55): the background items of the income-tax returns
// that the client's record decides, and the one the preparer chooses.
//
//   * civilStatusOf   Item 16 (1701, 1701A): the client's civilStatus, mapped
//                     case-insensitively onto the four boxes; anything else: none.
//   * taxpayerTypeOf  Item 6 (1701, 1701A) / Item 7 (1701Q): the client's Classification
//                     and nothing else — never the draft's figures. Professional and
//                     Single Proprietorship tick a box; anything else ticks none.
//   * chosenAtc       The ATC (Item 7 on the 1701 and 1701A, Item 8 on the 1701Q, Item 5
//                     on the 1702Q and 1702RT): what the preparer chose in the editor
//                     (draft key `atc`), checked against the choices the committed
//                     template prints for that form. No default, no suggestion; nothing
//                     chosen ticks nothing and writes nothing.
//
// Pure, apart from the refusal chosenAtc throws for an ATC the form does not print.

import { ATC_CHOICES, ATC_ITEM } from "@portal/shared";
import { ExportRefusal } from "./export-refusal";

export type CivilBox = "single" | "married" | "separated" | "widow";

/**
 * The Client form's options are "Single", "Married", "Widow/Widower" and "Legally
 * Separated" (apps/web ClientFormPage CIVIL_STATUSES). Older or imported records may
 * differ in case or punctuation; the plain synonyms below are accepted. Anything
 * else, or empty, ticks no box.
 */
export function civilStatusOf(raw: string | null | undefined): CivilBox | null {
  const k = String(raw ?? "")
    .toLowerCase()
    .replace(/[^a-z]/g, "");
  switch (k) {
    case "single":
      return "single";
    case "married":
      return "married";
    case "legallyseparated":
      return "separated";
    case "widowwidower":
    case "widower":
    case "widow":
    case "widowed":
      return "widow";
    default:
      return null;
  }
}

export type TaxpayerTypeBox = "single" | "prof";

/**
 * Item 6 is the client's Classification. The Client form stores "Professional",
 * "Single Proprietorship", "Domestic Corporation", "Partnership" or "" (Not set);
 * only the first two have a box on the individual returns. Case and surrounding
 * spaces are ignored; anything else, or empty, ticks none.
 */
export function taxpayerTypeOf(
  classification: string | null | undefined,
): TaxpayerTypeBox | null {
  const k = String(classification ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
  if (k === "professional") return "prof";
  if (k === "single proprietorship") return "single";
  return null;
}

export type IncomeTaxForm = "1701" | "1701A" | "1701Q" | "1702Q" | "1702RT";

/**
 * The ATC choices the committed template prints for the ATC item of each return, in the
 * order the template prints them, and the item each form prints the ATC as: @portal/shared
 * owns them (U27, D74); these are its codes.
 */
export const INCOME_TAX_ATC: Record<IncomeTaxForm, readonly string[]> =
  Object.fromEntries(
    Object.entries(ATC_CHOICES).map(([form, choices]) => [
      form,
      choices.map((c) => c.code),
    ]),
  ) as unknown as Record<IncomeTaxForm, readonly string[]>;

export { ATC_ITEM };

/**
 * The ATC the preparer chose, or null when none was chosen. An ATC the template does
 * not print for this form refuses the export and the preview, naming the ATC and the
 * form, the way the 2551Q refuses an ATC it cannot carry.
 */
export function chosenAtc(raw: unknown, form: IncomeTaxForm): string | null {
  const code = String(raw ?? "")
    .replace(/\s+/g, "")
    .toUpperCase();
  if (!code) return null;
  if (!INCOME_TAX_ATC[form].includes(code)) {
    const item = ATC_ITEM[form];
    throw new ExportRefusal(
      `Item ${item}: the ATC ${code} is not one of the ATC choices printed on BIR Form ${form}. Choose Item ${item} again, or clear it, then try again.`,
    );
  }
  return code;
}
