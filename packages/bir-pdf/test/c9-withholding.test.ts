// C9 — the 0619-E, 1601-EQ and 1601-C on the BIR's own blanks (D57).
//
//   * each map names exactly the keys the Portal's rows builder can emit (plus the three
//     1601-EQ over-remittance ticks, mapped but never written while a negative figure is
//     refused), every key of every fixture is mapped, and the blanks are the owner's bytes;
//   * every item of every fixture prints inside its own box: comb characters in their cells,
//     amounts in the blank's peso and centavo boxes, ticks in their squares, text between
//     its cell's edges;
//   * amounts are exact: totals are the sums to the centavo, never floating point, and a
//     third decimal is refused, never rounded;
//   * a preview is stamped on every page and the clear copy carries nothing of the kind;
//   * the ATC and tax type code the blanks pre-print are never written.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildWithholdingPrintRows } from "../../../apps/api/src/bir-forms/engine/withholding-print";
import { BirPdfError, renderReturn } from "../src/index";
import { WH_CORPORATION, WH_INDIVIDUAL, WH_SAMPLES } from "../tools/withholding-data";
import { PKG, loadMap, overlayText, readPkg, readText, type MapField } from "./helpers";

type Rows = [string, string][];

const FORMS = [
  { form: "0619E", version: "2018-01", fields: 49, pages: 1, size: [612, 792] },
  { form: "1601EQ", version: "2019-01", fields: 87, pages: 2, size: [612, 936] },
  { form: "1601C", version: "2018-01", fields: 93, pages: 2, size: [612, 936] },
] as const;

const fixture = (name: string): Rows =>
  JSON.parse(readFileSync(join(PKG, `fixtures/${name}.json`), "utf8")) as Rows;

/** Every fixture, with the form it prints on. */
const FIXTURES = Object.entries(WH_SAMPLES).map(([name, s]) => ({
  name,
  form: s.form,
  version: FORMS.find((f) => f.form === s.form)!.version,
  rows: fixture(name),
}));

describe("C9 · the maps", () => {
  for (const { form, version, fields, pages, size } of FORMS) {
    const map = loadMap(form, version);

    it(`${form}: ${fields} fields on ${pages} page(s) of ${size.join(" x ")} pt, every field on a page of the blank`, () => {
      expect(map.fields).toHaveLength(fields);
      expect(map.pages).toHaveLength(pages);
      for (const p of map.pages) expect([p.width, p.height]).toEqual([...size]);
      // all pages of the blank print: page 2 of the 1601-EQ and 1601-C is part of the return
      expect((map as unknown as { printPages?: number[] }).printPages).toBeUndefined();
      for (const f of map.fields) {
        const on = f.rows ? f.rows.map((r) => r.page) : [f.page!];
        for (const p of on) expect([f.key, p >= 1 && p <= pages]).toEqual([f.key, true]);
      }
    });

    it(`${form}: no key is mapped twice, and the pre-printed ATC and tax type code are not mapped`, () => {
      const keys = map.fields.map((f) => f.key);
      expect(new Set(keys).size).toBe(keys.length);
      expect(
        keys.filter((k) => /atc$|taxType|typeCode/i.test(k) && !/\dAtc$/.test(k)),
      ).toEqual([]);
    });

    it(`${form}: the map names the keys the rows builder emits, and nothing else but the over-remittance ticks`, () => {
      const emitted = new Set<string>();
      for (const s of Object.values(WH_SAMPLES).filter((x) => x.form === form))
        for (const [k] of buildWithholdingPrintRows(form, s.data, s.taxpayer, s.period))
          emitted.add(k);
      // both signature sides, the one-sided marks and the unused rows: union over a few drafts
      for (const tp of [WH_CORPORATION, WH_INDIVIDUAL])
        for (const amended of ["yes", "no"])
          for (const any of ["yes", "no"])
            for (const cat of ["private", "government"])
              for (const [k] of buildWithholdingPrintRows(
                form,
                {
                  ...WH_SAMPLES[
                    `${form}-${form === "1601EQ" ? "six-rows" : form === "1601C" ? "schedule" : "penalties"}`
                  ]!.data,
                  amended,
                  anyWithheld: any,
                  category: cat,
                  reliefYesNo: any,
                  quarter: amended === "yes" ? "1st" : "4th",
                },
                tp,
                form === "1601EQ" ? "2026-Q1" : "2026-03",
              ))
                emitted.add(k);
      // every quarter's tick
      if (form === "1601EQ")
        for (const q of [1, 2, 3, 4])
          for (const [k] of buildWithholdingPrintRows(
            form,
            WH_SAMPLES["1601EQ-sample"]!.data,
            WH_INDIVIDUAL,
            `2026-Q${q}`,
          ))
            emitted.add(k);
      const mapped = map.fields.map((f) => f.key);
      const ticks = form === "1601EQ" ? ["overCarried", "overRefunded", "overTcc"] : [];
      const unmapped = [...emitted].filter((k) => !mapped.includes(k));
      expect(unmapped).toEqual([]);
      expect(
        mapped
          .filter((k) => !emitted.has(k))
          .map((k) => k.split(":")[1])
          .sort(),
      ).toEqual(ticks);
    });
  }

  it("every key of every fixture is mapped", () => {
    for (const fx of FIXTURES) {
      const mapped = new Set(loadMap(fx.form, fx.version).fields.map((f) => f.key));
      expect([fx.name, fx.rows.map(([k]) => k).filter((k) => !mapped.has(k))]).toEqual([
        fx.name,
        [],
      ]);
    }
  });
});

