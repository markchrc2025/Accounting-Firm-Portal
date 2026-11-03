// certificate2307.ts — BIR Form 2307 as the print engine reads it (C7, D56).
//
// The 2307 is a certificate issued to a payee, not an e-filed return: it has no eBIRForms
// export. This builds the rows @portal/bir-pdf prints on the BIR's own blank (the keys of
// packages/bir-pdf/maps/2307-2018-01.json) from what the certificate holds:
//
//   * Part II, the payor: the client's record while the certificate is a draft (Item 7
//     prints the BIR registered name only, never a trade or display name); the filing
//     snapshot once issued (D12) — the caller passes whichever applies;
//   * Part I and the signatory lines: as typed in the certificate's data. The payee's
//     CONFORME block falls back to the payee's own name and TIN, as the editor's replica
//     does;
//   * Part III: block A from data.rows, block B from data.rowsB (empty until C8 gives the
//     editor an entry for it). Amounts are passed through as typed — the print engine
//     writes them with thousands separators and two decimals and refuses a third
//     decimal; it never rounds. Each Total row is the exact sum of the printed rows,
//     computed by compute2307 (the certificate's own totals) and written to the centavo.
//
// Pure. A certificate issued before the replica (no 4A, 5, 8A or block B, a payee without a
// branch code) prints what it holds and leaves the rest blank; it is never refused for that.

import { compute2307 } from "./compute2307";
import { ExportRefusal } from "./export-refusal";
import type { FilingData, Row2307 } from "./types";

/** The payor block of a certificate: the client's record, or the filing snapshot. */
export interface PayorBlock {
  kind?: string | null;
  regName?: string | null;
  lastName?: string | null;
  firstName?: string | null;
  middleName?: string | null;
  businessName?: string | null;
  tin?: string | null;
  branch?: string | null;
  address?: string | null;
  city?: string | null;
  zip?: string | null;
}

/** W7 R6: a draft prints only with its payor's BIR name in Item 7. */
export const PAYOR_NAME_MISSING =
  "Complete the client's registered name (or last and first name for an individual) before printing this certificate.";

/** The form prints ten data rows in each Part III block. */
export const BLOCK_ROWS = 10;

/** Calendar bounds of each quarter, MM/DD — Item 1 From and To. */
const QUARTER_BOUNDS: Record<number, [string, string]> = {
  1: ["01/01", "03/31"],
  2: ["04/01", "06/30"],
  3: ["07/01", "09/30"],
  4: ["10/01", "12/31"],
};

const str = (v: unknown) => (v == null ? "" : String(v));
const digitsOf = (v: unknown) => str(v).replace(/\D/g, "");

/**
 * The taxpayer's name as a BIR certificate prints it (W7 R6): "LAST, FIRST MIDDLE" for an
 * individual, the registered name for anyone else; "" when the fields it needs are empty.
 * The web's registeredName (lib/birFiling.ts), word for word.
 */
export function registeredName(src: PayorBlock): string {
  if (str(src.kind).trim() === "individual") {
    const last = str(src.lastName).trim();
    const first = str(src.firstName).trim();
    const middle = str(src.middleName).trim();
    if (!last || !first) return "";
    return `${last}, ${first}${middle ? ` ${middle}` : ""}`;
  }
  return str(src.regName).trim();
}

/** A TIN as the form prints it: 000-000-000-00000, as many groups as given (formatTin). */
export function formatTin(tin: unknown): string {
  const d = digitsOf(tin);
  return [d.slice(0, 3), d.slice(3, 6), d.slice(6, 9), d.slice(9)]
    .filter((g) => g !== "")
    .join("-");
}

/**
 * The TIN digits with their branch code: nine digits plus five (tin14), the branch being
 * the one the TIN carries or, failing that, the one given. Fewer than nine digits: as typed.
 */
export function tin14(tin: unknown, branch?: unknown): string {
  const digits = digitsOf(tin);
  if (digits.length < 9) return digits;
  const given = digits.slice(9, 14) || digitsOf(branch);
  return digits.slice(0, 9) + (given ? given.padStart(5, "0") : "");
}

/** The 8 digits an MM/DD/YYYY box row holds (the replica's mmddyyyy). */
export function mmddyyyy(value: unknown): string {
  const s = str(value).trim();
  if (s === "") return "";
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (iso) return iso[2]! + iso[3]! + iso[1]!;
  return s.replace(/\D/g, "").slice(0, 8);
}

/** "TITLE / TIN 000-000-000-00000"; either half alone prints alone (W3 R6). */
function titleTinLine(title: unknown, tin: unknown): string {
  const t = str(title).trim();
  const n = formatTin(tin);
  return [t, n ? `TIN ${n}` : ""].filter(Boolean).join(" / ");
}

/** The certificate's file name: payor TIN and branch, form, period (the editor's own). */
export function certificateFileName(
  form: string,
  period: string,
  tin?: string | null,
): string {
  const digits = digitsOf(tin);
  const prefix = digits
    ? `${digits.slice(0, 9)}${(digits.slice(9) || "000").padStart(3, "0")}-`
    : "";
  const per = period ? `-${period}` : "";
  return `${prefix}${form}${per}.pdf`;
}

/** Centavos as a plain amount, "1234.56" (the print engine adds the separators). */
function plain(c: number): string {
  const sign = c < 0 ? "-" : "";
  const a = Math.abs(c);
  return `${sign}${Math.floor(a / 100)}.${String(a % 100).padStart(2, "0")}`;
}
const cents = (n: number) => Math.round(n * 100);

