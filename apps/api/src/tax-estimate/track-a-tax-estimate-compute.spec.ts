/**
 * track-a-tax-estimate-compute.spec.ts — U10 T2: each method's arithmetic at the
 * bracket edges (250,000; 250,000.01; 400,000; 8,000,000.01) and the floor at 0,
 * plus the default rule's table by year (U10 addendum: 2022 and earlier take TRAIN
 * Table 1; 2023 on take Table 2). Hermetic: the pure functions in compute.ts.
 *
 * The published figures are rounded to centavos, which hides a one-centavo edge
 * (0.01 × 15% = 0.0015). So each edge is checked twice: raw, where the bracket
 * shows, and as published.
 */
import { DEFAULT_TAX_RULE, type TaxRuleInput } from "../tax-rules/dto/tax-rule.schemas";
import { businessTax, incomeTax, savedBracketTax } from "./compute";
import { graduatedTax } from "./statute";

const rule = (method: TaxRuleInput["method"], flatRate: number | null): TaxRuleInput => ({
  method,
  flatRate,
  brackets: [],
});

describe("U10 T2 · graduated, raw bracket arithmetic at the edges", () => {
  it.each([
    // [taxable, Table 2 (2026), Table 1 (2022)]
    [250000, 0, 0], // the 0% band's top: nothing
    [250000.01, 0.0015, 0.002], // 0.01 over: 15% (T2) / 20% (T1)
    [400000, 22500, 30000], // 150,000 × 15% / × 20%
    [8000000.01, 2202500.0035, 2410000.0035], // top band: base + 0.01 × 35%
  ])("taxable %d: Table 2 %d, Table 1 %d", (taxable, t2, t1) => {
    expect(graduatedTax(taxable, 2026)).toBeCloseTo(t2, 6);
    expect(graduatedTax(taxable, 2022)).toBeCloseTo(t1, 6);
    // A saved rule's brackets are used as saved — here the TRAIN default brackets,
    // which equal Table 2 value for value, whatever the year.
    expect(savedBracketTax(taxable, DEFAULT_TAX_RULE.brackets)).toBeCloseTo(t2, 6);
  });
});