// ---- each item inside its own box ------------------------------------------------------------

/** What an amount prints as pesos and centavos, written out here independently of the engine. */
function pesosAndCents(raw: string): [string, string] {
  const [p = "0", c = ""] = raw.replace(/,/g, "").split(".");
  return [String(BigInt(p)), c.padEnd(2, "0").slice(0, 2)];
}

type Cells = { page: number; y: number; cells: number[] };
const rowsOf = (f: MapField): Cells[] => f.rows as unknown as Cells[];

describe("C9 · every fixture prints each item in its own box", () => {
  for (const fx of FIXTURES) {
    it(`${fx.name}`, async () => {
      const map = loadMap(fx.form, fx.version);
      const out = await renderReturn(fx.form, fx.version, fx.rows, { root: PKG });
      const ink = await overlayText(
        out,
        readPkg(`templates/${fx.form}-${fx.version}.pdf`),
      );
      const onLine = (page: number, y: number) =>
        ink.filter((t) => t.page === page && Math.abs(t.y - y) < 0.6);
      let checked = 0;
      for (const [key, value] of fx.rows) {
        const f = map.fields.find((m) => m.key === key) as MapField & {
          drop?: string;
          date?: boolean;
          case?: string;
          squeeze?: boolean;
          cents?: number[];
        };
        expect([key, !!f]).toEqual([key, true]);
        if (f.kind === "mark") {
          const [x0, y0, x1, y1] = f.box!;
          const hit = ink.filter(
            (t) =>
              t.page === f.page &&
              t.str === "X" &&
              t.x >= x0 &&
              t.x + t.w <= x1 &&
              t.y >= y0 &&
              t.y <= y1,
          );
          expect([key, hit.length]).toEqual([key, 1]);
        } else if (f.kind === "money") {
          const [pesos, cents] = pesosAndCents(value);
          const cells = f.cells!;
          const n = cells.length - 1;
          expect([key, pesos.length <= n]).toEqual([key, true]);
          const at = (cs: number[], i: number, ch: string) =>
            onLine(f.page!, f.y!).filter(
              (t) => t.str === ch && t.x + t.w / 2 > cs[i]! && t.x + t.w / 2 < cs[i + 1]!,
            ).length;
          [...pesos].forEach((ch, i) =>
            expect([key, "peso", i, at(cells, n - pesos.length + i, ch)]).toEqual([
              key,
              "peso",
              i,
              1,
            ]),
          );
          [...cents].forEach((ch, i) =>
            expect([key, "centavo", i, at(f.cents!, i, ch)]).toEqual([
              key,
              "centavo",
              i,
              1,
            ]),
          );
        } else if (f.kind === "comb") {
          let v = (f.case === "keep" ? value : value.toUpperCase())
            .split("")
            .filter((c) => !(f.drop ?? "").includes(c))
            .join("");
          if (f.date) {
            const d = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(value)!;
            v = d[1]!.padStart(2, "0") + d[2]!.padStart(2, "0") + d[3]!;
          }
          const rows = rowsOf(f);
          const boxes = rows.reduce((t, r) => t + r.cells.length - 1, 0);
          if (v.length <= boxes && rows.length === 1) {
            // One character per box. pdfjs joins neighbouring glyphs of a wide letter into one
            // item, so compare what is printed along the row, and that it starts in its first box.
            const r = rows[0]!;
            const start =
              (f as { align?: string }).align === "right" ? boxes - v.length : 0;
            const items = onLine(r.page, r.y)
              .filter((t) => t.x >= r.cells[0]! - 0.5 && t.x <= r.cells.at(-1)!)
              .sort((a, b) => a.x - b.x);
            expect([
              key,
              items
                .map((t) => t.str)
                .join("")
                .replace(/\s+/g, ""),
            ]).toEqual([key, v.replace(/\s+/g, "")]);
            const first = items[0]!;
            expect([
              key,
              first.x + first.w / 2 > r.cells[start]! && first.x < r.cells[start + 1]!,
            ]).toEqual([key, true]);
          } else if (f.squeeze) {
            // A value longer than its boxes prints whole, in a line inside the comb's width.
            // pdfjs joins a squeezed line to its neighbours' text on the same baseline, so
            // read the items that overlap the comb: together they contain the value.
            const r = rows[0]!;
            const lo = r.cells[0]!;
            const hi = r.cells.at(-1)!;
            const lines = rows.flatMap((rw) =>
              ink.filter(
                (t) =>
                  t.page === rw.page &&
                  Math.abs(t.y - rw.y) < 3 &&
                  t.x < hi &&
                  t.x + t.w > lo,
              ),
            );
            const got = lines
              .sort((a, b) => b.y - a.y || a.x - b.x)
              .map((t) => t.str)
              .join("")
              .replace(/\s+/g, "");
            expect([key, got.includes(v.replace(/\s+/g, ""))]).toEqual([key, true]);
          }
        } else if (f.kind === "text") {
          const items = onLine(f.page!, f.y!).filter(
            (t) => t.x >= f.x0! - 0.5 && t.x <= f.x1!,
          );
          const got = items
            .sort((a, b) => a.x - b.x)
            .map((t) => t.str)
            .join("");
          expect([key, got.replace(/\s+/g, "")]).toEqual([
            key,
            value.replace(/\s+/g, ""),
          ]);
          for (const t of items)
            expect([key, t.x >= f.x0!, t.x + t.w <= f.x1!]).toEqual([key, true, true]);
        }
        checked++;
      }
      expect(checked).toBe(fx.rows.length);
    });
  }

  it("the 1601-EQ and 1601-C print both pages of the blank; the 0619-E its one page; the blank is untouched", async () => {
    for (const fx of FIXTURES.filter((f) => f.name.endsWith("-sample"))) {
      const out = await renderReturn(fx.form, fx.version, fx.rows, { root: PKG });
      const text = await readText(out);
      const blank = await readText(readPkg(`templates/${fx.form}-${fx.version}.pdf`));
      expect([fx.form, Math.max(...text.map((t) => t.page))]).toEqual([
        fx.form,
        FORMS.find((f) => f.form === fx.form)!.pages,
      ]);
      const has = (t: { page: number; str: string; x: number; y: number }) =>
        text.some(
          (o) => o.page === t.page && o.str === t.str && o.x === t.x && o.y === t.y,
        );
      expect([fx.form, blank.filter((t) => !has(t))]).toEqual([fx.form, []]);
    }
  });

  it("page 2 of the 1601-EQ and 1601-C carries the withholding agent's TIN and name, and Schedule I", async () => {
    const eq = fixture("1601EQ-sample");
    const c = fixture("1601C-schedule");
    for (const [form, version, rows] of [
      ["1601EQ", "2019-01", eq],
      ["1601C", "2018-01", c],
    ] as const) {
      const out = await renderReturn(form, version, rows, { root: PKG });
      const ink = (
        await overlayText(out, readPkg(`templates/${form}-${version}.pdf`))
      ).filter((t) => t.page === 2);
      const tin = ink.filter((t) => /^\d$/.test(t.str)).length;
      expect([form, tin >= 14]).toEqual([form, true]);
      expect([form, ink.some((t) => /^[A-Z]$/.test(t.str))]).toEqual([form, true]);
    }
  });

  it("the ATC and tax type code the blanks pre-print are never written", async () => {
    for (const fx of FIXTURES) {
      const out = await renderReturn(fx.form, fx.version, fx.rows, { root: PKG });
      const ink = await overlayText(
        out,
        readPkg(`templates/${fx.form}-${fx.version}.pdf`),
      );
      const text = ink.map((t) => t.str).join("|");
      for (const pre of ["WME10", "WW010"])
        expect([fx.name, text.includes(pre)]).toEqual([fx.name, false]);
      // the 0619-E's tax type code cell ("WE" on the blank): nothing of the engine's in it
      if (fx.form === "0619E")
        expect(
          ink.filter((t) => t.page === 1 && Math.abs(t.y - 644.6) < 3 && t.x > 560),
        ).toEqual([]);
    }
  });

  it("the Tax Debit Memo's drawee bank has no box on the blank and is never written", async () => {
    const rows = buildWithholdingPrintRows(
      "0619E",
      WH_SAMPLES["0619E-penalties"]!.data,
      WH_INDIVIDUAL,
      "2026-05",
    );
    expect(WH_SAMPLES["0619E-penalties"]!.data.payTaxDebitBank).toBe("NOT PRINTED");
    expect(rows.some(([, v]) => /NOT PRINTED/.test(v))).toBe(false);
  });
});

