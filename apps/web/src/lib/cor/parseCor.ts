// parseCor.ts — pure layout parser for BIR Form 2303 (Certificate of
// Registration) OCR text. No IO / browser deps, so it's unit-testable and
// shared by the browser extractor (extractCor.ts).
//
// Calibrated against REAL Tesseract output of scanned/photocopied CORs (see
// the test fixtures): table cells wrap across lines ("INDIVIDUAL INCOME" /
// "TAX 01A"), keywords get mangled ("INDIVIDUEL", "NTAGE TAX", "NCOME"), the
// BIR seal destroys the "REVENUE DISTRICT OFFICE NO." header, and values carry
// neighbouring-column noise (registration dates glued to the trade name).
// Strategy: anchor on the most OCR-resilient tokens — the OCN number for the
// RDO, the dash-formatted TIN line for the name, "TRADE NAME 1" for the trade
// name, and fuzzy tax-type keywords over a JOINED table region for tax types.
//
// OCR of a scanned, watermarked COR is inherently imperfect — callers MUST let
// the user review/correct the result before applying it.

import type { TaxType, TaxpayerKind } from "./types";

/** Fields parsed from a COR — every field is best-effort and may be empty. */
export interface ExtractedCor {
  kind?: TaxpayerKind;
  regName?: string;
  lastName?: string;
  firstName?: string;
  middleName?: string;
  tradeName?: string;
  tin?: string; // 9 digits, no dashes
  branch?: string; // up to 5 digits
  rdo?: string; // 3-digit RDO code
  address?: string;
  zip?: string;
  taxTypes: TaxType[];
  rawText: string;
}

// ---------------------------------------------------------------- patterns

// BIR return codes, longest/most-specific first (JS alternation is
// leftmost-position, first-alternative — "1701Q" must precede "1701").
const FORM_CODES =
  "1701Q|1701A|1702RT|1702Q|1702EX|1702MX|2550Q|2550M|2551Q|2551M|1601C|1601EQ|1601FQ|0619E|0619F|1701|1702|0605|2000";
const FORM_SRC = String.raw`\b(` + FORM_CODES + String.raw`)\b`;

// Bounded gap for the withholding anchors: may not cross into another
// withholding row — i.e. may not contain WITHHOLDING, another qualifier word,
// or a form code (a form code in the gap means we've left the type cell).
const WHT_GAP =
  String.raw`(?:(?!WITHHOLDING|COMPENSATION|EXPANDED|CREDITABLE|FINAL|` + FORM_CODES + String.raw`).){0,60}?`;

// Fuzzy tax-type anchors, matched against the joined table-region text. Gaps
// allow the "|" cell separators and stray punctuation OCR inserts; leading
// wildcards absorb clipped word starts ("NTAGE TAX" for PERCENTAGE TAX,
// "NCOME" for INCOME). `individual` marks rows whose form can be inferred
// from the filing frequency when the form cell itself was unreadable. The
// withholding rows print in both word orders ("WITHHOLDING TAX - EXPANDED"
// and "EXPANDED WITHHOLDING TAX"), so both are anchored.
const TYPE_ANCHORS: Array<{ src: string; type: string; individual?: boolean }> = [
  { src: String.raw`INDIVID\w*[\s!|.,:;-]{0,4}I?NCOME`, type: "Income Tax", individual: true },
  { src: String.raw`VALUE[\s|-]{0,4}ADDED[\s|]{0,4}TAX|\bVAT\b`, type: "Value-Added Tax" },
  { src: String.raw`\w*NTAGE[\s|]{0,4}TAX`, type: "Percentage Tax" },
  { src: String.raw`REGISTRATION[\s|]{0,4}FEE`, type: "Registration Fee" },
  { src: String.raw`WITHHOLDING` + WHT_GAP + String.raw`COMPENSATION`, type: "Withholding Tax - Compensation" },
  {
    src:
      String.raw`WITHHOLDING` + WHT_GAP + String.raw`(?:EXPANDED|CREDITABLE)` +
      String.raw`|(?:EXPANDED|CREDITABLE)[\s|]{0,6}WITHHOLDING`,
    type: "Withholding Tax - Expanded",
  },
  {
    src: String.raw`WITHHOLDING` + WHT_GAP + String.raw`FINAL|FINAL[\s|]{0,6}WITHHOLDING`,
    type: "Withholding Tax - Final",
  },
  { src: String.raw`DOCUMENTARY[\s|]{0,4}STAMP`, type: "Documentary Stamp Tax" },
  // Generic (corporate CORs say just "INCOME TAX") — keep last, least specific.
  { src: String.raw`INCOME[\s|]{0,4}TAX`, type: "Income Tax" },
];
const FREQ_SRC = String.raw`\b(ANNUALLY|QUARTERLY|MONTHLY)\b`;
// Day/year separator tolerates OCR's "," or "." ("February 3. 2022"); the year
// is constrained to 19xx/20xx so a stray form code (e.g. "0605") after a due
// date ("...November 15 0605") can't be consumed as the year.
const DATE_SRC = String.raw`\b(JAN(?:UARY)?|FEB(?:RUARY)?|MAR(?:CH)?|APR(?:IL)?|MAY|JUN(?:E)?|JUL(?:Y)?|AUG(?:UST)?|SEP(?:T(?:EMBER)?)?|OCT(?:OBER)?|NOV(?:EMBER)?|DEC(?:EMBER)?)\s*(\d{1,2})\s*[.,]?\s*((?:19|20)\d{2})\b`;
const MONTH_NUM: Record<string, string> = {
  JAN: "01", FEB: "02", MAR: "03", APR: "04", MAY: "05", JUN: "06",
  JUL: "07", AUG: "08", SEP: "09", OCT: "10", NOV: "11", DEC: "12",
};

