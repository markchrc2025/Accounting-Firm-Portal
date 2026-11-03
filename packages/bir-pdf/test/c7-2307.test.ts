// C7 — BIR Form 2307 on the BIR's own blank (D56).
//
//   * the map names exactly the keys the Portal's rows builder can emit (ten rows in each
//     Part III block, both signature areas), and prints page 1 only;
//   * every item of the sample prints inside its own box (comb characters in their cells,
//     text and amounts between their cell's edges, on their own baseline);
//   * amounts print with centavos, exactly as typed, never rounded;
//   * the engine's new options (centavo amounts, printPages) change nothing for the seven
//     older maps: their maps and proofs are byte-identical, pinned by SHA-256 and re-rendered.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { build2307PrintRows } from "../../../apps/api/src/bir-forms/engine/certificate2307";
import {
  BirPdfError,
  layoutReturn,
  parseEbirExport,
  renderProof,
  renderReturn,
  type FormMap as EngineMap,
  type Metrics,
} from "../src/index";
import { PKG, loadMap, overlayText, readPkg, readText, type MapField } from "./helpers";

const FORM = "2307";
const VERSION = "2018-01";
const sample = JSON.parse(
  readFileSync(join(PKG, "fixtures/2307-sample.json"), "utf8"),
) as [string, string][];
const map = loadMap(FORM, VERSION);

/** A certificate with every Part III row used, to know every key the builder can emit. */
function fullRows() {
  const row = (n: number) => ({
    atc: "WI010",
    desc: `ROW ${n}`,
    m1: "1.00",
    m2: "2.00",
    m3: "3.00",
    tax: "0.10",
  });
  const rows = Array.from({ length: 10 }, (_, i) => row(i + 1));
  return build2307PrintRows(
    {
      year: "2026",
      quarter: "1",
      payeeName: "A",
      payeeTin: "000111222",
      payeeBranch: "00000",
      payeeAddress: "B",
      payeeZip: "1234",
      payeeForeignAddress: "C",
      payorSignatoryName: "D",
      payorSignatoryTitle: "E",
      payorSignatoryTin: "000111222",
      payorTaxAgentNo: "F",
      payorTaxAgentIssued: "01/01/2026",
      payorTaxAgentExpiry: "01/01/2027",
      payeeSignatoryName: "G",
      payeeTaxAgentNo: "H",
      payeeTaxAgentIssued: "01/01/2026",
      payeeTaxAgentExpiry: "01/01/2027",
      rows,
      rowsB: rows,
    },
    {
      kind: "non-individual",
      regName: "PAYOR",
      tin: "000333444",
      branch: "00000",
      address: "X",
      city: "Y",
      zip: "0000",
    },
    { filed: true },
  );
}

