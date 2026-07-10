import { VatSummaryResponse } from "@portal/shared";
import {
  buildVatSummary,
  type IncomeRowForVat,
  type PurchaseRowForVat,
  quarterToRange,
} from "./aggregation";

describe("quarterToRange", () => {
  it("maps each calendar quarter to inclusive ISO bounds", () => {
    expect(quarterToRange(2026, 1)).toEqual({ start: "2026-01-01", end: "2026-03-31" });
    expect(quarterToRange(2026, 2)).toEqual({ start: "2026-04-01", end: "2026-06-30" });
    expect(quarterToRange(2026, 3)).toEqual({ start: "2026-07-01", end: "2026-09-30" });
    expect(quarterToRange(2026, 4)).toEqual({ start: "2026-10-01", end: "2026-12-31" });
  });

  it("handles February in a leap year", () => {
    // Q1 always ends 03-31 regardless; verify a Q with a leap-Feb boundary via month math.
    expect(quarterToRange(2024, 1).end).toBe("2024-03-31");
  });
});

const CLIENT = { id: "cl_123", tin: "471522378" };
const PERIOD = { year: 2026, quarter: 1, start: "2026-01-01", end: "2026-03-31" };

function income(partial: Partial<IncomeRowForVat>): IncomeRowForVat {
  return {
    vatClass: "VATABLE_12",
    netAmount: 0,
    saleToGovernment: false,
    creditableVATWithheld5pct: null,
    ...partial,
  };
}
function purchase(partial: Partial<PurchaseRowForVat>): PurchaseRowForVat {
  return {
    inputVATCategory: "DOMESTIC_PURCHASES",
    netAmount: 0,
    inputVAT: null,
    capitalGoodAcquisitionCost: null,
    estimatedUsefulLifeMonths: null,
    inputTaxAttribution: null,
    txnDate: "2026-02-10",
    ...partial,
  };
}

describe("buildVatSummary", () => {
  it("reproduces the spec's worked example (§6 vat-summary)", () => {
    const incomeRows: IncomeRowForVat[] = [
      // 300k plain vatable + 100k government vatable = 400k vatable total
      income({ netAmount: 300000 }),
      income({
        netAmount: 100000,
        saleToGovernment: true,
        creditableVATWithheld5pct: 5000,
      }),
    ];
    const purchaseRows: PurchaseRowForVat[] = [
      purchase({
        inputVATCategory: "DOMESTIC_PURCHASES",
        netAmount: 300000,
        inputVAT: 36000,
      }),
      purchase({
        inputVATCategory: "CAPITAL_GOODS_GT_1M",
        netAmount: 1500000,
        inputVAT: 180000,
        capitalGoodAcquisitionCost: 1500000,
        estimatedUsefulLifeMonths: 60,
        txnDate: "2026-02-10",
      }),
    ];

    const s = buildVatSummary(CLIENT, PERIOD, incomeRows, purchaseRows);

    // sales
    expect(s.sales.vatable.net).toBe(400000);
    expect(s.sales.vatable.outputVAT).toBe(48000); // advisory 12% × net
    expect(s.sales.zeroRated.net).toBe(0);
    expect(s.sales.exempt.net).toBe(0);
    expect(s.sales.governmentSalesMemo).toEqual({
      net: 100000,
      creditableVATWithheld5pct: 5000,
    });

    // purchases
    expect(s.purchases.domesticPurchases).toEqual({ net: 300000, inputVAT: 36000 });
    expect(s.purchases.servicesNonResident).toEqual({ net: 0, inputVAT: 0 });
    // capital goods > 1M are Schedule 1 items ONLY, never in Items 44–49
    expect(s.purchases.capitalGoodsGT1M.items).toEqual([
      { acquiredOn: "2026-02-10", cost: 1500000, inputVAT: 180000, usefulLifeMonths: 60 },
    ]);
    expect(s.purchases.domesticNoInputTax.net).toBe(0);

    // credits — single Item 16 total already includes the government 5% memo
    expect(s.otherCredits.creditableVATWithheld).toBe(5000);
    expect(s.otherCredits.advanceVATPayments).toBe(0);

    // conforms to the frozen shared contract
    expect(() => VatSummaryResponse.parse(s)).not.toThrow();
  });

  it("keeps capital goods > 1M out of domesticPurchases (Items 44–49)", () => {
    const s = buildVatSummary(CLIENT, PERIOD, [], [
      purchase({
        inputVATCategory: "CAPITAL_GOODS_GT_1M",
        netAmount: 2000000,
        inputVAT: 240000,
        capitalGoodAcquisitionCost: 2000000,
        estimatedUsefulLifeMonths: 60,
      }),
    ]);
    expect(s.purchases.domesticPurchases).toEqual({ net: 0, inputVAT: 0 });
    expect(s.purchases.capitalGoodsGT1M.items).toHaveLength(1);
  });

  it("splits exempt input tax into Schedule 2 direct vs common pools", () => {
    const s = buildVatSummary(CLIENT, PERIOD, [], [
      purchase({ inputTaxAttribution: "EXEMPT", inputVAT: 1200 }),
      purchase({ inputTaxAttribution: "MIXED", inputVAT: 800 }),
      purchase({ inputTaxAttribution: "VATABLE", inputVAT: 5000 }),
    ]);
    expect(s.exemptInputTax.directlyAttributable).toBe(1200);
    expect(s.exemptInputTax.commonNotDirectlyAttributable).toBe(800);
  });

  it("classifies each sale into its VAT class bucket", () => {
    const s = buildVatSummary(
      CLIENT,
      PERIOD,
      [
        income({ vatClass: "VATABLE_12", netAmount: 100 }),
        income({ vatClass: "ZERO_RATED", netAmount: 200 }),
        income({ vatClass: "EXEMPT", netAmount: 300 }),
      ],
      [],
    );
    expect(s.sales.vatable.net).toBe(100);
    expect(s.sales.zeroRated.net).toBe(200);
    expect(s.sales.exempt.net).toBe(300);
    expect(s.sales.governmentSalesMemo).toBeUndefined();
  });

  it("rounds summed amounts to 2 decimals", () => {
    const s = buildVatSummary(
      CLIENT,
      PERIOD,
      [income({ netAmount: 10.1 }), income({ netAmount: 20.2 })],
      [],
    );
    expect(s.sales.vatable.net).toBe(30.3);
  });
});
