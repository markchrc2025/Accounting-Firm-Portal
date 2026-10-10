// T1 — render the Portal's own 2551Q export onto the blank form and read the
// PDF's text layer back: every value must sit at its map's coordinates.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { parseEbirExport, renderReturn } from "../src/index";
import {
  PKG,
  expectComb,
  expectMark,
  expectMoney,
  loadMap,
  overlayText,
  placed,
  readPkg,
  type FormMap,
  type TextItem,
} from "./helpers";

const NS = "frm2551Qv2018:";

describe("T1 · 2551Q sample export prints into the right boxes", () => {
  let map: FormMap;
  let items: TextItem[];
  let rows: Map<string, string>;

  beforeAll(async () => {
    map = loadMap("2551Q", "2018-01");
    const text = readFileSync(join(PKG, "fixtures/2551Q-sample.xml"), "utf8");
    const parsed = parseEbirExport(text);
    rows = new Map(parsed);
    const pdf = await renderReturn("2551Q", "2018-01", parsed);
    items = await overlayText(pdf, readPkg(`templates/${map.template}`));
  });

  const comb = (key: string, text: string, align: "left" | "right" = "left") => {
    for (const f of placed(map, key)) {
      const r = f.rows?.[0] ?? { page: f.page!, y: f.y!, cells: f.cells! };
      expectComb(items, r.page, r.y, r.cells, text, align, key);
    }
  };

  it("TIN in its nine boxes, the branch code and the RDO", () => {
    comb(NS + "txtTIN1", "123");
    comb(NS + "txtTIN2", "456");
    comb(NS + "txtTIN3", "789");
    comb(NS + "txtBranchCode", "00000"); // five boxes on the paper; "000" padded with zeros
    comb(NS + "txtRDOCode", "000");
    comb(NS + "txtPg2TIN1", "123");
    comb(NS + "txtPg2TIN2", "456");
    comb(NS + "txtPg2TIN3", "789");
  });

  it("the name, the year and the quarter mark", () => {
    comb(NS + "registeredName", "TEST TAXPAYER");
    comb(NS + "txtPg2TaxpayerName", "TEST TAXPAYER");
    comb(NS + "txtYear", "2026");
    comb(NS + "rtnMonth", "12");
    for (const q of [1, 2, 3, 4]) {
      const f = placed(map, `${NS}qtr_${q}`)[0]!;
      expectMark(items, f.page!, f.box!, q === 3, `qtr_${q}`);
    }
  });

  it("items 14 to 24, aligned right with centavos after the printed point", () => {
    const want: Record<number, string> = {
      14: "6,100.00",
      15: "1,000.00",
      16: "0.00",
      17: "0.00",
      18: "1,000.00",
      19: "5,100.00",
      20: "0.00",
      21: "0.00",
      22: "0.00",
      23: "0.00",
      24: "5,100.00",
    };
    for (let i = 14; i <= 24; i++) {
      expect(rows.get(`${NS}txt${i}`), `fixture item ${i}`).toBe(want[i]);
      expectMoney(items, placed(map, `${NS}txt${i}`)[0]!, want[i]!, `item ${i}`);
    }
  });

  it("Schedule 1 rows 1 and 2: ATC, taxable amount, rate and tax due", () => {
    const sched = [
      { atc: "PT010", amt: "150,000.00", rate: "3", due: "4,500.00" },
      { atc: "PT120", amt: "80,000.50", rate: "2", due: "1,600.00" },
    ];
    sched.forEach((s, i) => {
      const n = i + 1;
      const atc = placed(map, `drpATC${n}`)[0]!;
      expect(atc.kind).toBe("choice");
      expectComb(items, atc.page!, atc.y!, atc.cells!, s.atc, "left", `ATC row ${n}`);
      expectMoney(items, placed(map, `txtATCAmt${n}`)[0]!, s.amt, `taxable row ${n}`);
      expectMoney(items, placed(map, `txtATCRate${n}`)[0]!, s.rate, `rate row ${n}`);
      expectMoney(items, placed(map, `txtATCDue${n}`)[0]!, s.due, `due row ${n}`);
    });
    // Unused rows 3-6 print nothing at all.
    for (const n of [3, 4, 5, 6]) {
      for (const k of [
        `drpATC${n}`,
        `txtATCAmt${n}`,
        `txtATCRate${n}`,
        `txtATCDue${n}`,
      ]) {
        const f = placed(map, k)[0]!;
        const empty = items.filter(
          (t) => t.page === f.page && Math.abs(t.y - f.y!) < 1.5,
        );
        expect(empty, `${k} blank`).toHaveLength(0);
      }
    }
    expectMoney(
      items,
      placed(map, "txtTotalSched1")[0]!,
      "6,100.00",
      "Schedule 1 item 7",
    );
  });
});
