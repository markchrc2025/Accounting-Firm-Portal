/**
 * mapping.ts — code, not the model, turns one receipt the AI read into a row of the
 * expenses-v2 template's 27 columns (U11 R7). The model reports what is printed
 * and what it doubts; this derives the VAT split, refuses values the import would
 * refuse (blank + a doubt quoting what was read, so the row is reviewed rather than
 * lost), and decides Needs Review.
 */
import {
  EXPENSES_V2_HEADERS,
  round2,
  type ScanCells,
  type ScanDoubt,
} from "@portal/shared";
import { VAT_RATE } from "../mcp/mcp-write-tools";
import {
  DOCUMENT_TYPES,
  MAX_REFERENCE_LENGTH,
} from "../purchase-transactions/import/expense-import.constants";
import {
  isRealIsoDate,
  normaliseTin,
} from "../purchase-transactions/import/expense-import.rules";
import type { AnswerReceipt } from "./answer";

export const VAT_BACKED_OUT = "VAT backed out of inclusive total";
export const SELLER_VAT_UNKNOWN = "Cannot tell whether the seller is VAT-registered.";

export interface MapContext {
  /** The client's names (business and registered): a buyer printed on the receipt
   *  that matches neither is flagged. */
  clientNames: string[];
  /** The uploaded file's original name (Source File). */
  fileName: string;
  /** COA codes allowed on expense rows (the template's COA sheet). */
  allowedCodes: Set<string>;
}

const norm = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, "");

function soldToIsClient(soldTo: string, clientNames: string[]): boolean {
  const s = norm(soldTo);
  if (!s) return true;
  return clientNames.some((c) => {
    const n = norm(c);
    return n.length > 0 && (n === s || n.includes(s) || s.includes(n));
  });
}

export function mapReceipt(
  r: AnswerReceipt,
  ctx: MapContext,
): { cells: ScanCells; doubts: ScanDoubt[] } {
  const doubts: ScanDoubt[] = [...r.doubts];
  const remarks: string[] = [];
  let needsReview = false;
  const refuse = (field: ScanDoubt["field"], reason: string) =>
    doubts.push({ field, reason });

  // Date
  let date: string | null = null;
  if (r.date !== null) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(r.date) && isRealIsoDate(r.date)) date = r.date;
    else refuse("Date", `Read "${r.date}", which is not a date.`);
  }

  // Document type: one of the import's codes, or blank.
  let docType: string | null = null;
  if (r.documentType !== null) {
    if (DOCUMENT_TYPES.some((d) => d.code === r.documentType)) docType = r.documentType;
    else
      refuse(
        "Document Type",
        `Read "${r.documentType}", which is not one of the document types.`,
      );
  }

  // Vendor TIN, exactly as printed, when it is in one of the four accepted forms.
  let tin: string | null = null;
  let branch: string | null = r.vendor.branch;
  if (r.vendor.tin !== null) {
    if (normaliseTin(r.vendor.tin, r.vendor.branch).error) {
      refuse(
        "Vendor TIN",
        `Read "${r.vendor.tin}", which is not a TIN in one of the four accepted forms.`,
      );
      branch = null;
    } else tin = r.vendor.tin;
  }

  // Reference number: text, at most 32 characters.
  let ref: string | null = r.referenceNumber;
  if (ref !== null && ref.length > MAX_REFERENCE_LENGTH) {
    refuse(
      "Reference Number",
      `Read "${ref}", which is longer than ${MAX_REFERENCE_LENGTH} characters.`,
    );
    ref = null;
  }

  // Amounts: a printed breakdown is copied; a lone total is split by the seller's status.
  const a = r.amounts;
  let vatable = a.vatableSales;
  let vat = a.vat;
  let other: number | null = null;
  const breakdown = [a.vatableSales, a.vat, a.vatExempt, a.zeroRated].some(
    (v) => v !== null,
  );
  if (!breakdown && a.total !== null) {
    if (r.sellerVatStatus === "VAT_REGISTERED") {
      vatable = round2(a.total / (1 + VAT_RATE));
      vat = round2(a.total - vatable);
      remarks.push(VAT_BACKED_OUT);
    } else if (r.sellerVatStatus === "NON_VAT") {
      other = a.total;
    } else {
      other = a.total;
      needsReview = true;
      remarks.push(SELLER_VAT_UNKNOWN);
    }
  }

  // COA: one of the allowed expense accounts, or blank.
  let coa: string | null = null;
  if (r.coaCode !== null) {
    if (ctx.allowedCodes.has(r.coaCode)) coa = r.coaCode;
    else
      refuse("COA Code", `Read "${r.coaCode}", which is not an allowed expense account.`);
  }

  // A receipt made out to someone else.
  if (r.soldTo !== null && !soldToIsClient(r.soldTo, ctx.clientNames)) {
    refuse("Remarks", `The receipt is made out to "${r.soldTo}", not to the client.`);
  }

  if (doubts.length > 0 || tin === null) needsReview = true;
  for (const d of doubts) remarks.push(`${d.field}: ${d.reason}`);

  const values: Record<string, string | number | null> = {
    Date: date,
    "Document Type": docType,
    "Vendor TIN": tin,
    "Vendor Branch": branch,
    "Vendor Registered Name": r.vendor.registeredName,
    "Vendor Lastname": r.vendor.lastName,
    "Vendor Firstname": r.vendor.firstName,
    "Vendor Middlename": r.vendor.middleName,
    "Trade Name": r.vendor.tradeName,
    Address: r.vendor.address,
    City: r.vendor.city,
    Province: r.vendor.province,
    "Postal Code": r.vendor.postalCode,
    "Reference Number": ref,
    "Vatable Amount": vatable,
    "VAT Amount": vat,
    "VAT-Exempt Amount": a.vatExempt,
    "Zero-rated Amount": a.zeroRated,
    "Other Non-vatable": other,
    "Gross Total": a.total,
    Description: r.description,
    "COA Code": coa,
    ATC: null,
    "Withholding Amount": null,
    "Source File": ctx.fileName,
    "Needs Review": needsReview ? "Y" : "N",
    Remarks: remarks.length > 0 ? remarks.join("; ") : null,
  };
  const cells = Object.fromEntries(
    EXPENSES_V2_HEADERS.map((h) => [h, values[h] ?? null]),
  ) as ScanCells;
  return { cells, doubts };
}
