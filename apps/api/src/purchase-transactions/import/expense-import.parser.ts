// expense-import.parser.ts — reads an uploaded Expenses workbook v2 (U6) with
// exceljs into plain rows. It knows the sheet names and the header row and
// nothing about what the cells mean; the rules live in the service.
import * as ExcelJS from "exceljs";
import {
  CLIENT_SHEET_KEYS,
  EXPENSES_HEADERS,
  MAX_DATA_ROWS,
  SHEET,
  type ExpenseHeader,
} from "./expense-import.constants";
import { cellText } from "./expense-import.rules";

/** A whole-file problem: wrong workbook, missing sheet, changed headers. */
export class ImportFileError extends Error {}

export interface ParsedClientSheet {
  clientId: string;
  tin: string;
  name: string;
  regime: string;
  periodFrom: unknown;
  periodTo: unknown;
  version: string;
}

export interface ParsedRow {
  /** The Excel row number, so a message points at the row the encoder sees. */
  rowNumber: number;
  cells: Partial<Record<ExpenseHeader, unknown>>;
}

/** Unwrap exceljs cell values (rich text, formulas, hyperlinks) to plain data. */
export function cellValue(v: ExcelJS.CellValue): unknown {
  if (v === null || v === undefined) return null;
  if (v instanceof Date || typeof v !== "object") return v;
  const o = v as unknown as Record<string, unknown>;
  if (Array.isArray(o.richText)) {
    return (o.richText as { text: string }[]).map((t) => t.text).join("");
  }
  if ("result" in o) return cellValue(o.result as ExcelJS.CellValue);
  if ("text" in o) return cellValue(o.text as ExcelJS.CellValue);
  if ("error" in o) return null;
  return null;
}

function findSheet(wb: ExcelJS.Workbook, name: string): ExcelJS.Worksheet | undefined {
  return wb.worksheets.find((s) => s.name.trim().toLowerCase() === name.toLowerCase());
}

export async function parseExpenseWorkbook(
  buffer: Buffer,
): Promise<{ client: ParsedClientSheet; rows: ParsedRow[] }> {
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buffer as unknown as ArrayBuffer);
  } catch {
    throw new ImportFileError("The file is not an .xlsx workbook. Upload the template you downloaded, filled in.");
  }

  const cs = findSheet(wb, SHEET.CLIENT);
  if (!cs) throw new ImportFileError(`The workbook has no "${SHEET.CLIENT}" sheet. Download a fresh template.`);
  const kv = new Map<string, unknown>();
  cs.eachRow((r) => {
    const k = cellText(cellValue(r.getCell(1).value));
    if (k) kv.set(k, cellValue(r.getCell(2).value));
  });
  const text = (k: string) => cellText(kv.get(k));
  const client: ParsedClientSheet = {
    clientId: text(CLIENT_SHEET_KEYS.clientId),
    tin: text(CLIENT_SHEET_KEYS.tin),
    name: text(CLIENT_SHEET_KEYS.name),
    regime: text(CLIENT_SHEET_KEYS.regime),
    periodFrom: kv.get(CLIENT_SHEET_KEYS.periodFrom) ?? null,
    periodTo: kv.get(CLIENT_SHEET_KEYS.periodTo) ?? null,
    version: text(CLIENT_SHEET_KEYS.version),
  };

  const ws = findSheet(wb, SHEET.EXPENSES);
  if (!ws) throw new ImportFileError(`The workbook has no "${SHEET.EXPENSES}" sheet. Download a fresh template.`);
  const headerRow = ws.getRow(1);
  for (let i = 0; i < EXPENSES_HEADERS.length; i++) {
    const expected = EXPENSES_HEADERS[i]!;
    const got = cellText(cellValue(headerRow.getCell(i + 1).value));
    if (got !== expected) {
      throw new ImportFileError(
        `Column ${i + 1} of the ${SHEET.EXPENSES} sheet should be "${expected}" but is "${got || "(blank)"}". Columns must not be added, renamed or reordered.`,
      );
    }
  }

  const rows: ParsedRow[] = [];
  ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1) return;
    const cells: Partial<Record<ExpenseHeader, unknown>> = {};
    let any = false;
    EXPENSES_HEADERS.forEach((h, i) => {
      const v = cellValue(row.getCell(i + 1).value);
      if (v !== null && v !== undefined && cellText(v) !== "") {
        cells[h] = v;
        any = true;
      }
    });
    if (any) rows.push({ rowNumber, cells });
  });
  if (rows.length > MAX_DATA_ROWS) {
    throw new ImportFileError(`The ${SHEET.EXPENSES} sheet has ${rows.length} rows; the limit is ${MAX_DATA_ROWS} per file. Split the file.`);
  }
  return { client, rows };
}
