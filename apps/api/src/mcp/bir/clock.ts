// clock.ts — U20b: the connector's notion of today, in one place (the tests move it).
/** Now, in milliseconds. Read through Date.now() so a test can set the day. */
export const nowMs = (): number => Date.now();

/** Today's Manila calendar date (UTC+8), "2026-11-06". */
export const manilaToday = (): string =>
  new Date(nowMs() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
