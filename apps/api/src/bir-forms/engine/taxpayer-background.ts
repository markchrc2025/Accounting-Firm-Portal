// taxpayer-background.ts — C5 (D55): the background items of the income-tax returns
// that the client's record and the form's own rules decide, never the draft.
//
//   * civilStatusOf   Item 16 (1701) / 16 (1701A): the client's civilStatus, mapped
//                     case-insensitively onto the four boxes; anything else: none.
//   * deriveFiler     Item 6 (taxpayer type) and Item 7/8 (ATC) from the client's
//                     classification (or, for an estate or trust, its taxpayer type),
//                     the rate chosen, and the income mix the draft holds.
//
// Pure. Exactly one box per item, or none when the Portal cannot tell.

import type { Taxpayer } from "./types";

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

export type FilerType = "single" | "prof" | "estate" | "trust" | "comp";
export type IncomeTaxAtc =
  "II011" | "II012" | "II013" | "II014" | "II015" | "II016" | "II017";

export interface Filer {
  /** Item 6 (1701) / Item 7 (1701Q) / Item 6 (1701A). */
  type: FilerType | null;
  /** Item 7 (1701) / Item 8 (1701Q) / Item 7 (1701A). */
  atc: IncomeTaxAtc | null;
}

export interface IncomeMix {
  /** Compensation income of the filer (the form's A column). */
  comp: number;
  /** Sales/receipts of the filer. */
  sales: number;
  /** Other non-operating income of the filer. */
  other: number;
}

/** The business kind the client's classification names; null if it names none. */
function businessKind(tp: Taxpayer | null): "single" | "prof" | null {
  const c = String(tp?.classification ?? "").toLowerCase();
  if (/professional/.test(c)) return "prof";
  if (/proprietor/.test(c)) return "single";
  return null;
}

/**
 * Item 6 and the ATC of an individual's, estate's or trust's income-tax return.
 *
 *   estate or trust (non-individual client whose taxpayer type says so):
 *       Item 6 Estate / Trust; ATC none (the form lists no ATC for them);
 *   compensation income only:       Compensation Earner, II011;
 *   compensation and business:      Item 6 the business kind; ATC II013 (graduated) / II016 (8%);
 *   business or profession only:    Item 6 the business kind;
 *       single proprietor II012 / II015, professional II014 / II017;
 *   the client's classification names no business kind: Item 6 none and, unless the
 *       filer has compensation income as well, ATC none.
 *
 * `allowComp` and `allowMixed` are false on the returns that have no such filer
 * (1701A and 1701Q): they then tick no compensation or mixed ATC.
 */
export function deriveFiler(
  tp: Taxpayer | null,
  mix: IncomeMix,
  rate: "graduated" | "eight",
  opts: { allowComp: boolean; allowMixed: boolean } = {
    allowComp: true,
    allowMixed: true,
  },
): Filer {
  if (!tp) return { type: null, atc: null };
  if (tp.kind !== "individual") {
    const t = String(tp.taxpayerType ?? "").toLowerCase();
    if (/estate/.test(t)) return { type: "estate", atc: null };
    if (/trust/.test(t)) return { type: "trust", atc: null };
    return { type: null, atc: null };
  }
  const biz = mix.sales > 0 || mix.other > 0;
  const comp = mix.comp > 0;
  const kind = businessKind(tp);
  const eight = rate === "eight";
  if (comp && !biz) {
    return opts.allowComp ? { type: "comp", atc: "II011" } : { type: null, atc: null };
  }
  if (comp && biz && opts.allowMixed) {
    return { type: kind, atc: eight ? "II016" : "II013" };
  }
  if (kind === "single") return { type: "single", atc: eight ? "II015" : "II012" };
  if (kind === "prof") return { type: "prof", atc: eight ? "II017" : "II014" };
  return { type: null, atc: null };
}
