// expense-template.ts — generates the Expenses import workbook v2 (U6) with
// exceljs: Instructions, CLIENT, EXPENSES, REFERENCE and COA. Pure given its
// inputs, so the sheet layout is unit-testable without a database.
import * as ExcelJS from "exceljs";
import {
  CLASSIFICATIONS,
  CLIENT_SHEET_KEYS,
  DOCUMENT_TYPES,
  EXPENSES_HEADERS,
  MAX_DATA_ROWS,
  MAX_REFERENCE_LENGTH,
  SHEET,
  TEMPLATE_VERSION,
  TIN_FORMATS,
  type ExpenseHeader,
} from "./expense-import.constants";
import { formatTin } from "./expense-import.rules";

export interface TemplateClient {
  id: string;
  tin: string | null;
  branch: string;
  businessName: string;
  regimeLabel: string;
}

export interface TemplateAccount {
  code: string;
  name: string;
  class: string;
  accountType: string;
  /** May a row be posted to it? Expense-class accounts only. No account is
   *  special (D36): nothing is marked personal and nothing is non-deductible. */
  allowed: boolean;
}

/** From chart rows to template rows: postable, non-archived; expense-class
 *  accounts are allowed on expense rows, everything else is listed for reference. */
export function classifyAccounts(
  rows: { code: string; name: string; class: string; accountType: string; postable: boolean; archived: boolean }[],
): TemplateAccount[] {
  return rows
    .filter((r) => r.postable && !r.archived)
    .map((r) => ({
      code: r.code,
      name: r.name,
      class: r.class,
      accountType: r.accountType,
      allowed: r.class === "Expense",
    }))
    .sort((a, b) => Number(b.allowed) - Number(a.allowed) || a.code.localeCompare(b.code));
}

/**
 * exceljs 4.4.0 implements `worksheet.dataValidations.add(range, rule)` and
 * `.model` but its index.d.ts omits the property. One typed accessor, used by
 * the generator and the tests, instead of casts scattered around.
 */
export interface WorksheetValidations {
  add(range: string, rule: ExcelJS.DataValidation): void;
  model: Record<string, ExcelJS.DataValidation | undefined>;
}
export function validationsOf(ws: ExcelJS.Worksheet): WorksheetValidations {
  return (ws as unknown as { dataValidations: WorksheetValidations }).dataValidations;
}

export function templateFilename(clientId: string, now: Date): string {
  const d = now.toISOString().slice(0, 10).replace(/-/g, "");
  return `expenses-import-${clientId}-${d}.xlsx`;
}

const REQUIRED: ReadonlySet<ExpenseHeader> = new Set<ExpenseHeader>([
  "Date",
  "Document Type",
  "Gross Total",
]);

const TEXT_COLUMNS: ReadonlySet<ExpenseHeader> = new Set<ExpenseHeader>([
  "Vendor TIN",
  "Vendor Branch",
  "Postal Code",
  "Reference Number",
  "COA Code",
]);

const AMOUNT_COLUMNS: ReadonlySet<ExpenseHeader> = new Set<ExpenseHeader>([
  "Vatable Amount",
  "VAT Amount",
  "VAT-Exempt Amount",
  "Zero-rated Amount",
  "Other Non-vatable",
  "Gross Total",
  "Withholding Amount",
]);

const WIDTHS: Partial<Record<ExpenseHeader, number>> = {
  Date: 12,
  "Document Type": 22,
  "Vendor TIN": 20,
  "Vendor Branch": 9,
  "Vendor Registered Name": 32,
  "Vendor Lastname": 16,
  "Vendor Firstname": 16,
  "Vendor Middlename": 16,
  "Trade Name": 24,
  Address: 32,
  City: 16,
  Province: 16,
  "Postal Code": 10,
  "Reference Number": 26,
  "Vatable Amount": 15,
  "VAT Amount": 13,
  "VAT-Exempt Amount": 16,
  "Zero-rated Amount": 16,
  "Other Non-vatable": 16,
  "Gross Total": 14,
  Description: 36,
  "COA Code": 11,
  ATC: 9,
  "Withholding Amount": 16,
  "Source File": 24,
  "Needs Review": 12,
  Remarks: 36,
};

