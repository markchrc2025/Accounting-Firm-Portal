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
  /** "i31a" for a plain figure, "rows.PT010" for the Schedule 1 row of that ATC. */
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
      for (const r of value) {
        if (!isRecord(r)) continue;
        const row: BookRow = {
          atc: text(r.atc),
          taxable: text(r.taxable),
          rate: text(r.rate),
        };
        // A row is known by its ATC, never by where it sits (W16-A1 R1).
        const id = `rows.${row.atc}`;
        if (row.atc === "" || out.some((f) => f.id === id)) continue;
        out.push({ id, dataKey: "rows", books: row.taxable, row });
      }
      continue;
    }
    if (typeof value === "number" || typeof value === "string") {
      out.push({ id: key, dataKey: key, books: String(value) });
    }
  }
  return out;
}

/** The draft's Schedule 1 row with this ATC (the first, if it has two). */
function draftRow(
  data: Record<string, unknown>,
  atc: string,
): Record<string, unknown> | undefined {
  const rows = Array.isArray(data.rows) ? (data.rows as unknown[]) : [];
  return rows.find(
    (r): r is Record<string, unknown> => isRecord(r) && text(r.atc) === atc,
  );
}

/** What the draft holds now in each of those boxes. A Schedule 1 row is looked
 *  up by ATC; when the draft has no row with that ATC the field has no value. */
export function currentValues(
  data: Record<string, unknown>,
  fields: readonly BookField[],
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of fields) {
    if (f.row) {
      const r = draftRow(data, f.row.atc);
      if (r) out[f.id] = text(r.taxable);
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

/** What the user typed over: the data key of a plain box, `rows.<ATC>` for a
 *  Schedule 1 row. A box that no longer holds the books' amount. */
export function editedKeys(
  values: Record<string, string>,
  fields: readonly BookField[],
): string[] {
  const out: string[] = [];
  for (const f of fields) {
    const mark = f.row ? f.id : f.dataKey;
    if (!sameAmount(values[f.id], f.books) && !out.includes(mark)) out.push(mark);
  }
  return out;
}

/** Schedule 1 has room for six rows (the editor's cap, the API's warning). */
export const SCHEDULE_1_ROWS = 6;

/** How many more rows the draft's Schedule 1 can take. */
export function rowRoom(data: Record<string, unknown>): number {
  const n = Array.isArray(data.rows) ? data.rows.length : 0;
  return Math.max(SCHEDULE_1_ROWS - n, 0);
}

/** A books row the draft has no row for. */
export const isAdded = (values: Record<string, string>, f: BookField): boolean =>
  f.row !== undefined && values[f.id] === undefined;

/** The boxes where the draft and the books disagree. A books row the draft lacks
 *  counts as an addition, and only while Schedule 1 has `room` left for it. */
export function differing(
  values: Record<string, string>,
  fresh: readonly BookField[],
  room = Number.POSITIVE_INFINITY,
): BookField[] {
  let left = room;
  const out: BookField[] = [];
  for (const f of fresh) {
    if (sameAmount(values[f.id], f.books)) continue;
    if (isAdded(values, f)) {
      if (left <= 0) continue;
      left -= 1;
    }
    out.push(f);
  }
  return out;
}

/** The draft's data with the chosen boxes set to the books' amounts. A Schedule 1
 *  amount goes into the draft's row with the same ATC; a books row the draft
 *  lacks is added whole, if there is room. The caller's object is never changed. */
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
      const at = rows.findIndex((r) => isRecord(r) && text(r.atc) === f.row!.atc);
      if (at >= 0) {
        // The draft's own row: the books' amount goes in, the rate stays the user's.
        rows[at] = { ...(rows[at] as Record<string, unknown>), taxable: f.row.taxable };
      } else if (rows.length < SCHEDULE_1_ROWS) {
        rows.push({ ...f.row });
      }
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
    return (
      lines.find((l) => l.key === atc || l.key === `rows.${atc}`) ??
      lines.find((l) => l.filter.atc === atc)
    );
  }
  return lines.find((l) => l.key === field.dataKey);
}

// ---------------------------------------------------------------- the words

function pesos(v: string): string {
  const n = Number(v === "" ? 0 : v);
  const safe = Number.isNaN(n) ? 0 : n;
  return `₱${safe.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Every count the editors print goes through here: "1 record", "2 records",
 *  "1 figure differs", "2 figures differ" (W16-A1 R2). */
export function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** The badge a fed figure carries (R3). */
export function badgeText(records: number | undefined): string {
  return records === undefined
    ? "From books"
    : `From books · ${plural(records, "record", "records")}`;
}

/** The badge a figure carries once typed over: the books' own amount stays visible. */
export function editedBadgeText(books: string): string {
  return `Edited · books say ${pesos(books)}`;
}

/** One line of the fill dialog (R4): `<label>: <typed> becomes <books>`, or
 *  `<label>: added <books>` for a Schedule 1 row the draft does not have. */
export function fillItemText(
  label: string,
  typed: string | undefined,
  books: string,
): string {
  return typed === undefined
    ? `${label}: added ${pesos(books)}`
    : `${label}: ${pesos(typed)} becomes ${pesos(books)}`;
}

const ITEM_45_OLD = "Domestic — services (Item 45)";
/** Item 45 as the BIR's 2550Q prints it (packages/bir-pdf/templates/2550Q-2024-04.pdf). */
export const ITEM_45_LABEL = "Services Rendered by Non-Residents (Item 45)";

/** A label from the books, worded as the form prints it. U15 still calls Item 45
 *  "Domestic — services". */
export function printedLabel(label: string): string {
  return label.replace(ITEM_45_OLD, ITEM_45_LABEL);
}

/** What "Refresh from books" says when the books already match the draft (R3). */
export const NOTHING_TO_REFRESH = "The books match this draft. Nothing to refresh.";

/** The note on a draft whose books moved on (R5). */
export function staleNote(n: number): string {
  return `The books changed after this draft was filled: ${plural(n, "figure differs", "figures differ")}.`;
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
