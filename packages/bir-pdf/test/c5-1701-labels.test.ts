// C5 T2 — the 1701's figures sit under the right printed labels (D55, R5).
//
// The key-coverage tests prove every key is mapped; they cannot prove a figure sits
// under the label the BIR printed for it (C4-A1 found business sales printing under
// "Gross Compensation Income"). This test renders the 1701 fixture, whose figures
// are all distinct, and for each figure checks two things independently of the keys:
//   * the template's own text on that row (the label, read from the blank form's text
//     layer to the left of the boxes) says what the figure is;
//   * the digits printed in those boxes are that figure.
// It also checks the figures that the paper says are the same number agree.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { parseEbirExport, renderReturn } from "../src/index";
import {
  PKG,
  expectMoney,
  loadMap,
  overlayText,
  placed,
  readPkg,
  readText,
  type MapField,
  type TextItem,
} from "./helpers";

const NS = "frm1701:";

/** Lower-case, no spaces: the blank's text layer breaks words ("Compens ation"). */
const norm = (s: string) => s.toLowerCase().replace(/\s+/g, "");

interface Case {
  /** Key without the namespace. */
  key: string;
  /** The figure the fixture holds (typed, or derived by the arithmetic of its inputs). */
  value: number;
  /** Words the row's printed label must contain (spaces and case ignored). */
  label: string[];
  /** Words it must NOT contain. */
  not?: string[];
  /** The column's left edge, where one row holds several figures (Schedule 1 c and d). */
  x0?: number;
}

