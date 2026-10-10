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
  private stopped = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly scans: ReceiptScanService,
    @Inject(AI_POLLER_TIMER) private readonly timer: AiPollerTimer,
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
    if (this.handle === null && !this.stopped) this.arm();
  }

  private arm(): void {
    this.handle = this.timer.setTimer(() => void this.tick(), POLL_EVERY_MS);
  }

  private async tick(): Promise<void> {
    this.handle = null;
    try {
      await this.scans.collectAll();
    } catch (err) {
      this.logger.error(`collecting threw (${(err as Error).name})`);
    }
    try {
      if (!this.stopped && (await this.scans.anyReading())) this.arm();
    } catch {
      if (!this.stopped) this.arm();
    }
  }
}
