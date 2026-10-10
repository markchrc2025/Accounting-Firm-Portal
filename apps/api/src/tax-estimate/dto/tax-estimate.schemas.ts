import { z } from "zod";

/**
 * GET /clients/:clientId/tax-estimate?year=YYYY[&quarter=1-4] (U10 R1). No year
 * means the current Manila year. The query arrives as strings; both coerce.
 */
export const TaxEstimateQuerySchema = z.object({
  year: z.coerce.number().int().min(2018).max(2100).optional(),
  quarter: z.coerce.number().int().min(1).max(4).optional(),
});
export type TaxEstimateQuery = z.infer<typeof TaxEstimateQuerySchema>;