describe("U10 T2 · each method, as published (centavos)", () => {
  it.each([
    // graduated, default rule, 2026 (Table 2): taxable = gross − deductible
    ["graduated", null, 2026, 250000, 0],
    ["graduated", null, 2026, 250000.01, 0],
    ["graduated", null, 2026, 400000, 22500],
    ["graduated", null, 2026, 8000000.01, 2202500],
    // flat 25%: taxable × 25%
    ["flat", 25, 2026, 250000, 62500],
    ["flat", 25, 2026, 250000.01, 62500],
    ["flat", 25, 2026, 400000, 100000],
    ["flat", 25, 2026, 8000000.01, 2000000],
    // percentage 1%: gross × 1%
    ["percentage", 1, 2026, 250000, 2500],
    ["percentage", 1, 2026, 250000.01, 2500],
    ["percentage", 1, 2026, 400000, 4000],
    ["percentage", 1, 2026, 8000000.01, 80000],
    // simplified8: 8% × (gross − 250,000)
    ["simplified8", 8, 2026, 250000, 0],
    ["simplified8", 8, 2026, 250000.01, 0], // 0.01 × 8% = 0.0008 → ₱0.00
    ["simplified8", 8, 2026, 400000, 12000],
    ["simplified8", 8, 2026, 8000000.01, 620000], // 7,750,000.01 × 8%
  ] as const)("%s (rate %s), %d, gross %d → %d", (method, rate, year, gross, due) => {
    const source = method === "graduated" ? "default" : "saved";
    const r = method === "graduated" ? DEFAULT_TAX_RULE : rule(method, rate);
    expect(incomeTax(r, source, year, gross, 0).due).toBe(due);
  });

  it("a 2022 estimate on the default rule uses TRAIN Table 1", () => {
    // 400,000 taxable: Table 1 → (400,000 − 250,000) × 20% = 30,000 (Table 2 would give 22,500).
    const r = incomeTax(DEFAULT_TAX_RULE, "default", 2022, 400000, 0);
    expect(r.due).toBe(30000);
    expect(r.assumptions.join(" ")).toContain("Graduated TRAIN rates for 2022");
    // The same brackets SAVED as a rule are used as saved: 22,500.
    expect(incomeTax(DEFAULT_TAX_RULE, "saved", 2022, 400000, 0).due).toBe(22500);
  });

  it.each(["graduated", "flat"] as const)(
    "%s floors taxable income at 0 when deductible expenses exceed gross income",
    (method) => {
      const r = method === "graduated" ? DEFAULT_TAX_RULE : rule("flat", 25);
      const out = incomeTax(
        r,
        method === "graduated" ? "default" : "saved",
        2026,
        100000,
        300000,
      );
      expect(out.taxableIncome).toBe(0);
      expect(out.due).toBe(0);
    },
  );

  it("simplified8 floors at 0 below ₱250,000 and states its assumption", () => {
    const out = incomeTax(rule("simplified8", 8), "saved", 2026, 100000, 0);
    expect(out.taxableIncome).toBe(0);
    expect(out.due).toBe(0);
    expect(out.assumptions.join(" ")).toContain(
      "assumes no compensation income; a mixed-income earner gets no ₱250,000 reduction.",
    );
  });

  it.each([5, null, 12])(
    "simplified8 uses the statutory 8%%, whatever rate is saved (%s)",
    (saved) => {
      // 8% × (1,000,000 − 250,000) = 60,000.
      expect(incomeTax(rule("simplified8", saved), "saved", 2026, 1000000, 0).due).toBe(
        60000,
      );
    },
  );

  it("a saved graduated rule with no bracket covering the income gives 0 and says so", () => {
    const out = incomeTax(
      { method: "graduated", flatRate: null, brackets: [] },
      "saved",
      2026,
      500000,
      0,
    );
    expect(out.due).toBe(0);
    expect(out.assumptions).toContain(
      "No saved bracket covers taxable income of ₱500,000, so 0 is used. Check the brackets on this client's Tax Rules.",
    );
  });

  it("flat and percentage with no saved rate use 0% and say so", () => {
    for (const m of ["flat", "percentage"] as const) {
      const out = incomeTax(rule(m, null), "saved", 2026, 500000, 0);
      expect(out.due).toBe(0);
      expect(out.assumptions).toContain("No rate is saved for this rule; 0% is used.");
    }
  });
});

describe("U10 T2 · business tax by regime", () => {
  it("percentage tax: 3% of gross receipts", () => {
    expect(businessTax("PERCENTAGE", "graduated", 250000, 0, 0)).toMatchObject({
      kind: "percentage",
      rate: 3,
      due: 7500,
    });
  });

  it("none under the 8% option, which is in lieu of percentage tax", () => {
    const out = businessTax("PERCENTAGE", "simplified8", 1000000, 0, 0);
    expect(out).toMatchObject({ kind: "percentage", rate: null, due: 0 });
    expect(out.assumptions).toEqual([
      "No percentage tax: the 8% option is in lieu of percentage tax.",
    ]);
  });

  it("VAT: output less input, and a negative figure is excess input VAT", () => {
    expect(businessTax("VAT", "graduated", 0, 60000, 24000).due).toBe(36000);
    const excess = businessTax("VAT", "graduated", 0, 10000, 24000);
    expect(excess.due).toBe(-14000);
    expect(excess.assumptions[0]).toContain("excess input VAT to carry over");
    expect(excess.assumptions).toContain(
      "Output VAT is taken as recorded on each sale; a sale saved without it counts as none.",
    );
  });

  it("exempt (no regime): no business tax", () => {
    expect(businessTax(null, "graduated", 1000000, 0, 0)).toMatchObject({
      kind: "none",
      due: 0,
    });
  });
});
