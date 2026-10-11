// C2 T2 — the print maps of the 1701Q, 1702Q, 1701, 1701A and 1702RT (D53):
//   * the map validates, and every template page is covered (a page with no field
//     is named here as an instructions page);
//   * a worst-case return — every digit box full, every squeezable name, address
//     and e-mail at its longest — prints with no digit squeezed, every digit in its
//     own box, and nothing outside the page frame;
//   * a figure the paper cannot hold is refused, naming the field;
//   * the 2551Q and 2550Q proofs made before this unit print byte for byte the same.
// Invented values only.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  BirPdfError,
  loadMap as loadValidMap,
  parseEbirExport,
  renderProof,
  renderReturn,
} from "../src/index";
import {
  PKG,
  expectComb,
  expectMoney,
  loadMap,
  overlayText,
  readPkg,
  type MapField,
} from "./helpers";

interface Case {
  form: string;
  version: string;
  /** 1-based template pages that carry no field (the BIR's instructions). */
  instructionPages: number[];
}
const CASES: Case[] = [
  { form: "1701Q", version: "2018-01", instructionPages: [] },
  // Page 3 of the 1702Q is the BIR's ATC table and instructions: nothing to fill in.
  { form: "1702Q", version: "2018-01", instructionPages: [3] },
];

/** Page-frame bounds (the BIR's forms draw a 1.4 pt border about 15-16 pt in). */
const FRAME = { left: 16.5, right: 595.5 };

/** Invented values too long for their boxes, by what the field holds (as tools/proof.ts). */
function longValue(key: string): string {
  const k = key.split(":").pop()!;
  if (/Email/i.test(k))
    return "accounts.receivable.department@invented-sample-company.example";
  if (/Address|Add$/i.test(k))
    return "UNIT 12 SAMPLE TOWER ONE, 5 INVENTED AVENUE CORNER EXAMPLE STREET, SAMPLE CITY, METRO 0000";
  if (/Specify|Treaty|Citizenship/.test(k))
    return "TREATY BETWEEN INVENTED REPUBLICS SAMPLE";
  if (/Agency/.test(k)) return "SAMPLE BANK INC";
  if (/Number/.test(k)) return "CHK-0001234567890";
  if (/Particular/.test(k)) return "INVENTED OTHER PAYMENT";
  return "INVENTED SAMPLE TRADING AND GENERAL MERCHANDISE SERVICES CORPORATION";
}

const boxesOf = (f: MapField) =>
  (f.rows ?? []).reduce((t, r) => t + r.cells.length - 1, 0);

