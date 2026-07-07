import { BadRequestException } from "@nestjs/common";
import type { IncomeTransaction, PurchaseTransaction } from "@portal/shared";
import { RegimeValidator } from "./regime-validator";

const v = new RegimeValidator();

function income(overrides: Partial<IncomeTransaction> = {}): IncomeTransaction {
  return {
    clientId: "11111111-1111-1111-1111-111111111111",
    txnDate: "2026-01-15",
    description: "Sale",
    categoryId: "22222222-2222-2222-2222-222222222222",
    netAmount: 1000,
    vatClass: "VATABLE_12",
    saleToGovernment: false,
    source: "manual",
    ...overrides,
  };
}

function purchase(overrides: Partial<PurchaseTransaction> = {}): PurchaseTransaction {
  return {
    clientId: "11111111-1111-1111-1111-111111111111",
    txnDate: "2026-01-15",
    description: "Purchase",
    categoryId: "22222222-2222-2222-2222-222222222222",
    netAmount: 1000,
    isCapitalGood: false,
    deductible: true,
    source: "manual",
    ...overrides,
  };
}

describe("RegimeValidator.requireRegime", () => {
  it("accepts VAT and PERCENTAGE", () => {
    expect(v.requireRegime("VAT")).toBe("VAT");
    expect(v.requireRegime("PERCENTAGE")).toBe("PERCENTAGE");
  });
  it("rejects an unset or unknown regime", () => {
    expect(() => v.requireRegime(null)).toThrow(BadRequestException);
    expect(() => v.requireRegime(undefined)).toThrow(BadRequestException);
    expect(() => v.requireRegime("VATABLE")).toThrow(BadRequestException);
  });
});

describe("RegimeValidator.validateIncome — VAT client", () => {
  it("accepts a VATABLE_12 sale", () => {
    expect(() => v.validateIncome("VAT", income())).not.toThrow();
  });
  it("rejects NON_VAT (reserved for percentage clients)", () => {
    expect(() => v.validateIncome("VAT", income({ vatClass: "NON_VAT" }))).toThrow(
      BadRequestException,
    );
  });
  it("requires a government sale to be VATABLE_12", () => {
    expect(() =>
      v.validateIncome(
        "VAT",
        income({
          vatClass: "ZERO_RATED",
          saleToGovernment: true,
          creditableVATWithheld5pct: 50,
        }),
      ),
    ).toThrow(BadRequestException);
    expect(() =>
      v.validateIncome(
        "VAT",
        income({ saleToGovernment: true, creditableVATWithheld5pct: 50 }),
      ),
    ).not.toThrow();
  });
  it("forbids creditableVATWithheld5pct without a government sale", () => {
    expect(() =>
      v.validateIncome("VAT", income({ creditableVATWithheld5pct: 50 })),
    ).toThrow(BadRequestException);
  });
  it("forbids output VAT on zero-rated / exempt sales", () => {
    expect(() =>
      v.validateIncome("VAT", income({ vatClass: "ZERO_RATED", outputVAT: 10 })),
    ).toThrow(BadRequestException);
    expect(() =>
      v.validateIncome("VAT", income({ vatClass: "EXEMPT", outputVAT: 0 })),
    ).not.toThrow();
  });
});

describe("RegimeValidator.validateIncome — percentage client", () => {
  it("requires NON_VAT", () => {
    expect(() =>
      v.validateIncome("PERCENTAGE", income({ vatClass: "NON_VAT" })),
    ).not.toThrow();
    expect(() =>
      v.validateIncome("PERCENTAGE", income({ vatClass: "VATABLE_12" })),
    ).toThrow(BadRequestException);
  });
  it("forbids government-sale withholding and output VAT", () => {
    expect(() =>
      v.validateIncome(
        "PERCENTAGE",
        income({ vatClass: "NON_VAT", saleToGovernment: true }),
      ),
    ).toThrow(BadRequestException);
    expect(() =>
      v.validateIncome(
        "PERCENTAGE",
        income({ vatClass: "NON_VAT", creditableVATWithheld5pct: 5 }),
      ),
    ).toThrow(BadRequestException);
    expect(() =>
      v.validateIncome("PERCENTAGE", income({ vatClass: "NON_VAT", outputVAT: 5 })),
    ).toThrow(BadRequestException);
  });
});

describe("RegimeValidator.validatePurchase — VAT client", () => {
  it("requires an input-VAT category", () => {
    expect(() =>
      v.validatePurchase("VAT", purchase({ inputVATCategory: "DOMESTIC_PURCHASES" })),
    ).not.toThrow();
    expect(() => v.validatePurchase("VAT", purchase())).toThrow(BadRequestException);
  });
  it("forbids input VAT on amount-only categories", () => {
    expect(() =>
      v.validatePurchase(
        "VAT",
        purchase({ inputVATCategory: "DOMESTIC_NO_INPUT_TAX", inputVAT: 120 }),
      ),
    ).toThrow(BadRequestException);
    expect(() =>
      v.validatePurchase("VAT", purchase({ inputVATCategory: "VAT_EXEMPT_IMPORTATION" })),
    ).not.toThrow();
  });
  it("requires isCapitalGood for a CAPITAL_GOODS_GT_1M purchase", () => {
    expect(() =>
      v.validatePurchase(
        "VAT",
        purchase({
          inputVATCategory: "CAPITAL_GOODS_GT_1M",
          isCapitalGood: false,
          capitalGoodAcquisitionCost: 1_500_000,
          estimatedUsefulLifeMonths: 60,
        }),
      ),
    ).toThrow(BadRequestException);
    expect(() =>
      v.validatePurchase(
        "VAT",
        purchase({
          inputVATCategory: "CAPITAL_GOODS_GT_1M",
          isCapitalGood: true,
          capitalGoodAcquisitionCost: 1_500_000,
          estimatedUsefulLifeMonths: 60,
        }),
      ),
    ).not.toThrow();
  });
});

describe("RegimeValidator.validatePurchase — percentage client", () => {
  it("forbids any input-VAT classification", () => {
    expect(() => v.validatePurchase("PERCENTAGE", purchase())).not.toThrow();
    expect(() =>
      v.validatePurchase(
        "PERCENTAGE",
        purchase({ inputVATCategory: "DOMESTIC_PURCHASES" }),
      ),
    ).toThrow(BadRequestException);
    expect(() => v.validatePurchase("PERCENTAGE", purchase({ inputVAT: 100 }))).toThrow(
      BadRequestException,
    );
    expect(() =>
      v.validatePurchase("PERCENTAGE", purchase({ inputTaxAttribution: "VATABLE" })),
    ).toThrow(BadRequestException);
  });
});
