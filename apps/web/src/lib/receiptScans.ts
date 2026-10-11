// receiptScans.ts — scan receipts, part 1 (W12): local types that mirror Track
// A U11's contract exactly, the calls the screens make, and the pure helpers
// they word things with. W13 switches the types to the shared schemas.
//
// R6: money is displayed, never computed for tax. The only arithmetic here is
// US$ × the response's own usdToPhp, for display; the web keeps no rate.

import { apiFetch, apiUpload } from "./api";
import type { PileAccepted } from "./drive";
import { lastEndedQuarter } from "./taxPeriod";
import { peso } from "../components/ui";

// --- The contract (U11) ------------------------------------------------------

/** GET /ai/status */
export interface AiStatus {
  /** Whether the API key is present. The key itself is never returned. */
  configured: boolean;
  enabled: boolean;
  /** The Manila calendar month, YYYY-MM. */
  month: string;
  budgetUsd: number;
  spentUsd: number;
  reservedUsd: number;
  /** max(0, budget − spent − reserved), computed by the API. */
  remainingUsd: number;
  /** spent + reserved ≥ 80% of the budget, decided by the API. */
  warning: boolean;
  usdToPhp: number;
  model: string;
}

/** GET /ai/estimate?images=N&pdfs=M */
export interface AiEstimate {
  estimatedUsd: number;
  remainingUsd: number;
  fits: boolean;
}

/** U14 (W15 R6): every pile is "preparing" first, while its files are fetched
 *  and prepared; nothing is sent to the AI until it moves on to "reading". */
export type ScanStatus =
  "preparing" | "reading" | "ready" | "failed" | "approved" | "discarded";

export interface ReceiptScanSummary {
  id: string;
  clientId: string;
  clientName: string;
  periodFrom: string;
  periodTo: string;
  status: ScanStatus;
  model: string;
  fileCount: number;
  rowCount: number;
  estimatedUsd: number;
  actualUsd: number | null;
  createdAt: string;
  createdByName: string;
  readyAt: string | null;
  problem: string | null;
}

