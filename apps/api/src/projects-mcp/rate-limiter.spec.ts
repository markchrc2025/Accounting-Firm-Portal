// rate-limiter.spec.ts — PA3 (D67): the per-token limit of the Projects MCP endpoint. The count
// lives in a shared store (Redis), so two API instances share one count per token.
import {
  MemoryRateStore,
  RateLimiter,
  RedisRateStore,
  type RateStore,
} from "./rate-limiter";

/** One store, standing in for the Redis both instances talk to. */
class SharedStore implements RateStore {
  readonly counts = new Map<string, number>();
  readonly ttls = new Map<string, number>();
  async incr(key: string, windowMs: number): Promise<number> {
    const n = (this.counts.get(key) ?? 0) + 1;
    this.counts.set(key, n);
    if (n === 1) this.ttls.set(key, windowMs);
    return n;
  }
}

describe("PA3 · MCP rate limit", () => {
  it("two instances over one store share one count per token: 240 in a minute, the 241st is refused", async () => {
    const store = new SharedStore();
    let now = 1_000_000;
    const a = new RateLimiter(store, { limit: 240, windowMs: 60_000, now: () => now });
    const b = new RateLimiter(store, { limit: 240, windowMs: 60_000, now: () => now });
    for (let n = 0; n < 240; n++) {
      const r = await (n % 2 ? a : b).hit("token-1");
      expect(r.allowed).toBe(true);
    }
    const over = await a.hit("token-1");
    expect(over.allowed).toBe(false);
    expect(over.count).toBe(241);
    expect(over.limit).toBe(240);
    expect(over.retryAfterSec).toBeGreaterThanOrEqual(1);
    expect(over.retryAfterSec).toBeLessThanOrEqual(60);
    // the other instance sees the same wall
    expect((await b.hit("token-1")).allowed).toBe(false);
    // another token is not affected
    expect((await b.hit("token-2")).allowed).toBe(true);
    // the next minute starts a new count
    now += 60_000;
    expect((await a.hit("token-1")).allowed).toBe(true);
  });

  it("the limit is configurable and a count of exactly the limit is still allowed", async () => {
    const lim = new RateLimiter(new SharedStore(), { limit: 3, windowMs: 60_000 });
    expect((await lim.hit("t")).allowed).toBe(true);
    expect((await lim.hit("t")).allowed).toBe(true);
    expect((await lim.hit("t")).allowed).toBe(true);
    expect((await lim.hit("t")).allowed).toBe(false);
  });

  it("when the shared store fails, the instance counts for itself, still limits, never throws, and says so once per failure", async () => {
    const broken: RateStore = {
      incr: async () => {
        throw new Error("redis down");
      },
    };
    const errors: string[] = [];
    const lim = new RateLimiter(broken, {
      limit: 2,
      windowMs: 60_000,
      onStoreError: (e) => errors.push(e.message),
    });
    expect((await lim.hit("t")).allowed).toBe(true);
    expect((await lim.hit("t")).allowed).toBe(true);
    expect((await lim.hit("t")).allowed).toBe(false);
    expect(errors).toEqual(["redis down", "redis down", "redis down"]);
  });

  it("MemoryRateStore counts and forgets old windows", async () => {
    const store = new MemoryRateStore();
    expect(await store.incr("a", 10)).toBe(1);
    expect(await store.incr("a", 10)).toBe(2);
    expect(await store.incr("b", 10)).toBe(1);
  });

  it("RedisRateStore sets the expiry once, on the first hit of a window, and connects when the client is idle", async () => {
    const calls: string[] = [];
    let n = 0;
    const client = {
      status: "wait",
      connect: async () => {
        calls.push("connect");
        client.status = "ready";
      },
      incr: async (k: string) => {
        calls.push(`incr ${k}`);
        return ++n;
      },
      pexpire: async (k: string, ms: number) => {
        calls.push(`pexpire ${k} ${ms}`);
        return 1;
      },
    };
    const store = new RedisRateStore(client);
    expect(await store.incr("k", 60_000)).toBe(1);
    expect(await store.incr("k", 60_000)).toBe(2);
    expect(calls).toEqual(["connect", "incr k", "pexpire k 60000", "incr k"]);
  });
});
