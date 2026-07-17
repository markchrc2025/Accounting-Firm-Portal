// xlsx export of the assembled financial statements — pure (no Prisma/Nest),
// mirroring the firm's AFS template layout: one sheet per statement (BS, IS,
// CF, CE) plus a Notes sheet. Each statement sheet carries the entity name,
// the statement title, a period line, then the engine's presentation rows with
// one amount column per period. Amounts are real number cells (#,##0.00) so
// the file is immediately workable in Excel.

import * as XLSX from "xlsx";
import type { FsRow } from "./fs-engine";
import type { FsNoteTableRow } from "./fs-notes";

export interface FsExportPeriod {
  id: string;
  label: string;
  endDate: string | null; // ISO yyyy-mm-dd
}

export interface FsExportNote {
  number: number;
  title: string;
  paragraphs?: string[];
  table?: { rows: FsNoteTableRow[] };
}

export interface FsExportInput {
  entityName: string;
  periods: FsExportPeriod[]; // current first (sortOrder ascending)
  balanceSheet: { rows: FsRow[] };
  incomeStatement: { rows: FsRow[] };
  cashFlow: { rows: FsRow[] };
  changesInEquity: { rows: FsRow[] };
  notes: FsExportNote[];
}

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** ISO yyyy-mm-dd → "December 31, 2025" (falls back to the raw string). */
export function longDate(iso: string | null): string {
  if (!iso) return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  const month = MONTHS[Number(m[2]) - 1];
  return month ? `${month} ${Number(m[3])}, ${m[1]}` : iso;
}

/** "December 31, 2024 and December 31, 2025" (oldest → newest, like the firm's
 *  template); Oxford-comma list beyond two. */
export function periodSpan(periods: FsExportPeriod[]): string {
  const dates = [...periods]
    .reverse() // oldest first
    .map((p) => longDate(p.endDate) || p.label)
    .filter(Boolean);
  if (dates.length <= 1) return dates[0] ?? "";
  if (dates.length === 2) return `${dates[0]} and ${dates[1]}`;
  return `${dates.slice(0, -1).join(", ")}, and ${dates[dates.length - 1]}`;
}

type Cell = string | number | null;

/** A number cell with the money format, or blank when the period has no value
 *  (e.g. the earliest column of a movement statement). */
function moneyCell(row: FsRow | { amounts?: Record<string, number> }, periodId: string): Cell {
  const amounts = row.amounts;
  if (!amounts || !(periodId in amounts)) return null;
  return amounts[periodId]!;
}

function sheetFromGrid(grid: Cell[][], periodCount: number): XLSX.WorkSheet {
  const ws = XLSX.utils.aoa_to_sheet(grid);
  // Money format on every numeric cell; generous label column.
  const range = XLSX.utils.decode_range(ws["!ref"] ?? "A1");
  for (let r = range.s.r; r <= range.e.r; r++) {
    for (let c = range.s.c; c <= range.e.c; c++) {
      const addr = XLSX.utils.encode_cell({ r, c });
      const cell = ws[addr] as XLSX.CellObject | undefined;
      if (cell && cell.t === "n") cell.z = "#,##0.00";
    }
  }
  ws["!cols"] = [{ wch: 52 }, ...Array.from({ length: periodCount }, () => ({ wch: 16 }))];
  return ws;
}

/** One statement sheet: title block, period header, then the engine rows. */
function statementSheet(
  entityName: string,
  title: string,
  subtitle: string,
  rows: FsRow[],
  periods: FsExportPeriod[],
): XLSX.WorkSheet {
  const grid: Cell[][] = [
    [entityName],
    [title],
    [subtitle],
    [],
    ["", ...periods.map((p) => p.label)],
  ];
  for (const row of rows) {
    if (row.kind === "spacer") {
      grid.push([]);
      continue;
    }
    const label = `${"  ".repeat(row.level)}${row.label}`;
    if (!row.amounts) {
      grid.push([label]);
      continue;
    }
    grid.push([label, ...periods.map((p) => moneyCell(row, p.id))]);
  }
  return sheetFromGrid(grid, periods.length);
}

/** The Notes sheet: numbered titles, narrative paragraphs (one per row), and
 *  numeric note tables with the same period columns as the statements. */
function notesSheet(
  entityName: string,
  subtitle: string,
  notes: FsExportNote[],
  periods: FsExportPeriod[],
): XLSX.WorkSheet {
  const grid: Cell[][] = [[entityName], ["NOTES TO FINANCIAL STATEMENTS"], [subtitle], []];
  for (const note of notes) {
    grid.push([`${note.number}. ${note.title.toUpperCase()}`]);
    for (const paragraph of note.paragraphs ?? []) grid.push([paragraph]);
    if (note.table) {
      grid.push(["", ...periods.map((p) => p.label)]);
      for (const row of note.table.rows) {
        grid.push([row.label, ...periods.map((p) => moneyCell(row, p.id))]);
      }
    }
    grid.push([]);
  }
  return sheetFromGrid(grid, periods.length);
}

/** Assemble the full workbook: BS · IS · CF · CE · Notes. */
export function buildFsWorkbook(input: FsExportInput): XLSX.WorkBook {
  const { entityName, periods } = input;
  const current = periods[0];
  const asOf = `As of ${longDate(current?.endDate ?? null) || current?.label || ""}`;
  const span = periodSpan(periods);
  const forPeriods = `For the period${periods.length > 1 ? "s" : ""} ended ${span}`;

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    wb,
    statementSheet(entityName, "STATEMENT OF FINANCIAL POSITION", asOf, input.balanceSheet.rows, periods),
    "BS",
  );
  XLSX.utils.book_append_sheet(
    wb,
    statementSheet(entityName, "STATEMENT OF INCOME", forPeriods, input.incomeStatement.rows, periods),
    "IS",
  );
  XLSX.utils.book_append_sheet(
    wb,
    statementSheet(entityName, "STATEMENT OF CASH FLOWS", forPeriods, input.cashFlow.rows, periods),
    "CF",
  );
  XLSX.utils.book_append_sheet(
    wb,
    statementSheet(entityName, "STATEMENT OF CHANGES IN EQUITY", forPeriods, input.changesInEquity.rows, periods),
    "CE",
  );
  XLSX.utils.book_append_sheet(wb, notesSheet(entityName, asOf, input.notes, periods), "Notes");
  return wb;
}

/** "<Entity> FS <current period>.xlsx", safe for a Content-Disposition header. */
export function exportFileName(entityName: string, periods: FsExportPeriod[]): string {
  const entity = entityName.replace(/[^\w\- ]+/g, "").replace(/\s+/g, " ").trim() || "Financial Statements";
  const label = periods[0]?.label?.replace(/[^\w\-]+/g, "") ?? "";
  return `${entity} FS${label ? ` ${label}` : ""}.xlsx`;
}
