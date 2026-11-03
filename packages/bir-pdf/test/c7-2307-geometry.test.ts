// C7 — the 2307 map against the BIR's blank itself (D56, R2: "the cell geometry measured
// from the blank, not guessed").
//
// c7-2307.test.ts proves the engine prints where the map says; that cannot catch a map that
// says the wrong thing. This test reads the template's own vector drawing (the boxes, the
// hairline digit separators, the table rules, through pdfjs's operator list) and checks the
// map against it, field by field, without using the map generator (tools/map-2307.py):
//
//   * a comb's cell boundaries ARE the edges of the stroked boxes it sits in and the
//     hairlines inside them, and its baseline is inside those boxes;
//   * a free-text line spans its stroked box, its baseline inside it;
//   * every Part III cell sits in the row between two of the table's horizontal rules and
//     the column between two of its vertical rules;
//   * the signature lines sit in the white signature box above their caption.
import { describe, expect, it } from "vitest";
import { PKG, loadMap, readPkg, type MapField } from "./helpers";

interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

async function vectors(): Promise<{ strokes: Rect[]; fills: Rect[] }> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = pdfjs.getDocument({
    data: readPkg("templates/2307-2018-01.pdf").slice(),
    verbosity: 0,
  });
  const doc = await task.promise;
  const page = await doc.getPage(1);
  const list = await page.getOperatorList();
  const strokes: Rect[] = [];
  const fills: Rect[] = [];
  list.fnArray.forEach((fn, i) => {
    if (fn !== pdfjs.OPS.constructPath) return;
    const [op, , mm] = list.argsArray[i] as [number, unknown, Record<string, number>];
    const r = { x0: mm[0]!, y0: mm[1]!, x1: mm[2]!, y1: mm[3]! };
    if (op === pdfjs.OPS.stroke) strokes.push(r);
    else if (op === pdfjs.OPS.eoFill) fills.push(r);
  });
  await task.destroy();
  return { strokes, fills };
}

const map = loadMap("2307", "2018-01");
const TOL = 0.06;
const near = (a: number, b: number, t = TOL) => Math.abs(a - b) <= t;

const mid = (r: Rect) => (r.x0 + r.x1) / 2;
const w = (r: Rect) => r.x1 - r.x0;
const h = (r: Rect) => r.y1 - r.y0;

