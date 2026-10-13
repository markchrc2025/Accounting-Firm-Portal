// C6 T3 — the words the editors list for Item 6 and for the ATC are the words the BIR
// printed on the blank form (D55 amendment, R2). For each of the 1701, 1701A and 1701Q the
// test reads the committed template's text layer next to every ATC and taxpayer-type
// box the print map places, and compares it, spaces ignored but every letter, digit and
// dash kept, with the choice the editor's selector shows (apps/web lib incomeTaxBackground).
// It also checks the selector lists exactly the ATC boxes the map places, no more. The 1702Q
// and 1702RT print one choice ("IC 055" and "Minimum Corporate Income Tax (MCIT)", in two
// boxes) and a blank write-in line: the test checks the editor's one choice reads as the
// printed words and that the blank line's boxes have nothing printed in them.
import { describe, expect, it } from "vitest";
import {
  ATC_CHOICES,
  ITEM_NUMBERS,
  TAXPAYER_TYPE_LABEL,
  type IncomeTaxForm,
} from "../../../apps/web/src/lib/incomeTaxBackground";
import { loadMap, readPkg, readText, type MapField, type TextItem } from "./helpers";

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, "");

const FORMS: { form: IncomeTaxForm; version: string }[] = [
  { form: "1701", version: "2018-01" },
  { form: "1701A", version: "2018-01" },
  { form: "1701Q", version: "2018-01" },
];

/** The text printed to the right of a mark's box on its row, up to the next box. */
function printedBeside(f: MapField, marks: MapField[], text: TextItem[]): string {
  const [, y0, x1, y1] = f.box as [number, number, number, number];
  const mid = (y0 + y1) / 2;
  const next = Math.min(
    ...marks
      .filter((g) => g !== f && g.page === f.page)
      .filter((g) => {
        const [gx0, gy0, , gy1] = g.box as [number, number, number, number];
        return Math.abs((gy0 + gy1) / 2 - mid) < 6 && gx0 > x1;
      })
      .map((g) => (g.box as number[])[0]!),
    1e9,
  );
  return text
    .filter(
      (t) =>
        t.page === (f.page ?? 1) &&
        Math.abs(t.y - y0) < 8 &&
        t.x >= x1 - 1 &&
        t.x < next - 1,
    )
    .sort((a, b) => a.x - b.x)
    .map((t) => t.str)
    .join("");
}

for (const { form, version } of FORMS) {
  describe(`C6 T3 · ${form}: the editor's words are the template's`, () => {
    const map = loadMap(form, version);
    const bytes = readPkg(`templates/${map.template}`);
    const items = ITEM_NUMBERS[form];
    // Marks of the filer's own Items (not the spouse's block): the ATC item's II0xx
    // choices and the taxpayer-type item's boxes.
    const marks = map.fields.filter((m) => m.kind === "mark" && m.box);
    const atcMarks = marks.filter((m) =>
      new RegExp(`^${items.atc} II0\\d\\d`).test(m.item),
    );
    const typeMarks = marks.filter((m) =>
      new RegExp(
        `^${items.type} (Single Proprietor|Professional|Estate|Trust|Compensation Earner)$`,
      ).test(m.item),
    );

    it("the selector lists exactly the ATC boxes the map places, each with the words printed beside it", async () => {
      const text = await readText(bytes);
      const printed = atcMarks.map((m) => ({
        code: m.item.split(" ")[1]!,
        text: printedBeside(m, marks, text),
      }));
      expect(printed.map((p) => p.code).sort()).toEqual(
        ATC_CHOICES[form].map((c) => c.code).sort(),
      );
      for (const p of printed) {
        const choice = ATC_CHOICES[form].find((c) => c.code === p.code)!;
        expect(norm(p.text), `${form} ${p.code}`).toBe(norm(choice.label));
      }
    });

    it("the taxpayer types the Classification can tick are printed as the card names them", async () => {
      const text = await readText(bytes);
      for (const [k, label] of Object.entries(TAXPAYER_TYPE_LABEL)) {
        const m = typeMarks.find((t) => t.item === `${items.type} ${label}`);
        expect(m, `${form} has a ${k} box`).toBeDefined();
        expect(norm(printedBeside(m!, marks, text)), `${form} ${k}`).toBe(norm(label));
      }
    });
  });
}

for (const form of ["1702Q", "1702RT"] as const) {
  describe(`C6 T3 · ${form}: the editor's one ATC choice is the template's`, () => {
    const map = loadMap(form, "2018-01");
    const bytes = readPkg(`templates/${map.template}`);

    it("the template prints exactly IC 055 and Minimum Corporate Income Tax (MCIT) on Item 5's first row, and nothing on the second", async () => {
      const text = (await readText(bytes)).filter((t) => t.page === 1);
      const code = text.find((t) => norm(t.str) === "ic055");
      expect(code, `${form} prints IC 055`).toBeDefined();
      const row = text
        .filter((t) => Math.abs(t.y - code!.y) < 3 && t.x >= 350 && t.x < 560)
        .sort((a, b) => a.x - b.x)
        .map((t) => t.str)
        .join("");
      expect(ATC_CHOICES[form]).toHaveLength(1);
      expect(norm(row)).toBe(norm(ATC_CHOICES[form][0]!.label));
      // The second row (the write-in line) has no printed text of its own.
      const second = text.filter(
        (t) => t.y < code!.y - 3 && t.y > code!.y - 20 && t.x >= 350 && t.x < 560,
      );
      expect(second.map((t) => t.str)).toEqual([]);
    });
  });
}
