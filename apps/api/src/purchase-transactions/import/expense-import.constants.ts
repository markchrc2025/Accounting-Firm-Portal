// expense-import.constants.ts — the shape of the Expenses import template v2
// (U6). Everything the generator writes and the importer reads is named here
// once, so the two cannot drift apart.
import { InputVATCategory } from "@portal/shared";

export const TEMPLATE_VERSION = "expenses-v2";

/** Sheet names. The importer reads CLIENT and EXPENSES; the rest are for people. */
export const SHEET = {
  INSTRUCTIONS: "Instructions",
  CLIENT: "CLIENT",
  EXPENSES: "EXPENSES",
  REFERENCE: "REFERENCE",
  COA: "COA",
} as const;

/** The data sheet's header row, in order. The importer rejects a file whose
 *  header row differs, so a renamed or reordered column cannot be misread. */
export const EXPENSES_HEADERS = [
  "Date",
  "Document Type",
  "Vendor TIN",
  "Vendor Branch",
  "Vendor Registered Name",
  "Vendor Lastname",
  "Vendor Firstname",
  "Vendor Middlename",
  "Trade Name",
  "Address",
  "City",
  "Province",
  "Postal Code",
  "Reference Number",
  "Vatable Amount",
  "VAT Amount",
  "VAT-Exempt Amount",
  "Zero-rated Amount",
  "Other Non-vatable",
  "Gross Total",
  "Description",
  "COA Code",
  "ATC",
  "Withholding Amount",
  "Source File",
  "Needs Review",
  "Remarks",
] as const;
export type ExpenseHeader = (typeof EXPENSES_HEADERS)[number];

/** Key labels in column A of the CLIENT sheet; values sit in column B. */
export const CLIENT_SHEET_KEYS = {
  clientId: "Client ID",
  tin: "Client TIN",
  name: "Client Name",
  regime: "Tax Regime",
  periodFrom: "Period From",
  periodTo: "Period To",
  version: "Template Version",
} as const;

export interface DocumentType {
  code: string;
  label: string;
  /** An official invoice posts on import; anything else is held (D25). */
  isInvoice: boolean;
  note: string;
}

/**
 * Which document types count as an "official invoice" (D25) is a domain
 * decision; this list encodes the ruling as given and is the one place to
 * change it. A non-invoice document is recorded and held until an accountant
 * posts it.
 */
export const DOCUMENT_TYPES: readonly DocumentType[] = [
  { code: "SALES_INVOICE", label: "Sales Invoice", isInvoice: true, note: "Official invoice for goods. Posts on import." },
  { code: "SERVICE_INVOICE", label: "Service Invoice", isInvoice: true, note: "Official invoice for services. Posts on import." },
  { code: "OFFICIAL_RECEIPT", label: "Official Receipt", isInvoice: true, note: "BIR-registered OR. Posts on import." },
  { code: "DELIVERY_RECEIPT", label: "Delivery Receipt", isInvoice: false, note: "Not an invoice. Recorded and held for an accountant." },
  { code: "ACKNOWLEDGEMENT_RECEIPT", label: "Acknowledgement Receipt", isInvoice: false, note: "Not an invoice. Held." },
  { code: "COLLECTION_RECEIPT", label: "Collection Receipt", isInvoice: false, note: "Not an invoice. Held." },
  { code: "BILLING_STATEMENT", label: "Billing Statement / SOA", isInvoice: false, note: "Not an invoice. Held." },
  { code: "PROVISIONAL_RECEIPT", label: "Provisional Receipt", isInvoice: false, note: "Not an invoice. Held." },
  { code: "CASH_SLIP", label: "Cash slip / POS tape without TIN", isInvoice: false, note: "Not an invoice. Held." },
  { code: "OTHER", label: "Other document", isInvoice: false, note: "Describe it in Remarks. Held." },
];

export const NEEDS_REVIEW_VALUES = ["Y", "N"] as const;

/** How one receipt row is split (D24). Named here, reported per record. */
export type Classification = "VATABLE" | "VAT_EXEMPT" | "ZERO_RATED" | "OTHER_NON_VATABLE";

/** The @portal/shared InputVATCategory a VAT-registered client's record takes
 *  for each treatment. "No VAT applies" is DOMESTIC_NO_INPUT_TAX (2550Q item
 *  48, amount only) — the value R4 asked A3 to name. A non-VAT client's
 *  records carry no category at all (the regime validator requires that). */
export const VATABLE_CATEGORY: InputVATCategory = InputVATCategory.enum.DOMESTIC_PURCHASES;
export const NO_VAT_CATEGORY: InputVATCategory = InputVATCategory.enum.DOMESTIC_NO_INPUT_TAX;

export interface ClassificationInfo {
  name: Classification;
  column: ExpenseHeader;
  /** Stored as this InputVATCategory on a VAT client; null on a non-VAT client. */
  vatCategory: InputVATCategory;
  useWhen: string;
}

export const CLASSIFICATIONS: readonly ClassificationInfo[] = [
  { name: "VATABLE", column: "Vatable Amount", vatCategory: VATABLE_CATEGORY, useWhen: "The receipt shows a VATable sale with 12% VAT. Put the VAT itself in VAT Amount." },
  { name: "VAT_EXEMPT", column: "VAT-Exempt Amount", vatCategory: NO_VAT_CATEGORY, useWhen: "The receipt marks the item VAT-exempt (e.g. unprocessed food, medicines on the list)." },
  { name: "ZERO_RATED", column: "Zero-rated Amount", vatCategory: NO_VAT_CATEGORY, useWhen: "The receipt marks the item zero-rated (0% VAT)." },
  { name: "OTHER_NON_VATABLE", column: "Other Non-vatable", vatCategory: NO_VAT_CATEGORY, useWhen: "No VAT applies and it is not marked exempt or zero-rated: a non-VAT seller's receipt, service charges, government fees." },
];

/** An account whose name says it is the personal / non-deductible bucket (D26).
 *  Rows posted to it are recorded non-deductible. */
export const PERSONAL_ACCOUNT_PATTERN = /\b(personal|non-?deductible|drawings?)\b/i;

/** Category a held row takes while it has no COA account (a record cannot be
 *  stored without one). Posting requires a real account first (R4). */
export const UNASSIGNED_CATEGORY = "Unassigned (held import)";

export const MAX_DATA_ROWS = 1000;
export const MAX_REFERENCE_LENGTH = 32;
export const FOOTING_TOLERANCE = 0.01;
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

export const TIN_FORMATS = ["000-000-000", "000-000-000-000", "000-000-000-00000", "000000000-00000"] as const;

export const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
