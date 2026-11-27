// atc.test.ts — U27 (D74): the ATC gate and the write-path check, per form.
import { describe, expect, it } from "vitest";
import {
  ATC_CHOICES,
  PERCENTAGE_TAX_ATCS,
  SPOUSE_ATC_CHOICES,
  missingAtcs,
  spouseAtcRequired,
  unknownAtcs,
} from "../atc";

const choose = (item: string) => `Choose the Item ${item} ATC before this return leaves the Portal.`;

describe("U27 · the gate", () => {
  it.each([
    ["1701", "7"],
    ["1701A", "7"],
    ["1701Q", "8"],
    ["1702Q", "5"],
    ["1702RT", "5"],
  ])("%s: an empty ATC keeps it in the Portal (Item %s); a chosen one lets it go", (form, item) => {
    expect(missingAtcs(form, {})).toEqual([choose(item)]);
    expect(missingAtcs(form, { atc: "  " })).toEqual([choose(item)]);
    expect(missingAtcs(form, { atc: ATC_CHOICES[form as "1701"][0]!.code })).toEqual([]);
  });

  it("the spouse's ATC: on the 1701Q and the 1701 when the spouse has sales; never on the 1701A", () => {
    expect(spouseAtcRequired("1701Q", { salesB: "1,000.00" })).toBe(true);
    expect(spouseAtcRequired("1701Q", { salesB: "0" })).toBe(false);
    expect(spouseAtcRequired("1701", { salesB: 5 })).toBe(true);
    expect(spouseAtcRequired("1701A", { salesB: "5" })).toBe(false);
    expect(missingAtcs("1701Q", { atc: "II012", salesB: "100" })).toEqual([
      "Choose the spouse's Item 20 ATC before this return leaves the Portal.",
    ]);
    expect(missingAtcs("1701", { atc: "II012", salesB: "100" })).toEqual([
      "Choose the spouse's Item 4 ATC before this return leaves the Portal.",
    ]);
    expect(missingAtcs("1701Q", { atc: "II012", salesB: "100", spouseAtc: "II011" })).toEqual([]);
  });

  it("the 2551Q: a row with a taxable amount and no ATC; an empty row is no row", () => {
    expect(
      missingAtcs("2551Q", {
        rows: [
          { atc: "PT010", taxable: "100" },
          { atc: "", taxable: "50" },
          { atc: "", taxable: "" },
          { taxable: "0" },
        ],
      }),
    ).toEqual([
      "Schedule 1, row 2 has a taxable amount but no ATC. Choose its ATC before this return leaves the Portal.",
    ]);
  });

  it("untouched: the 0619-E, 1601-EQ, 1601-C, 2550Q, 2307 and 2316", () => {
    for (const form of ["0619E", "1601EQ", "1601C", "2550Q", "2307", "2316"])
      expect([form, missingAtcs(form, {})]).toEqual([form, []]);
  });
});

describe("U27 · the write-path check", () => {
  it("a code the form does not list is refused, naming the item; an empty one is not", () => {
    expect(unknownAtcs("1701Q", { atc: "II011" })).toEqual([
      "Item 8: the ATC II011 is not one of the ATC choices printed on BIR Form 1701Q. Choose Item 8 again.",
    ]);
    expect(unknownAtcs("1701", { atc: "ii011" })).toEqual([]);
    expect(unknownAtcs("1701A", { atc: "II013" })).toHaveLength(1);
    expect(unknownAtcs("1702RT", { atc: "IC010" })).toHaveLength(1);
    expect(unknownAtcs("1701Q", {})).toEqual([]);
    expect(unknownAtcs("1701Q", { spouseAtc: "PT010" })).toEqual([
      "Item 20 (the spouse's ATC): the ATC PT010 is not one of the ATC choices printed on BIR Form 1701Q. Choose Item 20 again.",
    ]);
    expect(unknownAtcs("2551Q", { rows: [{ atc: "PT150" }, { atc: "PT010" }] })).toEqual([
      "Schedule 1, row 1: the ATC PT150 is not one of the ATCs the 2551Q offers. Choose its ATC again.",
    ]);
  });

  it("the lists: the 1701Q's Item 8 has no II011, its spouse's Item 20 does; the 2551Q offers eight", () => {
    expect(ATC_CHOICES["1701Q"].map((c) => c.code)).toEqual(["II012", "II014", "II013", "II015", "II017", "II016"]);
    expect(SPOUSE_ATC_CHOICES["1701Q"].map((c) => c.code)).toContain("II011");
    expect(ATC_CHOICES["1701"].map((c) => c.code)).toContain("II011");
    expect(PERCENTAGE_TAX_ATCS).toHaveLength(8);
  });
});