const hasAmount = (r: Row2307) =>
  [r.m1, r.m2, r.m3, r.tax].some((v) => v != null && String(v).trim() !== "");

type Rows = [string, string][];

/** One Part III block: its ten rows and its Total row. */
function block(prefix: "a" | "b", rows: Row2307[], out: Rows): void {
  if (rows.length > BLOCK_ROWS) {
    throw new ExportRefusal(
      `This certificate has ${rows.length} rows in Part III block ${prefix.toUpperCase()}; the form has room for ${BLOCK_ROWS}.`,
    );
  }
  const comp = compute2307({ rows });
  const put = (k: string, v: unknown) => {
    const s = str(v).trim();
    if (s !== "") out.push([`c2307:${k}`, s]);
  };
  rows.forEach((r, i) => {
    const n = i + 1;
    put(`${prefix}${n}Desc`, r.desc);
    put(`${prefix}${n}Atc`, r.atc);
    put(`${prefix}${n}M1`, r.m1);
    put(`${prefix}${n}M2`, r.m2);
    put(`${prefix}${n}M3`, r.m3);
    put(`${prefix}${n}Tax`, r.tax);
    // An untouched row prints no total, as the replica's row does.
    if (hasAmount(r)) put(`${prefix}${n}Total`, plain(cents(comp.rows[i]!.total)));
  });
  // The Total row prints only once there is something to total.
  if (rows.some(hasAmount)) {
    put(`${prefix}TotalM1`, plain(cents(comp.tM1)));
    put(`${prefix}TotalM2`, plain(cents(comp.tM2)));
    put(`${prefix}TotalM3`, plain(cents(comp.tM3)));
    put(`${prefix}TotalIncome`, plain(cents(comp.totalIncome)));
    put(`${prefix}TotalTax`, plain(cents(comp.totalTax)));
  }
}

/**
 * The rows to print a 2307 on the BIR's blank. `filed`: an issued certificate is never
 * refused for a missing payor name (it falls back to the business name its snapshot holds).
 */
export function build2307PrintRows(
  data: FilingData,
  payor: PayorBlock,
  opts: { filed: boolean; period?: string },
): Rows {
  const d = data ?? {};
  const out: Rows = [];
  const put = (k: string, v: unknown) => {
    const s = str(v).trim();
    if (s !== "") out.push([`c2307:${k}`, s]);
  };

  // ---- Item 1: the quarter's first and last day, on the calendar year ---------------
  const m = /^(\d{4})-Q([1-4])$/.exec(str(opts.period));
  const year = digitsOf(d.year ?? m?.[1]).slice(0, 4);
  const qn = Number(digitsOf(d.quarter ?? m?.[2])) || 1;
  const [qFrom, qTo] = QUARTER_BOUNDS[qn] ?? QUARTER_BOUNDS[1]!;
  put("periodFrom", mmddyyyy(year ? `${qFrom}/${year}` : ""));
  put("periodTo", mmddyyyy(year ? `${qTo}/${year}` : ""));

  // ---- Part I: the payee, as typed ------------------------------------------------------
  const payeeTin14 = tin14(d.payeeTin, d.payeeBranch);
  put("payeeTin1", payeeTin14.slice(0, 3));
  put("payeeTin2", payeeTin14.slice(3, 6));
  put("payeeTin3", payeeTin14.slice(6, 9));
  put("payeeBranch", payeeTin14.slice(9, 14));
  put("payeeName", d.payeeName);
  put("payeeAddress", d.payeeAddress);
  put("payeeZip", d.payeeZip);
  put("payeeForeignAddress", d.payeeForeignAddress);

  // ---- Part II: the payor ---------------------------------------------------------------
  const name =
    registeredName(payor) || (opts.filed ? str(payor.businessName).trim() : "");
  // A draft without its payor's BIR name is not printed (W7 R6); an issued one is never refused (W8 R3).
  if (!name && !opts.filed) throw new ExportRefusal(PAYOR_NAME_MISSING);
  const payorTin14 = tin14(payor.tin, payor.branch);
  put("payorTin1", payorTin14.slice(0, 3));
  put("payorTin2", payorTin14.slice(3, 6));
  put("payorTin3", payorTin14.slice(6, 9));
  put("payorBranch", payorTin14.slice(9, 14));
  put("payorName", name);
  put("payorAddress", [str(payor.address), str(payor.city)].filter(Boolean).join(", "));
  put("payorZip", payor.zip);

  // ---- Part III ---------------------------------------------------------------------------
  block("a", (d.rows as Row2307[] | undefined) ?? [], out);
  block("b", (d.rowsB as Row2307[] | undefined) ?? [], out);

  // ---- the two signature areas ---------------------------------------------------------
  const sig = (prefix: "payor" | "payee", nameFallback: string, tinFallback: string) => {
    const read = (k: string) => str(d[`${prefix}Signatory${k}`] ?? d[`${prefix}${k}`]);
    put(`${prefix}SigName`, read("Name") || nameFallback);
    put(`${prefix}SigTitleTin`, titleTinLine(read("Title"), read("Tin") || tinFallback));
    put(`${prefix}AgentNo`, read("TaxAgentNo"));
    put(`${prefix}AgentIssued`, mmddyyyy(read("TaxAgentIssued")));
    put(`${prefix}AgentExpiry`, mmddyyyy(read("TaxAgentExpiry")));
  };
  sig("payor", "", "");
  sig("payee", str(d.payeeName), payeeTin14);
  return out;
}
