// incomeTaxBackground.ts — C5/C6 (D55 and its amendment): what the income-tax editors
// show of the return's background. The server decides what the XML and the print say
// (apps/api bir-forms/engine/taxpayer-background.ts); this mirrors its two small rules
// so an editor can say, before saving, what the return will carry:
//
//   * Item 6 (taxpayer type) is the client's Classification and nothing else.
//   * Item 16 (civil status) is the client's record; Items 17 and 18 are asked only of
//     a married taxpayer.
//
// Item 7 (the ATC) is not decided here or anywhere: the preparer chooses it from the
// choices the BIR printed on the form (ATC_CHOICES, word for word from the template).

export type CivilBox = "single" | "married" | "separated" | "widow";
export type TaxpayerTypeBox = "single" | "prof";
export type IncomeTaxForm = "1701" | "1701A" | "1701Q";
/** The returns whose editors carry an ATC selector (the 1702s have no Item 6 or civil status). */
export type AtcForm = IncomeTaxForm | "1702Q" | "1702RT";

/** The client columns the editors read (a client row from GET /clients). */
export interface ClientBackground {
  kind?: string | null;
  civilStatus?: string | null;
  classification?: string | null;
}

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

export const CIVIL_LABEL: Record<CivilBox, string> = {
  single: "Single",
  married: "Married",
  separated: "Legally Separated",
  widow: "Widow/er",
};

/** The boxes of Item 6 the Classification can tick, as the form prints them. */
export const TAXPAYER_TYPE_LABEL: Record<TaxpayerTypeBox, string> = {
  single: "Single Proprietor",
  prof: "Professional",
};

/** "Professional" and "Single Proprietorship" have a box; anything else has none. */
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

/** The form's own item number for the taxpayer type and for the ATC. */
export const ITEM_NUMBERS: Record<AtcForm, { type: string; atc: string }> = {
  "1701": { type: "6", atc: "7" },
  "1701A": { type: "6", atc: "7" },
  "1701Q": { type: "7", atc: "8" },
  "1702Q": { type: "", atc: "5" },
  "1702RT": { type: "", atc: "5" },
};

/**
 * The ATC choices the committed template prints, in the order it prints them, each with
 * its printed description: @portal/shared owns them (U27, D74), for the API and the web
 * alike. packages/bir-pdf's C6 test reads the blank forms and checks these words.
 */
export { ATC_CHOICES, SPOUSE_ATC_CHOICES, SPOUSE_ATC_ITEM } from "@portal/shared";
export type { AtcChoice } from "@portal/shared";

/** What the editor says while no ATC is chosen. */
export const CHOOSE_ATC = (form: AtcForm) =>
  form === "1702Q" || form === "1702RT"
    ? "Choose the ATC."
    : `Choose Item ${ITEM_NUMBERS[form].atc} (ATC).`;

/** What the editor says when the client's Classification ticks no Item 6 box. */
export const SET_CLASSIFICATION = "Set this client's Classification on the Client page.";