// ---- exact figures ----------------------------------------------------------------------------

describe("C9 · totals are exact to the centavo", () => {
  const rowsOf = (name: string): Record<string, string> =>
    Object.fromEntries(fixture(name));

  it("the 0619-E with penalties: 16, 17D and 18", () => {
    const r = rowsOf("0619E-penalties");
    expect(r["f0619E:i14"]).toBe("12,345.67"); // as typed
    expect(r["f0619E:i16"]).toBe("11345.67");
    expect(r["f0619E:i17d"]).toBe("4093.62");
    expect(r["f0619E:i18"]).toBe("15439.29");
  });

  it("the six-row 1601-EQ: 19, 25, 26, 30 and 31", () => {
    const r = rowsOf("1601EQ-six-rows");
    expect(r["f1601EQ:i19"]).toBe("2598765.41");
    expect(r["f1601EQ:i25"]).toBe("785000.75");
    expect(r["f1601EQ:i26"]).toBe("1813764.66");
    expect(r["f1601EQ:i30"]).toBe("36000.40");
    expect(r["f1601EQ:i31"]).toBe("1849765.06");
    for (let n = 1; n <= 6; n++) expect(r[`f1601EQ:r${n}Atc`]).toBeTruthy();
  });

  it("the 1601-C with three Schedule I rows: each adjustment, their total, Items 26, 27 and 31", () => {
    const r = rowsOf("1601C-schedule");
    expect([
      r["f1601C:s1Adjustment"],
      r["f1601C:s2Adjustment"],
      r["f1601C:s3Adjustment"],
    ]).toEqual(["250.75", "100.05", "0.99"]);
    expect(r["f1601C:sTotal"]).toBe("351.79");
    expect(r["f1601C:i26"]).toBe("351.79");
    expect(r["f1601C:i27"]).toBe("15351.79");
    expect(r["f1601C:i31"]).toBe("12851.79");
  });

  it("no floating-point residue: 0.1 + 0.2 is 0.30", () => {
    const rows = buildWithholdingPrintRows(
      "0619E",
      {
        ...WH_SAMPLES["0619E-sample"]!.data,
        surcharge: "0.1",
        interest: "0.2",
        compromise: "0",
      },
      WH_CORPORATION,
      "2026-08",
    );
    expect(Object.fromEntries(rows)["f0619E:i17d"]).toBe("0.30");
  });
});