/** What an amount prints as, written out here independently of the engine. */
function money(raw: string): string {
  const [p = "0", c = ""] = raw.replace(/,/g, "").split(".");
  const pesos = String(Number(p)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${pesos}.${c.padEnd(2, "0").slice(0, 2)}`;
}

describe("C7 · the 2307 map", () => {
  it("prints page 1 only (D18), and every field sits on it", () => {
    expect((map as unknown as { printPages: number[] }).printPages).toEqual([1]);
    for (const f of map.fields) {
      const pages = f.rows ? f.rows.map((r) => r.page) : [f.page];
      expect([f.key, pages]).toEqual([f.key, pages.map(() => 1)]);
    }
  });

  it("names exactly the keys the rows builder can emit, and none twice", () => {
    const mapped = map.fields.map((f) => f.key);
    expect(new Set(mapped).size).toBe(mapped.length);
    const emitted = fullRows().map(([k]) => k);
    expect(new Set(emitted).size).toBe(emitted.length);
    expect([...mapped].sort()).toEqual([...emitted].sort());
  });

  it("the sample's every key is mapped", () => {
    const mapped = new Set(map.fields.map((f) => f.key));
    expect(sample.map(([k]) => k).filter((k) => !mapped.has(k))).toEqual([]);
  });

  it("only the money columns are centavo cells; the others are not", () => {
    const money = map.fields.filter(
      (f) => (f as { amount?: unknown }).amount === "centavos",
    );
    // 2 blocks x (10 rows + the Total row) x 5 amount columns
    expect(money).toHaveLength(2 * 11 * 5);
    for (const f of map.fields) {
      if (/(Desc|Atc|Name|Address|ForeignAddress|AgentNo|SigTitleTin)$/.test(f.key))
        expect([f.key, (f as { amount?: unknown }).amount]).toEqual([f.key, undefined]);
    }
  });
});

describe("C7 · the sample prints every item in its own box", () => {
  it("each value lands inside its cell, on its own baseline", async () => {
    const out = await renderReturn(FORM, VERSION, sample, { root: PKG });
    const ink = await overlayText(out, readPkg(`templates/${FORM}-${VERSION}.pdf`));
    const onLine = (y: number) => ink.filter((t) => Math.abs(t.y - y) < 0.6);
    for (const [key, value] of sample) {
      const f = map.fields.find((m) => m.key === key) as MapField & {
        amount?: string;
        drop?: string;
      };
      if (f.rows) {
        const chars = value.replace(/\//g, "").split("");
        const row = f.rows[0]!;
        chars.forEach((ch, i) => {
          const lo = row.cells[i]!;
          const hi = row.cells[i + 1]!;
          const hit = onLine(row.y).filter(
            (t) => t.str === ch && t.x + t.w / 2 > lo && t.x + t.w / 2 < hi,
          );
          expect([key, i, ch, hit.length]).toEqual([key, i, ch, 1]);
        });
      } else {
        const want = f.amount === "centavos" ? money(value) : value.toUpperCase();
        const items = onLine(f.y!).filter((t) => t.x >= f.x0! - 0.5 && t.x <= f.x1!);
        const got = items
          .sort((a, b) => a.x - b.x)
          .map((t) => t.str)
          .join("");
        expect([key, got.replace(/\s+/g, "")]).toEqual([key, want.replace(/\s+/g, "")]);
        for (const t of items) {
          expect([key, t.x >= f.x0!, t.x + t.w <= f.x1!]).toEqual([key, true, true]);
        }
      }
    }
  });

  it("the output is the one printed page, the template itself untouched", async () => {
    const out = await renderReturn(FORM, VERSION, sample, { root: PKG });
    const text = await readText(out);
    expect(Math.max(...text.map((t) => t.page))).toBe(1);
    const blank = (await readText(readPkg(`templates/${FORM}-${VERSION}.pdf`))).filter(
      (t) => t.page === 1,
    );
    // Everything the blank prints on page 1 is still there, where it was.
    const has = (t: { str: string; x: number; y: number }) =>
      text.some((o) => o.page === 1 && o.str === t.str && o.x === t.x && o.y === t.y);
    expect(blank.filter((t) => !has(t))).toEqual([]);
  });

  it("a preview is stamped DRAFT on the one page and the figures read through it", async () => {
    const out = await renderReturn(FORM, VERSION, sample, {
      root: PKG,
      watermark: "DRAFT",
      printedAt: new Date("2026-10-25T02:05:00.000Z"),
    });
    const ink = await overlayText(out, readPkg(`templates/${FORM}-${VERSION}.pdf`));
    expect(ink.filter((t) => t.str === "DRAFT — NOT FILED")).toHaveLength(1);
    expect(ink.filter((t) => /^Preview printed /.test(t.str))).toHaveLength(1);
    expect(ink.some((t) => t.str === "DELA CRUZ, JUANA SAMPLE")).toBe(true);
  });
});

/** A stand-in font: every character is half the size wide. */
const METRICS: Metrics = {
  width: (t, s) => t.length * s * 0.5,
  capHeight: (s) => s * 0.7,
  has: () => true,
};
const printedAmount = (v: string) => {
  const ops = layoutReturn(map as unknown as EngineMap, [["c2307:a1M1", v]], METRICS);
  expect(ops).toHaveLength(1);
  return ops[0]!.text;
};

describe("C7 · amounts have centavos and are never rounded", () => {
  it.each([
    ["1234.56", "1,234.56"],
    ["1,234.56", "1,234.56"],
    ["1234.5", "1,234.50"],
    ["1234", "1,234.00"],
    ["0.1", "0.10"],
    [".5", "0.50"],
    ["0.01", "0.01"],
    ["0012.30", "12.30"],
    ["1234567890.12", "1,234,567,890.12"],
    ["12.300", "12.30"],
    ["-12.3", "-12.30"],
  ])("%s prints as %s", (typed, shown) => {
    expect(printedAmount(typed)).toBe(shown);
  });

  it("a third decimal that is not zero is refused, naming the field; it is never rounded", () => {
    for (const v of ["12.345", "0.001", "1,234.567"]) {
      expect(() => printedAmount(v)).toThrow(BirPdfError);
      expect(() => printedAmount(v)).toThrow(/c2307:a1M1.*more than two decimals/);
    }
  });

  it("text that is not an amount is refused, naming the field", () => {
    expect(() => printedAmount("12 pesos")).toThrow(/c2307:a1M1.*is not an amount/);
    expect(() => printedAmount("1.2.3")).toThrow(/is not an amount/);
  });

  it("the older whole-peso cells still refuse centavos (the option is per field)", async () => {
    const old = loadMap("1701", "2018-01");
    const nolco = old.fields.find((f) => (f as { amount?: unknown }).amount === true) as
      MapField | undefined;
    expect(nolco, "the 1701 has a whole-peso table cell").toBeDefined();
    expect(() =>
      layoutReturn(old as unknown as EngineMap, [[nolco!.key, "12.50"]], METRICS),
    ).toThrow(/centavos but the paper asks for whole pesos/);
  });
});

describe("C7 · the older maps and their proofs are byte-identical", () => {
  const PROOFS: Record<string, string> = {
    "2551Q-2018-01-proof.pdf":
      "67c646fbd5f9e629cc42b8d1b5af011f9598da8b17a453d49cfdf39b15fc420f",
    "2551Q-2018-01-filled-proof.pdf":
      "fdf98d74c60a22f8e3e75dc0172d509b5db7c55651e4cd83927c23c1cd7cd71c",
    "2551Q-2018-01-longname-proof.pdf":
      "45bbd5576442593644a6b310fc94a6472fd8f27d480f6aeb5810cdb8881cf212",
    "2551Q-2018-01-draft-proof.pdf":
      "d0288352882e7fdd33688bea0c239aa6140aad4cb3bbd87291db3b5d92e9b168",
    "2550Q-2024-04-proof.pdf":
      "824606184976cef609a03b97d8a0f11b9675391daf6ccb1b677633e57dacf3c6",
    "2550Q-2024-04-filled-proof.pdf":
      "d74160d8cbcecd0c1898ba312a3c4ab87d8cce419a109914ad01e5f81e2ae1c0",
    "2550Q-2024-04-longname-proof.pdf":
      "7c644be3e101331b031c831a506ac32c6971f28aa947ac8207a10d46d15b055c",
    "2550Q-2024-04-draft-proof.pdf":
      "7618485f03296422363ee7118b48218013bfb19235534c3c8c705da0a86af3d9",
    "1701Q-2018-01-proof.pdf":
      "d5d3cb25337109b2fd81224e84ce13d77b0a7846854c98f10e9b3129c115a84f",
    "1701Q-2018-01-filled-proof.pdf":
      "cdebea7d7998da8a7b9fe6febea2aa2cf065fceb3eade7990b07bda32a5b6f3d",
    "1701Q-2018-01-longname-proof.pdf":
      "776efe25f5c287204d5917ac1581221e36a56c316de95c6cc9a4e9218e586bb6",
    "1701Q-2018-01-draft-proof.pdf":
      "7e8a6e8cc4f54f2915503b3c155878af2eec2c6e0ac7e0c9e322d55cf5888d39",
    "1702Q-2018-01-proof.pdf":
      "f8158615c00ddb8df6aeab2ba81a340c994094896a7c511d70255f13610c8b83",
    "1702Q-2018-01-filled-proof.pdf":
      "c800300ac9e7df5d2f0ef3d418e2caea6fac02ab37665eafa6639e77ca1084c1",
    "1702Q-2018-01-longname-proof.pdf":
      "efc9523390e057836fe696695d3bff6e6dfd69e66feb772971b04cf601399fa1",
    "1702Q-2018-01-draft-proof.pdf":
      "795a2da079845180a1f996c6f430e603e3447fd5bdcb390639ea4fc8d539ab9d",
    "1701-2018-01-proof.pdf":
      "c24bdd9ea55b940fc3048e3bc0cc4c76cb38c33c700140bdfb09e250e4b03c49",
    "1701-2018-01-filled-proof.pdf":
      "0757a1721e7276c6d6f37e02369f26a45a8c6c8ac88b0670c5da9e3da9bb507f",
    "1701-2018-01-longname-proof.pdf":
      "668235839990ffbf2b212ee1f8ab29599ac03bbc7b89b5df1eb674fdc8cd6eed",
    "1701-2018-01-draft-proof.pdf":
      "7eb7e2d8de094719c9b695426e76a7a46315d878da446e872371c0052fdf4c92",
    "1701A-2018-01-proof.pdf":
      "5613b7ae29200d8d73dbb5ab25a178be153bc823a50afa6719d395bb99c0979d",
    "1701A-2018-01-filled-proof.pdf":
      "5ad0ebfcfd981f43f65a1dd80774cc4b687bb690d29ad5daa14d1de142ec8316",
    "1701A-2018-01-longname-proof.pdf":
      "af8d5fd517ebfc648a84bc6ed0ce03a30b9231def9084ba6fa402a705525f36c",
    "1701A-2018-01-draft-proof.pdf":
      "d34343ad4bb06e67f1f8c4b2bc0a901596d85b13603dacedb4c104be6f5ef555",
    "1702RT-2018-01-proof.pdf":
      "ed7e7f13eabdc474150b2d4135143ac66d426e4e5ae50d94b8f3c155ac0b59a4",
    "1702RT-2018-01-filled-proof.pdf":
      "3bc60f2bfd75d62dd339d688709d9317d81c1b57a4eb33ea39a1f4de71f1b774",
    "1702RT-2018-01-longname-proof.pdf":
      "cea245089ee7f388fc9249276c58afe903da0e2a2efd986207b907a9e8749f02",
    "1702RT-2018-01-draft-proof.pdf":
      "a2c137c47d9d3d7bed0a6bb89fede75818d5c8da17f2c8a77b4d1e468b5d82af",
  };
  const MAPS: Record<string, string> = {
    "2551Q-2018-01.json":
      "39dfc0234743bc7dd575820d4efd231e8898349af07de6385538ab098df121f3",
    "2550Q-2024-04.json":
      "2527f0b6ece44754c50c95fd72a75d4bb5f0016cece3aa83e760b482b74ce4a6",
    "1701Q-2018-01.json":
      "1ead3fd77363179570fe106f70b0d254d7bed98980e83b931b9e0c17f1c315d7",
    "1702Q-2018-01.json":
      "d70cb688ea07f3a7df6efcfc9c3920f2cb9f738c1b01a1b13e7f9403fbdc2c26",
    "1701-2018-01.json":
      "71a2ea3da2969006ed3dd1175a5bfcd345712503f7cb460f8ac1f11efa0234ee",
    "1701A-2018-01.json":
      "e4238ab999ecdb0f6a77a4a101bf3d3941281b0866d2a82693c8bfa1b0917ec9",
    "1702RT-2018-01.json":
      "1d9a3fe29e352382cf6c3fd8e811a5bb858c64e77325be1cf282492c44633816",
  };
  const sha = (b: Uint8Array | Buffer) => createHash("sha256").update(b).digest("hex");

  for (const [file, hash] of Object.entries(MAPS)) {
    it(`maps/${file} is unchanged`, () => {
      expect(sha(readPkg(`maps/${file}`))).toBe(hash);
    });
  }
  for (const [file, hash] of Object.entries(PROOFS)) {
    it(`proofs/${file} is unchanged`, () => {
      expect(sha(readPkg(`proofs/${file}`))).toBe(hash);
    });
  }

  // The engine, run again today, still writes those same bytes.
  for (const [form, version] of [
    ["2551Q", "2018-01"],
    ["2550Q", "2024-04"],
    ["1701Q", "2018-01"],
    ["1702Q", "2018-01"],
    ["1701", "2018-01"],
    ["1701A", "2018-01"],
    ["1702RT", "2018-01"],
  ] as const) {
    it(`${form}: the engine still writes its committed proof, filled and draft prints, byte for byte`, async () => {
      const rows = parseEbirExport(
        readFileSync(join(PKG, `fixtures/${form}-sample.xml`), "utf8"),
      );
      const same = async (name: string, bytes: Uint8Array) =>
        expect([name, sha(bytes)]).toEqual([name, sha(readPkg(`proofs/${name}`))]);
      await same(
        `${form}-${version}-proof.pdf`,
        await renderProof(form, version, { root: PKG }),
      );
      await same(
        `${form}-${version}-filled-proof.pdf`,
        await renderReturn(form, version, rows, { root: PKG }),
      );
      await same(
        `${form}-${version}-draft-proof.pdf`,
        await renderReturn(form, version, rows, {
          root: PKG,
          watermark: "DRAFT",
          printedAt: new Date("2026-10-25T02:05:00.000Z"),
        }),
      );
    });
  }
});