/** One line per column, in the words the encoder reads. */
export const COLUMN_GUIDE: Record<ExpenseHeader, string> = {
  Date: "REQUIRED. The date on the receipt, as a real date cell. Must fall inside the period on the CLIENT sheet.",
  "Document Type": "Optional label. Pick from the list, or leave blank. It records what kind of document you had in hand and changes nothing about how the row is booked.",
  "Vendor TIN": "The seller's TIN: 000-000-000, 000-000-000-000, 000-000-000-00000 or 000000000-00000, dashes optional. Leave blank if the receipt has none — the row is then flagged for review.",
  "Vendor Branch": "The seller's branch code (000 or 00000). Leave blank when the TIN already carries it; 000 is the head office.",
  "Vendor Registered Name": "The seller's registered name (companies). Leave blank for an individual and use the three name columns.",
  "Vendor Lastname": "Individual sellers only.",
  "Vendor Firstname": "Individual sellers only.",
  "Vendor Middlename": "Individual sellers only. Optional.",
  "Trade Name": "The name on the signboard, if different from the registered name. Optional.",
  Address: "As printed on the receipt. Optional.",
  City: "Optional.",
  Province: "Optional.",
  "Postal Code": "Optional. Only when the receipt prints one.",
  "Reference Number": `Optional. The invoice / receipt number exactly as printed, leading zeros included (type it as text; up to ${MAX_REFERENCE_LENGTH} characters). Leave blank when the document has none.`,
  "Vatable Amount": "The VATable sales line (before VAT), if the receipt shows one.",
  "VAT Amount": "The 12% VAT line as printed. Required when Vatable Amount is given.",
  "VAT-Exempt Amount": "The VAT-exempt sales line, if any.",
  "Zero-rated Amount": "The zero-rated sales line, if any.",
  "Other Non-vatable": "Anything with no VAT that is not marked exempt or zero-rated: a non-VAT seller's receipt, service charges, government fees.",
  "Gross Total": "REQUIRED. The total you paid. Vatable + VAT + VAT-Exempt + Zero-rated + Other must equal this within 0.01 or the row is rejected.",
  Description: "What was bought. Optional — the vendor name is used when blank.",
  "COA Code": "The account from the COA sheet (pick from the list; only rows marked Allowed = Y). Leave blank if unsure — this is the one thing that holds a row: it waits, unposted, until an accountant assigns an account.",
  ATC: "Leave blank unless the client withholds tax on this purchase. If used, it must be a BIR ATC code and come with a Withholding Amount.",
  "Withholding Amount": "Leave blank unless the client withholds. The amount withheld, with its ATC.",
  "Source File": "The photo or scan filename you worked from (e.g. IMG_0123.jpg).",
  "Needs Review": "Y when something is unclear (faded receipt, uncertain account). The row still posts, flagged. N or blank otherwise.",
  Remarks: "Anything the accountant should know about this row.",
};

export const SAMPLE_ROWS: Partial<Record<ExpenseHeader, unknown>>[] = [
  {
    Date: "2026-08-14",
    "Document Type": "SALES_INVOICE",
    "Vendor TIN": "000-222-333-00000",
    "Vendor Registered Name": "Sample Supermart Inc",
    "Reference Number": "00000000000000000012345",
    "Vatable Amount": 2952.01,
    "VAT Amount": 354.24,
    "VAT-Exempt Amount": 887.96,
    "Gross Total": 4194.21,
    Description: "Groceries and supplies",
    "COA Code": "(an Allowed = Y code from COA)",
    "Source File": "IMG_0001.jpg",
    "Needs Review": "N",
  },
  {
    Date: "2026-09-02",
    "Document Type": "DELIVERY_RECEIPT",
    "Vendor Registered Name": "Sample Water Delivery",
    "Other Non-vatable": 500,
    "Gross Total": 500,
    Description: "Water delivery — no TIN on the slip",
    "COA Code": "(an Allowed = Y code from COA)",
    "Source File": "IMG_0002.jpg",
    "Needs Review": "Y",
    Remarks: "Delivery slip, no TIN printed; posts flagged for review",
  },
];