// The fixture's inputs (tools/make-fixtures.ts), restated here as numbers.
// A: compensation 311,111; sales 1,234,000 less returns 24,000 = 1,210,000; cost of
// sales 376,000; Schedule 4 lines 21,000 + 52,000 + 8,300 = 81,300; Schedule 5 5,500;
// NOLCO 3,700; other income 12,300. B (8%): compensation 255,111; sales 502,000; other 2,100.
const CASES: Case[] = [
  // ---- page 1, Part II
  { key: "txtPg1I22ATaxDue", value: 170108, label: ["22", "taxdue"] },
  { key: "txtPg1I23A", value: 33800, label: ["23", "totaltaxcredits"] },
  { key: "txtPg1I27A", value: 130, label: ["27", "interest"] },
  { key: "txtPg1I28A", value: 260, label: ["28", "surcharge"] },
  { key: "txtPg1I29A", value: 510, label: ["29", "compromise"] },
  { key: "txtPg1I30A", value: 900, label: ["30", "totalpenalties"] },
  // ---- page 2, Schedule 1: compensation and tax withheld (the 2316 table)
  {
    key: "txtPg2IShed1c_3ACI",
    value: 311111,
    label: ["taxpayer", "compensation"],
    not: ["spouse"],
    x0: 327.78,
  },
  {
    key: "txtPg2IShed1c_3ATW",
    value: 12600,
    label: ["taxpayer", "taxwithheld"],
    not: ["spouse"],
    x0: 461.98,
  },
  {
    key: "txtPg2IShed1c_3BCI",
    value: 255111,
    label: ["spouse", "compensation"],
    not: ["taxpayer"],
    x0: 327.78,
  },
  {
    key: "txtPg2IShed1c_3BTW",
    value: 9900,
    label: ["spouse", "taxwithheld"],
    not: ["taxpayer"],
    x0: 461.98,
  },
  // ---- page 2, Schedule 2: taxable COMPENSATION income
  { key: "txtPg2IShed2_4A", value: 311111, label: ["4", "grosscompensationincome"] },
  { key: "txtPg2IShed2_6A", value: 311111, label: ["6", "taxablecompensationincome"] },
  {
    key: "txtPg2IShed2_4B",
    value: 255111,
    label: ["4", "grosscompensationincome"],
    x0: 461.98,
  },
  {
    key: "txtPg2IShed2_7B",
    value: 767,
    label: ["7", "taxdue-compensationincome"],
    x0: 461.98,
  },
  // ---- page 2, Schedule 3.A: taxable BUSINESS income (graduated)
  {
    key: "txtPg2IShed3_8A",
    value: 1234000,
    label: ["8", "sales/revenues/receipts/fees"],
    not: ["net"],
  },
  { key: "txtPg2IShed3_9A", value: 24000, label: ["9", "salesreturns"] },
  { key: "txtPg2IShed3_10A", value: 1210000, label: ["10", "netsales"] },
  { key: "txtPg2IShed3_11A", value: 376000, label: ["11", "costofsales"] },
  {
    key: "txtPg2IShed3_12A",
    value: 834000,
    label: ["12", "grossincome/(loss)fromoperation"],
  },
  { key: "txtPg2IShed3_13A", value: 81300, label: ["13", "ordinaryallowableitemized"] },
  { key: "txtPg2IShed3_14A", value: 5500, label: ["14", "specialallowableitemized"] },
  { key: "txtPg2IShed3_15A", value: 3700, label: ["15", "nolco"] },
  { key: "txtPg2IShed3_16A", value: 90500, label: ["16", "totalallowableitemized"] },
  { key: "txtPg2IShed3_18A", value: 743500, label: ["18", "netincome/(loss)"] },
  {
    key: "txtPg2IShed3_22A",
    value: 12300,
    label: ["22", "totalothernon-operatingincome"],
  },
  { key: "txtPg2IShed3_23A", value: 755800, label: ["23", "taxableincome-business"] },
  {
    key: "txtPg2IShed3_24A",
    value: 1066911,
    label: ["24", "totaltaxableincome", "compensation&business"],
  },
  {
    key: "txtPg2IShed3_25A",
    value: 169228,
    label: ["25", "totaltaxdue-compensationandbusinessincome"],
  },
  // ---- page 3, Schedule 3.B: taxable business income at 8% (the spouse)
  {
    key: "txtPg3IShed3_26B",
    value: 502000,
    label: ["26", "sales/revenues/receipts/fees"],
    x0: 461.98,
  },
  { key: "txtPg3IShed3_28B", value: 504100, label: ["28", "totalincome"], x0: 461.98 },
  {
    key: "txtPg3IShed3_30B",
    value: 504100,
    label: ["30", "taxableincome/(loss)"],
    x0: 461.98,
  },
  {
    key: "txtPg3IShed3_31B",
    value: 40328,
    label: ["31", "taxdue-businessincome"],
    x0: 461.98,
  },
  {
    key: "txtPg3IShed3_32B",
    value: 41095,
    label: ["32", "totaltaxdue", "flatrate"],
    x0: 461.98,
  },
  // ---- page 3, Schedules 4 and 5
  { key: "txtPg3IShed4_1A", value: 21000, label: ["1", "amortizations"] },
  { key: "txtPg3IShed4_5A", value: 52000, label: ["5", "depreciation"] },
  { key: "txtPg3IShed4_17aA", value: 8300, label: ["janitorial"] },
  {
    key: "txtPg3IShed4_18A",
    value: 81300,
    label: ["18", "totalordinaryallowableitemizeddeductions"],
  },
  {
    key: "txtPg3IShed5_3",
    value: 5500,
    label: ["3", "totalspecialallowableitemizeddeductions-taxpayer"],
  },
  // ---- page 4, Part VI and Part VII
  { key: "txtPg4ISc6_1A", value: 169228, label: ["1", "regularrate", "incometaxdue"] },
  { key: "txtPg4ISc6_2A", value: 1100, label: ["2", "specialrate", "incometaxdue"] },
  { key: "txtPg4ISc6_3A", value: 220, label: ["3", "shareofothergovernmentagency"] },
  { key: "txtPg4ISc6_4A", value: 880, label: ["4", "netspecialrate"] },
  { key: "txtPg4ISc6_5A", value: 170108, label: ["5", "totalincometaxdue"] },
  { key: "txtPg4IPart7_1A", value: 1300, label: ["1", "prioryear", "excesscredits"] },
  { key: "txtPg4IPart7_2A", value: 15500, label: ["2", "taxpayments", "firstthree"] },
  { key: "txtPg4IPart7_5A", value: 12600, label: ["5", "creditabletaxwithheld", "2316"] },
  { key: "txtPg4IPart7_10A", value: 33800, label: ["10", "totaltaxcredits/payments"] },
];

