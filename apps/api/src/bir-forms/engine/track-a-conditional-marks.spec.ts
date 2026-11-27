// track-a-conditional-marks.spec.ts — U27 addendum (D74): the conditional marks of the 1701
// family. A method-of-deduction mark (1701Q 16A/25A, 1701 21A/12A) exports and prints only
// under that person's Graduated rate; the spouse's background (1701Q Items 19, 20, 24, 25,
// 25A; the 1701's Part I on page 2; the 1701A's spouse block) only when the return carries
// the spouse. Hermetic: the builders' own XML (the print reads the same rows). Invented data.
import { parseEbirExport } from "@portal/bir-pdf";
import { build1701 } from "./build1701";
import { build1701A } from "./build1701A";
import { build1701Q } from "./build1701Q";
import { compute1701 } from "./compute1701";
import { compute1701A } from "./compute1701A";
import { compute1701Q } from "./compute1701Q";
import { spouseOnReturn } from "./spouse-on-return";
import type { Filing, FilingData, Taxpayer } from "./types";

const TP = {
  kind: "individual",
  tin: "000555888",
  branch: "00000",
  lastName: "HALIMBAWA",
  firstName: "JUANA",
  civilStatus: "Married",
  classification: "Professional",
} as unknown as Taxpayer;
const filing = (form: string, period: string, data: FilingData) =>
  ({ form, period, data }) as unknown as Filing;
const marks = (xml: string, ns: string) =>
  Object.fromEntries(
    parseEbirExport(xml)
      .filter(([k]) => k.startsWith(ns))
      .map(([k, v]) => [k.slice(ns.length), v]),
  );
const q = (d: FilingData) =>
  marks(build1701Q(filing("1701Q", "2026-Q3", d), TP, compute1701Q(d)), "frm1701q:");
const annual = (d: FilingData) =>
  marks(build1701(filing("1701", "2025", d), TP, compute1701(d)), "frm1701:");
const a = (d: FilingData) =>
  marks(build1701A(filing("1701A", "2025", d), TP, compute1701A(d)), "frm1701A:");

const SPOUSE_1701Q = [
  "optSpouseType_1",
  "optSpouseType_2",
  "optSpouseType_3",
  "optSpouseATC_1",
  "optSpouseATC_2",
  "optSpouseATC_3",
  "optSpouseATC_4",
  "optSpouseATC_5",
  "optSpouseATC_6",
  "optSpouseATC_7",
  "optSpouseForeignTaxCred_1",
  "optSpouseForeignTaxCred_2",
  "optSpouseTaxRate_1",
  "optSpouseTaxRate_2",
  "optSpouseMethod:_1",
  "optSpouseMethod:_2",
];
const ticked = (m: Record<string, string>, keys: string[]) =>
  keys.filter((k) => m[k] === "true");

describe("U27 addendum · the 1701Q", () => {
  it("8%: no Item 16A mark, whatever methodA holds (the Trinoche return's keys)", () => {
    const m = q({ atc: "II015", rateA: "eight", methodA: "osd", salesA: "500000" });
    expect([
      m["optTaxRate_2"],
      m["optMethodOfDeduction:_1"],
      m["optMethodOfDeduction:_2"],
    ]).toEqual(["true", "false", "false"]);
  });

  it("Graduated with OSD (and with itemized): unchanged", () => {
    expect(
      q({ rateA: "graduated", methodA: "osd", salesA: "1" })["optMethodOfDeduction:_2"],
    ).toBe("true");
    expect(
      q({ rateA: "graduated", methodA: "itemized", salesA: "1" })[
        "optMethodOfDeduction:_1"
      ],
    ).toBe("true");
  });

  it("the spouse column off (the defaulted rateB/methodB, no spouse keys): Part II is blank", () => {
    const m = q({
      rateA: "eight",
      methodA: "osd",
      rateB: "graduated",
      methodB: "osd",
      salesA: "1",
    });
    expect(ticked(m, SPOUSE_1701Q)).toEqual([]);
  });

  it("a spouse on the return: Part II prints; under the spouse's 8% no 25A mark", () => {
    const grad = q({
      rateB: "graduated",
      methodB: "osd",
      salesB: "1000",
      spouseAtc: "II012",
      spouseType: "prof",
    });
    expect(ticked(grad, SPOUSE_1701Q)).toEqual([
      "optSpouseType_2",
      "optSpouseATC_1",
      "optSpouseForeignTaxCred_2",
      "optSpouseTaxRate_1",
      "optSpouseMethod:_2",
    ]);
    const eight = q({
      rateB: "eight",
      methodB: "osd",
      salesB: "1000",
      spouseAtc: "II015",
    });
    expect(ticked(eight, SPOUSE_1701Q)).toEqual([
      "optSpouseATC_5",
      "optSpouseForeignTaxCred_2",
      "optSpouseTaxRate_2",
    ]);
  });
});

describe("U27 addendum · the 1701 and the 1701A", () => {
  it("1701: the spouse column off leaves the spouse's rate and method (Items 12 and 12A) blank", () => {
    const m = annual({
      rateA: "graduated",
      methodA: "osd",
      rateB: "graduated",
      methodB: "osd",
      compA: "1",
    });
    expect(
      ticked(m, [
        "rdoPg2I12TaxRateG",
        "rdoPg2I12AMethodDeductionI",
        "rdoPg2I12AMethodDeductionO",
        "rdoPg2I12TaxRateP",
      ]),
    ).toEqual([]);
    const on = annual({ rateB: "graduated", methodB: "osd", salesB: "1000", compA: "1" });
    expect(on["rdoPg2I12AMethodDeductionO"]).toBe("true");
    // The filer's 21A was already gated on the rate.
    expect(annual({ rateA: "eight", methodA: "osd" })["rdoPg1I21AMethodDeductionO"]).toBe(
      "false",
    );
  });

  it("1701A: the spouse's block stays blank without a spouse on the return", () => {
    const m = a({ spouseTaxRate: "eight", spouseForeignCredit: "no" });
    expect(
      ticked(m, [
        "optSpouseTaxRate_1",
        "optSpouseTaxRate_2",
        "optSpouseFTC_1",
        "optSpouseFTC_2",
      ]),
    ).toEqual([]);
    const on = a({ spouseTaxRate: "eight", spouseForeignCredit: "no", i47B: "1000" });
    expect(ticked(on, ["optSpouseTaxRate_2", "optSpouseFTC_2"])).toEqual([
      "optSpouseTaxRate_2",
      "optSpouseFTC_2",
    ]);
  });

  it("spouseOnReturn: a column-B figure or a typed spouse answer; never the selectors alone", () => {
    expect(spouseOnReturn({ rateB: "graduated", methodB: "osd" })).toBe(false);
    expect(spouseOnReturn({ salesB: "0" })).toBe(true);
    expect(spouseOnReturn({ salesB: "" })).toBe(false);
    expect(spouseOnReturn({ spouseName: "DELA CRUZ, JUAN" })).toBe(true);
    expect(spouseOnReturn({})).toBe(false);
  });
});