export const INSTRUCTIONS_TEXT: string[] = [
  "EXPENSES IMPORT — HOW TO FILL THIS WORKBOOK",
  "",
  "1. Check the CLIENT sheet. It names the client this file belongs to. Fill in Period From and Period To (yyyy-mm-dd): every Date on the EXPENSES sheet must fall inside that period. Do not change the other cells — the importer refuses a file whose client or template version does not match.",
  "2. Encode one row per receipt on the EXPENSES sheet. Start at row 2; the header row stays as it is. Do not add, rename or reorder columns.",
  "3. One receipt, one row — even a mixed receipt. Put each part in its own column (Vatable, VAT, VAT-Exempt, Zero-rated, Other Non-vatable) and the total you paid in Gross Total. The importer splits the row into one record per treatment. The parts must add up to Gross Total within 0.01.",
  "4. The client's VAT registration decides what the importer does with the VAT: a VAT-registered client books the VATable part net and claims the VAT; a non-VAT client books the gross and keeps the VAT as a cost figure. You never choose this — it is stamped on each record from the client's regime.",
  "5. Document Type is an optional label: pick from the list or leave it blank. It records what kind of document you had in hand and changes nothing — a delivery slip, a cash slip and an invoice are all booked the same way. Every row that passes the checks below posts.",
  "6. Vendor TIN is accepted with or without dashes in any of the four forms on the REFERENCE sheet. Blank is allowed when the receipt has none; the row is then flagged Needs Review. A wrong format rejects the row.",
  "7. Reference Number is optional. When the document has one, type it as text so leading zeros survive; when it has none, leave it blank — nothing is flagged for a missing reference.",
  "8. COA Code: pick from the list (the COA sheet, rows marked Allowed = Y). The account name is looked up — never type it. Leave it blank if unsure. A row is held only when its COA Code is blank: it waits, unposted and outside every total, until an accountant assigns an account and posts it. Nothing else holds a row.",
  "9. ATC and Withholding Amount: leave both blank unless this client withholds tax on purchases. If used, both are required together and the ATC must be a BIR code.",
  "10. Needs Review = Y posts the row with a flag and keeps your Remarks on the record. Use it for faded receipts, uncertain accounts, anything an accountant should look at.",
  "11. Duplicates are rejected: the same vendor TIN + reference number + date + gross twice in one file, or a vendor TIN + reference number already in this client's books. Rows without a reference are checked on vendor TIN + date + gross.",
  "12. Use the DRY RUN first. It checks every row and reports posted / held / rejected per row without writing anything. Posted: written and live. Held: written, waiting for an account. Rejected: not written; the message says why. Fix what it flags, then import.",
  "",
  "Two sample rows follow — they are examples only and are not imported from this sheet.",
];

