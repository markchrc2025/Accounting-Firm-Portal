// whole-peso.spec.ts — U26 (D73): whole pesos where the BIR paper has no centavo boxes.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { WHOLE_PESO_KEYS, isWholePesoKey, wholePesoItem } from "@portal/shared";
import { parseEbirExport } from "@portal/bir-pdf";
import { MAPS_DIR, PROBED, STARTS, centavosOnPaper, wholePesoFields } from "./derive";
import { renderWholePesoFile } from "./render";
import { roundWholePesos, roundedNote } from "./round-draft";
import type { FilingData } from "../engine/types";

describe("U26 · the list follows the maps", () => {
  it("the committed @portal/shared list is exactly what the maps and builders give (run gen:whole-peso)", () => {
    const committed = readFileSync(
      join(__dirname, "../../../../../packages/shared/src/whole-peso.ts"),
      "utf8",
    );
    expect(committed).toBe(renderWholePesoFile());
  });

  it("the maps' money fields with no centavo boxes: 81, 85, 217, 131, 46 of 47, 6 of 34, none on the others", () => {
    const count = (file: string) => {
      const m = JSON.parse(readFileSync(join(MAPS_DIR, file), "utf8")) as {
        fields: { kind: string; cents?: unknown }[];
      };
      const money = m.fields.filter((f) => f.kind === "money");
      return [money.filter((f) => !f.cents).length, money.length];
    };
    expect(count("1701Q-2018-01.json")).toEqual([81, 81]);
    expect(count("1701A-2018-01.json")).toEqual([85, 85]);
    expect(count("1701-2018-01.json")).toEqual([217, 217]);
    expect(count("1702RT-2018-01.json")).toEqual([131, 131]);
    expect(count("1702Q-2018-01.json")).toEqual([46, 47]);
    expect(count("2551Q-2018-01.json")).toEqual([6, 34]);
    for (const f of [
      "2550Q-2024-04.json",
      "0619E-2018-01.json",
      "1601EQ-2019-01.json",
      "1601C-2018-01.json",
    ])
      expect([f, count(f)[0]]).toEqual([f, 0]);
  });

  it("the 2551Q's six are its rate boxes, not pesos: no 2551Q key is whole pesos", () => {
    expect(WHOLE_PESO_KEYS["2551Q"]).toBeUndefined();
    expect(WHOLE_PESO_KEYS["2550Q"]).toBeUndefined();
    expect(wholePesoFields("2551Q-2018-01.json").size).toBe(0);
  });

  it("one function answers per form and key", () => {
    expect(wholePesoItem("1701Q", "salesA")).toBe("36A");
    expect(isWholePesoKey("1701Q", "salesA")).toBe(true);
    expect(isWholePesoKey("1701Q", "year")).toBe(false);
    expect(isWholePesoKey("1702Q", "rate")).toBe(false);
    expect(isWholePesoKey("2550Q", "salesA")).toBe(false);
  });
});

describe("U26 · rounding at save", () => {
  it("a whole-peso field is rounded and noted; the others keep their centavos", () => {
    const r = roundWholePesos("1701Q", {
      salesA: "130507.95",
      cogsA: "1,000.00",
      year: "2026",
      methodA: "osd",
    });
    expect(r.data).toEqual({
      salesA: "130508",
      cogsA: "1,000.00",
      year: "2026",
      methodA: "osd",
    });
    expect(r.notes).toEqual([
      "Item 36A was rounded to 130,508 because eBIRForms takes whole pesos on the 1701Q.",
    ]);
    const kept = roundWholePesos("2550Q", { salesA: "100.55" });
    expect(kept).toEqual({ data: { salesA: "100.55" }, notes: [] });
  });

  it.each([
    ["100.49", "100"],
    ["100.50", "101"],
    ["100.51", "101"],
    ["0.50", "1"],
    ["-100.49", "-100"],
    ["-100.50", "-101"],
    ["-100.51", "-101"],
    ["-0.49", "0"],
  ])(
    "D54's rule, nearest peso, 50 centavos and up go up (away from zero): %s is %s",
    (typed, stored) => {
      expect(roundWholePesos("1701Q", { cogsA: typed }).data.cogsA).toBe(stored);
    },
  );

  it("a number stays a number; a value that is not an amount is left alone", () => {
    expect(roundWholePesos("1702RT", { i17: 10.5 }).data.i17).toBe(11);
    expect(roundWholePesos("1701Q", { salesA: "abc" }).data.salesA).toBe("abc");
    expect(roundWholePesos("1701Q", { salesA: "" }).data.salesA).toBe("");
  });

  it("the note names the item and the form", () => {
    expect(roundedNote("1702RT", "17", 1234567)).toBe(
      "Item 17 was rounded to 1,234,567 because eBIRForms takes whole pesos on the 1702RT.",
    );
  });
});

describe("U26 · computed whole-peso items never carry centavos", () => {
  it.each(Object.keys(WHOLE_PESO_KEYS))(
    "%s: whole pesos typed in every whole-peso key print whole pesos everywhere",
    (form) => {
      const p = PROBED[form]!;
      const whole = wholePesoFields(p.map);
      const keys = Object.keys(WHOLE_PESO_KEYS[form]!);
      for (const start of STARTS) {
        const data: Record<string, unknown> = { ...start };
        keys.forEach((k, i) => (data[k] = String(1003 + 137 * i)));
        expect([
          form,
          start,
          centavosOnPaper(whole, parseEbirExport(p.xml(data as FilingData))),
        ]).toEqual([form, start, []]);
      }
    },
  );
});
