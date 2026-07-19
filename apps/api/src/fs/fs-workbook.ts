// exceljs renderer for the export model: real formulas WITH server-computed
// cached results (so PDF renderers/previewers show numbers without a
// recalculation pass), professional typography, alignment-indent (never
// literal spaces), the accounting number format, wrapped/merged note
// paragraphs, freeze panes, full print setup, and workbook metadata.

import * as ExcelJS from "exceljs";
import type { ExportModel, FormulaSpec, SheetName, XRow, XSheet } from "./fs-statement-model";

export interface RenderOptions {
  fontName: string;
  fontSize: number;
}

export const DEFAULT_RENDER_OPTIONS: RenderOptions = { fontName: "Arial", fontSize: 10 };

/** Accounting-style: negatives in parentheses, zeros as a dash. */
export const AMOUNT_FORMAT = '#,##0.00;(#,##0.00);"-"';

const colLetter = (n: number): string => {
  let s = "";
  let x = n;
  while (x > 0) {
    const r = (x - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    x = Math.floor((x - 1) / 26);
  }
  return s;
};

interface SheetGeo {
  sheet: XSheet;
  bodyStart: number; // first body row (1-based)
  amountColStart: number; // 1-based column of amount column 0
  lastCol: number;
  lastRow: number;
}

/** Row number of every id across the workbook: "SHEET:id" → row. */
function buildRegistry(geos: Map<SheetName, SheetGeo>): Map<string, number> {
  const registry = new Map<string, number>();
  for (const geo of geos.values()) {
    geo.sheet.rows.forEach((row, i) => {
      if (row.id) registry.set(`${geo.sheet.name}:${row.id}`, geo.bodyStart + i);
    });
  }
  return registry;
}

/** Collapse sorted row numbers into A1 ranges for a SUM. */
function sumRanges(col: string, rowsNums: number[]): string {
  const sorted = [...new Set(rowsNums)].sort((a, b) => a - b);
  const parts: string[] = [];
  let start = sorted[0]!;
  let prev = sorted[0]!;
  for (const r of sorted.slice(1)) {
    if (r === prev + 1) {
      prev = r;
      continue;
    }
    parts.push(start === prev ? `${col}${start}` : `${col}${start}:${col}${prev}`);
    start = prev = r;
  }
  parts.push(start === prev ? `${col}${start}` : `${col}${start}:${col}${prev}`);
  return parts.join(",");
}

function materialize(
  spec: FormulaSpec,
  ownSheet: SheetName,
  ownColIdx: number,
  geos: Map<SheetName, SheetGeo>,
  registry: Map<string, number>,
): string {
  const geoOf = (s: SheetName) => geos.get(s)!;
  if (spec.t === "sum") {
    const col = colLetter(geoOf(ownSheet).amountColStart + ownColIdx);
    const rows = spec.ids
      .map((id) => registry.get(`${ownSheet}:${id}`))
      .filter((r): r is number => r !== undefined);
    if (rows.length === 0) return "0";
    return `SUM(${sumRanges(col, rows)})`;
  }
  const parts: string[] = [];
  for (const term of spec.terms) {
    const sheet = term.sheet ?? ownSheet;
    const row = registry.get(`${sheet}:${term.id}`);
    if (row === undefined) continue;
    const colIdx = term.col ?? ownColIdx;
    const ref = `${sheet === ownSheet ? "" : `${sheet}!`}${colLetter(geoOf(sheet).amountColStart + colIdx)}${row}`;
    parts.push(`${term.s === 1 ? (parts.length ? "+" : "") : "-"}${ref}`);
  }
  const expr = parts.join("") || "0";
  return spec.round ? `ROUND(${expr},2)` : expr;
}

const rowStyle = (
  kind: XRow["kind"],
): { bold: boolean; top: boolean; doubleBottom: boolean; italic?: boolean } => {
  switch (kind) {
    case "section":
    case "group":
    case "blocktitle":
    case "notetitle":
      return { bold: true, top: false, doubleBottom: false };
    case "subtotal":
      return { bold: true, top: true, doubleBottom: false };
    case "total":
      return { bold: true, top: true, doubleBottom: true };
    case "check":
      return { bold: false, top: false, doubleBottom: false, italic: true };
    default:
      return { bold: false, top: false, doubleBottom: false };
  }
};

/** Render the model into a styled exceljs workbook. */
export function renderWorkbook(
  model: ExportModel,
  entityName: string,
  render: RenderOptions = DEFAULT_RENDER_OPTIONS,
): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Accounting Firm Portal";
  wb.lastModifiedBy = "Accounting Firm Portal";
  wb.created = new Date();
  wb.modified = new Date();
  wb.title = `${entityName} — Financial Statements ${model.currentLabel ? `FY${model.currentLabel}` : ""}`.trim();
  wb.company = entityName;

  const font = { name: render.fontName, size: render.fontSize };
  const boldFont = { ...font, bold: true };

  // --- geometry pass ---------------------------------------------------------
  const geos = new Map<SheetName, SheetGeo>();
  for (const sheet of model.sheets) {
    const hasHeader = sheet.amountHeads.length > 0;
    const bodyStart = hasHeader ? 7 : 6; // titles 1–4, blank 5, [header 6]
    const amountColStart = (sheet.hasNoteCol ? 2 : 1) + 1; // after label (+ note) col
    const widest = Math.max(
      sheet.amountHeads.length,
      ...sheet.rows.map((r) => Math.max(r.cells?.length ?? 0, r.heads?.length ?? 0)),
      1,
    );
    geos.set(sheet.name, {
      sheet,
      bodyStart,
      amountColStart,
      lastCol: amountColStart + widest - 1,
      lastRow: bodyStart + sheet.rows.length - 1,
    });
  }
  const registry = buildRegistry(geos);

  // --- render pass -----------------------------------------------------------
  for (const sheet of model.sheets) {
    const geo = geos.get(sheet.name)!;
    const ws = wb.addWorksheet(sheet.name);

    // Column widths: generous label column, money columns.
    ws.getColumn(1).width = 46;
    if (sheet.hasNoteCol) ws.getColumn(2).width = 7;
    for (let c = geo.amountColStart; c <= geo.lastCol; c++) ws.getColumn(c).width = 16;

    // Title block (merged + centered, company/statement bold).
    sheet.titles.forEach((title, i) => {
      const rowNum = i + 1;
      ws.mergeCells(rowNum, 1, rowNum, geo.lastCol);
      const cell = ws.getCell(rowNum, 1);
      cell.value = title;
      cell.font = i < 2 ? boldFont : font;
      cell.alignment = { horizontal: "center" };
    });

    // Column-header row (period labels / CE matrix heads) + Note column head.
    if (sheet.amountHeads.length > 0) {
      const headerRow = 6;
      if (sheet.hasNoteCol) {
        const noteHead = ws.getCell(headerRow, 2);
        noteHead.value = "Note";
        noteHead.font = boldFont;
        noteHead.alignment = { horizontal: "center" };
      }
      sheet.amountHeads.forEach((head, i) => {
        const cell = ws.getCell(headerRow, geo.amountColStart + i);
        cell.value = head; // year headers stay text
        cell.font = boldFont;
        cell.alignment = { horizontal: "right", wrapText: true };
      });
    }

    // Body rows.
    sheet.rows.forEach((row, i) => {
      const rowNum = geo.bodyStart + i;
      const style = rowStyle(row.kind);
      const label = ws.getCell(rowNum, 1);
      label.value = row.label;
      label.font = style.bold ? boldFont : style.italic ? { ...font, italic: true } : font;
      label.alignment = { indent: row.indent > 0 ? row.indent : undefined, wrapText: false };

      if (row.kind === "para") {
        ws.mergeCells(rowNum, 1, rowNum, geo.lastCol);
        label.alignment = { wrapText: true, vertical: "top" };
        const approxCharsPerLine = 110;
        const lines = Math.max(1, Math.ceil(row.label.length / approxCharsPerLine));
        ws.getRow(rowNum).height = lines * 13.5 + 4;
        return;
      }
      if (row.kind === "tablehead") {
        (row.heads ?? []).forEach((head, hi) => {
          const cell = ws.getCell(rowNum, geo.amountColStart + hi);
          cell.value = head;
          cell.font = boldFont;
          cell.alignment = { horizontal: "right", wrapText: true };
        });
        return;
      }
      if (row.note && sheet.hasNoteCol) {
        const noteCell = ws.getCell(rowNum, 2);
        noteCell.value = Number(row.note) || row.note;
        noteCell.font = font;
        noteCell.alignment = { horizontal: "center" };
      }
      (row.cells ?? []).forEach((xc, ci) => {
        if (xc === null || xc.v === null) return;
        const cell = ws.getCell(rowNum, geo.amountColStart + ci);
        cell.numFmt = AMOUNT_FORMAT;
        cell.font = style.bold ? boldFont : font;
        if (xc.f) {
          cell.value = { formula: materialize(xc.f, sheet.name, ci, geos, registry), result: xc.v };
        } else {
          cell.value = xc.v;
        }
        const border: Partial<ExcelJS.Borders> = {};
        if (style.top) border.top = { style: "thin" };
        if (style.doubleBottom) border.bottom = { style: "double" };
        if (style.top || style.doubleBottom) cell.border = border;
      });
    });

    // Freeze panes below the column-header row on the statement sheets.
    if (sheet.name === "BS" || sheet.name === "IS" || sheet.name === "CF") {
      ws.views = [{ state: "frozen", ySplit: 6 }];
    }

    // Print setup (§G.5): portrait, fit one page wide, margins, repeat titles,
    // footer with page numbers + company name.
    ws.pageSetup = {
      orientation: "portrait",
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      paperSize: 9, // A4
      printArea: `A1:${colLetter(geo.lastCol)}${geo.lastRow}`,
      printTitlesRow: "1:4",
      margins: { left: 0.75, right: 0.75, top: 0.75, bottom: 0.75, header: 0.3, footer: 0.3 },
      horizontalCentered: true,
    };
    ws.headerFooter = {
      oddFooter: `&L${entityName}&RPage &P of &N`,
      evenFooter: `&L${entityName}&RPage &P of &N`,
    };
  }

  return wb;
}

export async function workbookBuffer(wb: ExcelJS.Workbook): Promise<Buffer> {
  return Buffer.from(await wb.xlsx.writeBuffer());
}
