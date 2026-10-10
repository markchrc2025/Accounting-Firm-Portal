// validateMap — structural checks on a field map, run every time one is loaded.
// A map is data a person edits by hand; a typo here must fail loudly, not
// print in the wrong place.
import { BirPdfError, type CombRow, type Field, type FormMap } from "./types";

function fail(map: FormMap, what: string): never {
  throw new BirPdfError(`map ${map.form}-${map.version}: ${what}`);
}

function checkCells(map: FormMap, key: string, cells: unknown, page: number): void {
  if (
    !Array.isArray(cells) ||
    cells.length < 2 ||
    !cells.every((c) => typeof c === "number")
  ) {
    fail(map, `${key}: cells must be at least two x-boundaries`);
  }
  const cs = cells as number[];
  const width = map.pages[page - 1]!.width;
  for (let i = 1; i < cs.length; i++) {
    if (!(cs[i]! > cs[i - 1]!))
      fail(map, `${key}: cell boundaries must increase (${cs.join(", ")})`);
  }
  if (cs[0]! < 0 || cs[cs.length - 1]! > width)
    fail(map, `${key}: cells run off the page`);
}

function checkPage(map: FormMap, key: string, page: unknown, y: unknown): number {
  if (
    typeof page !== "number" ||
    !Number.isInteger(page) ||
    page < 1 ||
    page > map.pages.length
  ) {
    fail(map, `${key}: page ${String(page)} is not a page of the template`);
  }
  if (typeof y !== "number" || y < 0 || y > map.pages[page - 1]!.height)
    fail(map, `${key}: y ${String(y)} is off the page`);
  return page;
}

function checkField(map: FormMap, f: Field): void {
  if (typeof f.key !== "string" || f.key === "") fail(map, "a field has no key");
  if (f.kind === "none") {
    if (typeof f.reason !== "string" || f.reason.trim() === "")
      fail(map, `${f.key}: kind "none" needs a reason`);
    if (f.expect !== undefined) new RegExp(f.expect);
    return;
  }
  if (typeof f.item !== "string" || f.item === "")
    fail(map, `${f.key}: a placed field needs its item label`);
  for (const c of f.blankIf ?? []) {
    if (typeof c.key !== "string" || typeof c.equals !== "string")
      fail(map, `${f.key}: blankIf needs key and equals`);
  }
  switch (f.kind) {
    case "comb": {
      if (!Array.isArray(f.rows) || f.rows.length === 0)
        fail(map, `${f.key}: a comb needs rows`);
      f.rows.forEach((r: CombRow) =>
        checkCells(map, f.key, r.cells, checkPage(map, f.key, r.page, r.y)),
      );
      if (f.rows.length > 1 && f.align === "right")
        fail(map, `${f.key}: right alignment is for one row only`);
      if (f.pad !== undefined && f.pad.length !== 1)
        fail(map, `${f.key}: pad is one character`);
      if (f.squeeze && (f.date || f.pad || f.ghost === "8" || f.align === "right"))
        fail(map, `${f.key}: squeeze is for letter combs only; digits never squeeze`);
      return;
    }
    case "money":
      checkCells(map, f.key, f.cells, checkPage(map, f.key, f.page, f.y));
      if (f.cents) checkCells(map, f.key, f.cents, f.page);
      return;
    case "choice":
      checkCells(map, f.key, f.cells, checkPage(map, f.key, f.page, f.y));
      if (typeof f.options !== "object" || f.options === null)
        fail(map, `${f.key}: a choice needs its options`);
      return;
    case "mark": {
      checkPage(map, f.key, f.page, f.box?.[1]);
      const [x0, y0, x1, y1] = f.box;
      if (!(x1 > x0 && y1 > y0)) fail(map, `${f.key}: box must be [x0, y0, x1, y1]`);
      return;
    }
    case "text":
      checkPage(map, f.key, f.page, f.y);
      if (!(f.x1 > f.x0)) fail(map, `${f.key}: x1 must be right of x0`);
      if (!(f.minSize > 0)) fail(map, `${f.key}: a text field needs minSize`);
      return;
    default:
      fail(
        map,
        `${(f as { key: string }).key}: unknown kind "${(f as { kind: string }).kind}"`,
      );
  }
}

export function validateMap(map: FormMap): FormMap {
  if (
    !map ||
    !Array.isArray(map.fields) ||
    !Array.isArray(map.pages) ||
    map.pages.length === 0
  ) {
    throw new BirPdfError("field map: missing pages or fields");
  }
  if (!(map.size > 0)) fail(map, "default size missing");
  map.fields.forEach((f) => checkField(map, f));
  const none = new Set(map.fields.filter((f) => f.kind === "none").map((f) => f.key));
  for (const f of map.fields) {
    if (f.kind !== "none" && none.has(f.key))
      fail(map, `${f.key} is both placed and "none"`);
  }
  return map;
}
