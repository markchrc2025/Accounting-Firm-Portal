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
import { Prisma } from "@prisma/client";
import type { AuditService } from "../audit/audit.service";
import type { BirFormsService } from "../bir-forms/bir-forms.service";
import type { ClientsService } from "../clients/clients.service";
import type { PrismaService } from "../prisma/prisma.service";
import { DEFAULT_TAX_RULE, type TaxRuleInput } from "../tax-rules/dto/tax-rule.schemas";
import { TaxRulesService } from "../tax-rules/tax-rules.service";
import { TaxEstimateService } from "./tax-estimate.service";
import { PERCENTAGE_RULE_NOTE, businessTax, incomeTax, savedBracketTax } from "./compute";
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
    // a saved "percentage" rule (1%): U10-A1 R1 — graduated TRAIN income tax for the
    // year, the saved 1% unused (Table 2, as the graduated rows above)
    ["percentage", 1, 2026, 250000, 0],
    ["percentage", 1, 2026, 250000.01, 0],
    ["percentage", 1, 2026, 400000, 22500],
    ["percentage", 1, 2026, 8000000.01, 2202500],
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

  it("flat with no saved rate uses 0% and says so", () => {
    const out = incomeTax(rule("flat", null), "saved", 2026, 500000, 0);
    expect(out.due).toBe(0);
    expect(out.assumptions).toContain("No rate is saved for this rule; 0% is used.");
  });

  it.each([1, null, 12])(
    'U10-A1 R1: a saved "percentage" rule (rate %s) gives graduated income tax for the year and says why',
    (saved) => {
      // 2026: taxable 500,000 − 0 → Table 2: 22,500 + 20% × 100,000 = 42,500.
      const y26 = incomeTax(rule("percentage", saved), "saved", 2026, 600000, 100000);
      expect(y26).toMatchObject({ taxableIncome: 500000, due: 42500 });
      expect(y26.assumptions).toContain(PERCENTAGE_RULE_NOTE);
      expect(y26.assumptions).not.toContain(
        "No rate is saved for this rule; 0% is used.",
      );
      // 2022: the same 500,000 on Table 1: 30,000 + 25% × 100,000 = 55,000.
      expect(
        incomeTax(rule("percentage", saved), "saved", 2022, 600000, 100000).due,
      ).toBe(55000);
    },
  );
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

describe("U10-A1 T2 · one read of the rule decides both the label and the brackets", () => {
  const user = {
    id: "u1",
    firmId: "f1",
    userType: "FIRM" as const,
    email: "u@example.com",
  };
  const savedRow = {
    id: "r1",
    clientId: "c1",
    method: "graduated",
    flatRate: null,
    // A saved schedule unlike TRAIN: 10% on everything over 0.
    bracketsJson: [{ over: 0, notOver: null, baseTax: 0, rate: 10 }],
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  it("getWithSource reads once: a rule deleted after that read is still labelled and used as saved", async () => {
    // The first read finds the saved rule; any later read would find none.
    const findUnique = jest.fn().mockResolvedValueOnce(savedRow).mockResolvedValue(null);
    const service = new TaxRulesService(
      { taxRule: { findUnique } } as unknown as PrismaService,
      {
        assertInFirm: jest.fn().mockResolvedValue(undefined),
      } as unknown as ClientsService,
      {} as AuditService,
    );
    const { rule, saved } = await service.getWithSource(user, "c1");
    expect(findUnique).toHaveBeenCalledTimes(1);
    expect(saved).toBe(true);
    expect(rule.brackets).toEqual([{ over: 0, notOver: null, baseTax: 0, rate: 10 }]);
  });

  it("the estimate takes the rule and its label from that one read, and reads no rule itself", async () => {
    const getWithSource = jest.fn().mockResolvedValue({
      rule: { method: "graduated", flatRate: null, brackets: savedRow.bracketsJson },
      saved: true,
    });
    const agg = (sum: Record<string, number>) => ({
      _sum: Object.fromEntries(
        Object.entries(sum).map(([k, v]) => [k, new Prisma.Decimal(v)]),
      ),
    });
    // No `taxRule` here: a second read of the rule would throw.
    const prisma = {
      client: {
        findFirst: jest
          .fn()
          .mockResolvedValue({ id: "c1", businessName: "Invented Co", taxType: null }),
      },
      $transaction: jest.fn(async (ops: unknown[]) => Promise.all(ops)),
      incomeTransaction: {
        aggregate: jest.fn().mockResolvedValue(agg({ netAmount: 500000, outputVAT: 0 })),
      },
      purchaseTransaction: {
        aggregate: jest.fn().mockResolvedValue(agg({ inputVAT: 0, netAmount: 0 })),
      },
    } as unknown as PrismaService;
    const estimates = new TaxEstimateService(
      prisma,
      { getWithSource } as unknown as TaxRulesService,
      { filedForClient: jest.fn().mockResolvedValue([]) } as unknown as BirFormsService,
    );
    const out = await estimates.estimate(user, "c1", { year: 2026 });
    expect(getWithSource).toHaveBeenCalledTimes(1);
    expect(out.method).toMatchObject({ name: "graduated", source: "saved" });
    // The saved 10% schedule, not TRAIN: 500,000 × 10% = 50,000 (TRAIN would give 42,500).
    expect(out.incomeTax.due).toBe(50000);
  });
});
