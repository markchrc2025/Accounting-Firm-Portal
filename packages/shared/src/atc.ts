/**
 * ============================================================================
 * THE ATC A RETURN CARRIES (U27, D74): the choices each form prints, and the gate
 * ----------------------------------------------------------------------------
 * An ATC is always chosen by a person (owner decision, 13 Oct): nothing here picks,
 * suggests or defaults one. A return whose form carries an ATC choice never leaves the
 * Portal (eBIRForms export, Mark as filed on either path, clear copy) while a required
 * one is empty; the Super Admin override bypasses only the missing BIR e-mail, never
 * this. Preview PDF stays open. A code the form does not list is refused when the draft
 * is written. The API and the web read these lists and sentences; nothing else may
 * retype them.
 * ============================================================================
 */

export type AtcForm = "1701" | "1701A" | "1701Q" | "1702Q" | "1702RT";
export type SpouseAtcForm = "1701" | "1701A" | "1701Q";

export interface AtcChoice {
  code: string;
  /** The words the BIR printed beside the box, dashes as printed. */
  label: string;
}

/** The filer's ATC choices each blank prints, in the order printed. */
export const ATC_CHOICES: Record<AtcForm, readonly AtcChoice[]> = {
  "1701": [
    { code: "II012", label: "II012 Business Income-Graduated IT Rates" },
    { code: "II014", label: "II014 Income from Profession–Graduated IT Rates" },
    { code: "II013", label: "II013 Mixed Income–Graduated IT Rates" },
    { code: "II011", label: "II011 Compensation Income" },
    { code: "II015", label: "II015 Business Income - 8% IT Rate" },
    { code: "II017", label: "II017 Income from Profession – 8% IT Rate" },
    { code: "II016", label: "II016 Mixed Income – 8% IT Rate" },
  ],
  "1701A": [
    { code: "II012", label: "II012 Business Income - Graduated IT Rates" },
    { code: "II014", label: "II014 Income from Profession – Graduated IT Rates" },
    { code: "II015", label: "II015 Business Income - 8% IT Rate" },
    { code: "II017", label: "II017 Income from Profession – 8% IT Rate" },
  ],
  "1701Q": [
    { code: "II012", label: "II012 Business Income-Graduated IT Rates" },
    { code: "II014", label: "II014 Income from Profession–Graduated IT Rates" },
    { code: "II013", label: "II013 Mixed Income–Graduated IT Rates" },
    { code: "II015", label: "II015 Business Income - 8% IT Rate" },
    { code: "II017", label: "II017 Income from Profession – 8% IT Rate" },
    { code: "II016", label: "II016 Mixed Income – 8% IT Rate" },
  ],
  // The 1702Q and 1702RT print one choice and a blank write-in line.
  "1702Q": [{ code: "IC055", label: "IC 055 Minimum Corporate Income Tax (MCIT)" }],
  "1702RT": [{ code: "IC055", label: "IC 055 Minimum Corporate Income Tax (MCIT)" }],
};

/** The spouse's ATC choices each blank prints, in the order printed. */
export const SPOUSE_ATC_CHOICES: Record<SpouseAtcForm, readonly AtcChoice[]> = {
  "1701": [
    { code: "II012", label: "II012 Business Income-Graduated IT Rates" },
    { code: "II014", label: "II014 Income from Profession–Graduated IT Rates" },
    { code: "II013", label: "II013 Mixed Income–Graduated IT Rates" },
    { code: "II011", label: "II011 Compensation Income" },
    { code: "II015", label: "II015 Business Income-8% IT Rate" },
    { code: "II017", label: "II017 Income from Profession–8% IT Rate" },
    { code: "II016", label: "II016 Mixed Income–8% IT Rate" },
  ],
  "1701A": [
    { code: "II012", label: "II012 Business Income-Graduated IT Rates" },
    { code: "II014", label: "II014 Income from Profession–Graduated IT Rates" },
    { code: "II015", label: "II015 Business Income-8% IT Rate" },
    { code: "II017", label: "II017 Income from Profession–8% IT Rate" },
  ],
  "1701Q": [
    { code: "II012", label: "II012 Business Income-Graduated IT Rates" },
    { code: "II014", label: "II014 Income from Profession-Graduated IT Rates" },
    { code: "II013", label: "II013 Mixed Income-Graduated IT Rates" },
    { code: "II011", label: "II011 Compensation Income" },
    { code: "II015", label: "II015 Business Income-8% IT Rate" },
    { code: "II017", label: "II017 Income from Profession-8% IT Rate" },
    { code: "II016", label: "II016 Mixed Income-8% IT Rate" },
  ],
};

/** The item number each blank prints for the filer's ATC. */
export const ATC_ITEM: Record<AtcForm, string> = {
  "1701": "7",
  "1701A": "7",
  "1701Q": "8",
  "1702Q": "5",
  "1702RT": "5",
};