// Unambiguous company tokens. Bare "CO" is deliberately NOT here — it's a
// common Filipino-Chinese surname/middle name ("SANTOS, MARIA CO"), so it only
// counts as a company marker when the name has no comma (see classification).
const COMPANY_RE =
  /\b(INC\.?|INCORPORATED|CORP\.?|CORPORATION|COMPANY|ENTERPRISES?|PARTNERSHIP|OPC|FOUNDATION|ASSOCIATION|COOPERATIVE)\b/;
const TRAILING_CO_RE = /(?:&|\bAND\b)\s*CO\.?\s*$|\bCO\.?\s*$/;
const TIN_SRC = String.raw`\d{3}\s*[-–—]?\s*\d{3}\s*[-–—]?\s*\d{3}\s*(?:[-–—]\s*\d{3,5})?`;
// OCR of the watermarked TIN cell also confuses look-alike glyphs inside the
// digit groups (O/Q/D→0, I/L→1, S→5, B→8, Z→2, G→6). The fuzzy pattern
// REQUIRES the printed dashes, so it can only fire on a TIN-shaped run —
// never on prose — and the lookarounds keep it off longer runs like the OCN.
const DIGITISH = String.raw`[0-9OQDILSBZG]`;
const FUZZY_TIN_SRC =
  String.raw`(?<![0-9A-Z])(${DIGITISH}{3})\s*[-–—]\s*(${DIGITISH}{3})\s*[-–—]\s*` +
  String.raw`(${DIGITISH}{3})(?:\s*[-–—]\s*(${DIGITISH}{3,5}))?(?![0-9A-Z])`;
/** Map OCR look-alike letters back to the digits they were misread from. */
function digitish(s: string): string {
  return s
    .replace(/[OQD]/g, "0")
    .replace(/[IL]/g, "1")
    .replace(/S/g, "5")
    .replace(/B/g, "8")
    .replace(/Z/g, "2")
    .replace(/G/g, "6");
}
// Column headers / boilerplate that must never be mistaken for a field value.
const HEADER_NOISE_SRC = String.raw`\bTIN\b|ISSUANCE|BRANCH\s*CODE|\bDATE\b|REGISTERING\s*OFFICE|HEAD\s*OFFICE|\bBRANCH\b|\(PSIC\)`;
const NAME_SUFFIXES = new Set(["JR", "JR.", "SR", "SR.", "II", "III", "IV"]);

// ---------------------------------------------------------------- helpers

/** First DATE_SRC match in `s`, as ISO yyyy-mm-dd (or ""). */
function firstIsoDate(s: string): string {
  const m = s.match(new RegExp(DATE_SRC));
  if (!m) return "";
  const mm = MONTH_NUM[m[1]!.slice(0, 3)];
  return mm ? `${m[3]}-${mm}-${m[2]!.padStart(2, "0")}` : "";
}

