/**
 * prices.ts — the one price table the AI receipt reader uses (U11 R5, R9), in US$
 * per million tokens, at standard rates; Message Batches are billed at half of
 * these (BATCH_DISCOUNT), and the discount stacks with prompt caching.
 *
 * Source: https://platform.claude.com/docs/en/about-claude/pricing (read 2026-10-10)
 *   claude-sonnet-5-5: input $2, 5-minute cache write $2.50, 1-hour cache write $4,
 *     cache read $0.10, output $10 (no long-context premium).
 *   claude-haiku-5-5 (prompts up to 100k tokens): input $0.10, cache writes $0.125 /
 *     $0.20, cache read $0.01, output $0.50. A receipt request is far below 100k
 *     tokens (one image of at most 4,784 tokens, or a PDF of at most 5 pages, plus
 *     the instructions), so the over-100k rates never apply here.
 * Batch discount: https://platform.claude.com/docs/en/build-with-claude/batch-processing
 */
import type { AiModel } from "@portal/shared";
import type { BatchUsage } from "./batch-client";

export const PRICE_SOURCE = "https://platform.claude.com/docs/en/about-claude/pricing";
export const PRICES_READ_ON = "2026-10-10";

export interface ModelPrices {
  input: number;
  cacheWrite5m: number;
  cacheWrite1h: number;
  cacheRead: number;
  output: number;
}

export const PRICES: Record<AiModel, ModelPrices> = {
  "claude-sonnet-5-5": {
    input: 2,
    cacheWrite5m: 2.5,
    cacheWrite1h: 4,
    cacheRead: 0.1,
    output: 10,
  },
  "claude-haiku-5-5": {
    input: 0.1,
    cacheWrite5m: 0.125,
    cacheWrite1h: 0.2,
    cacheRead: 0.01,
    output: 0.5,
  },
};

/** Message Batches cost half the standard price. */
export const BATCH_DISCOUNT = 0.5;

/** Round to 6 decimal places (costs are stored to 6). */
export function round6(n: number): number {
  return Math.round((n + Number.EPSILON) * 1e6) / 1e6;
}

/**
 * R9: one result's cost = the usage the API reports (input, cache writes, cache
 * reads, output) × the model's prices × 0.5. Cache writes are priced by their TTL
 * when the API breaks them down; otherwise at the 1-hour rate, which is the TTL
 * the reader asks for (the dearer of the two, so never an under-count).
 */
export function costOfUsage(model: AiModel, u: BatchUsage): number {
  const p = PRICES[model];
  const writes5m = u.cache_creation?.ephemeral_5m_input_tokens ?? 0;
  const writes1h =
    u.cache_creation?.ephemeral_1h_input_tokens ??
    (u.cache_creation ? 0 : (u.cache_creation_input_tokens ?? 0));
  const dollars =
    (u.input_tokens * p.input +
      writes5m * p.cacheWrite5m +
      writes1h * p.cacheWrite1h +
      (u.cache_read_input_tokens ?? 0) * p.cacheRead +
      u.output_tokens * p.output) /
    1_000_000;
  return round6(dollars * BATCH_DISCOUNT);
}
