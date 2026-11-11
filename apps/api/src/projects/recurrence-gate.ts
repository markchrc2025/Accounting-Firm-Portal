// recurrence-gate.ts — PA8 (D70): "once a day, once across API processes". A Redis lock keeps two
// processes from running at the same time, and a "last run" day keeps a second run from following
// the first. With no Redis the run is skipped (and said so): once cannot be promised without it.
import { randomUUID } from "node:crypto";

/** The part of Redis the gate uses, so a test can stand in for it. */
export interface GateStore {
  available(): Promise<boolean>;
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSeconds: number): Promise<void>;
  /** SET key value NX EX ttl: true when this caller took the key. */
  setNx(key: string, value: string, ttlSeconds: number): Promise<boolean>;
  /** Delete the key only if it still holds `value`. */
  delIfEquals(key: string, value: string): Promise<void>;
}

export const LOCK_KEY = "projects:recurrence:lock";
export const LAST_RUN_KEY = "projects:recurrence:last-run";
const LOCK_SECONDS = 15 * 60;
const LAST_RUN_SECONDS = 3 * 24 * 60 * 60;

export type GateResult<T> =
  | { ran: true; result: T }
  | { ran: false; reason: "no-redis" | "already-run" | "locked" };

export class RecurrenceGate {
  constructor(private readonly store: GateStore) {}

  /**
   * Run `work` for the Manila day `today` unless it has run today or is running now. `work` answers
   * `ok: false` when it did not finish everything, and then the day is not marked done.
   */
  async run<T>(
    today: string,
    work: () => Promise<{ ok: boolean; result: T }>,
    opts: { force?: boolean } = {},
  ): Promise<GateResult<T>> {
    if (!(await this.store.available())) return { ran: false, reason: "no-redis" };
    if (!opts.force && (await this.store.get(LAST_RUN_KEY)) === today) {
      return { ran: false, reason: "already-run" };
    }
    const token = randomUUID();
    if (!(await this.store.setNx(LOCK_KEY, token, LOCK_SECONDS))) {
      return { ran: false, reason: "locked" };
    }
    try {
      // the other process may have finished between the first look and the lock
      if (!opts.force && (await this.store.get(LAST_RUN_KEY)) === today) {
        return { ran: false, reason: "already-run" };
      }
      const done = await work();
      if (done.ok) await this.store.set(LAST_RUN_KEY, today, LAST_RUN_SECONDS);
      return { ran: true, result: done.result };
    } finally {
      await this.store.delIfEquals(LOCK_KEY, token);
    }
  }
}
