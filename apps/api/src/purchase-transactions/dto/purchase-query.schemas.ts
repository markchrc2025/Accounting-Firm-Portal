import {
  InputTaxAttribution,
  InputVATCategory,
  TransactionSource,
  zIsoDate,
} from "@portal/shared";
import { z } from "zod";

const zBoolParam = z.enum(["true", "false"]).transform((v) => v === "true");

/** List/filter/sort/paginate query for purchase transactions. */
export const PurchaseListQuerySchema = z.object({
  dateFrom: zIsoDate.optional(),
  dateTo: zIsoDate.optional(),
  categoryId: z.string().uuid().optional(),
  inputVATCategory: InputVATCategory.optional(),
  inputTaxAttribution: InputTaxAttribution.optional(),
  isCapitalGood: zBoolParam.optional(),
  deductible: zBoolParam.optional(),
  source: TransactionSource.optional(),
  search: z.string().optional(),
  sortBy: z.enum(["txnDate", "netAmount", "vendor"]).default("txnDate"),
  sortDir: z.enum(["asc", "desc"]).default("desc"),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});
export type PurchaseListQuery = z.infer<typeof PurchaseListQuerySchema>;

export const PurchaseSummaryQuerySchema = z.object({
  dateFrom: zIsoDate.optional(),
  dateTo: zIsoDate.optional(),
});
export type PurchaseSummaryQuery = z.infer<typeof PurchaseSummaryQuerySchema>;
