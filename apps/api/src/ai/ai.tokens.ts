/**
 * ai.tokens.ts — injection tokens for the AI receipt reader (U11). Each is a plain
 * string so a test can replace the provider without importing this module.
 *  - AI_BATCH_CLIENT: the Message Batches client (a fake in every test; R3).
 *  - AI_CLOCK: `{ now(): Date }` — the Manila month a pile counts in (R5).
 *  - AI_POLLER_TIMER: `{ setTimer, clearTimer }` — the poller's single timers (R9).
 */
export const AI_BATCH_CLIENT = "AiBatchClient";
export const AI_CLOCK = "AiClock";
export const AI_POLLER_TIMER = "AiPollerTimer";

export interface AiClock {
  now(): Date;
}

export interface AiPollerTimer {
  setTimer(fn: () => void, ms: number): unknown;
  clearTimer(handle: unknown): void;
}
