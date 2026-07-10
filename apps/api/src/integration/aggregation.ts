import { round2, type VatSummaryResponse } from "@portal/shared";

/**
 * Pure aggregation of classified transactions into the 2550Q `vat-summary` shape
 * (bir-integration-spec §6 / @portal/shared VatSummaryResponse). Kept free of
 * NestJS/Prisma so it is trivially unit-testable — the service converts Prisma
 * rows (Decimal → number, Date → ISO) and calls in here.
 *
 * Guardrails honoured:
 *  - amounts are NET OF VAT; VAT is carried separately (guardrail #3);
 *  - `outputVAT` is advisory (12% × net) — the Generator derives the filed figure;
 *  - capital goods > ₱1M are Schedule 1 items ONLY, never rolled into Items 44–49;
 *  - `creditableVATWithheld` is a single Item 16 total that already includes the
 *    government 5% memo (no double count).
 */

export interface IncomeRowForVat {
  vatClass: string;
  netAmount: number;
  saleToGovernment: boolean;
  creditableVATWithheld5pct: number | null;
}

export interface PurchaseRowForVat {
  inputVATCategory: string | null;
  netAmount: number;
  inputVAT: number | null;
  capitalGoodAcquisitionCost: number | null;
  estimatedUsefulLifeMonths: number | null;
  inputTaxAttribution: string | null;
  txnDate: string; // ISO yyyy-mm-dd
}

export interface VatSummaryPeriod {
  year: number;
  quarter: number;
  start: string;
  end: string;
}

export interface VatSummaryClient {
  id: string;
  tin: string;
}

/** Inclusive calendar-quarter date range as ISO yyyy-mm-dd strings. */
export function quarterToRange(
  year: number,
  quarter: number,
): { start: string; end: string } {
  const startMonth = (quarter - 1) * 3 + 1; // 1,4,7,10
  const endMonth = startMonth + 2; // 3,6,9,12
  const lastDay = new Date(Date.UTC(year, endMonth, 0)).getUTCDate();
  const pad = (n: number) => String(n).padStart(2, "0");
  return {
    start: `${year}-${pad(startMonth)}-01`,
    end: `${year}-${pad(endMonth)}-${pad(lastDay)}`,
  };
}

const sum = (xs: number[]): number => round2(xs.reduce((a, b) => a + b, 0));

export function buildVatSummary(
  client: VatSummaryClient,
  period: VatSummaryPeriod,
  income: IncomeRowForVat[],
  purchases: PurchaseRowForVat[],
): VatSummaryResponse {
  const byVatClass = (cls: string) => income.filter((r) => r.vatClass === cls);
  const byInputCat = (cat: string) =>
    purchases.filter((r) => r.inputVATCategory === cat);
  const byAttribution = (attr: string) =>
    purchases.filter((r) => r.inputTaxAttribution === attr);

  const vatableNet = sum(byVatClass("VATABLE_12").map((r) => r.netAmount));
  const governmentRows = byVatClass("VATABLE_12").filter(
    (r) => r.saleToGovernment,
  );
  const governmentNet = sum(governmentRows.map((r) => r.netAmount));
  const governmentWithheld = sum(
    governmentRows.map((r) => r.creditableVATWithheld5pct ?? 0),
  );

  const inputCat = (cat: string) => ({
    net: sum(byInputCat(cat).map((r) => r.netAmount)),
    inputVAT: sum(byInputCat(cat).map((r) => r.inputVAT ?? 0)),
  });

  const summary: VatSummaryResponse = {
    client: { id: client.id, tin: client.tin, vatRegistered: true },
    period: {
      year: period.year,
      quarter: period.quarter,
      start: period.start,
      end: period.end,
    },
    sales: {
      // Item 31 — vatable (includes government sales); outputVAT advisory (12% × net).
      vatable: { net: vatableNet, outputVAT: round2(vatableNet * 0.12) },
      zeroRated: { net: sum(byVatClass("ZERO_RATED").map((r) => r.netAmount)) }, // Item 32
      exempt: { net: sum(byVatClass("EXEMPT").map((r) => r.netAmount)) }, // Item 33
      // Government sales memo (subset of vatable) → drives Item 16.
      ...(governmentRows.length > 0
        ? {
            governmentSalesMemo: {
              net: governmentNet,
              creditableVATWithheld5pct: governmentWithheld,
            },
          }
        : {}),
    },
    purchases: {
      domesticPurchases: inputCat("DOMESTIC_PURCHASES"), // Item 44
      servicesNonResident: inputCat("SERVICES_NONRESIDENT"), // Item 45
      importationGoods: inputCat("IMPORTATION_GOODS"), // Item 46
      othersWithInputTax: inputCat("OTHERS_WITH_INPUT_TAX"), // Item 47
      domesticNoInputTax: {
        net: sum(byInputCat("DOMESTIC_NO_INPUT_TAX").map((r) => r.netAmount)),
      }, // Item 48
      vatExemptImportation: {
        net: sum(byInputCat("VAT_EXEMPT_IMPORTATION").map((r) => r.netAmount)),
      }, // Item 49
      capitalGoodsGT1M: {
        // Schedule 1 only — raw acquisition items, never Items 44–49.
        items: byInputCat("CAPITAL_GOODS_GT_1M").map((r) => ({
          acquiredOn: r.txnDate,
          cost: round2(r.capitalGoodAcquisitionCost ?? 0),
          inputVAT: round2(r.inputVAT ?? 0),
          usefulLifeMonths: r.estimatedUsefulLifeMonths ?? 0,
        })),
      },
    },
    exemptInputTax: {
      // Schedule 2 — returned un-apportioned; the Generator computes the ratable share.
      directlyAttributable: sum(byAttribution("EXEMPT").map((r) => r.inputVAT ?? 0)),
      commonNotDirectlyAttributable: sum(
        byAttribution("MIXED").map((r) => r.inputVAT ?? 0),
      ),
    },
    otherCredits: {
      // Item 16 total — already includes the government 5% memo (no double count).
      creditableVATWithheld: sum(
        income.map((r) => r.creditableVATWithheld5pct ?? 0),
      ),
      advanceVATPayments: 0, // Item 17 — not tracked by the Portal
    },
  };

  return summary;
}
