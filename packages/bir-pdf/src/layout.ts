// layout — the pure heart of the engine: turn a form map plus the [key, value]
// rows of an export into the exact pieces of text to draw (page, x, y, size).
// No PDF, no files, no clock: the font's metrics come in as a parameter.
//
// Every value either lands inside its boxes or throws a BirPdfError naming the
// field. Nothing is ever cut off silently.
import {
  BirPdfError,
  type ChoiceField,
  type CombField,
  type CombRow,
  type DrawOp,
  type FormMap,
  type MarkField,
  type MoneyField,
  type PlacedField,
  type TextField,
} from "./types";

/** What the layout needs to know about the font. */
export interface Metrics {
  width(text: string, size: number): number;
  /** Height of a capital letter at `size` (to centre an X in a checkbox). */
  capHeight(size: number): number;
  /** Whether the font can print this character. */
  has(ch: string): boolean;
}

const where = (f: PlacedField, form: FormMap) =>
  `${form.form} ${form.version} ${f.key} (item ${f.item})`;

/** Lay out every mapped field of an export. */
export function layoutReturn(
  map: FormMap,
  rows: [string, string][],
  m: Metrics,
): DrawOp[] {
  const values = new Map<string, string>();
  for (const [k, v] of rows) {
    if (values.has(k))
      throw new BirPdfError(
        `${map.form} ${map.version}: key ${k} appears twice in the export`,
        k,
      );
    values.set(k, v);
  }
  const mapped = new Set(map.fields.map((f) => f.key));
  for (const k of values.keys()) {
    if (!mapped.has(k)) {
      throw new BirPdfError(
        `${map.form} ${map.version}: key ${k} has no entry in the field map (maps/${map.form}-${map.version}.json)`,
        k,
      );
    }
  }

  const ops: DrawOp[] = [];
  for (const f of map.fields) {
    const v = values.get(f.key);
    if (v === undefined) continue; // the export does not carry this key
    if (f.kind === "none") {
      if (f.expect !== undefined && !new RegExp(f.expect).test(v)) {
        throw new BirPdfError(
          `${map.form} ${map.version} ${f.key}: has no place on the paper (${f.reason}) but holds "${v}"`,
          f.key,
        );
      }
      continue;
    }
    if (
      f.blankIf?.length &&
      f.blankIf.every((c) => (values.get(c.key) ?? "") === c.equals)
    )
      continue;
    ops.push(...placeField(map, f, v, m));
  }
  return ops;
}

function placeField(map: FormMap, f: PlacedField, v: string, m: Metrics): DrawOp[] {
  const size = f.size ?? map.size;
  switch (f.kind) {
    case "comb":
      return comb(map, f, v, size, m);
    case "money":
      return money(map, f, v, size, m);
    case "mark":
      return mark(map, f, v, size, m);
    case "choice":
      return choice(map, f, v, size, m);
    case "text":
      return text(map, f, v, size, m);
  }
}

/** Characters centred one per box, starting at box `start`. */
function fill(
  row: CombRow,
  chars: string,
  start: number,
  size: number,
  m: Metrics,
  who: string,
): DrawOp[] {
  const ops: DrawOp[] = [];
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i]!;
    if (ch === " ") continue;
    if (!m.has(ch))
      throw new BirPdfError(`${who}: the character "${ch}" cannot be printed`);
    const x0 = row.cells[start + i]!;
    const x1 = row.cells[start + i + 1]!;
    ops.push({
      page: row.page,
      x: (x0 + x1) / 2 - m.width(ch, size) / 2,
      y: row.y,
      text: ch,
      size,
    });
  }
  return ops;
}

const boxes = (row: CombRow) => row.cells.length - 1;

/** "1/01/2026" or "01/01/2026" → "01012026". */
function dateDigits(v: string, who: string): string {
  const d = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(v.trim());
  if (!d) throw new BirPdfError(`${who}: "${v}" is not a date (MM/DD/YYYY)`);
  return d[1]!.padStart(2, "0") + d[2]!.padStart(2, "0") + d[3]!;
}

