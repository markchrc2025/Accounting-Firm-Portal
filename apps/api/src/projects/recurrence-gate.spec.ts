// recurrence-gate.spec.ts — PA8 (D70): the daily run happens once across API processes. The gate
// is a Redis lock plus a "last run" day; here the store is a stand-in so every branch is tried.
import { RecurrenceGate, type GateStore } from "./recurrence-gate";

function fakeStore(over: Partial<GateStore> = {}): GateStore & { kv: Map<string, string> } {
  const kv = new Map<string, string>();
  return {
    kv,
    available: async () => true,
    get: async (k) => kv.get(k) ?? null,
    set: async (k, v) => void kv.set(k, v),
    setNx: async (k, v) => {
      if (kv.has(k)) return false;
      kv.set(k, v);
      return true;
    },
    delIfEquals: async (k, v) => {
      if (kv.get(k) === v) kv.delete(k);
    },
    ...over,
  };
}

describe("RecurrenceGate", () => {
  it("runs the work, records the day, and releases the lock", async () => {
    const store = fakeStore();
    const gate = new RecurrenceGate(store);
    const r = await gate.run("2026-11-11", async () => ({ ok: true, result: 3 }));
    expect(r).toEqual({ ran: true, result: 3 });
    expect(store.kv.get("projects:recurrence:last-run")).toBe("2026-11-11");
    expect(store.kv.has("projects:recurrence:lock")).toBe(false);
  });

  it("does not run twice on one day, unless forced", async () => {
    const gate = new RecurrenceGate(fakeStore());
    let n = 0;
    const work = async () => ({ ok: true, result: ++n });
    await gate.run("2026-11-11", work);
    expect(await gate.run("2026-11-11", work)).toEqual({ ran: false, reason: "already-run" });
    expect(await gate.run("2026-11-11", work, { force: true })).toEqual({ ran: true, result: 2 });
    expect(await gate.run("2026-11-12", work)).toEqual({ ran: true, result: 3 });
  });

  it("two at once: one runs, the other finds the lock", async () => {
    const store = fakeStore();
    const a = new RecurrenceGate(store);
    const b = new RecurrenceGate(store);
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    let runs = 0;
    const slow = async () => {
      runs++;
      await held;
      return { ok: true, result: "a" };
    };
    const first = a.run("2026-11-11", slow);
    await new Promise((r) => setTimeout(r, 10));
    expect(await b.run("2026-11-11", slow)).toEqual({ ran: false, reason: "locked" });
    release();
    expect(await first).toEqual({ ran: true, result: "a" });
    expect(runs).toBe(1);
    // and once it has finished, the day is done
    expect(await b.run("2026-11-11", slow)).toEqual({ ran: false, reason: "already-run" });
  });

  it("a run that fails releases the lock and leaves the day open for the next try", async () => {
    const store = fakeStore();
    const gate = new RecurrenceGate(store);
    await expect(
      gate.run("2026-11-11", async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(store.kv.has("projects:recurrence:lock")).toBe(false);
    expect(store.kv.has("projects:recurrence:last-run")).toBe(false);
    expect(await gate.run("2026-11-11", async () => ({ ok: true, result: 1 }))).toEqual({
      ran: true,
      result: 1,
    });
  });

  it("work that reports it was not whole does not mark the day done", async () => {
    const store = fakeStore();
    const gate = new RecurrenceGate(store);
    expect(await gate.run("2026-11-11", async () => ({ ok: false, result: "partial" }))).toEqual({
      ran: true,
      result: "partial",
    });
    expect(store.kv.has("projects:recurrence:last-run")).toBe(false);
  });

  it("with no Redis it does not run: once across processes cannot be promised", async () => {
    const gate = new RecurrenceGate(fakeStore({ available: async () => false }));
    let ran = false;
    expect(
      await gate.run("2026-11-11", async () => {
        ran = true;
        return { ok: true, result: 1 };
      }),
    ).toEqual({ ran: false, reason: "no-redis" });
    expect(ran).toBe(false);
  });

  it("only the holder of the lock releases it", async () => {
    const store = fakeStore();
    const gate = new RecurrenceGate(store);
    await gate.run("2026-11-11", async () => {
      store.kv.set("projects:recurrence:lock", "someone-else");
      return { ok: true, result: 1 };
    });
    expect(store.kv.get("projects:recurrence:lock")).toBe("someone-else");
  });
});
