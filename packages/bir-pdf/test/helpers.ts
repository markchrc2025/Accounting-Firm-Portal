// Test helpers: read a PDF's text layer back with pdfjs-dist (dev only) and
// check that characters sit inside the boxes a field map names. The layout
// arithmetic here is deliberately independent of src/ so the tests check the
// engine, not a copy of it.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect } from "vitest";

export const PKG = join(dirname(fileURLToPath(import.meta.url)), "..");

export interface TextItem {
  page: number;
  str: string;
  /** Left edge of the glyph run. */
  x: number;
  /** Baseline. */
  y: number;
  w: number;
  /** Font size (the text matrix's vertical scale). */
  size: number;
}

/** Read every text item of every page (1-based page numbers). */
export async function readText(bytes: Uint8Array): Promise<TextItem[]> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  // pdfjs takes ownership of the buffer it is given, so hand it a copy.
  const task = pdfjs.getDocument({ data: bytes.slice(), verbosity: 0 });
  const doc = await task.promise;
  const out: TextItem[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const tc = await page.getTextContent();
    for (const it of tc.items) {
      if (!("str" in it) || it.str.trim() === "") continue;
      out.push({
        page: p,
        str: it.str,
        x: it.transform[4],
        y: it.transform[5],
        w: it.width,
        size: Math.abs(it.transform[3]),
      });
    }
  }
  await task.destroy();
  return out;
}

const sig = (t: TextItem) => `${t.page}|${t.str}|${t.x.toFixed(2)}|${t.y.toFixed(2)}`;

/** The text items the engine added: everything on the render not on the blank. */
export async function overlayText(
  rendered: Uint8Array,
  template: Uint8Array,
): Promise<TextItem[]> {
  const base = new Map<string, number>();
  for (const t of await readText(template)) base.set(sig(t), (base.get(sig(t)) ?? 0) + 1);
  const added: TextItem[] = [];
  for (const t of await readText(rendered)) {
    const n = base.get(sig(t)) ?? 0;
    if (n > 0) base.set(sig(t), n - 1);
    else added.push(t);
  }
  return added;
}

export function readPkg(rel: string): Uint8Array {
  return new Uint8Array(readFileSync(join(PKG, rel)));
}

// ---- map access (typed loosely on purpose: the tests read the JSON as data) ----
export interface MapRow {
  page: number;
  y: number;
  cells: number[];
}
export interface MapField {
  key: string;
  item: string;
  kind: string;
  page?: number;
  y?: number;
  cells?: number[];
  cents?: number[];
  rows?: MapRow[];
  box?: [number, number, number, number];
  x0?: number;
  x1?: number;
  align?: string;
  pad?: string;
  options?: Record<string, string>;
  reason?: string;
}
export interface FormMap {
  form: string;
  version: string;
  template: string;
  fields: MapField[];
}

export function loadMap(form: string, version: string): FormMap {
  return JSON.parse(
    readFileSync(join(PKG, "maps", `${form}-${version}.json`), "utf8"),
  ) as FormMap;
}

/** The placed map entries for a key (a key may print in more than one place). */
export function placed(map: FormMap, key: string): MapField[] {
  const f = map.fields.filter((x) => x.key === key && x.kind !== "none");
  expect(f.length, `map places ${key}`).toBeGreaterThan(0);
  return f;
}

/** Items whose centre lies inside [x0,x1] on the given page and baseline. */
function at(
  items: TextItem[],
  page: number,
  y: number,
  x0: number,
  x1: number,
): TextItem[] {
  return items.filter(
    (t) =>
      t.page === page &&
      Math.abs(t.y - y) < 1.5 &&
      t.x + t.w / 2 > x0 &&
      t.x + t.w / 2 < x1,
  );
}

/**
 * Assert `text` is written one character per box into the comb whose
 * boundaries are `cells` (n+1 x-values), aligned left or right. Every
 * non-space character must sit, centred, inside its own box.
 */
export function expectComb(
  items: TextItem[],
  page: number,
  y: number,
  cells: number[],
  text: string,
  align: "left" | "right",
  label: string,
): void {
  const n = cells.length - 1;
  expect(text.length, `${label}: fits ${n} boxes`).toBeLessThanOrEqual(n);
  const start = align === "right" ? n - text.length : 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    const x0 = cells[start + i]!;
    const x1 = cells[start + i + 1]!;
    const hits = at(items, page, y, x0, x1);
    if (ch === " ") {
      expect(hits, `${label}: box ${start + i + 1} empty`).toHaveLength(0);
      continue;
    }
    expect(
      hits.map((h) => h.str),
      `${label}: "${ch}" in box ${start + i + 1} [${x0}, ${x1}] at y=${y}`,
    ).toEqual([ch]);
    const c = hits[0]!.x + hits[0]!.w / 2;
    expect(Math.abs(c - (x0 + x1) / 2), `${label}: "${ch}" centred`).toBeLessThan(0.75);
  }
  // Nothing else in the boxes this value leaves empty.
  for (let i = 0; i < n; i++) {
    if (i >= start && i < start + text.length) continue;
    expect(
      at(items, page, y, cells[i]!, cells[i + 1]!),
      `${label}: box ${i + 1} empty`,
    ).toHaveLength(0);
  }
}

/** Assert an "X" (or nothing) is centred in a checkbox. */
export function expectMark(
  items: TextItem[],
  page: number,
  box: number[],
  marked: boolean,
  label: string,
): void {
  const [x0, y0, x1, y1] = box as [number, number, number, number];
  const hits = items.filter(
    (t) =>
      t.page === page &&
      t.x + t.w / 2 > x0 &&
      t.x + t.w / 2 < x1 &&
      t.y > y0 - 1 &&
      t.y < y1,
  );
  if (!marked) {
    expect(hits, `${label}: unmarked`).toHaveLength(0);
    return;
  }
  expect(
    hits.map((h) => h.str),
    `${label}: one X`,
  ).toEqual(["X"]);
  expect(
    Math.abs(hits[0]!.x + hits[0]!.w / 2 - (x0 + x1) / 2),
    `${label}: X centred`,
  ).toBeLessThan(0.75);
}

/** Assert a money value: integer digits right-aligned, centavos after the printed point. */
export function expectMoney(
  items: TextItem[],
  f: MapField,
  value: string,
  label: string,
): void {
  const [int, cents = ""] = value.replace(/,/g, "").split(".");
  expectComb(items, f.page!, f.y!, f.cells!, int!, "right", `${label} pesos`);
  if (f.cents)
    expectComb(items, f.page!, f.y!, f.cents, cents, "left", `${label} centavos`);
}
