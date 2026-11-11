// eligibility.spec.ts — PA8 (D70): which returns a client must file, from its registered tax types
// and kind, and what is missing from the record to decide.
import { missingInfo, requiredReturns, type DeadlineClient } from "./eligibility";

const base: DeadlineClient = {
  id: "c1",
  name: "Client",
  kind: "non-individual",
  taxType: null,
  taxTypesJson: [],
  fiscalYearStart: null,
};
const forms = (c: Partial<DeadlineClient>) =>
  requiredReturns({ ...base, ...c }).map((r) => r.form);

describe("requiredReturns", () => {
  it("VAT brings the 2550Q, percentage tax the 2551Q", () => {
    expect(forms({ taxType: "VAT" })).toContain("2550Q");
    expect(forms({ taxType: "VAT" })).not.toContain("2551Q");
    expect(forms({ taxType: "PERCENTAGE" })).toContain("2551Q");
    expect(forms({ taxType: "PERCENTAGE" })).not.toContain("2550Q");
    expect(forms({})).not.toContain("2550Q");
  });
  it("expanded withholding brings 0619E, 1601EQ, 2307 and 1604E", () => {
    const f = forms({ taxTypesJson: [{ type: "Withholding Tax - Expanded" }] });
    expect(f).toEqual(expect.arrayContaining(["0619E", "1601EQ", "2307", "1604E"]));
    expect(f).not.toContain("1601C");
  });
  it("compensation withholding brings 1601C, 1604C and 2316", () => {
    const f = forms({ taxTypesJson: [{ type: "Withholding Tax - Compensation" }] });
    expect(f).toEqual(expect.arrayContaining(["1601C", "1604C", "2316"]));
    expect(f).not.toContain("0619E");
  });
  it("an individual files the 1701Q and one annual row (1701 or 1701A)", () => {
    const r = requiredReturns({ ...base, kind: "individual" });
    expect(r.map((x) => x.form)).toEqual(expect.arrayContaining(["1701Q", "1701"]));
    expect(r.find((x) => x.form === "1701")!.alternatives).toEqual(["1701A"]);
    expect(r.map((x) => x.form)).not.toContain("1702Q");
    expect(r.map((x) => x.form)).not.toContain("1701A"); // one row, not two
  });
  it("a corporation files the 1702Q and the 1702RT", () => {
    const f = forms({ kind: "non-individual" });
    expect(f).toEqual(expect.arrayContaining(["1702Q", "1702RT"]));
    expect(f).not.toContain("1701Q");
  });
  it("a client with every registration lists each form once", () => {
    const f = forms({
      kind: "non-individual",
      taxType: "VAT",
      taxTypesJson: [
        { type: "Withholding Tax - Expanded" },
        { type: "Withholding Tax - Compensation" },
      ],
    });
    expect(new Set(f).size).toBe(f.length);
    expect(f.sort()).toEqual(
      [
        "0619E",
        "1601C",
        "1601EQ",
        "1604C",
        "1604E",
        "1702Q",
        "1702RT",
        "2307",
        "2316",
        "2550Q",
      ].sort(),
    );
  });
});

describe("missingInfo", () => {
  it("nothing is missing from a complete corporation", () => {
    expect(
      missingInfo({
        ...base,
        taxType: "VAT",
        taxTypesJson: [{ type: "Withholding Tax - Expanded" }],
        fiscalYearStart: "2024-01-01",
      }),
    ).toEqual([]);
  });
  it("names the business tax regime, the registered tax types and the fiscal year", () => {
    const m = missingInfo(base);
    expect(m.map((x) => x.field)).toEqual(["taxType", "taxTypes", "fiscalYearStart"]);
    expect(m[0]!.sentence).toBe(
      "The business tax (VAT or percentage tax) is not set, so the 2550Q or 2551Q cannot be listed.",
    );
    expect(m[1]!.sentence).toBe(
      "No registered tax types, so the withholding returns cannot be listed.",
    );
    expect(m[2]!.sentence).toBe(
      "The fiscal year start is not set; the calendar year is assumed for the 2550Q, 1702Q and 1702RT.",
    );
  });
  it("an individual does not need a fiscal year", () => {
    const m = missingInfo({
      ...base,
      kind: "individual",
      taxType: "PERCENTAGE",
      taxTypesJson: [{ type: "Withholding Tax - Compensation" }],
    });
    expect(m).toEqual([]);
  });
});
