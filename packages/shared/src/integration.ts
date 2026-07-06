import { z } from "zod";
import { FilingStatus, FormCode, PeriodType } from "./enums";
import { round2, zIsoDate, zMoney, zSignedMoney } from "./money";

/**
 * ============================================================================
 * INTEGRATION PAYLOADS (Portal ⇄ BIR Form Generator)
 * ----------------------------------------------------------------------------
 * These mirror bir-integration-spec.md §6–7 exactly. Amounts are NET OF VAT.
 * ============================================================================
 */

const QuarterPeriod = z.object({
  year: z.number().int(),
  quarter: z.number().int().min(1).max(4),
  start: zIsoDate,
  end: zIsoDate,
});

// ---------------------------------------------------------------------------
// Portal → Generator (read)
// ---------------------------------------------------------------------------

/** `GET /clients/{id}/vat-summary` — the 2550Q roll-up of classified transactions. */
export const VatSummaryResponse = z.object({
  client: z.object({
    id: z.string(),
    tin: z.string(),
    vatRegistered: z.literal(true),
  }),
  period: QuarterPeriod,
  sales: z.object({
    vatable: z.object({ net: zMoney, outputVAT: zMoney.optional() }), // Item 31 (outputVAT advisory)
    zeroRated: z.object({ net: zMoney }), // Item 32
    exempt: z.object({ net: zMoney }), // Item 33
    governmentSalesMemo: z
      .object({ net: zMoney, creditableVATWithheld5pct: zMoney })
      .optional(), // subset of vatable → Item 16
  }),
  purchases: z.object({
    domesticPurchases: z.object({ net: zMoney, inputVAT: zMoney }), // Item 44
    servicesNonResident: z.object({ net: zMoney, inputVAT: zMoney }), // Item 45
    importationGoods: z.object({ net: zMoney, inputVAT: zMoney }), // Item 46
    othersWithInputTax: z.object({ net: zMoney, inputVAT: zMoney }), // Item 47
    domesticNoInputTax: z.object({ net: zMoney }), // Item 48 (amount only)
    vatExemptImportation: z.object({ net: zMoney }), // Item 49 (amount only)
    capitalGoodsGT1M: z.object({
      // Schedule 1 ONLY — never rolled into Items 44–49
      items: z.array(
        z.object({
          acquiredOn: zIsoDate,
          cost: zMoney,
          inputVAT: zMoney,
          usefulLifeMonths: z.number().int().positive(),
        }),
      ),
    }),
  }),
  exemptInputTax: z.object({
    directlyAttributable: zMoney, // Schedule 2 (direct)
    commonNotDirectlyAttributable: zMoney, // Schedule 2 (common pool; Generator apportions)
  }),
  otherCredits: z.object({
    creditableVATWithheld: zMoney, // Item 16 TOTAL (already includes the government 5% memo)
    advanceVATPayments: zMoney, // Item 17
  }),
});
export type VatSummaryResponse = z.infer<typeof VatSummaryResponse>;

/** `GET /clients/{id}/percentage-tax-summary` — 2551Q gross receipts (amounts only). */
export const PercentageTaxSummaryResponse = z.object({
  client: z.object({
    id: z.string(),
    tin: z.string(),
    vatRegistered: z.literal(false),
  }),
  period: QuarterPeriod,
  grossReceipts: zMoney,
  // Optional — the ATC is authoritative on the Generator's taxpayer profile and the rate
  // is resolved by the Generator's period-keyed catalog. Populate only for multiple streams.
  byAtc: z.array(z.object({ atc: z.string(), grossReceipts: zMoney })).optional(),
});
export type PercentageTaxSummaryResponse = z.infer<
  typeof PercentageTaxSummaryResponse
>;

/** `GET /clients/{id}/tax-computations` — income-tax summary figures (the Portal estimate). */
export const TaxComputationSummary = z.object({
  clientId: z.string().uuid().optional(),
  periodType: PeriodType,
  periodStart: zIsoDate,
  periodEnd: zIsoDate,
  grossIncome: zMoney,
  totalDeductions: zMoney,
  taxableIncome: zMoney,
  grossTaxDue: zMoney,
  taxCredits: zMoney,
  netTaxPayable: zSignedMoney,
});
export type TaxComputationSummary = z.infer<typeof TaxComputationSummary>;

// ---------------------------------------------------------------------------
// Generator → Portal (write, idempotent by client + form + period)
// ---------------------------------------------------------------------------

/** `POST /clients/{id}/bir-filings` — the finished BIR filing artifact. */
export const BirFilingPushback = z.object({
  form: FormCode,
  periodType: PeriodType,
  periodStart: zIsoDate,
  periodEnd: zIsoDate,
  status: FilingStatus,
  figures: z.record(zSignedMoney), // per-form key figures (may be negative, e.g. netVATPayable)
  xmlFilename: z.string().min(1),
  xmlBase64: z.string().min(1),
  pdfUrl: z.string().optional(),
});
export type BirFilingPushback = z.infer<typeof BirFilingPushback>;

/** `POST /clients/{id}/input-tax-asset` — the carried-forward input VAT to book as an asset. */
export const InputTaxAssetHandoff = z
  .object({
    sourceForm: FormCode,
    asOfPeriod: z.object({
      year: z.number().int(),
      quarter: z.number().int().min(1).max(4),
    }),
    excessInputTaxCarriedForward: zMoney,
    deferredCapitalGoodsInputTax: zMoney,
    totalInputTaxAsset: zMoney,
    computedAt: z.string().datetime(),
  })
  .superRefine((v, ctx) => {
    const sum = round2(
      v.excessInputTaxCarriedForward + v.deferredCapitalGoodsInputTax,
    );
    if (round2(v.totalInputTaxAsset) !== sum) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["totalInputTaxAsset"],
        message:
          "totalInputTaxAsset must equal excessInputTaxCarriedForward + deferredCapitalGoodsInputTax.",
      });
    }
  });
export type InputTaxAssetHandoff = z.infer<typeof InputTaxAssetHandoff>;

/**
 * The idempotency key for push-back. The Portal upserts a BIRFiling by this key so a
 * re-send updates the existing record rather than duplicating it.
 */
export function birFilingIdempotencyKey(input: {
  clientId: string;
  form: FormCode | string;
  periodStart: string;
  periodEnd: string;
}): string {
  return [input.clientId, input.form, input.periodStart, input.periodEnd].join(
    "|",
  );
}
