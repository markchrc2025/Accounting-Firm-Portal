// expense-import.rules.ts — pure rules of the Expenses import v2 (U6): cell
// reading, TIN normalisation (R5), footing (R4) and the split by treatment
// (D23, D24). No I/O, no Nest, so every rule is testable on its own.
import { round2 } from "@portal/shared";
import {
  FOOTING_TOLERANCE,
  NO_VAT_CATEGORY,
  VATABLE_CATEGORY,
  type Classification,
} from "./expense-import.constants";

export type Regime = "VAT" | "PERCENTAGE";

// --- cells ------------------------------------------------------------------

/** A cell's value as trimmed text ("" when blank). Dates become ISO. */
export function cellText(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? "" : v.toISOString().slice(0, 10);
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "";
  if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
  return String(v).trim();
}

/** Excel serial / JS Date / ISO or m/d/y string → 'YYYY-MM-DD', or null. */
export function cellToIsoDate(v: unknown): string | null {
  if (v instanceof Date) {
    return Number.isNaN(v.getTime()) ? null : v.toISOString().slice(0, 10);
  }
  if (typeof v === "number" && Number.isFinite(v)) {
    // Excel serial: day 0 = 1899-12-30 (the 1900 leap-year quirk included).
    const d = new Date(Math.round((v - 25569) * 86400 * 1000));
    return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
  }
  const s = cellText(v);
  if (!s) return null;
  const iso = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/.exec(s);
  if (iso) return `${iso[1]}-${iso[2]!.padStart(2, "0")}-${iso[3]!.padStart(2, "0")}`;
  const mdy = /^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/.exec(s);
  if (mdy) return `${mdy[3]}-${mdy[1]!.padStart(2, "0")}-${mdy[2]!.padStart(2, "0")}`;
  return null;
}

