/**
 * receipt-scan.poller.ts — collects finished batches every 10 minutes while any
 * pile is reading (U11 R9). A chain of single timers, as backup.scheduler.ts is:
 * each tick arms the next only if something is still reading, so an idle API
 * holds no timer. On boot it resumes: a pile still reading when the API restarted
 * is collected afterwards. The timer functions are injectable (AI_POLLER_TIMER).
 */
import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { AI_POLLER_TIMER, type AiPollerTimer } from "./ai.tokens";
import { ReceiptScanPreparer } from "./receipt-scan.preparer";
import { ReceiptScanService } from "./receipt-scan.service";

export const POLL_EVERY_MS = 10 * 60 * 1000;

/** The production timer: unref'd, so it never keeps the process alive by itself. */
export const realPollerTimer: AiPollerTimer = {
  setTimer: (fn, ms) => {
    const h = setTimeout(fn, ms);
    h.unref();
    return h;
  },
  clearTimer: (h) => clearTimeout(h as NodeJS.Timeout),
};

@Injectable()
export class ReceiptScanPoller implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger("ReceiptScanPoller");
  private handle: unknown = null;
  /** True while a tick collects: wake() then leaves the re-arming to the tick, so
   *  there is never more than one chain of timers. */
  private running = false;
  private stopped = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly scans: ReceiptScanService,
    @Inject(AI_POLLER_TIMER) private readonly timer: AiPollerTimer,
    private readonly preparer: ReceiptScanPreparer,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (!this.prisma.isConnected) return;
    try {
      if (await this.scans.anyReading()) {
        this.arm();
        this.logger.log(
          "piles still reading after a restart: collecting every 10 minutes",
        );
      }
    } catch (err) {
      this.logger.warn(`could not look for piles still reading (${(err as Error).name})`);
    }
  }

  onModuleDestroy(): void {
    this.stopped = true;
    if (this.handle !== null) this.timer.clearTimer(this.handle);
    this.handle = null;
  }

  /** A pile was just sent: make sure a collection is coming. */
  wake(): void {
    if (this.handle === null && !this.running && !this.stopped) this.arm();
  }

  private arm(): void {
    this.handle = this.timer.setTimer(() => void this.tick(), POLL_EVERY_MS);
  }

  private async tick(): Promise<void> {
    this.handle = null;
    this.running = true;
    try {
      await this.scans.collectAll();
      // U14 R3: a pile a restart left "preparing" is ended after 30 minutes.
      await this.scans.endStalePreparing(this.preparer.activeIds());
    } catch (err) {
      this.logger.error(`collecting threw (${(err as Error).name})`);
    }
    let again = true;
    try {
      again = await this.scans.anyReading();
    } catch {
      again = true;
    }
    this.running = false;
    if (again && !this.stopped && this.handle === null) this.arm();
  }
}