/** The expenses-v2 template's 27 headers, exact names, in template order. */
export const EXPENSE_HEADERS = [
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
export type ExpenseHeader = (typeof EXPENSE_HEADERS)[number];

export type CheckOutcome = "posted" | "held" | "rejected";

export interface ScanRow {
  id: string;
  /** Date is YYYY-MM-DD; amounts and Withholding Amount are numbers; Needs
   *  Review is "Y" or "N"; everything else is text; a blank is null. */
  cells: Record<ExpenseHeader, string | number | null>;
  doubts: { field: ExpenseHeader; reason: string }[];
  /** What approving would do. Nothing is written in U11 or W12. */
  check: { outcome: CheckOutcome; needsReview: boolean; messages: string[] };
}

export type ScanFileResult =
  "pending" | "read" | "not-a-receipt" | "unreadable" | "copy-of-another-file" | "failed";

export interface ScanFile {
  id: string;
  name: string;
  contentType: string;
  bytes: number;
  /** A signed GET, valid for 1 hour; null when the photo is not available. */
  imageUrl: string | null;
  result: ScanFileResult;
  problem: string | null;
  rows: ScanRow[];
  /** U14: where the photo came from. Absent on an API before U14. */
  source?: "upload" | "drive";
  /** U14: the file's Google Drive page; null for an upload. */
  driveLink?: string | null;
}

export interface ReceiptScanDetail {
  scan: ReceiptScanSummary;
  files: ScanFile[];
  totals: {
    files: number;
    rows: number;
    posted: number;
    held: number;
    rejected: number;
    grossAmount: number;
  };
}

// --- The calls ---------------------------------------------------------------

export function fetchAiStatus(): Promise<AiStatus> {
  return apiFetch<AiStatus>("/ai/status");
}

export function fetchAiEstimate(images: number, pdfs: number): Promise<AiEstimate> {
  return apiFetch<AiEstimate>(`/ai/estimate?images=${images}&pdfs=${pdfs}`);
}

export function fetchReceiptScans(): Promise<ReceiptScanSummary[]> {
  return apiFetch<ReceiptScanSummary[]>("/receipt-scans");
}

export function fetchReceiptScan(id: string): Promise<ReceiptScanDetail> {
  return apiFetch<ReceiptScanDetail>(`/receipt-scans/${encodeURIComponent(id)}`);
}

/** POST /receipt-scans — multipart, every photo under the field "files". The
 *  server's { message } for a 400, 409 or 503 is thrown word for word. */
export function sendReceiptScan(input: {
  clientId: string;
  periodFrom: string;
  periodTo: string;
  files: File[];
}): Promise<PileAccepted> {
  const form = new FormData();
  for (const f of input.files) form.append("files", f, f.name);
  const q = new URLSearchParams({
    clientId: input.clientId,
    periodFrom: input.periodFrom,
    periodTo: input.periodTo,
  });
  // U14: 202 { id, status: "preparing", files } once the files are on disk.
  return apiUpload<PileAccepted>(`/receipt-scans?${q}`, form, "The pile was not sent");
}

// --- The review screen's columns (R5) ----------------------------------------

export const COLUMN_GROUPS: { name: string; columns: ExpenseHeader[] }[] = [
  { name: "Receipt", columns: ["Date", "Document Type", "Reference Number"] },
  {
    name: "Vendor",
    columns: [
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
    ],
  },
  {
    name: "Amounts",
    columns: [
      "Vatable Amount",
      "VAT Amount",
      "VAT-Exempt Amount",
      "Zero-rated Amount",
      "Other Non-vatable",
      "Gross Total",
    ],
  },
  { name: "Booking", columns: ["Description", "COA Code", "ATC", "Withholding Amount"] },
  { name: "Review", columns: ["Needs Review", "Remarks", "Source File"] },
];

/** The columns that carry money, shown in pesos as the API sent them. */
export const MONEY_COLUMNS: ReadonlySet<ExpenseHeader> = new Set<ExpenseHeader>([
  "Vatable Amount",
  "VAT Amount",
  "VAT-Exempt Amount",
  "Zero-rated Amount",
  "Other Non-vatable",
  "Gross Total",
  "Withholding Amount",
]);

/** A cell as the reader sees it: money in pesos, a blank as "—". */
export function cellText(column: ExpenseHeader, value: string | number | null): string {
  if (value === null || value === "") return "—";
  if (MONEY_COLUMNS.has(column) && typeof value === "number") return peso(value);
  return String(value);
}

// --- Money for display (R2, R6) ----------------------------------------------

/** Dollars as US$ with two decimals. */
export function usd(n: number): string {
  return `US$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Dollars in pesos, at the rate the API's response carries. */
export function phpFromUsd(amountUsd: number, usdToPhp: number): string {
  return peso(amountUsd * usdToPhp);
}

/** "₱X left of ₱Y this month (US$a of US$b)" */
export function budgetLine(s: AiStatus): string {
  return (
    `${phpFromUsd(s.remainingUsd, s.usdToPhp)} left of ${phpFromUsd(s.budgetUsd, s.usdToPhp)} ` +
    `this month (${usd(s.remainingUsd)} of ${usd(s.budgetUsd)})`
  );
}

export const WARNING_SENTENCE = "80% of this month's AI budget is used.";
export const NOT_CONFIGURED_SENTENCE =
  "AI reading isn't set up yet. The Super Admin adds the key to the API service.";
export const SWITCHED_OFF_SENTENCE = "AI reading is switched off in Settings.";

/** "About ₱X (US$Y) for N files. Results usually within the hour; …" */
export function estimateSentence(e: AiEstimate, files: number, usdToPhp: number): string {
  return (
    `About ${phpFromUsd(e.estimatedUsd, usdToPhp)} (${usd(e.estimatedUsd)}) for ${files} ` +
    `${files === 1 ? "file" : "files"}. Results usually within the hour; at the latest by tomorrow.`
  );
}

/** What is left, when the pile does not fit this month's budget. */
export function noFitSentence(e: AiEstimate, usdToPhp: number): string {
  return (
    "This pile does not fit this month's AI budget: only " +
    `${phpFromUsd(e.remainingUsd, usdToPhp)} (${usd(e.remainingUsd)}) is left.`
  );
}

// --- The upload panel (R3) ---------------------------------------------------

export const MAX_FILES = 100;
export const MAX_FILE_BYTES = 10 * 1024 * 1024;
/** What the picker offers (W12-A1 R1): any photo or PDF, iPhone HEIC included.
 *  Nothing in the browser refuses a file for its type; the API reads each one
 *  by its content and its 400 is shown word for word. */
export const ACCEPTED_FILES = "image/*,.heic,.heif,.pdf,application/pdf";

const pad = (n: number) => String(n).padStart(2, "0");

/** The last quarter that has ended, by the Manila date, as From and To. */
export function defaultScanPeriod(now: Date = new Date()): { from: string; to: string } {
  const { year, quarter } = lastEndedQuarter(now);
  const first = (quarter - 1) * 3 + 1;
  // Day 0 of the month after the quarter is the quarter's last day.
  const lastDay = new Date(Date.UTC(year, first + 2, 0)).getUTCDate();
  return {
    from: `${year}-${pad(first)}-01`,
    to: `${year}-${pad(first + 2)}-${pad(lastDay)}`,
  };
}

type FileLike = { name: string; type: string; size: number };

const isPdf = (f: FileLike) => f.type === "application/pdf" || /\.pdf$/i.test(f.name);

/** The counts GET /ai/estimate asks for: PDFs, and every other file as an image. */
export function estimateCounts(files: readonly FileLike[]): {
  images: number;
  pdfs: number;
} {
  const pdfs = files.filter(isPdf).length;
  return { images: files.length - pdfs, pdfs };
}

/** Why the chosen files cannot be sent, before anything is sent; null if they can. */
export function localRefusal(files: readonly FileLike[]): string | null {
  if (files.length > MAX_FILES) {
    return `A pile can hold at most ${MAX_FILES} files; you chose ${files.length}. Choose ${MAX_FILES} or fewer.`;
  }
  const big = files.find((f) => f.size > MAX_FILE_BYTES);
  if (big) return `${big.name} is larger than 10 MB. Each file must be 10 MB or smaller.`;
  return null;
}

/** W15 R6: a pile still on its way — preparing, then reading — is polled. */
export function isInProgress(status: ScanStatus): boolean {
  return status === "preparing" || status === "reading";
}

// --- Labels (R4, R5) ---------------------------------------------------------

const STATUS_LABELS: Record<ScanStatus, string> = {
  preparing: "Preparing…",
  reading: "Reading",
  ready: "Ready for review",
  failed: "Failed",
  approved: "Approved",
  discarded: "Discarded",
};
export function scanStatusLabel(status: ScanStatus): string {
  return STATUS_LABELS[status] ?? status;
}

const CHECK_LABELS: Record<CheckOutcome, string> = {
  posted: "Will post",
  held: "Will be held",
  rejected: "Will be rejected",
};
/** What approving the row would do. */
export function checkLabel(outcome: CheckOutcome): string {
  return CHECK_LABELS[outcome] ?? outcome;
}

const RESULT_LABELS: Record<Exclude<ScanFileResult, "read">, string> = {
  pending: "Still reading",
  "not-a-receipt": "Not a receipt",
  unreadable: "Unreadable",
  "copy-of-another-file": "Copy of another file",
  failed: "Failed",
};
/** Each file's result, for the file list down the side. */
export function fileResultLabel(file: Pick<ScanFile, "result" | "rows">): string {
  if (file.result === "read") {
    const n = file.rows.length;
    return n === 0 ? "No receipts" : `${n} ${n === 1 ? "receipt" : "receipts"}`;
  }
  return RESULT_LABELS[file.result] ?? file.result;
}

/** What a file shows instead of rows: its problem sentence, or "Still reading." */
export function fileProblem(file: ScanFile): string | null {
  if (file.result === "read") return null;
  if (file.result === "pending") return "Still reading.";
  return file.problem ?? `${RESULT_LABELS[file.result] ?? file.result}.`;
}
