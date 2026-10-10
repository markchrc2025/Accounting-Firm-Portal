/**
 * track-a-status-cache.spec.ts — the guard's user-status cache is bounded (U9-A1 R7,
 * D46): an entry lives at most 60 s, expired entries are pruned, and the cache never
 * holds more than 1,000 entries. Hermetic: the cache alone, with the clock passed in.
 */
import { StatusCache } from "./jwt-auth.guard";

const MINUTE = 60_000;

describe("U9-A1 T5 · the status cache is bounded", () => {
  const saved = process.env.AUTH_STATUS_CACHE_MS;
  afterEach(() => {
    if (saved === undefined) delete process.env.AUTH_STATUS_CACHE_MS;
    else process.env.AUTH_STATUS_CACHE_MS = saved;
  });

  it("an entry answers within 60 s and is gone (and pruned) at 60 s", () => {
    delete process.env.AUTH_STATUS_CACHE_MS;
    const cache = new StatusCache();
    cache.set("u1", true, 0);
    expect(cache.get("u1", MINUTE - 1)).toBe(true);
    expect(cache.get("u1", MINUTE)).toBeUndefined();
    expect(cache.size).toBe(0);
  });

  it("a window above 60 s is clamped to 60 s", () => {
    process.env.AUTH_STATUS_CACHE_MS = "999999";
    const cache = new StatusCache();
    cache.set("u1", false, 0);
    expect(cache.get("u1", MINUTE - 1)).toBe(false);
    expect(cache.get("u1", MINUTE)).toBeUndefined();
  });

  it("expired entries of users never seen again are pruned on the next write", () => {
    delete process.env.AUTH_STATUS_CACHE_MS;
    const cache = new StatusCache();
    for (let i = 0; i < 10; i++) cache.set(`old-${i}`, true, 0);
    cache.set("fresh", true, MINUTE + 1);
    expect(cache.size).toBe(1);
    expect(cache.get("fresh", MINUTE + 2)).toBe(true);
  });

  it("never holds more than 1,000 entries: the oldest is dropped first", () => {
    delete process.env.AUTH_STATUS_CACHE_MS;
    const cache = new StatusCache();
    for (let i = 0; i < 1000; i++) cache.set(`u-${i}`, true, i);
    expect(cache.size).toBe(1000);
    cache.set("u-1000", true, 1000);
    expect(cache.size).toBe(1000);
    expect(cache.get("u-0", 1001)).toBeUndefined();
    expect(cache.get("u-1", 1001)).toBe(true);
    expect(cache.get("u-1000", 1001)).toBe(true);
    for (let i = 1001; i < 3000; i++) cache.set(`u-${i}`, true, i);
    expect(cache.size).toBe(1000);
  });

  it("a window of 0 stores nothing", () => {
    process.env.AUTH_STATUS_CACHE_MS = "0";
    const cache = new StatusCache();
    cache.set("u1", true, 0);
    expect(cache.size).toBe(0);
    expect(cache.get("u1", 0)).toBeUndefined();
  });
});
