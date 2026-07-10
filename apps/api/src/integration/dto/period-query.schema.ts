import { z } from "zod";

/** `?year=2026&quarter=1` for the quarterly aggregation endpoints. */
export const QuarterQuerySchema = z.object({
  year: z.coerce.number().int().min(2000).max(2100),
  quarter: z.coerce.number().int().min(1).max(4),
});
export type QuarterQuery = z.infer<typeof QuarterQuerySchema>;