/** Break text into rows of the given widths at spaces; a word longer than a row is split. */
function wrapWords(v: string, widths: number[]): string[] | undefined {
  const lines: string[] = [""];
  for (const word of v.split(/ +/).filter(Boolean)) {
    let w = word;
    for (;;) {
      const i = lines.length - 1;
      const cap = widths[i];
      if (cap === undefined) return undefined;
      const cur = lines[i]!;
      const joined = cur ? `${cur} ${w}` : w;
      if (joined.length <= cap) {
        lines[i] = joined;
        break;
      }
      if (!cur) {
        // A word wider than a whole row: fill the row and carry the rest.
        lines[i] = w.slice(0, cap);
        w = w.slice(cap);
      }
      lines.push("");
    }
  }
  return lines.length <= widths.length ? lines : undefined;
}

function comb(
  map: FormMap,
  f: CombField,
  raw: string,
  size: number,
  m: Metrics,
): DrawOp[] {
  const who = where(f, map);
  let v = (f.case ?? "upper") === "upper" ? raw.toUpperCase() : raw;
  if (v.trim() === "") return [];
  if (f.date) v = dateDigits(v, who);
  if (f.drop) v = [...v].filter((c) => !f.drop!.includes(c)).join("");
  const total = f.rows.reduce((t, r) => t + boxes(r), 0);
  if (f.pad && v.length < total) v = v.padStart(total, f.pad);
  if (v.length > total && (f.wrap !== "words" || f.rows.length === 1)) {
    throw new BirPdfError(
      `${who}: "${raw}" is ${v.length} characters but the paper has ${total} boxes`,
      f.key,
    );
  }

  if (f.rows.length === 1) {
    const row = f.rows[0]!;
    const start = (f.align ?? "left") === "right" ? boxes(row) - v.length : 0;
    return fill(row, v, start, size, m, who);
  }
  let parts: string[];
  if (f.wrap === "words") {
    const wrapped = wrapWords(v, f.rows.map(boxes));
    if (!wrapped) {
      throw new BirPdfError(
        `${who}: "${raw}" (${v.length} characters) does not fit ${f.rows.length} rows of ${f.rows.map(boxes).join(" + ")} boxes`,
        f.key,
      );
    }
    parts = wrapped;
  } else {
    parts = [];
    let rest = v;
    for (const r of f.rows) {
      parts.push(rest.slice(0, boxes(r)));
      rest = rest.slice(boxes(r));
    }
  }
  return f.rows.flatMap((r, i) => fill(r, parts[i] ?? "", 0, size, m, who));
}

const AMOUNT = /^(-?)([0-9][0-9,]*)(?:\.([0-9]+))?$/;

function money(
  map: FormMap,
  f: MoneyField,
  raw: string,
  size: number,
  m: Metrics,
): DrawOp[] {
  const who = where(f, map);
  const v = raw.trim();
  if (v === "") return [];
  const a = AMOUNT.exec(v);
  if (!a) throw new BirPdfError(`${who}: "${raw}" is not an amount`, f.key);
  const pesos = a[1]! + a[2]!.replace(/,/g, "");
  const centavos = a[3] ?? "";
  const row = { page: f.page, y: f.y, cells: f.cells };
  if (pesos.length > boxes(row)) {
    throw new BirPdfError(
      `${who}: "${raw}" needs ${pesos.length} boxes before the point but the paper has ${boxes(row)}`,
      f.key,
    );
  }
  const ops = fill(row, pesos, boxes(row) - pesos.length, size, m, who);
  if (!f.cents) {
    if (/[1-9]/.test(centavos)) {
      throw new BirPdfError(
        `${who}: "${raw}" has centavos but the paper has no centavo boxes`,
        f.key,
      );
    }
    return ops;
  }
  const cents = { page: f.page, y: f.y, cells: f.cents };
  // "3.0" in two centavo boxes prints "00"; trailing zeros never change the value.
  const c = centavos.padEnd(boxes(cents), "0");
  if (c.length > boxes(cents)) {
    if (/[1-9]/.test(c.slice(boxes(cents)))) {
      throw new BirPdfError(
        `${who}: "${raw}" has ${c.length} decimals but the paper has ${boxes(cents)} centavo boxes`,
        f.key,
      );
    }
  }
  return ops.concat(fill(cents, c.slice(0, boxes(cents)), 0, size, m, who));
}

function markAt(f: MarkField, size: number, m: Metrics): DrawOp {
  const [x0, y0, x1, y1] = f.box;
  return {
    page: f.page,
    x: (x0 + x1) / 2 - m.width("X", size) / 2,
    y: (y0 + y1) / 2 - m.capHeight(size) / 2,
    text: "X",
    size,
  };
}

