// whole-peso-filing.test.ts — U28 (D75): a saved draft with centavos in whole-peso figures is
// not marked filed; the one sentence names every item, once, in the draft's order.
import { describe, expect, it } from "vitest";
import {
  centavoItemsBeforeFiling,
  centavosBeforeFiling,
  saveBeforeFilingSentence,
} from "../whole-peso-filing";

const ONE =
  "Item 36A has centavos, which the 1701Q paper has no boxes for. Save the draft so the figures are rounded to whole pesos, then mark it filed.";

describe("U28 · centavos before filing", () => {
  it("a whole-peso figure with centavos holds the filing back, in one sentence", () => {
    expect(centavosBeforeFiling("1701Q", { salesA: "130507.95" })).toEqual([ONE]);
  });

  it("every item, in the draft's order, joined as the U26 sentences are", () => {
    expect(
      centavosBeforeFiling("1701Q", { excessA: "99.49", salesA: "1,000.50", cogsA: 12.25 }),
    ).toEqual([
      "Items 55A, 36A and 37A have centavos, which the 1701Q paper has no boxes for. Save the draft so the figures are rounded to whole pesos, then mark it filed.",
    ]);
    expect(saveBeforeFilingSentence("1701", ["S3 11 A", "23 A"])).toMatch(
      /^Items S3 11 A and 23 A have centavos, which the 1701 paper/,
    );
  });

  it("an item two keys print in is named once", () => {
    expect(centavoItemsBeforeFiling("1701", { nolco4D: "1.50", nolco5D: "2.50" })).toEqual([
      "S3 15 A",
    ]);
  });

  it("whole pesos, zero centavos, text and empties do not hold it back", () => {
    for (const v of ["130508", "130,508.00", " 130508.0 ", 130508, "", null, "abc", "12.5x"]) {
      expect(centavosBeforeFiling("1701Q", { salesA: v })).toEqual([]);
    }
    expect(centavosBeforeFiling("1701Q", { salesA: Number.NaN })).toEqual([]);
  });

  it("a key that keeps centavos, a form with centavo boxes, and no data are never held", () => {
    expect(centavosBeforeFiling("1701Q", { atc: "II015", year: "2026" })).toEqual([]);
    expect(centavosBeforeFiling("2551Q", { rows: [{ taxable: "130507.95" }] })).toEqual([]);
    expect(centavosBeforeFiling("0619E", { remittance: "12,345.67" })).toEqual([]);
    expect(centavosBeforeFiling("1701Q", null)).toEqual([]);
    expect(centavosBeforeFiling("1701Q", undefined)).toEqual([]);
  });

  it("negative amounts with centavos are held too", () => {
    expect(centavoItemsBeforeFiling("1701Q", { excessA: "-10.10" })).toEqual(["55A"]);
  });
});
