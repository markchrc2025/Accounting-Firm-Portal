// bir-file-name.ts — U18 (D58): the file name the BIR's confirmation e-mail names
// ("File name: 111222333000-2550Qv2024-122026Q1.xml") is what ties the e-mail to a return.
//
// The shape DIFFERS BY FORM, and the TIN's branch is 3 digits in some files and 5 in
// others (eBIRForms 7.9.6.0 lengthened it): the first 9 digits are the TIN, the rest the
// branch, and a branch is compared as a NUMBER (000 and 00000 are the same head office).
//
// VERIFIED from real e-mails the owner supplied (invented TINs below):
//   2550Q   111222333000-2550Qv2024-122026Q1.xml   TIN+branch(3), form, v+year, month 12, year, quarter
//   1701Q   111222333000-1701Qv2018-2025Q3.xml     TIN+branch(3), form, v+year, year, quarter (no month)
//   1601EQ  11122233300000-1601EQ-2026Q3.xml       TIN+branch(5), form, no version, year, quarter
//   0619E   11122233300000-0619E-072026.xml        TIN+branch(5), form, no version, month, year
// DERIVED (not yet verified) from the Portal's own fileName functions, which write no
// dashes; the dashes are optional here, so both spellings are read:
//   2551Q   …2551Qv201812<yyyy>Q<n>.xml     1701   …1701v2018<mm><yyyy>.xml
//   1701A   …1701A<mm><yyyy>.xml            1702Q  …1702Q<yyyy>Q<n>.xml
//   1702RT  …1702RTv2018<mm><yyyy>.xml
// An amended return is saved with a V suffix (V1, V2) just before .xml: accepted for
// every form, UNVERIFIED.

export interface ParsedBirFileName {
  /** The file name as read (trimmed). */
  fileName: string;
  /** The first nine digits. */
  tin: string;
  /** The branch as a number (000 and 00000 are both 0). */
  branch: number;
  /** The branch as written in the file name. */
  branchText: string;
  /** How many digits the branch was written with (3 or 5). */
  branchDigits: 3 | 5;
  form: string;
  /** The version year of the form's file name ("2024"), or null where there is none. */
  version: string | null;
  /** The month the file name carries after the version (the year-end month), or null. */
  fyEndMonth: number | null;
  taxYear: number;
  quarter: number | null;
  /** The month of a monthly return (0619E), or null. */
  month: number | null;
  /** The V1, V2… of an amended return, or null. */
  amendment: number | null;
  /** "verified" (seen in a real e-mail) or "derived" (built from the Portal's own function). */
  shape: "verified" | "derived";
}

const TB = "(\\d{9})(\\d{3}|\\d{5})";
const DASH = "-?";
const AMEND = "(?:V(\\d+))?";
const END = "\\.xml";

interface Shape {
  form: string;
  shape: "verified" | "derived";
  re: RegExp;
  /** Maps the regex groups after TIN, branch (g[3]…) to the fields. */
  read: (
    g: string[],
  ) => Pick<
    ParsedBirFileName,
    "version" | "fyEndMonth" | "taxYear" | "quarter" | "month"
  > & { amend: string | undefined };
}

const rx = (body: string) => new RegExp(`^${TB}${DASH}${body}${AMEND}${END}$`, "i");

const withMonthYearQuarter = (g: string[]) => ({
  version: g[3]!,
  fyEndMonth: Number(g[4]),
  taxYear: Number(g[5]),
  quarter: Number(g[6]),
  month: null,
  amend: g[7],
});
const withMonthYear = (g: string[]) => ({
  version: g[3]!,
  fyEndMonth: Number(g[4]),
  taxYear: Number(g[5]),
  quarter: null,
  month: null,
  amend: g[6],
});