function mark(map: FormMap, f: MarkField, v: string, size: number, m: Metrics): DrawOp[] {
  if (v !== "true" && v !== "false") {
    throw new BirPdfError(
      `${where(f, map)}: a checkbox takes "true" or "false", not "${v}"`,
      f.key,
    );
  }
  return v === (f.when ?? "true") ? [markAt(f, size, m)] : [];
}

function choice(
  map: FormMap,
  f: ChoiceField,
  v: string,
  size: number,
  m: Metrics,
): DrawOp[] {
  const label = f.options[v];
  if (label === undefined) {
    throw new BirPdfError(
      `${where(f, map)}: "${v}" is not one of the dropdown's options`,
      f.key,
    );
  }
  const row = { page: f.page, y: f.y, cells: f.cells };
  if (label.length > boxes(row)) {
    throw new BirPdfError(
      `${where(f, map)}: "${label}" is ${label.length} characters but the paper has ${boxes(row)} boxes`,
      f.key,
    );
  }
  const start = (f.align ?? "left") === "right" ? boxes(row) - label.length : 0;
  return fill(row, label, start, size, m, where(f, map));
}

/** Room left at each end of a free-text line or cell. */
const TEXT_INSET = 1.5;

function text(
  map: FormMap,
  f: TextField,
  raw: string,
  size: number,
  m: Metrics,
): DrawOp[] {
  const who = where(f, map);
  const v = ((f.case ?? "upper") === "upper" ? raw.toUpperCase() : raw).trim();
  if (v === "") return [];
  for (const ch of v)
    if (ch !== " " && !m.has(ch))
      throw new BirPdfError(`${who}: the character "${ch}" cannot be printed`, f.key);
  const room = f.x1 - f.x0 - 2 * TEXT_INSET;
  let s = size;
  const w = m.width(v, size);
  if (w > room) {
    s = Math.floor(((size * room) / w) * 10) / 10;
    if (s < f.minSize) {
      throw new BirPdfError(
        `${who}: "${raw}" is ${v.length} characters; it needs ${((w * f.minSize) / size).toFixed(1)} pt at the minimum ${f.minSize} pt size but the line is ${room.toFixed(1)} pt`,
        f.key,
      );
    }
  }
  const tw = m.width(v, s);
  const align = f.align ?? "left";
  const x =
    align === "left"
      ? f.x0 + TEXT_INSET
      : align === "right"
        ? f.x1 - TEXT_INSET - tw
        : (f.x0 + f.x1) / 2 - tw / 2;
  return [{ page: f.page, x, y: f.y, text: v, size: s }];
}

/**
 * The proof layout: a ghost value in every placed field, every box filled.
 * 8 in digit boxes, W in letter boxes, X in every checkbox, and the item
 * number on every free-text line. Conditions (blankIf) are ignored.
 */
export function layoutGhost(map: FormMap, m: Metrics): DrawOp[] {
  const ops: DrawOp[] = [];
  const seenBox = new Set<string>();
  for (const f of map.fields) {
    if (f.kind === "none") continue;
    const size = f.size ?? map.size;
    const who = where(f, map);
    switch (f.kind) {
      case "comb":
        for (const r of f.rows)
          ops.push(...fill(r, (f.ghost ?? "W").repeat(boxes(r)), 0, size, m, who));
        break;
      case "choice": {
        const r = { page: f.page, y: f.y, cells: f.cells };
        ops.push(...fill(r, "W".repeat(boxes(r)), 0, size, m, who));
        break;
      }
      case "money": {
        const r = { page: f.page, y: f.y, cells: f.cells };
        ops.push(...fill(r, "8".repeat(boxes(r)), 0, size, m, who));
        if (f.cents) {
          const c = { page: f.page, y: f.y, cells: f.cents };
          ops.push(...fill(c, "8".repeat(boxes(c)), 0, size, m, who));
        }
        break;
      }
      case "mark": {
        // Two keys may share one checkbox (either marks it): draw it once.
        const id = `${f.page}:${f.box.join(",")}`;
        if (!seenBox.has(id)) ops.push(markAt(f, size, m));
        seenBox.add(id);
        break;
      }
      case "text":
        ops.push(...text(map, { ...f, case: "keep" }, f.item, size, m));
        break;
    }
  }
  return ops;
}