describe("C5 T2 · the 1701's figures under the right labels", () => {
  let tpl: TextItem[];
  let ink: TextItem[];
  let map: ReturnType<typeof loadMap>;
  let values: Map<string, string>;

  beforeAll(async () => {
    map = loadMap("1701", "2018-01");
    const rows = parseEbirExport(
      readFileSync(join(PKG, "fixtures/1701-sample.xml"), "utf8"),
    );
    values = new Map(rows);
    const blank = readPkg(`templates/${map.template}`);
    tpl = await readText(blank);
    ink = await overlayText(await renderReturn("1701", "2018-01", rows), blank);
  });

  /** What the blank form prints to the left of a field's boxes on its row. */
  function labelOf(f: MapField): string {
    const page = f.page!;
    const left = f.cells![0]! - 1;
    const row = tpl
      .filter(
        (t) =>
          t.page === page && t.x + t.w <= left + 2 && t.y >= f.y! - 7 && t.y <= f.y! + 11,
      )
      .sort((a, b) => b.y - a.y || a.x - b.x);
    return norm(row.map((t) => t.str).join(""));
  }

  for (const c of CASES) {
    it(`${c.key} (${c.value}) sits under "${c.label.join(" … ")}"`, () => {
      const f = placed(map, NS + c.key)[0]!;
      const label = labelOf(f);
      for (const w of c.label)
        expect(label, `the row's label: "${label}"`).toContain(norm(w));
      for (const w of c.not ?? []) expect(label).not.toContain(norm(w));
      if (c.x0 !== undefined) expect(Math.abs(f.cells![0]! - c.x0)).toBeLessThan(1);
      expect(values.get(NS + c.key)).toBe(
        c.value.toLocaleString("en-US", { minimumFractionDigits: 2 }),
      );
      expectMoney(ink, f, `${c.value}.00`, c.key);
    });
  }

  const v = (k: string) => values.get(NS + k);

  it("Part VII's credits (item 10) are the credits Part II item 23 carries, for the filer and the spouse", () => {
    expect(v("txtPg4IPart7_10A")).toBe(v("txtPg1I23A"));
    expect(v("txtPg4IPart7_10B")).toBe(v("txtPg1I23B"));
  });

  it("the 2316 withholding is the same figure in Schedule 1 (3Ad) and Part VII item 5", () => {
    expect(v("txtPg2IShed1c_3ATW")).toBe(v("txtPg4IPart7_5A"));
    expect(v("txtPg2IShed1c_3BTW")).toBe(v("txtPg4IPart7_5B"));
  });

  it("the tax the schedules end in is the tax Part VI and Part II carry", () => {
    expect(v("txtPg2IShed3_25A")).toBe(v("txtPg4ISc6_1A")); // graduated
    expect(v("txtPg3IShed3_32B")).toBe(v("txtPg4ISc6_1B")); // 8%
    expect(v("txtPg4ISc6_5A")).toBe(v("txtPg1I22ATaxDue"));
    expect(v("txtPg4ISc6_5B")).toBe(v("txtPg1I22BTaxDue"));
  });

  it("Schedule 4's total is what Schedule 3.A item 13 carries; Schedule 1's total is Schedule 2 item 4", () => {
    expect(v("txtPg3IShed4_18A")).toBe(v("txtPg2IShed3_13A"));
    expect(v("txtPg2IShed1c_3ACI")).toBe(v("txtPg2IShed2_4A"));
    expect(v("txtPg2IShed1c_3BCI")).toBe(v("txtPg2IShed2_4B"));
  });

  it("a side prints only the schedule of its own rate: the filer (graduated) has no 3.B figure, the spouse (8%) no 3.A figure", () => {
    expect(v("txtPg3IShed3_32A")).toBe("0.00");
    expect(v("txtPg2IShed3_25B")).toBe("0.00");
  });

  it("the business figures no longer print under the compensation labels", () => {
    // The fixture's sales (1,234,000) and net-plus-other (1,222,300) are nowhere in Schedules 1 and 2.
    const ids = [
      "txtPg2IShed1c_3ACI",
      "txtPg2IShed2_4A",
      "txtPg2IShed2_5A",
      "txtPg2IShed2_6A",
    ];
    for (const k of ids) {
      expect([
        "1,234,000.00",
        "1,222,300.00",
        "755,800.00",
        "1,066,911.00",
      ]).not.toContain(v(k));
    }
  });

  it("the Part VII amounts it cannot place (the year's one 2307 total, items 3 and 4) print nothing there", () => {
    expect(v("txtPg4IPart7_3A")).toBe("0.00");
    expect(v("txtPg4IPart7_4A")).toBe("0.00");
  });
});