/** True when the ISO date is a real calendar date. */
export function isRealIsoDate(iso: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return false;
  const d = new Date(`${iso}T00:00:00.000Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === iso;
}

/** A money cell → { value } (null when blank) or { error }. Accepts numbers and
 *  numeric text with thousands separators; rejects negatives. */
export function parseMoney(v: unknown, label: string): { value: number | null; error?: string } {
  if (v === null || v === undefined || v === "") return { value: null };
  let n: number;
  if (typeof v === "number") n = v;
  else {
    const s = cellText(v).replace(/[,\s₱]/g, "");
    if (s === "") return { value: null };
    if (!/^-?\d+(\.\d+)?$/.test(s)) return { value: null, error: `${label} "${cellText(v)}" is not a number.` };
    n = Number(s);
  }
  if (!Number.isFinite(n)) return { value: null, error: `${label} is not a number.` };
  if (n < 0) return { value: null, error: `${label} cannot be negative.` };
  return { value: round2(n) };
}

// --- TIN (R5) -----------------------------------------------------------------

export interface TinResult {
  tin: string | null;
  branch: string | null;
  error?: string;
}

const TIN_ERROR =
  "Vendor TIN must be 000-000-000, 000-000-000-000, 000-000-000-00000 or 000000000-00000 (dashes optional).";

/**
 * Accepts the four TIN forms with or without dashes; returns nine digits plus
 * a five-digit branch (a three-digit branch is left-padded, 000 → 00000). A
 * blank TIN is allowed (D28) and returns nulls. A Vendor Branch column value
 * overrides a TIN with no branch and must agree with a TIN that carries one.
 */
export function normaliseTin(tinRaw: unknown, branchRaw: unknown): TinResult {
  const tinText = cellText(tinRaw);
  const branchText = cellText(branchRaw);
  const branchFromColumn = normaliseBranch(branchText);
  if (branchFromColumn === "invalid") {
    return { tin: null, branch: null, error: "Vendor Branch must be 3 or 5 digits (e.g. 000 or 00000)." };
  }
  if (!tinText) {
    return { tin: null, branch: branchFromColumn };
  }
  if (!/^[\d-\s]+$/.test(tinText)) return { tin: null, branch: null, error: TIN_ERROR };
  const digits = tinText.replace(/[-\s]/g, "");
  let tin: string;
  let branch: string | null = null;
  if (digits.length === 9) tin = digits;
  else if (digits.length === 12) {
    tin = digits.slice(0, 9);
    branch = digits.slice(9).padStart(5, "0");
  } else if (digits.length === 14) {
    tin = digits.slice(0, 9);
    branch = digits.slice(9);
  } else {
    return { tin: null, branch: null, error: TIN_ERROR };
  }
  if (branch && branchFromColumn && branch !== branchFromColumn) {
    return {
      tin: null,
      branch: null,
      error: `Vendor TIN carries branch ${branch} but Vendor Branch says ${branchFromColumn}.`,
    };
  }
  return { tin, branch: branch ?? branchFromColumn ?? "00000" };
}

function normaliseBranch(text: string): string | null | "invalid" {
  if (!text) return null;
  if (!/^\d{1,5}$/.test(text)) return "invalid";
  return text.padStart(5, "0");
}

/** "000-111-222-00000" for people; the record stores the two parts. */
export function formatTin(tin: string | null | undefined, branch: string | null | undefined): string {
  if (!tin) return "";
  const t = tin.replace(/\D/g, "").padStart(9, "0");
  const b = (branch ?? "00000").padStart(5, "0");
  return `${t.slice(0, 3)}-${t.slice(3, 6)}-${t.slice(6, 9)}-${b}`;
}

// --- vendor -------------------------------------------------------------------

export interface VendorNameParts {
  regName?: string;
  lastName?: string;
  firstName?: string;
  middleName?: string;
  tradeName?: string;
}

/** Registered name for a juridical vendor; "LAST, FIRST MIDDLE" for an
 *  individual; the trade name as a last resort. */
export function vendorDisplayName(p: VendorNameParts): string | null {
  if (p.regName) return p.regName;
  if (p.lastName || p.firstName) {
    const given = [p.firstName, p.middleName].filter(Boolean).join(" ");
    return [p.lastName, given].filter(Boolean).join(", ");
  }
  return p.tradeName || null;
}

// --- amounts (R4, D23, D24) --------------------------------------------------

export interface Breakdown {
  vatable: number;
  vat: number;
  exempt: number;
  zeroRated: number;
  other: number;
}

export function footsToGross(parts: number[], gross: number, tolerance = FOOTING_TOLERANCE): boolean {
  const sum = round2(parts.reduce((a, b) => a + b, 0));
  return Math.abs(sum - round2(gross)) <= tolerance + 1e-9;
}

/** One record the importer will write for a treatment present on the row. */
export interface RecordPart {
  classification: Classification;
  /** What lands in `netAmount`: net of VAT for a VAT client; the gross of the
   *  part for a non-VAT client (D23). */
  netAmount: number;
  /** Creditable input VAT — VAT clients only. */
  inputVAT?: number;
  /** The VAT printed on the receipt, kept as a figure on both regimes. */
  taxAmount?: number;
  inputVATCategory?: string;
  vatClaimable: boolean;
  /** What this part cost in cash, for totals. */
  gross: number;
}

/**
 * Split one receipt row into records by treatment (D24). The VATable part is
 * the only one that changes with the regime: a VAT-registered client books it
 * net and claims the VAT; a non-VAT client books the gross and keeps the VAT
 * as a non-claimable figure (D23). Treatments with a zero amount produce no
 * record.
 */
export function splitRow(b: Breakdown, regime: Regime): RecordPart[] {
  const out: RecordPart[] = [];
  const isVat = regime === "VAT";
  if (b.vatable > 0 || b.vat > 0) {
    out.push(
      isVat
        ? {
            classification: "VATABLE",
            netAmount: round2(b.vatable),
            inputVAT: round2(b.vat),
            taxAmount: round2(b.vat),
            inputVATCategory: VATABLE_CATEGORY,
            vatClaimable: true,
            gross: round2(b.vatable + b.vat),
          }
        : {
            classification: "VATABLE",
            netAmount: round2(b.vatable + b.vat),
            taxAmount: round2(b.vat),
            vatClaimable: false,
            gross: round2(b.vatable + b.vat),
          },
    );
  }
  // Keys are omitted, not set to undefined, on a non-VAT client: the record
  // genuinely has no category there, and the tests check for absence.
  const noVat = (classification: Classification, amount: number): RecordPart => ({
    classification,
    netAmount: round2(amount),
    ...(isVat ? { inputVATCategory: NO_VAT_CATEGORY } : {}),
    vatClaimable: false,
    gross: round2(amount),
  });
  if (b.exempt > 0) out.push(noVat("VAT_EXEMPT", b.exempt));
  if (b.zeroRated > 0) out.push(noVat("ZERO_RATED", b.zeroRated));
  if (b.other > 0) out.push(noVat("OTHER_NON_VATABLE", b.other));
  return out;
}

/** Duplicate key within one file (R6): vendor TIN + reference + date + gross,
 *  or vendor TIN + date + gross when there is no reference. */
export function fileDuplicateKey(p: {
  tin: string | null;
  referenceNo: string | null;
  date: string;
  gross: number;
}): string {
  return p.referenceNo
    ? `ref|${p.tin ?? ""}|${p.referenceNo}|${p.date}|${round2(p.gross).toFixed(2)}`
    : `noref|${p.tin ?? ""}|${p.date}|${round2(p.gross).toFixed(2)}`;
}