/** The item number each blank prints for the spouse's ATC (the 1701's Part I on page 2). */
export const SPOUSE_ATC_ITEM: Record<SpouseAtcForm, string> = {
  "1701": "4",
  "1701A": "69",
  "1701Q": "20",
};

/** The Schedule 1 ATCs of the 2551Q the Portal can write (the eBIRForms dropdown's). */
export const PERCENTAGE_TAX_ATCS = [
  "PT010",
  "PT040",
  "PT041",
  "PT060",
  "PT070",
  "PT090",
  "PT120",
  "PT130",
] as const;

const isAtcForm = (f: string): f is AtcForm => f in ATC_CHOICES;
const isSpouseForm = (f: string): f is SpouseAtcForm => f in SPOUSE_ATC_CHOICES;

/** An ATC as stored: spaces dropped, upper case; "" when none. */
export function atcCode(raw: unknown): string {
  return String(raw ?? "")
    .replace(/\s+/g, "")
    .toUpperCase();
}

/** "1,234.50", 12, "-3": a number; anything else 0. */
function amountOf(v: unknown): number {
  const n = Number(String(v ?? "").replace(/[,\s]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

type Data = Record<string, unknown> | null | undefined;

/**
 * Whether the return carries a spouse with business or professional income: a spouse
 * column with sales or receipts (salesB) on the 1701Q or the 1701. The 1701A gates the
 * filer's ATC only (owner's list, 27 Nov).
 */
export function spouseAtcRequired(form: string, data: Data): boolean {
  if (form !== "1701Q" && form !== "1701") return false;
  return amountOf((data ?? {}).salesB) !== 0;
}

/** The 2551Q's Schedule 1 rows, as stored. */
function rowsOf(data: Data): { atc?: unknown; taxable?: unknown }[] {
  const rows = (data ?? {}).rows;
  return Array.isArray(rows) ? (rows as { atc?: unknown; taxable?: unknown }[]) : [];
}

/** What the gate says while the filer's ATC is empty. */
export const chooseAtcSentence = (item: string) =>
  `Choose the Item ${item} ATC before this return leaves the Portal.`;
/** What the gate says while the spouse's ATC is empty. */
export const chooseSpouseAtcSentence = (item: string) =>
  `Choose the spouse's Item ${item} ATC before this return leaves the Portal.`;
/** What the gate says for a 2551Q row with a taxable amount and no ATC. */
export const chooseRowAtcSentence = (row: number) =>
  `Schedule 1, row ${row} has a taxable amount but no ATC. Choose its ATC before this return leaves the Portal.`;

/**
 * The ATC gate (D74): every sentence that keeps this return in the Portal, in the order
 * the form prints the items; [] when nothing is missing or the form has no ATC choice.
 */
export function missingAtcs(form: string, data: Data): string[] {
  const d = data ?? {};
  const out: string[] = [];
  if (isAtcForm(form)) {
    if (atcCode(d.atc) === "") out.push(chooseAtcSentence(ATC_ITEM[form]));
    if (isSpouseForm(form) && spouseAtcRequired(form, d) && atcCode(d.spouseAtc) === "")
      out.push(chooseSpouseAtcSentence(SPOUSE_ATC_ITEM[form]));
  }
  if (form === "2551Q") {
    rowsOf(d).forEach((r, i) => {
      if (atcCode(r.atc) === "" && amountOf(r.taxable) !== 0)
        out.push(chooseRowAtcSentence(i + 1));
    });
  }
  return out;
}

/**
 * The write-path check: every ATC the draft holds must be one the form lists. Each
 * sentence names the field; [] when all are known (an empty ATC is not refused here).
 */
export function unknownAtcs(form: string, data: Data): string[] {
  const d = data ?? {};
  const out: string[] = [];
  if (isAtcForm(form)) {
    const code = atcCode(d.atc);
    if (code !== "" && !ATC_CHOICES[form].some((c) => c.code === code)) {
      const item = ATC_ITEM[form];
      out.push(
        `Item ${item}: the ATC ${code} is not one of the ATC choices printed on BIR Form ${form}. Choose Item ${item} again.`,
      );
    }
  }
  if (isSpouseForm(form)) {
    const code = atcCode(d.spouseAtc);
    if (code !== "" && !SPOUSE_ATC_CHOICES[form].some((c) => c.code === code)) {
      const item = SPOUSE_ATC_ITEM[form];
      out.push(
        `Item ${item} (the spouse's ATC): the ATC ${code} is not one of the ATC choices printed on BIR Form ${form}. Choose Item ${item} again.`,
      );
    }
  }
  if (form === "2551Q") {
    rowsOf(d).forEach((r, i) => {
      const code = atcCode(r.atc);
      if (code !== "" && !(PERCENTAGE_TAX_ATCS as readonly string[]).includes(code))
        out.push(
          `Schedule 1, row ${i + 1}: the ATC ${code} is not one of the ATCs the 2551Q offers. Choose its ATC again.`,
        );
    });
  }
  return out;
}
