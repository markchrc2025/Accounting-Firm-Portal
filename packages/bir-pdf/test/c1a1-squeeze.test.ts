// C1-A1 — a name too long for its boxes prints whole, squeezed across the row
// (domain owner: "it's okay if it isn't per character box, as long as the name
// is complete"). Read back from the PDF's text layer.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { BirPdfError, parseEbirExport, renderReturn } from "../src/index";
import {
  PKG,
  expectComb,
  loadMap,
  overlayText,
  placed,
  readPkg,
  type FormMap,
  type MapRow,
  type TextItem,
} from "./helpers";

const NS = "frm2551Qv2018:";
// Invented values only.
const NAME40 = "INVENTED SAMPLE TRADING AND SERVICES INC";
const NAME20 = "INVENTED SAMPLE CORP";
const ADDRESS90 =
  "UNIT 12 SAMPLE TOWER ONE, 5 INVENTED AVENUE CORNER EXAMPLE STREET, SAMPLE CITY, METRO 0000";

const sample = () =>
  parseEbirExport(readFileSync(join(PKG, "fixtures/2551Q-sample.xml"), "utf8"));
const withValues = (rows: [string, string][], vals: Record<string, string>) =>
  rows.map(([k, v]): [string, string] => [k, k in vals ? vals[k]! : v]);

/** Cap height of Liberation Sans Bold is 1409/2048 em; round up for the bound. */
const CAP = 0.7;

/** Items on a comb row: its baseline band, centred between its outer edges. */
function onRow(items: TextItem[], r: MapRow): TextItem[] {
  const left = r.cells[0]!;
  const right = r.cells[r.cells.length - 1]!;
  return items.filter(
    (t) =>
      t.page === r.page &&
      t.y > r.y - 2.5 &&
      t.y < r.y + 2 &&
      t.x + t.w / 2 > left &&
      t.x + t.w / 2 < right,
  );
}

/** Assert a squeezed line: inside the comb's x-range and between its bottom and top. */
function expectInside(t: TextItem, r: MapRow, size: number, label: string): void {
  const left = r.cells[0]!;
  const right = r.cells[r.cells.length - 1]!;
  expect(t.x, `${label}: starts inside the comb`).toBeGreaterThanOrEqual(left);
  expect(t.x + t.w, `${label}: ends inside the comb`).toBeLessThanOrEqual(right);
  expect(t.y, `${label}: above the box bottom`).toBeGreaterThanOrEqual(r.y - 2);
  expect(t.y + CAP * size, `${label}: below the box top`).toBeLessThanOrEqual(
    r.y + CAP * 10 + 0.5,
  );
}

describe("C1-A1 T1 · a value too long for its boxes prints whole", () => {
  let map: FormMap;
  let long: TextItem[];
  let short: TextItem[];
  beforeAll(async () => {
    expect(NAME40).toHaveLength(40);
    expect(NAME20).toHaveLength(20);
    expect(ADDRESS90).toHaveLength(90);
    map = loadMap("2551Q", "2018-01");
    const tpl = readPkg(`templates/${map.template}`);
    // The page-2 TIN shares the name's baseline and pdfjs would merge its last
    // digit into the name's text item; blank it so the name reads back alone.
    const longRows = withValues(sample(), {
      [NS + "txtPg2TIN1"]: "",
      [NS + "txtPg2TIN2"]: "",
      [NS + "txtPg2TIN3"]: "",
      [NS + "txtPg2BranchCode"]: "",
      [NS + "registeredName"]: NAME40,
      [NS + "txtPg2TaxpayerName"]: NAME40,
      [NS + "registeredAddress"]: ADDRESS90,
    });
    long = await overlayText(await renderReturn("2551Q", "2018-01", longRows), tpl);
    const shortRows = withValues(sample(), {
      [NS + "registeredName"]: NAME20,
      [NS + "txtPg2TaxpayerName"]: NAME20,
    });
    short = await overlayText(await renderReturn("2551Q", "2018-01", shortRows), tpl);
  });

  it("the 40-letter name prints whole on page 2's 26 boxes, inside the comb", () => {
    const r = placed(map, NS + "txtPg2TaxpayerName")[0]!.rows![0]!;
    const got = onRow(long, r);
    expect(got.map((t) => t.str)).toEqual([NAME40]);
    const size = got[0]!.size;
    expect(size).toBeGreaterThanOrEqual(5.5);
    expectInside(got[0]!, r, size, "page 2 name");
  });

  it("the 40-letter name still fills page 1's 40 boxes one character per box", () => {
    const r = placed(map, NS + "registeredName")[0]!.rows![0]!;
    expectComb(long, r.page, r.y, r.cells, NAME40, "left", "page 1 name");
  });

  it("the 90-letter address prints whole across its two rows, inside the comb", () => {
    const rows = placed(map, NS + "registeredAddress")[0]!.rows!;
    const lines = rows.map((r) => onRow(long, r));
    for (const l of lines)
      expect(l.length, "one squeezed line per row").toBeLessThanOrEqual(1);
    expect(
      lines
        .flat()
        .map((t) => t.str)
        .join(" "),
    ).toBe(ADDRESS90);
    lines.forEach((l, i) => {
      if (l[0]) expectInside(l[0], rows[i]!, l[0].size, `address row ${i + 1}`);
    });
  });

  it("a 20-letter name still prints one character per box on both pages", () => {
    for (const key of [NS + "registeredName", NS + "txtPg2TaxpayerName"]) {
      const r = placed(map, key)[0]!.rows![0]!;
      expectComb(short, r.page, r.y, r.cells, NAME20, "left", key);
    }
  });
});

describe("C1-A1 T2 · what still refuses", () => {
  const rejects = async (vals: Record<string, string>, ...parts: (string | RegExp)[]) => {
    const err = await renderReturn("2551Q", "2018-01", withValues(sample(), vals)).then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(BirPdfError);
    for (const p of parts) expect((err as Error).message).toMatch(p);
  };

  it("a name too long even at 5.5 pt is an error naming the field", async () => {
    await rejects(
      { [NS + "txtPg2TaxpayerName"]: "W".repeat(120) },
      `${NS}txtPg2TaxpayerName`,
      "5.5 pt",
    );
  });

  it("a 12-digit TIN group is still an error: digits never squeeze", async () => {
    await rejects(
      { [NS + "txtTIN1"]: "123456789012" },
      `${NS}txtTIN1`,
      "12 characters",
      "3 boxes",
    );
  });
});