describe("C7 · the 2307 map follows the blank's own drawing", async () => {
  const { strokes, fills } = await vectors();
  const boxes = strokes.filter((r) => w(r) > 5 && h(r) > 5);
  const ticks = strokes.filter((r) => w(r) < 0.6 && h(r) > 1);
  const hRules = fills
    .filter((r) => h(r) < 2.5 && w(r) > 570)
    .map((r) => (r.y0 + r.y1) / 2)
    .sort((a, b) => b - a);
  const vRules = fills
    .filter((r) => w(r) < 2.5 && h(r) > 250)
    .map((r) => (r.x0 + r.x1) / 2)
    .sort((a, b) => a - b);

  it("the blank has the drawing this test expects", () => {
    expect(boxes).toHaveLength(35);
    expect(ticks).toHaveLength(62);
  });

  /** The cell boundaries the blank draws inside the stroked boxes that hold this row. */
  function drawnCells(y: number, x0: number, x1: number): number[] {
    const inRow = boxes.filter(
      (b) => b.y0 <= y && y <= b.y1 && b.x0 >= x0 - 0.5 && b.x1 <= x1 + 0.5,
    );
    inRow.sort((a, b) => a.x0 - b.x0);
    const out: number[] = [];
    for (const b of inRow) {
      const inner = ticks
        .filter(
          (t) => t.y0 < b.y1 && t.y1 > b.y0 && mid(t) > b.x0 + 0.3 && mid(t) < b.x1 - 0.3,
        )
        .map(mid)
        .sort((p, q) => p - q);
      const edge = [b.x0, ...inner, b.x1];
      if (out.length && near(out[out.length - 1]!, edge[0]!, 0.1)) {
        out[out.length - 1] = (out[out.length - 1]! + edge[0]!) / 2;
        edge.shift();
      }
      out.push(...edge);
    }
    return out;
  }

  const combs = map.fields.filter((f) => f.rows) as (MapField & {
    rows: { page: number; y: number; cells: number[] }[];
  })[];
  const texts = map.fields.filter((f) => f.kind === "text") as (MapField & {
    x0: number;
    x1: number;
    y: number;
    amount?: string;
  })[];

  it("every comb's boundaries are the blank's own box edges and digit hairlines", () => {
    expect(combs).toHaveLength(16); // 2 dates, 2 x (3 TIN groups + branch), 2 ZIPs, 4 agent dates
    for (const f of combs) {
      const row = f.rows[0]!;
      const drawn = drawnCells(row.y, row.cells[0]! - 0.5, row.cells.at(-1)! + 0.5);
      expect(drawn.length, `${f.key}: boxes drawn at its baseline`).toBe(
        row.cells.length,
      );
      row.cells.forEach((c, i) => {
        expect([f.key, i, near(c, drawn[i]!)]).toEqual([f.key, i, true]);
      });
    }
  });

  it("every comb's baseline is centred in its boxes", () => {
    for (const f of combs) {
      const row = f.rows[0]!;
      const b = boxes.find(
        (r) =>
          r.x0 <= row.cells[0]! + 0.1 &&
          r.x1 >= row.cells[1]! - 0.1 &&
          r.y0 <= row.y &&
          row.y <= r.y1,
      )!;
      expect(b, f.key).toBeDefined();
      expect([f.key, row.y - b.y0 >= 3.8 && row.y - b.y0 <= 5.0]).toEqual([f.key, true]);
    }
  });

  it("each free-text line spans its stroked box and sits inside it", () => {
    const lines = texts.filter(
      (f) =>
        !/^c2307:[ab]\d*(Desc|Atc|M1|M2|M3|Total|Tax|Total\w+)$/.test(f.key) &&
        !/Sig(Name|TitleTin)$/.test(f.key),
    );
    expect(lines.map((f) => f.key).sort()).toEqual(
      [
        "c2307:payeeName",
        "c2307:payeeAddress",
        "c2307:payeeForeignAddress",
        "c2307:payorName",
        "c2307:payorAddress",
        "c2307:payorAgentNo",
        "c2307:payeeAgentNo",
      ].sort(),
    );
    for (const f of lines) {
      const b = boxes.find(
        (r) => r.y0 <= f.y && f.y <= r.y1 && r.x0 <= f.x0 + 1 && r.x1 >= f.x1 - 1,
      )!;
      expect(b, `${f.key}: its box`).toBeDefined();
      expect([f.key, f.x0 - b.x0 >= 0 && f.x0 - b.x0 <= 1.2]).toEqual([f.key, true]);
      expect([f.key, b.x1 - f.x1 >= 0 && b.x1 - f.x1 <= 1.2]).toEqual([f.key, true]);
      expect([f.key, f.y - b.y0 >= 3.8 && f.y - b.y0 <= 5.0]).toEqual([f.key, true]);
    }
  });

  it("the table: ten rows and a Total row in each block, between the blank's own rules", () => {
    // Rules from the bottom of the column headings down to the bottom of block B's Total row.
    const top = 936 - 365.33;
    const rules = hRules.filter((y) => y <= top + 0.1 && y >= 936 - 685.3 - 0.1);
    // 10 data rows + Total (11 spans), the B title row, 10 + Total again: 24 rules.
    expect(rules).toHaveLength(24);
    const span = (n: number): [number, number] => [rules[n + 1]!, rules[n]!]; // [low, high]
    const rowOf = (key: string): [number, number] => {
      const m = /^c2307:([ab])(\d+|Total)/.exec(key)!;
      const base = m[1] === "a" ? 0 : 12;
      return span(base + (m[2] === "Total" ? 10 : Number(m[2]) - 1));
    };
    // columns between the blank's vertical rules (page border, five inner rules, page border)
    const inner = vRules.filter((x) => x > 170 && x < 520);
    expect(inner).toHaveLength(6);
    const cols = [19.4, ...inner, 596.0];
    const colOf: Record<string, number> = {
      Desc: 0,
      Atc: 1,
      M1: 2,
      M2: 3,
      M3: 4,
      Total: 5,
      Tax: 6,
    };

    const cells = texts.filter((f) =>
      /^c2307:[ab]\d*(Desc|Atc|M1|M2|M3|Total|Tax|TotalM1|TotalM2|TotalM3|TotalIncome|TotalTax)$/.test(
        f.key,
      ),
    );
    expect(cells).toHaveLength(2 * 11 * 7 - 2 * 2); // 2 x (10 rows x 7 columns + a Total row x 5)
    for (const f of cells) {
      const [low, high] = rowOf(f.key);
      expect([f.key, f.y - low >= 3.5 && f.y - low <= 4.5]).toEqual([f.key, true]);
      expect([f.key, high - low > 13 && high - low < 14]).toEqual([f.key, true]);
      const k =
        /(Desc|Atc|M1|M2|M3|TotalM1|TotalM2|TotalM3|TotalIncome|TotalTax|Total|Tax)$/.exec(
          f.key,
        )![1]!;
      const col =
        colOf[k] ??
        { TotalM1: 2, TotalM2: 3, TotalM3: 4, TotalIncome: 5, TotalTax: 6 }[k]!;
      expect([f.key, f.x0 - cols[col]! >= 0.3 && f.x0 - cols[col]! <= 2.5]).toEqual([
        f.key,
        true,
      ]);
      expect([
        f.key,
        cols[col + 1]! - f.x1 >= 0.3 && cols[col + 1]! - f.x1 <= 2.5,
      ]).toEqual([f.key, true]);
    }
  });

  it("the printed name and the title/TIN line sit in the white signature box above their caption", () => {
    // the box is bounded by the rule under "We declare…" / "CONFORME" and the caption's rule.
    const boxFor = (key: string): [number, number] =>
      key.startsWith("c2307:payor")
        ? [936 - 750.48, 936 - 722.02]
        : [936 - 827.76, 936 - 799.38];
    const lines = texts.filter((f) => /Sig(Name|TitleTin)$/.test(f.key));
    expect(lines).toHaveLength(4);
    for (const f of lines) {
      const [low, high] = boxFor(f.key);
      expect(
        hRules.some((y) => near(y, low, 0.6)),
        `${f.key}: the rule under the box`,
      ).toBe(true);
      expect(
        hRules.some((y) => near(y, high, 0.6)),
        `${f.key}: the rule over the box`,
      ).toBe(true);
      expect([f.key, f.y > low + 2 && f.y < high - 12]).toEqual([f.key, true]);
      expect([f.key, f.x0 > 19 && f.x1 < 596]).toEqual([f.key, true]);
    }
    // the title/TIN line is under the printed name
    for (const p of ["payor", "payee"]) {
      const name = lines.find((f) => f.key === `c2307:${p}SigName`)!;
      const tin = lines.find((f) => f.key === `c2307:${p}SigTitleTin`)!;
      expect(tin.y).toBeLessThan(name.y);
    }
  });

  it("nothing is mapped on the BIR pre-printed areas (barcode, For BIR box, form code)", () => {
    // Everything the map prints is below the "Fill in all applicable spaces" line (y 936-103).
    const lowest = Math.max(...map.fields.map((f) => (f.rows ? f.rows[0]!.y : f.y!)));
    expect(lowest).toBeLessThan(936 - 103);
    expect(PKG.length).toBeGreaterThan(0);
  });
});
