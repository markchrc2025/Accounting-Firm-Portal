/**
 * pdf-text.ts — read a printed return's text back, field by field, using the print
 * engine's own field map for where each field sits (the geometry, not the engine's
 * code). U13 T1.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const BIR_PDF = join(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "..",
  "packages",
  "bir-pdf",
);

interface Item {
  page: number;
  str: string;
  x: number;
  y: number;
}
export interface PdfText {
  pages: number;
  items: Item[];
}

/** The text layers of several PDFs, read in one child process. */
export function readPdfText(...pdfs: Uint8Array[]): PdfText[] {
  const dir = mkdtempSync(join(tmpdir(), "u13-pdf-"));
  try {
    const paths = pdfs.map((b, i) => {
      const p = join(dir, `${i}.pdf`);
      writeFileSync(p, b);
      return p;
    });
    const json = execFileSync(
      process.execPath,
      [join(__dirname, "pdf-text.mjs"), ...paths],
      {
        cwd: join(__dirname, "..", ".."),
        maxBuffer: 64 * 1024 * 1024,
      },
    );
    return JSON.parse(json.toString("utf8")) as PdfText[];
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** What the engine printed: the render's text items that are not on the blank. */
export function overlay(rendered: PdfText, blank: PdfText): Item[] {
  const sig = (t: Item) => `${t.page}|${t.str}|${t.x.toFixed(2)}|${t.y.toFixed(2)}`;
  const base = new Map<string, number>();
  for (const t of blank.items) base.set(sig(t), (base.get(sig(t)) ?? 0) + 1);
  return rendered.items.filter((t) => {
    const n = base.get(sig(t)) ?? 0;
    if (n > 0) base.set(sig(t), n - 1);
    return n === 0;
  });
}

interface MapField {
  key: string;
  kind: string;
  page?: number;
  y?: number;
  cells?: number[];
  cents?: number[];
  rows?: Array<{ page: number; y: number; cells: number[] }>;
}

export function loadMap(file: string): { template: string; fields: MapField[] } {
  return JSON.parse(readFileSync(join(BIR_PDF, "maps", file), "utf8"));
}

/** The characters printed between two x-edges on one baseline, left to right. */
function between(items: Item[], page: number, y: number, x0: number, x1: number): string {
  return items
    .filter((t) => t.page === page && Math.abs(t.y - y) < 4 && t.x >= x0 - 1 && t.x < x1)
    .sort((a, b) => a.x - b.x)
    .map((t) => t.str)
    .join("")
    .replace(/\s+/g, "");
}

/** What a field printed: a comb or choice as its characters; money as "pesos.cents". */
export function printed(items: Item[], field: MapField): string {
  if (field.rows)
    return field.rows
      .map((r) => between(items, r.page, r.y, r.cells[0]!, r.cells.at(-1)!))
      .join("");
  const pesos = between(
    items,
    field.page!,
    field.y!,
    field.cells![0]!,
    field.cells!.at(-1)!,
  );
  if (!field.cents) return pesos;
  const cents = between(
    items,
    field.page!,
    field.y!,
    field.cents[0]!,
    field.cents.at(-1)!,
  );
  return `${pesos}.${cents}`;
}
