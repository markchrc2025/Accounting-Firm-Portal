// C9 — the three maps against the blanks' own drawing (D57: "geometry measured from the
// blank, not guessed").
//
// c9-withholding.test.ts proves the engine prints where a map says; that cannot catch a map
// that says the wrong thing. This test reads each template's own vector drawing (the hairline
// tick of every digit box and the table's borders, through pdfjs's operator list) and checks
// the map against it, field by field, without using the map generator (tools/map-withholding.py):
//
//   * every comb and every money row: each cell boundary has a vertical tick or border of the
//     blank at its x, crossing the row's baseline;
//   * the cells of a table row the blank draws (the 1601-EQ's Tax Rate cell, the tax agent
//     and date cells): their edges are borders of the blank;
//   * every tick square: it is drawn on the blank as a square of that size at that place.
import { describe, expect, it } from "vitest";
import { loadMap, readPkg, type MapField } from "./helpers";

interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

type Page = { ticks: Rect[]; squares: Rect[] };

async function drawing(file: string): Promise<Page[]> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = pdfjs.getDocument({
    data: readPkg(`templates/${file}`).slice(),
    verbosity: 0,
  });
  const doc = await task.promise;
  const pages: Page[] = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const list = await page.getOperatorList();
    const ticks: Rect[] = [];
    const squares: Rect[] = [];
    list.fnArray.forEach((fn, i) => {
      if (fn !== pdfjs.OPS.constructPath) return;
      const [op, , mm] = list.argsArray[i] as [number, unknown, Record<string, number>];
      const r = { x0: mm[0]!, y0: mm[1]!, x1: mm[2]!, y1: mm[3]! };
      const w = r.x1 - r.x0;
      const h = r.y1 - r.y0;
      if (op === pdfjs.OPS.fill || op === pdfjs.OPS.eoFill) {
        if (w < 2.6 && h >= 1.8) ticks.push(r); // a hairline: a tick or a border
      } else if (op === pdfjs.OPS.stroke) {
        if (w > 9 && w < 16 && h > 8 && h < 16) squares.push(r); // a tick square
      }
    });
    pages.push({ ticks, squares });
  }
  await task.destroy();
  return pages;
}

const TOL = 0.5;
const mid = (r: Rect) => (r.x0 + r.x1) / 2;

const FORMS = [
  { form: "0619E", version: "2018-01", file: "0619E-2018-01.pdf" },
  { form: "1601EQ", version: "2019-01", file: "1601EQ-2019-01.pdf" },
  { form: "1601C", version: "2018-01", file: "1601C-2018-01.pdf" },
] as const;

for (const { form, version, file } of FORMS) {
  describe(`C9 · the ${form} map follows the blank's own drawing`, async () => {
    const map = loadMap(form, version);
    const pages = await drawing(file);

    /** A hairline of the blank at x that crosses the row's baseline. */
    const ruleAt = (page: number, x: number, y: number) =>
      pages[page - 1]!.ticks.some(
        (t) => Math.abs(mid(t) - x) <= TOL && t.y0 - 1 <= y && y <= t.y1 + 1,
      );

    it("the blank has the drawing this test expects (hairlines and tick squares)", () => {
      expect(pages.length).toBe(map.pages.length);
      expect(pages[0]!.ticks.length).toBeGreaterThan(200);
      expect(pages[0]!.squares.length).toBeGreaterThanOrEqual(form === "0619E" ? 6 : 8);
    });

    it("every comb and money row: each cell boundary is a tick or border of the blank, on the row", () => {
      const rows: { key: string; page: number; y: number; xs: number[] }[] = [];
      for (const f of map.fields as (MapField & { cents?: number[] })[]) {
        if (f.rows)
          for (const r of f.rows)
            rows.push({ key: f.key, page: r.page, y: r.y, xs: r.cells });
        if (f.kind === "money") {
          rows.push({ key: f.key, page: f.page!, y: f.y!, xs: f.cells! });
          rows.push({ key: `${f.key} (centavos)`, page: f.page!, y: f.y!, xs: f.cents! });
        }
      }
      expect(rows.length).toBeGreaterThan(40);
      for (const r of rows)
        r.xs.forEach((x, i) => {
          expect([r.key, i, x, ruleAt(r.page, x, r.y)]).toEqual([r.key, i, x, true]);
        });
    });

    it("every tick square is a square the blank draws, and the mark sits inside it", () => {
      for (const f of map.fields.filter((m) => m.kind === "mark")) {
        const [x0, y0, x1, y1] = f.box!;
        const hit = pages[f.page! - 1]!.squares.some(
          (s) =>
            Math.abs(s.x0 - x0) <= 0.6 &&
            Math.abs(s.x1 - x1) <= 0.6 &&
            Math.abs(s.y0 - y0) <= 0.6 &&
            Math.abs(s.y1 - y1) <= 0.6,
        );
        expect([f.key, hit]).toEqual([f.key, true]);
      }
    });

    it("every comb row sits in boxes the blank draws: one baseline, centred in its row", () => {
      // Every comb's baseline is 2 pt above the bottom of its boxes (geometry.py's lift): the
      // tick under it starts at or below the baseline and rises above it.
      for (const f of map.fields.filter((m) => m.rows)) {
        for (const r of f.rows!) {
          const ticks = pages[r.page - 1]!.ticks.filter(
            (t) =>
              Math.abs(mid(t) - r.cells[1]!) <= TOL && t.y0 - 1 <= r.y && r.y <= t.y1 + 1,
          );
          expect([f.key, ticks.length > 0]).toEqual([f.key, true]);
          const base = Math.min(...ticks.map((t) => t.y0));
          expect([f.key, r.y - base >= 0.5 && r.y - base <= 6]).toEqual([f.key, true]);
        }
      }
    });
  });
}

describe("C9 · the free-text cells sit between borders the blank draws", async () => {
  const eq = await drawing("1601EQ-2019-01.pdf");
  const all = {
    "0619E": await drawing("0619E-2018-01.pdf"),
    "1601EQ": eq,
    "1601C": await drawing("1601C-2018-01.pdf"),
  };
  it("the tax agent, date of issue and date of expiry cells (all three), the Tax Rate cell (1601-EQ)", () => {
    for (const { form, version } of FORMS) {
      const map = loadMap(form, version);
      const fields = map.fields.filter(
        (f) =>
          f.kind === "text" &&
          /^f\w+:(agentNo|agentIssue|agentExpiry|r\dRate)$/.test(f.key),
      );
      expect(fields.length).toBe(form === "1601EQ" ? 9 : 3);
      for (const f of fields) {
        const page = all[form][f.page! - 1]!;
        const has = (x: number) =>
          page.ticks.some(
            (t) => Math.abs(mid(t) - x) <= 1.6 && t.y0 - 1 <= f.y! && f.y! <= t.y1 + 12,
          );
        expect([f.key, "left edge", has(f.x0! - 1.0)]).toEqual([
          f.key,
          "left edge",
          true,
        ]);
        expect([f.key, "right edge", has(f.x1! + 1.0)]).toEqual([
          f.key,
          "right edge",
          true,
        ]);
      }
    }
  });
});
