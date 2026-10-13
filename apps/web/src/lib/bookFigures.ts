// bookFigures.ts — the pure model behind the "Portal books | Manual" switch on
// the 2551Q and 2550Q editors (W16, Track A U15).
//
// The books give figures keyed by the draft's own data keys: a plain key
// (2550Q's i31a) is one field; the 2551Q's `rows` array is one field per
// Schedule 1 row, each a taxable amount with its ATC and rate. Everything the
// editor needs to do with them — compare, fill, count, word — lives here so it
// is tested without a browser. The browser never computes tax: these are the
// books' own whole-peso figures, put into the same boxes a person types in.

import type { BookFigureLine } from "./api";

export type BookLine = BookFigureLine;
export type BookMode = "books" | "manual";

/** What a draft remembers of the books (saved inside its data as `_source`). */
export interface BookSource {
  mode: BookMode;
  /** When the books last filled this draft. */
  asOf: string;
  /** The figures the books gave then, exactly as the API sent them. */
  fed: Record<string, unknown>;
  /** The data keys the user typed over after the books filled them. */
  edited: string[];
}

export interface BookRow {
  atc: string;
  taxable: string;
  rate: string;
}

/** One box on the form that the books can fill. */
export interface BookField {
  /** "i31a" for a plain figure, "rows.0" for a Schedule 1 row. */
  id: string;
  /** The draft data key the box lives under. */
  dataKey: string;
  /** The books' amount, as the text the box holds. */
  books: string;
  /** For a Schedule 1 row: the whole row the books gave. */
  row?: BookRow;
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** A draft's `_source`, or null when it has none or it is not the contract's shape. */
export function readSource(
  data: Record<string, unknown> | undefined | null,
): BookSource | null {
  const s = data?._source;
  if (!isRecord(s)) return null;
  if (s.mode !== "books" && s.mode !== "manual") return null;
  if (typeof s.asOf !== "string") return null;
  if (!isRecord(s.fed)) return null;
  if (!Array.isArray(s.edited) || !s.edited.every((k) => typeof k === "string"))
    return null;
  return { mode: s.mode, asOf: s.asOf, fed: s.fed, edited: s.edited as string[] };
}

const text = (v: unknown): string =>
  typeof v === "number" || typeof v === "string" ? String(v) : "";

/** The books' figures as fields, in the draft's own key order. */
export function flattenFigures(
  figures: Record<string, unknown>,
  knownKeys: readonly string[],
): BookField[] {
  const out: BookField[] = [];
  for (const key of knownKeys) {
    const value = figures[key];
    if (key === "rows") {
      if (!Array.isArray(value)) continue;
      value.forEach((r, i) => {
        if (!isRecord(r)) return;
        const row: BookRow = {
          atc: text(r.atc),
          taxable: text(r.taxable),
          rate: text(r.rate),
        };
        out.push({ id: `rows.${i}`, dataKey: "rows", books: row.taxable, row });
      });
      continue;
    }
    if (typeof value === "number" || typeof value === "string") {
      out.push({ id: key, dataKey: key, books: String(value) });
    }
  }
  return out;
}

/** What the draft holds now in each of those boxes (blank when it has none). */
export function currentValues(
  data: Record<string, unknown>,
  fields: readonly BookField[],
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of fields) {
    if (f.row) {
      const rows = Array.isArray(data.rows) ? (data.rows as unknown[]) : [];
      const r = rows[Number(f.id.split(".")[1])];
      out[f.id] = isRecord(r) ? text(r.taxable) : "";
    } else {
      out[f.id] = text(data[f.dataKey]);
    }
  }
  return out;
}

/** Two amounts are the same when they are the same number; a blank is nothing. */
export function sameAmount(a: string | undefined, b: string | undefined): boolean {
  const x = Number(a === undefined || a === "" ? 0 : a);
  const y = Number(b === undefined || b === "" ? 0 : b);
  if (Number.isNaN(x) || Number.isNaN(y)) return (a ?? "") === (b ?? "");
  return x === y;
}

