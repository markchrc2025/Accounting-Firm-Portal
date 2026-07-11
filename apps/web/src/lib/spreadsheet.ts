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
 * header. `raw: true` keeps numbers as numbers and (with cellDates) dates as JS
 * Date objects; strings stay strings. Mapping normalises from there.
 */
export async function parseSheet(file: File): Promise<Record<string, unknown>[]> {
  const XLSX = await import("xlsx");
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array", cellDates: true });
  const firstName = wb.SheetNames[0];
  if (!firstName) return [];
  const ws = wb.Sheets[firstName];
  if (!ws) return [];
  return XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: "", raw: true });
}

// --- Header mapping (accepts the user's template AND the canonical export) ----

function normKey(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** normalised header → canonical field, for the Sales/Income template. */
export const SALES_ALIASES: Record<string, string> = {
  date: "Date",
  referenceno: "ReferenceNo",
  referencenumber: "ReferenceNo",
  invoicenumber: "ReferenceNo",
  customer: "Customer",
  customername: "Customer",
  vendorname: "Customer", // the template labels the counterparty "Vendor Name"
  description: "Description",
  category: "Category",
  netamount: "NetAmount",
  amount: "NetAmount",
  grossreceipts: "NetAmount",
  vatclass: "VatClass",
  outputvat: "OutputVAT",
  saletogovernment: "SaleToGovernment",
  creditablevatwithheld5pct: "CreditableVATWithheld5pct",
  atc: "ATC",
  taxcode: "ATC",
  currency: "Currency",
};

/** normalised header → canonical field, for the Expenses/Purchases template. */
export const EXPENSE_ALIASES: Record<string, string> = {
  date: "Date",
  referenceno: "ReferenceNo",
  referencenumber: "ReferenceNo",
  vendor: "Vendor",
  vendorname: "Vendor",
  description: "Description",
  category: "Category",
  netamount: "NetAmount",
  amount: "NetAmount",
  inputvatcategory: "InputVATCategory",
  inputvat: "InputVAT",
  iscapitalgood: "IsCapitalGood",
  capitalgoodacquisitioncost: "CapitalGoodAcquisitionCost",
  estimatedusefullifemonths: "EstimatedUsefulLifeMonths",
  inputtaxattribution: "InputTaxAttribution",
  deductible: "Deductible",
  currency: "Currency",
};

/** Excel serial / JS Date / string → ISO yyyy-mm-dd (best effort; "" on fail). */
export function toIsoDate(cell: unknown): string {
  if (cell instanceof Date && !Number.isNaN(cell.getTime())) {
    return cell.toISOString().slice(0, 10);
  }
  if (typeof cell === "number" && Number.isFinite(cell)) {
    // Excel serial date: day 0 = 1899-12-30 (accounts for the 1900 leap bug).
    const ms = Math.round((cell - 25569) * 86400 * 1000);
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? "" : d.toISOString().slice(0, 10);
  }
  const s = String(cell ?? "").trim();
  if (!s) return "";
  const m = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/); // ISO-ish
  if (m) return `${m[1]}-${m[2]!.padStart(2, "0")}-${m[3]!.padStart(2, "0")}`;
  const md = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})/); // m/d/y
  if (md) {
    const yr = md[3]!.length === 2 ? `20${md[3]}` : md[3];
    return `${yr}-${md[1]!.padStart(2, "0")}-${md[2]!.padStart(2, "0")}`;
  }
  return s;
}

/**
 * Map raw parsed rows (keyed by the file's headers) to canonical import rows
 * (keyed by the shared schema's field names). `defaults` seed fields the file
 * may omit (e.g. VatClass from the client's regime); a value present in the file
 * overrides the default. The Date field is normalised to ISO.
 */
export function mapImportRows(
  rawRows: Record<string, unknown>[],
  aliases: Record<string, string>,
  defaults: Record<string, unknown> = {},
): Record<string, unknown>[] {
  return rawRows.map((raw) => {
    const out: Record<string, unknown> = { ...defaults };
    for (const [header, val] of Object.entries(raw)) {
      const field = aliases[normKey(header)];
      if (!field) continue;
      if (val === "" || val === null || val === undefined) continue;
      // The import schemas expect strings (amounts use z.coerce.number, so a
      // numeric cell like a reference/invoice number stays valid as a string).
      out[field] = field === "Date" ? toIsoDate(val) : String(val).trim();
    }
    return out;
  });
}

/** True when a mapped row has no real data (skip fully-blank template rows). */
export function isBlankRow(row: Record<string, unknown>): boolean {
  return !["Date", "Description", "NetAmount", "Category"].some((k) => {
    const v = row[k];
    return v !== "" && v !== null && v !== undefined;
  });
}
