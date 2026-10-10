import { z } from "zod";
import { zIsoDate } from "./money";

/**
 * ============================================================================
 * RECEIPT SCANS — the AI receipt-reading contract (U11, D49)
 * ----------------------------------------------------------------------------
 * A pile of receipt photos for one client and one period is read overnight by
 * Claude (Anthropic Message Batches) and comes back as rows in the 27 columns of
 * the expenses-v2 import template, each checked by the import's own rules. Nothing
 * is written to the books here; review and approval are U12 / W13. The API (U11)
 * and the web screens (W12) both build against these shapes. Every error body is
 * { message }, a plain-English sentence the web shows word for word.
 * ============================================================================
 */

/** The expenses-v2 template's data-sheet headers, in order — exact names. The
 *  workbook import (apps/api expense-import.constants) reads this same list. */
export const EXPENSES_V2_HEADERS = [
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
export type ExpensesV2Header = (typeof EXPENSES_V2_HEADERS)[number];
export const ExpensesV2Header = z.enum(EXPENSES_V2_HEADERS);

/** The amount columns (and Withholding Amount): numbers in `cells`. */
export const SCAN_AMOUNT_HEADERS = [
  "Vatable Amount",
  "VAT Amount",
  "VAT-Exempt Amount",
  "Zero-rated Amount",
  "Other Non-vatable",
  "Gross Total",
  "Withholding Amount",
] as const satisfies readonly ExpensesV2Header[];

/**
 * One row's cells: every one of the 27 headers. Date is "YYYY-MM-DD"; the amount
 * columns and Withholding Amount are numbers; Needs Review is "Y" or "N";
 * everything else is text. A blank is null.
 */
const cellShape = Object.fromEntries(
  EXPENSES_V2_HEADERS.map((h) => [
    h,
    (SCAN_AMOUNT_HEADERS as readonly string[]).includes(h)
      ? z.number().nullable()
      : h === "Needs Review"
        ? z.enum(["Y", "N"])
        : z.string().nullable(),
  ]),
) as unknown as { [K in ExpensesV2Header]: z.ZodTypeAny };
export const ScanCells = z.object(cellShape).strict();
export type ScanCells = { [K in ExpensesV2Header]: string | number | null };

export const ScanDoubt = z.object({ field: ExpensesV2Header, reason: z.string() });
export type ScanDoubt = z.infer<typeof ScanDoubt>;

/** What approving the row would do — the workbook import's own verdict. */
export const ScanRowOutcome = z.enum(["posted", "held", "rejected"]);
export type ScanRowOutcome = z.infer<typeof ScanRowOutcome>;
export const ScanCheck = z.object({
  outcome: ScanRowOutcome,
  needsReview: z.boolean(),
  messages: z.array(z.string()),
});
export type ScanCheck = z.infer<typeof ScanCheck>;

export const ScanRow = z.object({
  id: z.string().uuid(),
  cells: ScanCells,
  doubts: z.array(ScanDoubt),
  check: ScanCheck,
});
export type ScanRow = z.infer<typeof ScanRow>;

export const ScanFileResult = z.enum([
  "pending",
  "read",
  "not-a-receipt",
  "unreadable",
  "copy-of-another-file",
  "failed",
]);
export type ScanFileResult = z.infer<typeof ScanFileResult>;

export const ScanFile = z.object({
  id: z.string().uuid(),
  name: z.string(),
  contentType: z.string(),
  bytes: z.number().int().nonnegative(),
  /** A signed GET valid for 1 hour; null when nothing is stored for the file. */
  imageUrl: z.string().nullable(),
  result: ScanFileResult,
  problem: z.string().nullable(),
  rows: z.array(ScanRow),
});
export type ScanFile = z.infer<typeof ScanFile>;

/** "approved" and "discarded" are reserved for U12. */
export const ReceiptScanStatus = z.enum(["reading", "ready", "failed", "approved", "discarded"]);
export type ReceiptScanStatus = z.infer<typeof ReceiptScanStatus>;

export const ReceiptScanSummary = z.object({
  id: z.string().uuid(),
  clientId: z.string().uuid(),
  clientName: z.string(),
  periodFrom: zIsoDate,
  periodTo: zIsoDate,
  status: ReceiptScanStatus,
  model: z.string(),
  fileCount: z.number().int().nonnegative(),
  rowCount: z.number().int().nonnegative(),
  estimatedUsd: z.number().nonnegative(),
  actualUsd: z.number().nonnegative().nullable(),
  createdAt: z.string(),
  createdByName: z.string(),
  readyAt: z.string().nullable(),
  problem: z.string().nullable(),
});
export type ReceiptScanSummary = z.infer<typeof ReceiptScanSummary>;

export const ReceiptScanDetail = z.object({
  scan: ReceiptScanSummary,
  files: z.array(ScanFile),
  totals: z.object({
    files: z.number().int().nonnegative(),
    rows: z.number().int().nonnegative(),
    posted: z.number().int().nonnegative(),
    held: z.number().int().nonnegative(),
    rejected: z.number().int().nonnegative(),
    grossAmount: z.number(),
  }),
});
export type ReceiptScanDetail = z.infer<typeof ReceiptScanDetail>;

/** GET /ai/status. `configured` says whether the API key is present; the key
 *  itself is never returned. `month` is the Manila calendar month. */
export const AiStatus = z.object({
  configured: z.boolean(),
  enabled: z.boolean(),
  month: z.string().regex(/^\d{4}-\d{2}$/),
  budgetUsd: z.number().nonnegative(),
  spentUsd: z.number().nonnegative(),
  reservedUsd: z.number().nonnegative(),
  remainingUsd: z.number().nonnegative(),
  warning: z.boolean(),
  usdToPhp: z.number().positive(),
  model: z.string(),
});
export type AiStatus = z.infer<typeof AiStatus>;

/** GET /ai/estimate?images=N&pdfs=M — an upper bound (each PDF at 5 pages). */
export const AiEstimate = z.object({
  estimatedUsd: z.number().nonnegative(),
  remainingUsd: z.number().nonnegative(),
  fits: z.boolean(),
});
export type AiEstimate = z.infer<typeof AiEstimate>;

/** The two models U11 allows; U12's test decides between them. */
export const AiModel = z.enum(["claude-sonnet-5-5", "claude-haiku-5-5"]);
export type AiModel = z.infer<typeof AiModel>;
