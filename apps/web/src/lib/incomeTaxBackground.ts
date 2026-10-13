// incomeTaxBackground.ts — C5 (D55): what the income-tax editors SHOW of the return's
// background. The Portal's server decides what the XML and the print say (apps/api
// bir-forms/engine/taxpayer-background.ts); this mirrors its rules so an editor can say,
// before saving, which taxpayer type and ATC the return will carry. The browser never
// decides anything that is filed: a draft's saved figures and the client's record do,
// on the server.

export type CivilBox = "single" | "married" | "separated" | "widow";
export type FilerType = "single" | "prof" | "estate" | "trust" | "comp";
export type IncomeTaxAtc =
  "II011" | "II012" | "II013" | "II014" | "II015" | "II016" | "II017";

/** The client columns the rules read (a client row from GET /clients). */
export interface ClientBackground {
  kind?: string | null;
  civilStatus?: string | null;
  classification?: string | null;
  taxpayerType?: string | null;
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

export const FILER_LABEL: Record<FilerType, string> = {
  single: "Single Proprietor",
  prof: "Professional",
  estate: "Estate",
  trust: "Trust",
  comp: "Compensation Earner",
};

/** The template's own words for each ATC. */
export const ATC_LABEL: Record<IncomeTaxAtc, string> = {
  II011: "II011 Compensation Income",
  II012: "II012 Business Income – Graduated IT Rates",
  II013: "II013 Mixed Income – Graduated IT Rates",
  II014: "II014 Income from Profession – Graduated IT Rates",
  II015: "II015 Business Income – 8% IT Rate",
  II016: "II016 Mixed Income – 8% IT Rate",
  II017: "II017 Income from Profession – 8% IT Rate",
};

export interface IncomeMix {
  comp: number;
  sales: number;
  other: number;
}

export function deriveFiler(
  client: ClientBackground | undefined,
  mix: IncomeMix,
  rate: "graduated" | "eight",
  opts: { allowComp: boolean; allowMixed: boolean } = {
    allowComp: true,
    allowMixed: true,
  },
): { type: FilerType | null; atc: IncomeTaxAtc | null } {
  if (!client) return { type: null, atc: null };
  if (client.kind !== "individual") {
    const t = String(client.taxpayerType ?? "").toLowerCase();
    if (/estate/.test(t)) return { type: "estate", atc: null };
    if (/trust/.test(t)) return { type: "trust", atc: null };
    return { type: null, atc: null };
  }
  const c = String(client.classification ?? "").toLowerCase();
  const kind = /professional/.test(c) ? "prof" : /proprietor/.test(c) ? "single" : null;
  const biz = mix.sales > 0 || mix.other > 0;
  const comp = mix.comp > 0;
  const eight = rate === "eight";
  if (comp && !biz)
    return opts.allowComp ? { type: "comp", atc: "II011" } : { type: null, atc: null };
  if (comp && biz && opts.allowMixed)
    return { type: kind, atc: eight ? "II016" : "II013" };
  if (kind === "single") return { type: "single", atc: eight ? "II015" : "II012" };
  if (kind === "prof") return { type: "prof", atc: eight ? "II017" : "II014" };
  return { type: null, atc: null };
}

/** Typed amount → number (blank, junk → 0). */
export const amountOf = (v: string | undefined): number => {
  const n = Number(String(v ?? "").replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
};

/** What to tell the person when the Portal could not decide Item 6 / the ATC. */
export function undecidedHint(client: ClientBackground | undefined): string {
  if (!client) return "Choose the client first.";
  if (client.kind !== "individual") {
    return "Nothing is ticked: the form lists no ATC for this client. Set its taxpayer type to Estate or Trust to tick Item 6.";
  }
  return "Nothing is ticked: set the client's classification (Professional or Single Proprietorship) on its record.";
}