// ---- refusals ---------------------------------------------------------------------------------

describe("C9 · a third decimal is refused, never rounded", () => {
  const cases: [string, string, string, string][] = [
    ["0619E", "2018-01", "f0619E:i14", "12345.675"],
    ["1601EQ", "2019-01", "f1601EQ:r1Withheld", "1000.001"],
    ["1601EQ", "2019-01", "f1601EQ:r2Base", "50000.125"],
    ["1601C", "2018-01", "f1601C:i14", "250000.005"],
    ["1601C", "2018-01", "f1601C:s1TaxPaid", "1000.999"],
  ];
  for (const [form, version, key, value] of cases) {
    it(`${form} ${key} = ${value}`, async () => {
      const name = `${form}-sample`;
      const base = fixture(name);
      const rows: Rows = base.some(([k]) => k === key)
        ? base.map(([k, v]) => [k, k === key ? value : v])
        : [...base, [key, value]];
      await expect(renderReturn(form, version, rows, { root: PKG })).rejects.toThrow(
        BirPdfError,
      );
      await expect(renderReturn(form, version, rows, { root: PKG })).rejects.toThrow(
        /3 decimals but the paper has 2 centavo boxes/,
      );
    });
  }
  it("trailing zeros are not a third decimal: 1.500 prints 1.50", async () => {
    const rows: Rows = [
      ...fixture("0619E-sample").filter(([k]) => k !== "f0619E:i14"),
      ["f0619E:i14", "1.500"],
    ];
    const out = await renderReturn("0619E", "2018-01", rows, { root: PKG });
    expect(out.byteLength).toBeGreaterThan(1000);
  });
});

// ---- the draft stamp and the clear copy -------------------------------------------------------

describe("C9 · a preview is stamped DRAFT on every page; the clear copy carries nothing of the kind", () => {
  for (const { form, version, pages } of FORMS) {
    it(`${form}`, async () => {
      const rows = fixture(`${form}-sample`);
      const blank = readPkg(`templates/${form}-${version}.pdf`);
      const draft = await overlayText(
        await renderReturn(form, version, rows, {
          root: PKG,
          watermark: "DRAFT",
          printedAt: new Date("2026-10-25T02:05:00.000Z"),
        }),
        blank,
      );
      expect(draft.filter((t) => t.str === "DRAFT — NOT FILED")).toHaveLength(pages);
      expect(draft.filter((t) => /^Preview printed /.test(t.str))).toHaveLength(pages);
      const clear = await overlayText(
        await renderReturn(form, version, rows, { root: PKG }),
        blank,
      );
      expect(clear.filter((t) => /DRAFT|Preview printed/.test(t.str))).toEqual([]);
    });
  }
});