/** Build the workbook. */
export async function buildExpenseTemplate(input: {
  client: TemplateClient;
  accounts: TemplateAccount[];
}): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "MCRC Accounting Firm Portal";
  const headerFill: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0F2A4A" } };
  const headerFont: Partial<ExcelJS.Font> = { bold: true, color: { argb: "FFFFFFFF" } };
  const inputFill: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFF4CC" } };

  // --- Instructions ---------------------------------------------------------
  const ins = wb.addWorksheet(SHEET.INSTRUCTIONS);
  ins.getColumn(1).width = 120;
  for (const line of INSTRUCTIONS_TEXT) {
    const row = ins.addRow([line]);
    row.getCell(1).alignment = { wrapText: true, vertical: "top" };
    if (line === INSTRUCTIONS_TEXT[0]) row.font = { bold: true, size: 13 };
  }
  ins.addRow([]);
  const guideHeader = ins.addRow(["Column", "What to put in it"]);
  guideHeader.font = { bold: true };
  ins.getColumn(2).width = 110;
  for (const h of EXPENSES_HEADERS) {
    const r = ins.addRow([h, COLUMN_GUIDE[h]]);
    r.getCell(2).alignment = { wrapText: true, vertical: "top" };
    if (REQUIRED.has(h)) r.getCell(1).font = { bold: true };
  }
  ins.addRow([]);
  ins.addRow(["Sample rows (examples — not imported)"]).font = { bold: true };
  const sampleHeader = ins.addRow([...EXPENSES_HEADERS]);
  sampleHeader.font = headerFont;
  sampleHeader.fill = headerFill;
  for (const s of SAMPLE_ROWS) ins.addRow(EXPENSES_HEADERS.map((h) => (s[h] ?? null) as ExcelJS.CellValue));

  // --- CLIENT ---------------------------------------------------------------
  const cs = wb.addWorksheet(SHEET.CLIENT);
  cs.getColumn(1).width = 18;
  cs.getColumn(2).width = 44;
  cs.getColumn(3).width = 60;
  const kv: [string, string | null, string][] = [
    [CLIENT_SHEET_KEYS.clientId, input.client.id, "Do not change."],
    [CLIENT_SHEET_KEYS.tin, formatTin(input.client.tin, input.client.branch), "Do not change."],
    [CLIENT_SHEET_KEYS.name, input.client.businessName, "Do not change."],
    [CLIENT_SHEET_KEYS.regime, input.client.regimeLabel, "Decides how VAT on receipts is booked. Do not change."],
    [CLIENT_SHEET_KEYS.periodFrom, null, "FILL IN: first day of the period covered (yyyy-mm-dd)."],
    [CLIENT_SHEET_KEYS.periodTo, null, "FILL IN: last day of the period covered (yyyy-mm-dd)."],
    [CLIENT_SHEET_KEYS.version, TEMPLATE_VERSION, "Do not change."],
  ];
  for (const [k, v, note] of kv) {
    const r = cs.addRow([k, v, note]);
    r.getCell(1).font = { bold: true };
    if (v === null) {
      r.getCell(2).fill = inputFill;
      r.getCell(2).numFmt = "@";
    }
  }

  // --- EXPENSES -------------------------------------------------------------
  const ws = wb.addWorksheet(SHEET.EXPENSES);
  const header = ws.addRow([...EXPENSES_HEADERS]);
  header.font = headerFont;
  header.fill = headerFill;
  header.alignment = { vertical: "middle", wrapText: true };
  header.height = 30;
  ws.views = [{ state: "frozen", ySplit: 1 }];
  EXPENSES_HEADERS.forEach((h, i) => {
    const col = ws.getColumn(i + 1);
    col.width = WIDTHS[h] ?? 14;
    if (TEXT_COLUMNS.has(h)) col.numFmt = "@";
    if (AMOUNT_COLUMNS.has(h)) col.numFmt = "#,##0.00";
    if (h === "Date") col.numFmt = "yyyy-mm-dd";
  });
  const lastRow = MAX_DATA_ROWS + 1;
  const letter = (h: ExpenseHeader) => ws.getColumn(EXPENSES_HEADERS.indexOf(h) + 1).letter;
  const docTypeRange = `${SHEET.REFERENCE}!$A$2:$A$${DOCUMENT_TYPES.length + 1}`;
  const validations = validationsOf(ws);
  validations.add(`${letter("Document Type")}2:${letter("Document Type")}${lastRow}`, {
    type: "list",
    allowBlank: true,
    showErrorMessage: true,
    errorTitle: "Document Type",
    error: "Pick a Document Type from the list (see REFERENCE).",
    formulae: [docTypeRange],
  });
  validations.add(`${letter("Needs Review")}2:${letter("Needs Review")}${lastRow}`, {
    type: "list",
    allowBlank: true,
    showErrorMessage: true,
    errorTitle: "Needs Review",
    error: "Y or N.",
    formulae: ['"Y,N"'],
  });
  const allowedCount = input.accounts.filter((a) => a.allowed).length;
  if (allowedCount > 0) {
    validations.add(`${letter("COA Code")}2:${letter("COA Code")}${lastRow}`, {
      type: "list",
      allowBlank: true,
      showErrorMessage: true,
      errorTitle: "COA Code",
      error: "Pick an account marked Allowed = Y on the COA sheet.",
      formulae: [`${SHEET.COA}!$A$2:$A$${allowedCount + 1}`],
    });
  }

  // --- REFERENCE ------------------------------------------------------------
  const ref = wb.addWorksheet(SHEET.REFERENCE);
  ref.getColumn(1).width = 28;
  ref.getColumn(2).width = 30;
  ref.getColumn(3).width = 44;
  ref.getColumn(4).width = 70;
  const h1 = ref.addRow(["Document Type (optional label)", "Label", "What it is", "Effect on the row"]);
  h1.font = headerFont;
  h1.fill = headerFill;
  for (const d of DOCUMENT_TYPES) ref.addRow([d.code, d.label, d.note, "none — a label only"]);
  ref.addRow(["(blank)", "allowed", "No document type recorded", "none"]);
  ref.addRow([]);
  const h2 = ref.addRow(["Column on EXPENSES", "Treatment", "Stored as (VAT client; none on a non-VAT client)", "Use this when"]);
  h2.font = headerFont;
  h2.fill = headerFill;
  for (const c of CLASSIFICATIONS) ref.addRow([c.column, c.name, c.vatCategory, c.useWhen]);
  ref.addRow([]);
  const h3 = ref.addRow(["Vendor TIN formats accepted", "", "", ""]);
  h3.font = headerFont;
  h3.fill = headerFill;
  for (const f of TIN_FORMATS) ref.addRow([f, "dashes optional", "", ""]);
  ref.addRow(["(blank)", "allowed — the row is flagged Needs Review", "", ""]);
  ref.eachRow((r) => r.eachCell((c) => (c.alignment = { wrapText: true, vertical: "top" })));

  // --- COA ------------------------------------------------------------------
  const coa = wb.addWorksheet(SHEET.COA);
  const ch = coa.addRow(["Code", "Account Name", "Class", "Account Type", "Use for", "Allowed on expense rows"]);
  ch.font = headerFont;
  ch.fill = headerFill;
  coa.views = [{ state: "frozen", ySplit: 1 }];
  [11, 40, 12, 22, 44, 22].forEach((w, i) => (coa.getColumn(i + 1).width = w));
  coa.getColumn(1).numFmt = "@";
  for (const a of input.accounts) {
    coa.addRow([
      a.code,
      a.name,
      a.class,
      a.accountType,
      a.allowed ? "Expense rows." : "Not for expense rows — shown for reference.",
      a.allowed ? "Y" : "N",
    ]);
  }

  return Buffer.from(await wb.xlsx.writeBuffer());
}
