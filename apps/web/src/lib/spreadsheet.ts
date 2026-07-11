// Lazy-loaded SheetJS wrapper for importing / exporting Sales & Expense data.
// xlsx (~400 KB) loads only when a user actually exports or imports, keeping it
// out of the main bundle. Export produces the canonical import headers below, so
// an exported file re-imports cleanly (round-trip).

/** Canonical Sales/Income template headers (match @portal/shared SalesImportRow). */
export const SALES_HEADERS = [
  "Date",
  "ReferenceNo",
  "Customer",
  "Description",
  "Category",
  "NetAmount",
  "VatClass",
  "OutputVAT",
  "SaleToGovernment",
  "CreditableVATWithheld5pct",
  "ATC",
  "Currency",
] as const;

/** Canonical Expenses/Purchases template headers (match ExpenseImportRow). */
export const EXPENSE_HEADERS = [
  "Date",
  "ReferenceNo",
  "Vendor",
  "Description",
  "Category",
  "NetAmount",
  "InputVATCategory",
  "InputVAT",
  "IsCapitalGood",
  "CapitalGoodAcquisitionCost",
  "EstimatedUsefulLifeMonths",
  "InputTaxAttribution",
  "Deductible",
  "Currency",
] as const;

/** Build and trigger download of an .xlsx from plain-object rows. */
export async function downloadSheet(
  filename: string,
  sheetName: string,
  rows: Record<string, unknown>[],
  headers?: readonly string[],
): Promise<void> {
  const XLSX = await import("xlsx");
  const ws = XLSX.utils.json_to_sheet(rows, headers ? { header: headers as string[] } : undefined);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName.slice(0, 31));
  XLSX.writeFile(wb, filename);
}

/**
 * Parse the first sheet of an uploaded .xlsx / .csv into row objects keyed by
 * header. `raw: false` returns formatted strings (so the header row's names are
 * used as keys and cells arrive as strings for the import schemas to coerce).
 */
export async function parseSheet(file: File): Promise<Record<string, unknown>[]> {
  const XLSX = await import("xlsx");
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array", cellDates: true });
  const firstName = wb.SheetNames[0];
  if (!firstName) return [];
  const ws = wb.Sheets[firstName];
  if (!ws) return [];
  return XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: "", raw: false });
}
