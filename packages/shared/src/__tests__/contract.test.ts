import { describe, expect, it } from "vitest";
import {
  BirFilingPushback,
  ExpenseImportRow,
  IncomeTransaction,
  InputTaxAssetHandoff,
  PercentageTaxSummaryResponse,
  PurchaseTransaction,
  SalesImportRow,
  VatSummaryResponse,
  birFilingIdempotencyKey,
} from "../index";

describe("integration payloads accept the spec's sample JSON", () => {
  it("vat-summary", () => {
    const sample = {
      client: { id: "cl_123", tin: "471522378", vatRegistered: true },
      period: { year: 2026, quarter: 1, start: "2026-01-01", end: "2026-03-31" },
      sales: {
        vatable: { net: 400000.0, outputVAT: 48000.0 },
        zeroRated: { net: 0.0 },
        exempt: { net: 0.0 },
        governmentSalesMemo: { net: 100000.0, creditableVATWithheld5pct: 5000.0 },
      },
      purchases: {
        domesticPurchases: { net: 300000.0, inputVAT: 36000.0 },
        servicesNonResident: { net: 0.0, inputVAT: 0.0 },
        importationGoods: { net: 0.0, inputVAT: 0.0 },
        othersWithInputTax: { net: 0.0, inputVAT: 0.0 },
        domesticNoInputTax: { net: 0.0 },
        vatExemptImportation: { net: 0.0 },
        capitalGoodsGT1M: {
          items: [
            {
              acquiredOn: "2026-02-10",
              cost: 1500000.0,
              inputVAT: 180000.0,
              usefulLifeMonths: 60,
            },
          ],
        },
      },
      exemptInputTax: { directlyAttributable: 0.0, commonNotDirectlyAttributable: 0.0 },
      otherCredits: { creditableVATWithheld: 5000.0, advanceVATPayments: 0.0 },
    };
    expect(VatSummaryResponse.parse(sample)).toBeTruthy();
  });

  it("percentage-tax-summary", () => {
    const sample = {
      client: { id: "cl_123", tin: "471522378", vatRegistered: false },
      period: { year: 2026, quarter: 1, start: "2026-01-01", end: "2026-03-31" },
      grossReceipts: 500000.0,
      byAtc: [{ atc: "PT010", grossReceipts: 500000.0 }],
    };
    expect(PercentageTaxSummaryResponse.parse(sample)).toBeTruthy();
  });

  it("bir-filings push-back (negative netVATPayable allowed)", () => {
    const sample = {
      form: "2550Q",
      periodType: "quarter",
      periodStart: "2026-01-01",
      periodEnd: "2026-03-31",
      status: "filed",
      figures: {
        outputVAT: 48000.0,
        allowableInputVAT: 60000.0,
        netVATPayable: -12000.0,
        amountPayable: 0.0,
      },
      xmlFilename: "471522378000002550Q2026Q1.xml",
      xmlBase64: "PHhtbC8+",
      pdfUrl: "https://example.test/a4.pdf",
    };
    expect(BirFilingPushback.parse(sample)).toBeTruthy();
  });

  it("input-tax-asset (total must equal the parts)", () => {
    const ok = {
      sourceForm: "2550Q",
      asOfPeriod: { year: 2026, quarter: 1 },
      excessInputTaxCarriedForward: 12000.0,
      deferredCapitalGoodsInputTax: 3000.0,
      totalInputTaxAsset: 15000.0,
      computedAt: "2026-04-20T09:00:00Z",
    };
    expect(InputTaxAssetHandoff.parse(ok)).toBeTruthy();

    const bad = { ...ok, totalInputTaxAsset: 14000.0 };
    expect(() => InputTaxAssetHandoff.parse(bad)).toThrow();
  });
});

describe("domain transaction refinements", () => {
  const base = {
    clientId: "11111111-1111-1111-1111-111111111111",
    txnDate: "2026-03-15",
    description: "x",
    categoryId: "22222222-2222-2222-2222-222222222222",
    netAmount: 1000,
  };

  it("government sale requires the 5% withheld", () => {
    expect(() =>
      IncomeTransaction.parse({
        ...base,
        vatClass: "VATABLE_12",
        saleToGovernment: true,
      }),
    ).toThrow();
    expect(
      IncomeTransaction.parse({
        ...base,
        vatClass: "VATABLE_12",
        saleToGovernment: true,
        creditableVATWithheld5pct: 50,
      }),
    ).toBeTruthy();
  });

  it("capital goods > 1M require cost + useful life", () => {
    expect(() =>
      PurchaseTransaction.parse({
        ...base,
        inputVATCategory: "CAPITAL_GOODS_GT_1M",
      }),
    ).toThrow();
    expect(
      PurchaseTransaction.parse({
        ...base,
        inputVATCategory: "CAPITAL_GOODS_GT_1M",
        capitalGoodAcquisitionCost: 1500000,
        estimatedUsefulLifeMonths: 60,
      }),
    ).toBeTruthy();
  });

  it("applies defaults (source, saleToGovernment, deductible)", () => {
    const inc = IncomeTransaction.parse({ ...base, vatClass: "NON_VAT" });
    expect(inc.source).toBe("manual");
    expect(inc.saleToGovernment).toBe(false);
    const pur = PurchaseTransaction.parse({ ...base });
    expect(pur.deductible).toBe(true);
  });
});

describe("import rows coerce spreadsheet cells", () => {
  it("normalizes Yes/No and lowercase enum values", () => {
    const row = SalesImportRow.parse({
      Date: "2026-03-15",
      Description: "Consulting",
      Category: "Service Revenue",
      NetAmount: "50000.00",
      VatClass: "vatable_12",
      SaleToGovernment: "Yes",
    });
    expect(row.NetAmount).toBe(50000);
    expect(row.VatClass).toBe("VATABLE_12");
    expect(row.SaleToGovernment).toBe(true);
  });

  it("enforces capital-goods conditional on the expense row", () => {
    expect(() =>
      ExpenseImportRow.parse({
        Date: "2026-03-18",
        Description: "Machine",
        Category: "Equipment",
        NetAmount: "1500000",
        InputVATCategory: "capital_goods_gt_1m",
      }),
    ).toThrow();
  });
});

describe("idempotency key", () => {
  it("is stable for client + form + period", () => {
    expect(
      birFilingIdempotencyKey({
        clientId: "cl_1",
        form: "2550Q",
        periodStart: "2026-01-01",
        periodEnd: "2026-03-31",
      }),
    ).toBe("cl_1|2550Q|2026-01-01|2026-03-31");
  });
});