const SHAPES: Shape[] = [
  {
    form: "2550Q",
    shape: "verified",
    re: rx(`2550Q${DASH}v(\\d{4})${DASH}(\\d{2})(\\d{4})Q([1-4])`),
    read: withMonthYearQuarter,
  },
  {
    form: "1701Q",
    shape: "verified",
    re: rx(`1701Q${DASH}v(\\d{4})${DASH}(\\d{4})Q([1-4])`),
    read: (g) => ({
      version: g[3]!,
      fyEndMonth: null,
      taxYear: Number(g[4]),
      quarter: Number(g[5]),
      month: null,
      amend: g[6],
    }),
  },
  {
    form: "1601EQ",
    shape: "verified",
    re: rx(`1601EQ${DASH}(\\d{4})Q([1-4])`),
    read: (g) => ({
      version: null,
      fyEndMonth: null,
      taxYear: Number(g[3]),
      quarter: Number(g[4]),
      month: null,
      amend: g[5],
    }),
  },
  {
    form: "0619E",
    shape: "verified",
    re: rx(`0619E${DASH}(\\d{2})(\\d{4})`),
    read: (g) => ({
      version: null,
      fyEndMonth: null,
      taxYear: Number(g[4]),
      quarter: null,
      month: Number(g[3]),
      amend: g[5],
    }),
  },
  {
    form: "2551Q",
    shape: "derived",
    re: rx(`2551Q${DASH}v(\\d{4})${DASH}(\\d{2})(\\d{4})Q([1-4])`),
    read: withMonthYearQuarter,
  },
  {
    form: "1701",
    shape: "derived",
    re: rx(`1701${DASH}v(\\d{4})${DASH}(\\d{2})(\\d{4})`),
    read: withMonthYear,
  },
  {
    form: "1701A",
    shape: "derived",
    re: rx(`1701A${DASH}(\\d{2})(\\d{4})`),
    read: (g) => ({
      version: null,
      fyEndMonth: Number(g[3]),
      taxYear: Number(g[4]),
      quarter: null,
      month: null,
      amend: g[5],
    }),
  },
  {
    form: "1702Q",
    shape: "derived",
    re: rx(`1702Q${DASH}(\\d{4})Q([1-4])`),
    read: (g) => ({
      version: null,
      fyEndMonth: null,
      taxYear: Number(g[3]),
      quarter: Number(g[4]),
      month: null,
      amend: g[5],
    }),
  },
  {
    form: "1702RT",
    shape: "derived",
    re: rx(`1702RT${DASH}v(\\d{4})${DASH}(\\d{2})(\\d{4})`),
    read: withMonthYear,
  },
];

/** Read a BIR file name; null if it is none of the shapes above. */
export function parseBirFileName(raw: string): ParsedBirFileName | null {
  const name = String(raw ?? "").trim();
  if (!name) return null;
  for (const s of SHAPES) {
    const m = s.re.exec(name);
    if (!m) continue;
    const g = m.slice(0) as string[];
    const f = s.read(g);
    // calendar sanity: a month is 1–12 wherever the name carries one
    if (f.fyEndMonth !== null && (f.fyEndMonth < 1 || f.fyEndMonth > 12)) return null;
    if (f.month !== null && (f.month < 1 || f.month > 12)) return null;
    const branchText = m[2]!;
    return {
      fileName: name,
      tin: m[1]!,
      branch: Number(branchText),
      branchText,
      branchDigits: branchText.length === 5 ? 5 : 3,
      form: s.form,
      version: f.version,
      fyEndMonth: f.fyEndMonth,
      taxYear: f.taxYear,
      quarter: f.quarter,
      month: f.month,
      amendment: f.amend === undefined ? null : Number(f.amend),
      shape: s.shape,
    };
  }
  return null;
}

/** "111-222-333-000": the TIN and branch as the file name wrote them. */
export function shownTin(p: ParsedBirFileName): string {
  return `${p.tin.slice(0, 3)}-${p.tin.slice(3, 6)}-${p.tin.slice(6, 9)}-${p.branchText}`;
}