/** The data keys the user typed over: a box that no longer holds the books' amount. */
export function editedKeys(
  values: Record<string, string>,
  fields: readonly BookField[],
): string[] {
  const out: string[] = [];
  for (const f of fields) {
    if (!sameAmount(values[f.id], f.books) && !out.includes(f.dataKey))
      out.push(f.dataKey);
  }
  return out;
}

/** The boxes where the draft and the books disagree. */
export function differing(
  values: Record<string, string>,
  fresh: readonly BookField[],
): BookField[] {
  return fresh.filter((f) => !sameAmount(values[f.id], f.books));
}

const emptyRow = (): BookRow => ({ atc: "PT010", taxable: "", rate: "3" });

/** The draft's data with the chosen boxes set to the books' amounts. The
 *  caller's object is never changed. */
export function patchData(
  data: Record<string, unknown>,
  fields: readonly BookField[],
  ids: readonly string[],
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...data };
  for (const id of ids) {
    const f = fields.find((x) => x.id === id);
    if (!f) continue;
    if (f.row) {
      const rows: unknown[] = Array.isArray(out.rows) ? [...(out.rows as unknown[])] : [];
      const at = Number(id.split(".")[1]);
      while (rows.length < at) {
        const gap = fields.find((x) => x.id === `rows.${rows.length}`);
        rows.push(gap?.row ? { ...gap.row } : emptyRow());
      }
      rows[at] = { ...f.row };
      out.rows = rows;
    } else {
      out[f.dataKey] = f.books;
    }
  }
  return out;
}

/** How many figures the books now give differently from what the draft was filled with. */
export function staleCount(
  old: readonly BookField[],
  fresh: readonly BookField[],
): number {
  const before = new Map(old.map((f) => [f.id, f.books]));
  const after = new Map(fresh.map((f) => [f.id, f.books]));
  let n = 0;
  for (const id of new Set([...before.keys(), ...after.keys()])) {
    const a = before.get(id);
    const b = after.get(id);
    if (a === undefined || b === undefined || !sameAmount(a, b)) n += 1;
  }
  return n;
}

/** The API line that explains a figure: by its key, or for a Schedule 1 row by its ATC. */
export function lineFor(
  field: BookField,
  lines: readonly BookLine[],
): BookLine | undefined {
  if (field.row) {
    const atc = field.row.atc;
    return lines.find((l) => l.key === atc) ?? lines.find((l) => l.filter.atc === atc);
  }
  return lines.find((l) => l.key === field.dataKey);
}

// ---------------------------------------------------------------- the words

function pesos(v: string): string {
  const n = Number(v === "" ? 0 : v);
  const safe = Number.isNaN(n) ? 0 : n;
  return `₱${safe.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** The badge a fed figure carries (R3). */
export function badgeText(records: number | undefined): string {
  return records === undefined ? "From books" : `From books · ${records} records`;
}

/** The badge a figure carries once typed over: the books' own amount stays visible. */
export function editedBadgeText(books: string): string {
  return `Edited · books say ${pesos(books)}`;
}

/** One line of the fill dialog (R4): `<label>: <typed> becomes <books>`. */
export function fillItemText(label: string, typed: string, books: string): string {
  return `${label}: ${pesos(typed)} becomes ${pesos(books)}`;
}

/** The note on a draft whose books moved on (R5). */
export function staleNote(n: number): string {
  return `The books changed after this draft was filled: ${n} figures differ.`;
}

/** The one quiet line on a filed return that was filled from the books (R2). */
export function filedLine(asOf: string): string {
  const d = new Date(asOf);
  const on = Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleDateString("en-US", {
        month: "long",
        day: "numeric",
        year: "numeric",
        timeZone: "Asia/Manila",
      });
  return `Figures were filled from the Portal's books on ${on}.`;
}

/** Only a real quarter, "2026-Q3", can be asked of the books. */
export function validPeriod(period: string): boolean {
  return /^\d{4}-Q[1-4]$/.test(period);
}

/** The `_source` a draft saves (R6). */
export function buildSource(
  mode: BookMode,
  asOf: string,
  figures: Record<string, unknown>,
  fields: readonly BookField[],
  values: Record<string, string>,
): BookSource {
  return { mode, asOf, fed: figures, edited: editedKeys(values, fields) };
}
