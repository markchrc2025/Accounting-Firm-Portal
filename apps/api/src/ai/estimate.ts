/**
 * estimate.ts — an UPPER BOUND on what one file of a pile costs to read (U11 R5),
 * priced at the batch price from prices.ts.
 *
 * Image tokens, by the documented formula on the PREPARED size (vision docs,
 * https://platform.claude.com/docs/en/build-with-claude/vision): ⌈w/28⌉ × ⌈h/28⌉.
 * claude-sonnet-5-5 and claude-haiku-5-5 read on the high-resolution tier ("Claude
 * 4.7 and later": a 2,576 px long edge and at most 4,784 tokens); prepare.ts sizes
 * every image to fit both, so a prepared image never costs more than 4,784.
 * A PDF page (https://platform.claude.com/docs/en/build-with-claude/pdf-support) is
 * sent as an image plus its extracted text, about 1,500–3,000 tokens: each page is
 * counted at the tier maximum plus 3,000.
 */
import type { AiModel } from "@portal/shared";
import { BATCH_DISCOUNT, PRICES, round6 } from "./prices";

/** The high-resolution tier the 5.5 models read on. */
export const MAX_LONG_EDGE_PX = 2576;
export const MAX_IMAGE_TOKENS = 4784;
/** The most a PDF in a pile may have (R4). */
export const MAX_PDF_PAGES = 5;
/** A PDF page's extracted text, at the top of the documented 1,500–3,000. */
export const PDF_PAGE_TEXT_TOKENS = 3000;
/** The request's own text: the client's name and TIN, the period, the file name. */
export const REQUEST_TEXT_TOKENS = 400;
/** max_tokens on every request: the answer can never be longer (R6). */
export const MAX_OUTPUT_TOKENS = 4096;

/** ⌈w/28⌉ × ⌈h/28⌉ — the documented image token count. */
export function imageTokens(width: number, height: number): number {
  return Math.ceil(width / 28) * Math.ceil(height / 28);
}

/** The largest size, aspect kept, within the long edge and the token cap. */
export function fitToModel(
  width: number,
  height: number,
): { width: number; height: number } {
  let scale = Math.min(1, MAX_LONG_EDGE_PX / Math.max(width, height));
  let w = Math.max(1, Math.floor(width * scale));
  let h = Math.max(1, Math.floor(height * scale));
  while (imageTokens(w, h) > MAX_IMAGE_TOKENS) {
    scale *= 0.995;
    w = Math.max(1, Math.floor(width * scale));
    h = Math.max(1, Math.floor(height * scale));
  }
  return { width: w, height: h };
}

/** A pessimistic token count for the cached instructions (≥ 1 token per 3 chars). */
export function instructionTokens(text: string): number {
  return Math.ceil(text.length / 3);
}

/**
 * One file's upper bound, in US$: its content tokens and the request text at the
 * input price, the instructions as a 1-hour cache WRITE (the dearest way they can
 * be billed), and a full max_tokens answer at the output price — all × 0.5.
 */
export function fileEstimateUsd(
  model: AiModel,
  contentTokens: number,
  instructions: number,
): number {
  const p = PRICES[model];
  const dollars =
    ((contentTokens + REQUEST_TEXT_TOKENS) * p.input +
      instructions * p.cacheWrite1h +
      MAX_OUTPUT_TOKENS * p.output) /
    1_000_000;
  return round6(dollars * BATCH_DISCOUNT);
}

/** Content tokens for a prepared image, and for a PDF of `pages` pages. */
export function pdfTokens(pages: number): number {
  return pages * (MAX_IMAGE_TOKENS + PDF_PAGE_TEXT_TOKENS);
}
