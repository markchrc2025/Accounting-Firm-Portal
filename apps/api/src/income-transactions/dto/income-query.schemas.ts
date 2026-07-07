import { TransactionSource, VatClass, zIsoDate } from "@portal/shared";
import { z } from "zod";

/** Query-string boolean: exactly "true"/"false" → boolean. */
const zBoolParam = z.enum(["true", "false"]).transform((v) => v === "true");

/** List/filter/sort/paginate query for income transactions. */
export const IncomeListQuerySchema = z.object({
  dateFrom: zIsoDate.optional(),
  dateTo: zIsoDate.optional(),
  categoryId: z.string().uuid().optional(),
  vatClass: VatClass.optional(),
  saleToGovernment: zBoolParam.optional(),
  source: TransactionSource.optional(),
  search: z.string().optional(),
  sortBy: z.enum(["txnDate", "netAmount", "customer"]).default("txnDate"),
  sortDir: z.enum(["asc", "desc"]).default("desc"),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});
export type IncomeListQuery = z.infer<typeof IncomeListQuerySchema>;

/** Period filter for the management summary roll-up. */
export const IncomeSummaryQuerySchema = z.object({
  dateFrom: zIsoDate.optional(),
  dateTo: zIsoDate.optional(),
});
export type IncomeSummaryQuery = z.infer<typeof IncomeSummaryQuerySchema>;
