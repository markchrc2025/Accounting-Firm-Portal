/**
 * track-a-receipt-poller.spec.ts — U11 R9 (hermetic): the poller is ONE chain of
 * single timers. A pile sent while a tick is collecting does not start a second
 * chain; the chain stops when nothing is reading; shutdown leaves no timer.
 */
import type { PrismaService } from "../prisma/prisma.service";
import { POLL_EVERY_MS, ReceiptScanPoller } from "./receipt-scan.poller";
import type { ReceiptScanService } from "./receipt-scan.service";

function setup(reading: () => boolean) {
  const armed: Array<{ fn: () => void; ms: number; cleared: boolean }> = [];
  let release: () => void = () => undefined;
  const scans = {
    collectAll: jest.fn(() => new Promise<void>((r) => (release = r))),
    anyReading: jest.fn(async () => reading()),
  } as unknown as ReceiptScanService;
  const poller = new ReceiptScanPoller(
    { isConnected: true } as unknown as PrismaService,
    scans,
    {
      setTimer: (fn, ms) => {
        const t = { fn, ms, cleared: false };
        armed.push(t);
        return t;
      },
      clearTimer: (h) => {
        (h as { cleared: boolean }).cleared = true;
      },
    },
  );
  const live = () => armed.filter((t) => !t.cleared);
  return { poller, armed, live, release: () => release(), scans };
}

const settle = () => new Promise((r) => setImmediate(r));

describe("U11 R9 · the poller is one chain of single timers", () => {
  it("wake() during a tick does not start a second chain", async () => {
    let reading = true;
    const { poller, armed, release } = setup(() => reading);
    poller.wake();
    expect(armed.map((t) => t.ms)).toEqual([POLL_EVERY_MS]);
    armed[0]!.fn(); // the tick starts and is collecting…
    poller.wake(); // …when a new pile is sent
    poller.wake();
    expect(armed).toHaveLength(1);
    release();
    await settle();
    await settle();
    // The tick re-arms once, because something is still reading.
    expect(armed).toHaveLength(2);
    reading = false;
    armed[1]!.fn();
    release();
    await settle();
    await settle();
    // Nothing is reading: the chain stops.
    expect(armed).toHaveLength(2);
  });

  it("wake() while armed does nothing; shutdown clears the one timer", () => {
    const { poller, armed, live } = setup(() => true);
    poller.wake();
    poller.wake();
    expect(armed).toHaveLength(1);
    poller.onModuleDestroy();
    expect(live()).toHaveLength(0);
    poller.wake();
    expect(armed).toHaveLength(1);
  });

  it("on boot it resumes only when a pile is still reading", async () => {
    const idle = setup(() => false);
    await idle.poller.onApplicationBootstrap();
    expect(idle.armed).toHaveLength(0);
    const busy = setup(() => true);
    await busy.poller.onApplicationBootstrap();
    expect(busy.armed.map((t) => t.ms)).toEqual([POLL_EVERY_MS]);
  });
});
