import { z } from "zod";

/**
 * Per-client income-tax computation configuration. This is a Portal-internal,
 * per-client entity (a MANAGEMENT ESTIMATE — guardrail #1: the Portal never
 * computes authoritative BIR tax), so its validation lives here rather than in
 * @portal/shared.
 *
 * `method` selects the regime; `brackets` is the graduated schedule; `flatRate`
 * is the single rate % used by the non-graduated methods (null for graduated).
 */
export const TaxMethod = z.enum(["graduated", "flat", "percentage", "simplified8"]);
export type TaxMethod = z.infer<typeof TaxMethod>;

/** One row of a graduated schedule. `notOver: null` = the open-ended top band. */
export const TaxBracketSchema = z.object({
  over: z.number(),
  notOver: z.number().nullable(),
  baseTax: z.number(),
  rate: z.number(),
});
export type TaxBracket = z.infer<typeof TaxBracketSchema>;

/** PUT body: the full rule to upsert for a client. */
export const TaxRuleSchema = z.object({
  method: TaxMethod,
  flatRate: z.number().nullable(),
  brackets: z.array(TaxBracketSchema),
});
export type TaxRuleInput = z.infer<typeof TaxRuleSchema>;

/** The default TRAIN graduated schedule served when a client has no rule yet. */
export const TRAIN_DEFAULT_BRACKETS: TaxBracket[] = [
  { over: 0, notOver: 250000, baseTax: 0, rate: 0 },
  { over: 250000, notOver: 400000, baseTax: 0, rate: 15 },
  { over: 400000, notOver: 800000, baseTax: 22500, rate: 20 },
  { over: 800000, notOver: 2000000, baseTax: 102500, rate: 25 },
  { over: 2000000, notOver: 8000000, baseTax: 402500, rate: 30 },
  { over: 8000000, notOver: null, baseTax: 2202500, rate: 35 },
];

/** The default rule (graduated, TRAIN schedule) — not persisted until configured. */
export const DEFAULT_TAX_RULE: TaxRuleInput = {
  method: "graduated",
  flatRate: null,
  brackets: TRAIN_DEFAULT_BRACKETS,
};