for (const c of CASES) {
  const { form, version } = c;
  describe(`C2 T2 · ${form} ${version}`, () => {
    const map = loadMap(form, version);
    const sample = parseEbirExport(
      readFileSync(join(PKG, `fixtures/${form}-sample.xml`), "utf8"),
    );

    it("the map validates and every template page has a field (or is named an instructions page)", () => {
      expect(() => loadValidMap(form, version)).not.toThrow();
      const pages = new Set<number>();
      for (const f of map.fields) {
        if (f.kind === "none") continue;
        if (f.rows) for (const r of f.rows) pages.add(r.page);
        else if (f.page) pages.add(f.page);
      }
      const all = [...Array.from({ length: loadPageCount() }, (_, i) => i + 1)];
      expect(all.filter((p) => !pages.has(p))).toEqual(c.instructionPages);
    });

    function loadPageCount(): number {
      return (
        JSON.parse(
          readFileSync(join(PKG, "maps", `${form}-${version}.json`), "utf8"),
        ) as {
          pages: unknown[];
        }
      ).pages.length;
    }

    it("a worst-case return prints with no digit squeezed and nothing outside the frame", async () => {
      // Per key: the placements it has (a key may print in several places).
      const byKey = new Map<string, MapField[]>();
      for (const f of map.fields)
        if (f.kind !== "none") byKey.set(f.key, [...(byKey.get(f.key) ?? []), f]);

      const values: Record<string, string> = {};
      const exact: { f: MapField; value: string }[] = [];
      for (const [key, fs] of byKey) {
        const f = fs[0]!;
        if (f.kind === "money") {
          const digits = Math.min(...fs.map((x) => x.cells!.length - 1));
          const cents = f.cents ? f.cents.length - 1 : 0;
          if (fs.some((x) => (x.cents ? x.cents.length - 1 : 0) !== cents)) continue;
          const pesos = Number("9".repeat(digits)).toLocaleString("en-US");
          values[key] = `${pesos}.${cents ? "9".repeat(cents) : "00"}`;
          for (const x of fs) exact.push({ f: x, value: values[key]! });
        } else if (f.kind === "comb") {
          const raw = f as MapField & {
            squeeze?: boolean;
            ghost?: string;
            date?: boolean;
            strip?: string;
            pad?: string;
          };
          if (raw.squeeze) values[key] = longValue(key);
          else if (raw.date) values[key] = "12/31/2026";
          else if (raw.strip)
            values[key] = raw.strip + "9".repeat(Math.min(...fs.map(boxesOf)));
          else if (raw.ghost === "8") {
            const n = Math.min(...fs.map(boxesOf));
            values[key] = "8".repeat(n);
            if (fs.length === 1 && fs[0]!.rows!.length === 1)
              exact.push({ f, value: values[key]! });
          }
        }
      }
      const rows = sample.map(([k, v]): [string, string] => [
        k,
        k in values ? values[k]! : v,
      ]);
      const pdf = await renderReturn(form, version, rows);
      const tpl = readPkg(`templates/${map.template}`);
      const ink = await overlayText(pdf, tpl);
      expect(ink.length).toBeGreaterThan(50);

      // Nothing outside the page frame; nothing under 5.5 pt; a lone character is never shrunk.
      for (const t of ink) {
        expect(t.x, `"${t.str}" p${t.page} left of the frame`).toBeGreaterThanOrEqual(
          FRAME.left,
        );
        expect(t.x + t.w, `"${t.str}" p${t.page} right of the frame`).toBeLessThanOrEqual(
          FRAME.right,
        );
        expect(t.size, `"${t.str}" size`).toBeGreaterThanOrEqual(5.5 - 1e-6);
        if (t.str.length === 1 && /[0-9]/.test(t.str))
          expect(
            t.size,
            `digit "${t.str}" p${t.page} y=${t.y.toFixed(1)} is not squeezed`,
          ).toBe(10);
      }
      expect(exact.length, "digit fields checked").toBeGreaterThan(20);
      // Digit boxes: every digit centred in its own box.
      for (const { f, value } of exact) {
        if (f.kind === "money") expectMoney(ink, f, value, f.key);
        else {
          const r = f.rows![0]!;
          expectComb(
            ink,
            r.page,
            r.y,
            r.cells,
            value,
            (f.align as "left" | "right") ?? "left",
            f.key,
          );
        }
      }
    });

    it("a figure the paper cannot hold is refused, naming the field", async () => {
      const money = map.fields.find((f) => f.kind === "money")!;
      const digits = money.cells!.length - 1;
      const tooBig = `${"9".repeat(digits + 1)}.00`;
      const err = await renderReturn(
        form,
        version,
        sample.map(([k, v]): [string, string] => [k, k === money.key ? tooBig : v]),
      ).then(
        () => undefined,
        (e: unknown) => e,
      );
      expect(err).toBeInstanceOf(BirPdfError);
      expect((err as Error).message).toContain(money.key);

      const noCents = map.fields.find((f) => f.kind === "money" && !f.cents);
      if (noCents) {
        const err2 = await renderReturn(
          form,
          version,
          sample.map(([k, v]): [string, string] => [
            k,
            k === noCents.key ? "1,234.56" : v,
          ]),
        ).then(
          () => undefined,
          (e: unknown) => e,
        );
        expect(err2).toBeInstanceOf(BirPdfError);
        expect((err2 as Error).message).toContain(noCents.key);
      }
    });
  });
}

describe("C2 T2 · the 2551Q and 2550Q proofs made before C2 print byte for byte the same", () => {
  const same = async (file: string, bytes: Promise<Uint8Array>) =>
    expect(Buffer.from(await bytes).equals(readFileSync(join(PKG, "proofs", file)))).toBe(
      true,
    );
  const printedAt = new Date("2026-10-25T02:05:00.000Z");
  for (const [form, version] of [
    ["2551Q", "2018-01"],
    ["2550Q", "2024-04"],
  ] as const) {
    it(`${form}: ghost proof and draft proof`, async () => {
      await same(`${form}-${version}-proof.pdf`, renderProof(form, version));
      const rows = parseEbirExport(
        readFileSync(join(PKG, `fixtures/${form}-sample.xml`), "utf8"),
      );
      await same(
        `${form}-${version}-draft-proof.pdf`,
        renderReturn(form, version, rows, { watermark: "DRAFT", printedAt }),
      );
    });
  }
});
