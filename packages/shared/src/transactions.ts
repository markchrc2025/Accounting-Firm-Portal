import { z } from "zod";
import {
  InputTaxAttribution,
  InputVATCategory,
  TransactionSource,
  VatClass,
} from "./enums";
import { zIsoDate, zMoney } from "./money";

/**
 * IncomeTransaction — the Portal's `SalesRecord` extended with BIR tax classification.
 *
 * - `netAmount` is NET OF VAT.
 * - `vatClass` is always present; percentage-tax (non-VAT) clients use `NON_VAT`.
 * - `outputVAT` is advisory — the Generator derives Item 31B as 12% × net.
 * - Regime coupling (a VAT client uses a real vatClass; a percentage client uses NON_VAT)
 *   is enforced at the service layer using the client's VAT-registration flag.
 */
export const IncomeTransaction = z
  .object({
    id: z.string().uuid().optional(),
    clientId: z.string().uuid(),
    txnDate: zIsoDate,
    referenceNo: z.string().optional(),
    customer: z.string().optional(),
    description: z.string().min(1),
    categoryId: z.string().uuid(),
    netAmount: zMoney,
    vatClass: VatClass,
    saleToGovernment: z.boolean().default(false),
    outputVAT: zMoney.optional(),
    creditableVATWithheld5pct: zMoney.optional(),
    atc: z.string().optional(),
    source: TransactionSource.default("manual"),
  })
  .superRefine((v, ctx) => {
    if (v.saleToGovernment && v.creditableVATWithheld5pct === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["creditableVATWithheld5pct"],
        message:
          "Government sales must include creditableVATWithheld5pct (the 5% VAT withheld).",
      });
    }
  });
export type IncomeTransaction = z.infer<typeof IncomeTransaction>;

/**
 * PurchaseTransaction — the Portal's `ExpenseRecord` extended with input-VAT classification.
 *
 * - `netAmount` is NET OF VAT.
 * - `inputVATCategory` applies to VAT clients; enforce its presence at the service layer
 *   using the client's VAT-registration flag.
 * - Capital goods > ₱1M (`CAPITAL_GOODS_GT_1M`) require an acquisition cost and useful
 *   life; the Generator owns the Schedule-1 amortization math.
 */
export const PurchaseTransaction = z
  .object({
    id: z.string().uuid().optional(),
    clientId: z.string().uuid(),
    txnDate: zIsoDate,
    referenceNo: z.string().optional(),
    vendor: z.string().optional(),
    description: z.string().min(1),
    categoryId: z.string().uuid(),
    netAmount: zMoney,
    inputVATCategory: InputVATCategory.optional(),
    inputVAT: zMoney.optional(),
    isCapitalGood: z.boolean().default(false),
    capitalGoodAcquisitionCost: zMoney.optional(),
    estimatedUsefulLifeMonths: z.number().int().positive().optional(),
    inputTaxAttribution: InputTaxAttribution.optional(),
    deductible: z.boolean().default(true),
    source: TransactionSource.default("manual"),
  })
  .superRefine((v, ctx) => {
    if (v.inputVATCategory === "CAPITAL_GOODS_GT_1M") {
      if (v.capitalGoodAcquisitionCost === undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["capitalGoodAcquisitionCost"],
          message: "CAPITAL_GOODS_GT_1M requires capitalGoodAcquisitionCost.",
        });
      }
      if (v.estimatedUsefulLifeMonths === undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["estimatedUsefulLifeMonths"],
          message: "CAPITAL_GOODS_GT_1M requires estimatedUsefulLifeMonths.",
        });
      }
    }
  });
export type PurchaseTransaction = z.infer<typeof PurchaseTransaction>;