/** Pull the text following a label, on the same line or the next non-empty one. */
function valueAfter(lines: string[], labelRe: RegExp): string {
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const m = line.match(labelRe);
    if (!m) continue;
    const tail = line.slice((m.index ?? 0) + m[0].length).replace(/^[\s:.\-|]+/, "").trim();
    if (tail.length >= 2) return tail;
    for (let j = i + 1; j < Math.min(i + 3, lines.length); j++) {
      const nxt = lines[j]!.trim();
      if (nxt.length >= 2) return nxt;
    }
  }
  return "";
}

/** Strip TIN runs, dates and header words so a candidate string is just a name.
 *  Table borders binarise into junk glued to the name cell ("_190-… COMIA,
 *  MARJORIE ALCARAZ … oo"), so edge marks and O/0/underscore junk TOKENS are
 *  dropped too — but only at the edges, and never a trailing "." (it belongs
 *  to a "JR." suffix). */
function cleanName(s: string): string {
  const t = s
    .replace(new RegExp(TIN_SRC, "g"), " ")
    .replace(new RegExp(FUZZY_TIN_SRC, "g"), " ")
    .replace(new RegExp(DATE_SRC, "g"), " ")
    .replace(new RegExp(HEADER_NOISE_SRC, "g"), " ")
    .replace(/[|]/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
  const toks = t.split(/\s+/).filter(Boolean);
  while (toks.length && /^[O0~_\-.,|©®[\]{}]+$/i.test(toks[toks.length - 1]!)) toks.pop();
  while (toks.length && /^[O0~_\-.,|©®[\]{}]+$/i.test(toks[0]!)) toks.shift();
  return toks
    .join(" ")
    .replace(/^[\s_~'"©®|.:\-[\]{}]+|[\s_~'"©®|[\]{}]+$/g, "")
    .trim();
}

/** Clean a trade-name candidate: drop glued registration dates, PSIC tags,
 *  the glued CATEGORY column value and separator junk. Table-cell borders
 *  binarise into leading marks ("_| HEBREWS…"), so the leading strip class
 *  mirrors the trailing one (includes `_ ~ © ®`). Both are edge-anchored, so an
 *  internal hyphen ("13-8") is untouched and the CATEGORY strip is END-anchored
 *  only — "PRIMARY CARE PHARMACY" is a real trade name and keeps its first word. */
function cleanTradeName(s: string): string {
  return s
    .replace(new RegExp(DATE_SRC, "g"), " ")
    .replace(/[({[]\s*PSIC\s*[)}\]]?/g, " ")
    .replace(/(?:\s*\b(?:PRIMARY|SECONDARY)\b)+[\s:.\-|_~©®]*$/, " ")
    // Edge junk includes brackets/braces — an empty neighbouring cell's border
    // binarises into tokens like "[_]" glued before the value ("[_] NCV RICE
    // TRADING"). Parentheses are NOT stripped (real names use them).
    .replace(/^[\s:.\-|_~©®[\]{}"']+|[\s:.\-|_~©®[\]{}"']+$/g, "")
    // A lone trailing letter is border/CATEGORY-cell garble glued after the
    // value ("…APARTMENT RENTAL a January 25. 2024"), not part of the name.
    .replace(/(\S\s+\S.*)\s+[A-Z]$/, "$1")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/** Drop trailing OCR junk tokens (runs of O/0/dashes/tildes) from an address,
 *  then drop the "N.A." segments BIR prints for blank address components
 *  ("N.A., N.A., 25, MANALO ST, N.A., …" → "25, MANALO ST, …"). The filter is
 *  per comma-segment, so real words containing NA are untouched. */
function cleanAddress(s: string): string {
  const toks = s.split(/\s+/);
  while (toks.length && /^[O0~_\-.,|©®]+$/i.test(toks[toks.length - 1]!)) toks.pop();
  while (toks.length && /^[O0~_\-.,|©®]+$/i.test(toks[0]!)) toks.shift();
  return (
    toks
      .join(" ")
      .split(",")
      .map((seg) => seg.trim())
      .filter((seg) => seg && !/^N\.?\s*\/?\s*A\.?$/i.test(seg))
      .join(", ")
      // A registered address ends at the country — anything OCR glued after
      // "PHILIPPINES" (watermark/border fragments like "A TT A") is junk.
      .replace(/\b(PHILIPPINES)\b[\s\S]*$/, "$1")
      .replace(/\s{2,}/g, " ")
      .trim()
  );
}

/** The address block: everything after the REGISTERED/REGISTERING ADDRESS
 *  label up to the tax-types table. The 2019-revision COR wraps the address
 *  onto a second line ("… SECOND DISTRICT," / "PHILIPPINES"), so unlike
 *  valueAfter this joins continuation lines until a table/label boundary. */
function addressAfterLabel(lines: string[]): string {
  const labelRe = /REGISTER(?:ED|ING)\s*ADDRESS/;
  const stopRe =
    /\bTAX\s*TYPES?\b|\bFORM\s*TYPES?\b|\bFILING\b|REMINDERS|TRADE\s*NAME|LINE\s*OF\s*BUSINESS|REGISTERING\s*OFFICE|\bOCN\b/;
  // A continuation line must look like address content — a digit or a ≥3-letter
  // word containing a vowel. Table borders binarise into vowel-less garble
  // lines ("i — TTT TT ;") that would otherwise be joined onto the address.
  const looksLikeContent = (l: string) =>
    /\d/.test(l) || l.split(/\s+/).some((t) => /^[A-Z'.-]{3,}$/.test(t) && /[AEIOU]/.test(t));
  const leadJunk = /^[\s:.\-|_~©®[\]{}]+/;
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i]!.match(labelRe);
    if (!m) continue;
    const parts: string[] = [];
    const tail = lines[i]!.slice((m.index ?? 0) + m[0].length).replace(leadJunk, "").trim();
    if (tail.length >= 2 && !stopRe.test(tail)) parts.push(tail);
    for (let j = i + 1; j < Math.min(i + 4, lines.length) && parts.length < 3; j++) {
      const next = lines[j]!.trim();
      if (!next) continue;
      if (stopRe.test(next)) break;
      if (!looksLikeContent(next)) break; // border garble — the address ended
      parts.push(next.replace(leadJunk, ""));
    }
    if (parts.length) return parts.join(" ");
  }
  return "";
}

/** COR rows print the return each tax type is filed on; when OCR destroyed the
 *  form cell, fall back to the type's standard return (all user-reviewable). */
function fallbackForm(type: string, individual: boolean, frequency: string): string {
  if (type === "Percentage Tax") return frequency === "Monthly" ? "2551M" : "2551Q";
  if (type === "Registration Fee") return "0605";
  if (type === "Value-Added Tax") {
    return frequency === "Monthly" ? "2550M" : frequency === "Quarterly" ? "2550Q" : "";
  }
  if (type === "Income Tax" && individual) {
    return frequency === "Annually" ? "1701" : frequency === "Quarterly" ? "1701Q" : "";
  }
  return "";
}

// ---------------------------------------------------------------- parse

/** Parse OCR text from a BIR Form 2303 into structured fields. */
export function parseCorText(raw: string): ExtractedCor {
  const text = raw.toUpperCase();
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.replace(/\s{2,}/g, " ").trim())
    .filter(Boolean);
  const out: ExtractedCor = { taxTypes: [], rawText: raw };

  // --- TIN + branch: 9 digits, optionally followed by a 3-5 digit branch ---
  // The table border binarises into junk GLUED to the TIN ("_190-784-550-…").
  // "_" is a word character, so a \b anchor silently fails there — anchor on
  // "not adjacent to another digit" instead, so glued punctuation is fine but
  // the pattern still can't fire inside a longer digit run (the OCN).
  const tinMatch = text.match(
    /(?<!\d)(\d{3})\s*[-–—]?\s*(\d{3})\s*[-–—]?\s*(\d{3})(?:\s*[-–—]\s*(\d{3,5}))?(?!\d)/,
  );
  if (tinMatch) {
    out.tin = tinMatch[1]! + tinMatch[2]! + tinMatch[3]!;
    if (tinMatch[4]) out.branch = tinMatch[4];
  } else {
    // No clean digit run anywhere — try the dash-anchored fuzzy pattern and
    // map misread look-alike letters back to digits (still user-reviewed).
    const fz = text.match(new RegExp(FUZZY_TIN_SRC));
    if (fz) {
      out.tin = digitish(fz[1]! + fz[2]! + fz[3]!);
      if (fz[4]) out.branch = digitish(fz[4]);
    }
  }

  // --- RDO code ---
  // The BIR seal overlaps "REVENUE DISTRICT OFFICE NO. NNN", so OCR often
  // destroys it. The OCN ("046RC2024...") prints in a clean area and STARTS
  // with the same RDO code — prefer it; fall back to the header when readable.
  const ocn = text.match(/\b(\d{3})\s*RC\s*\d{8,}/);
  if (ocn) {
    out.rdo = ocn[1];
  } else {
    const rdo = text.match(/DISTRICT\s*OFFICE\s*NO\.?\s*(\d{2,3})/);
    if (rdo) out.rdo = rdo[1]!.padStart(3, "0");
  }

  // --- Name of taxpayer ---
  // The COR header row is three columns (TIN | NAME | ISSUANCE DATE), so the
  // name lives on the value line mixed with the TIN and a date. Read the
  // dash-formatted TIN line specifically (the OCN's long digit run has no
  // dashes) and strip the TIN/date/header noise; fall back to the label.
  let nameCand = "";
  const fuzzyTinRe = new RegExp(FUZZY_TIN_SRC);
  const tinLineIdx = lines.findIndex((l) => /\d{3}-\d{3}-\d{3}/.test(l) || fuzzyTinRe.test(l));
  if (tinLineIdx >= 0) nameCand = cleanName(lines[tinLineIdx]!);
  if (nameCand.replace(/[^A-Z]/g, "").length < 3) {
    nameCand = cleanName(valueAfter(lines, /NAME\s*OF\s*TAXPAYER/));
  }
  if (nameCand.replace(/[^A-Z]/g, "").length >= 3) {
    if (COMPANY_RE.test(nameCand)) {
      out.kind = "non-individual";
      out.regName = nameCand;
    } else if (nameCand.includes(",")) {
      // Individual names print as "LAST, FIRST MIDDLE [SUFFIX]" — hold a
      // trailing suffix (JR/III/…) aside, then the final token is the middle
      // name and the suffix rides with the first name.
      out.kind = "individual";
      const ci = nameCand.indexOf(",");
      out.lastName = nameCand.slice(0, ci).trim();
      const rest = nameCand.slice(ci + 1).trim().split(/\s+/).filter(Boolean);
      const suffix = rest.length && NAME_SUFFIXES.has(rest[rest.length - 1]!) ? rest.pop() : "";
      if (rest.length >= 2) {
        out.middleName = rest[rest.length - 1];
        out.firstName = [rest.slice(0, -1).join(" "), suffix].filter(Boolean).join(" ");
      } else {
        out.firstName = [rest.join(" "), suffix].filter(Boolean).join(" ");
      }
    } else if (TRAILING_CO_RE.test(nameCand)) {
      // "SMITH BELL & CO." — comma-less trailing CO reads as a company.
      out.kind = "non-individual";
      out.regName = nameCand;
    } else {
      out.regName = nameCand; // unknown shape — keep for review
    }
  }

  // --- Trade name (Business Information Details) ---
  // OCR damages this cell two different ways, so read it in two tiers:
  //   Tier 1 — the "TRADE NAME 1" label survives with its value on the same
  //     line ("TRADE NAME 1 | NCV RICE TRADING"): take the text after the label.
  //     This is preferred because the CATEGORY|REGISTRATION-DATE header row
  //     often OCRs to caps garble ("TT CAMCOAV | RECSTRATONDATE") that a
  //     positional scan would otherwise mistake for the value.
  //   Tier 2 — the label itself failed OCR (value on a bare line, e.g.
  //     Nichievan): take the first data line in the section, AFTER the (possibly
  //     garbled) column-header row and BEFORE the PSIC code, so a lost value is
  //     left empty rather than capturing the header or the Line of Business.
  const TN_LABEL = /TRA[DC]E\s*NA[MN]E\s*\d*/i;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (!TN_LABEL.test(line)) continue;
    const c = cleanTradeName(line.replace(TN_LABEL, ""));
    if (c && c.replace(/[^A-Z]/gi, "").length >= 3) {
      out.tradeName = c;
      break;
    }
  }
  if (!out.tradeName) {
    const biIdx = lines.findIndex((l) => /BUSINESS\s*INFORMATION/.test(l));
    if (biIdx >= 0) {
      let skippedHeader = false;
      for (let j = biIdx + 1; j < lines.length; j++) {
        const raw = lines[j]!;
        const body = raw.replace(TN_LABEL, "");
        if (/^[({[]?\s*\d{4,5}\s*[-–]/.test(body)) break; // PSIC code cell → past the value
        if (/LINE\s*OF\s*BUSINESS|REMINDERS|TAXPAYER\s*TYPE/i.test(raw)) break;
        if (/^[({[]?\s*PSIC\s*[)}\]]?\s*$/i.test(body)) continue; // lone (PSIC) sub-label
        // The first row after "BUSINESS INFORMATION DETAILS" is the
        // CATEGORY | REGISTRATION DATE column header — skip it even when OCR
        // garbled it beyond a clean keyword match.
        if (!skippedHeader) {
          skippedHeader = true;
          continue;
        }
        const c = cleanTradeName(body);
        if (c && c.replace(/[^A-Z]/gi, "").length >= 3) {
          out.tradeName = c;
          break;
        }
      }
    }
  }

  // --- Registered address + ZIP ---
  // Older CORs print "REGISTERED ADDRESS"; the 2019 revision prints
  // "REGISTERING ADDRESS" and wraps onto a second line — handle both.
  const addr = addressAfterLabel(lines);
  if (addr) {
    out.address = cleanAddress(addr);
    const zip = out.address.match(/\b(\d{4})\b/);
    if (zip) out.zip = zip[1];
  }

  // --- Tax Types table ---
  // Bound the scan to the table region so the REMINDERS prose (which mentions
  // "income tax return … 2551Q … quarterly") can't manufacture phantom rows,
  // then JOIN the region: table cells wrap ("INDIVIDUAL INCOME" / "TAX 01A"),
  // so per-line matching misses rows. Fuzzy anchors mark each row's start;
  // the segment up to the next anchor carries its form, frequency and date.
  let lo = lines.findIndex((l) => /\bTAX\s*TYPES?\b/.test(l));
  if (lo < 0) lo = 0;
  let hi = lines.findIndex(
    (l, idx) =>
      idx > lo &&
      /(REMINDERS|TAXPAYER\s*TYPE|BUSINESS\s*INFORMATION|HEREBY\s*CERTIFY|THIS\s*CERTIFICATE|TRADE\s*NAME|LINE\s*OF\s*BUSINESS)/.test(l),
  );
  if (hi < 0) hi = lines.length;
  const region = lines.slice(lo, hi).join(" ");

  // Collect anchors (deduping overlapping same-type matches, e.g. the generic
  // INCOME TAX pattern re-matching inside an INDIVIDUAL INCOME TAX hit).
  const anchors: Array<{ index: number; type: string; individual: boolean }> = [];
  for (const a of TYPE_ANCHORS) {
    for (const m of region.matchAll(new RegExp(a.src, "g"))) {
      const idx = m.index ?? 0;
      if (anchors.some((k) => k.type === a.type && Math.abs(k.index - idx) < 30)) continue;
      anchors.push({ index: idx, type: a.type, individual: Boolean(a.individual) });
    }
  }
  anchors.sort((a, b) => a.index - b.index);

  const seen = new Set<string>();
  for (let i = 0; i < anchors.length; i++) {
    const anchor = anchors[i]!;
    const seg = region.slice(anchor.index, anchors[i + 1]?.index ?? region.length);
    const startDate = firstIsoDate(seg);
    const freqRaw = seg.match(new RegExp(FREQ_SRC))?.[1] ?? "";
    const frequency = freqRaw ? freqRaw[0] + freqRaw.slice(1).toLowerCase() : "";
    // Match the form on the segment with dates removed, so a FILING START DATE
    // year like "June 1, 2000" can't be mistaken for the DST form code 2000 —
    // and only accept a bare "2000" on an actual Documentary Stamp row.
    let form = seg.replace(new RegExp(DATE_SRC, "g"), " ").match(new RegExp(FORM_SRC))?.[1] ?? "";
    if (form === "2000" && anchor.type !== "Documentary Stamp Tax") form = "";
    if (!form) form = fallbackForm(anchor.type, anchor.individual, frequency);
    const key = anchor.type + "|" + form;
    if (seen.has(key)) continue;
    seen.add(key);
    out.taxTypes.push({ type: anchor.type, form, frequency, startDate });
  }

  return out;
}
