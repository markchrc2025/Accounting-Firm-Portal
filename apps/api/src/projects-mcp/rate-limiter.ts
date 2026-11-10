// rate-limiter.ts — PA3 (D67): the per-token limit of the Projects MCP endpoint.
//
// A fixed one-minute window per token. The count lives in Redis, so two API instances count
// together. When Redis cannot be reached an instance counts for itself (the limit still holds
// per instance, and the MCP keeps working) and says so in the log.
export interface RateStore {
  /** Add one to the count of `key` and return the new count. The first hit starts its expiry. */
  incr(key: string, windowMs: number): Promise<number>;
}

export interface RateResult {
  allowed: boolean;
  count: number;
  limit: number;
  retryAfterSec: number;
}

export interface RateLimiterOptions {
  limit: number;
  windowMs: number;
  now?: () => number;
  onStoreError?: (error: Error) => void;
}

/** The count in this process only: the fallback when the shared store fails. */
export class MemoryRateStore implements RateStore {
  private readonly counts = new Map<string, { n: number; expires: number }>();

  async incr(key: string, windowMs: number): Promise<number> {
    const now = Date.now();
    if (this.counts.size > 5000) {
      for (const [k, v] of this.counts) if (v.expires < now) this.counts.delete(k);
    }
    const cur = this.counts.get(key);
    if (!cur || cur.expires < now) {
      this.counts.set(key, { n: 1, expires: now + windowMs });
      return 1;
    }
    cur.n += 1;
    return cur.n;
  }
}

/** The part of an ioredis client the store uses (so a test can stand in for it). */
interface RedisLike {
  status: string;
  connect(): Promise<unknown>;
  incr(key: string): Promise<number>;
  pexpire(key: string, ms: number): Promise<unknown>;
}

/** The shared count, in Redis: INCR, and PEXPIRE on the first hit of a window. */
export class RedisRateStore implements RateStore {
  constructor(private readonly client: RedisLike) {}

  async incr(key: string, windowMs: number): Promise<number> {
    if (this.client.status === "wait" || this.client.status === "end") {
      await this.client.connect();
    }
    const n = await this.client.incr(key);
    if (n === 1) await this.client.pexpire(key, windowMs);
    return n;
  }
}

export class RateLimiter {
  private readonly limit: number;
  private readonly windowMs: number;
  private readonly now: () => number;
  private readonly onStoreError: (error: Error) => void;
  private readonly fallback = new MemoryRateStore();

  constructor(
    private readonly store: RateStore,
    opts: RateLimiterOptions,
  ) {
    this.limit = opts.limit;
    this.windowMs = opts.windowMs;
    this.now = opts.now ?? Date.now;
    this.onStoreError = opts.onStoreError ?? (() => undefined);
  }

  /** Count one request for `id`; says whether it is within the limit. Never throws. */
  async hit(id: string): Promise<RateResult> {
    const at = this.now();
    const bucket = Math.floor(at / this.windowMs);
    const key = `projects-mcp:rate:${id}:${bucket}`;
    let count: number;
    try {
      count = await this.store.incr(key, this.windowMs);
    } catch (e) {
      this.onStoreError(e instanceof Error ? e : new Error(String(e)));
      count = await this.fallback.incr(key, this.windowMs);
    }
    const resetsAt = (bucket + 1) * this.windowMs;
    return {
      allowed: count <= this.limit,
      count,
      limit: this.limit,
      retryAfterSec: Math.min(
        Math.ceil(this.windowMs / 1000),
        Math.max(1, Math.ceil((resetsAt - at) / 1000)),
      ),
    };
  }
}
