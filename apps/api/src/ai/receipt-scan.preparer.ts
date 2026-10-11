/**
 * receipt-scan.preparer.ts — every pile is prepared in the background (U14 R3).
 * The POST answers 202 "preparing" once the request's own checks pass; this queue
 * then fetches, checks and prepares the pile's files and sends it, one pile at a
 * time, so at most one decoded picture is in memory however many piles arrive.
 *
 * The queue lives in this process. A pile it held when the API restarted is left
 * "preparing"; the poller ends it after 30 minutes (ReceiptScanService
 * endStalePreparing), skipping any pile this process is still working on.
 */
import { Injectable, Logger, type OnModuleDestroy } from "@nestjs/common";
import { ReceiptScanService } from "./receipt-scan.service";

@Injectable()
export class ReceiptScanPreparer implements OnModuleDestroy {
  private readonly logger = new Logger("ReceiptScanPreparer");
  private chain: Promise<void> = Promise.resolve();
  private readonly active = new Set<string>();
  private stopped = false;

  constructor(private readonly scans: ReceiptScanService) {}

  /** Queue a pile; it is prepared after every pile queued before it. */
  enqueue(scanId: string): void {
    if (this.stopped) return;
    this.active.add(scanId);
    this.chain = this.chain.then(async () => {
      try {
        if (!this.stopped) await this.scans.prepare(scanId);
      } catch (err) {
        // prepare() ends the pile itself; this only logs what escaped it.
        this.logger.error(`pile ${scanId}: preparing failed (${(err as Error).name})`);
      } finally {
        this.active.delete(scanId);
      }
    });
  }

  /** The piles this process holds (queued or being prepared). */
  activeIds(): ReadonlySet<string> {
    return this.active;
  }

  /** Resolves once every pile queued so far is done. */
  async idle(): Promise<void> {
    let seen: Promise<void>;
    do {
      seen = this.chain;
      await seen;
    } while (seen !== this.chain);
  }

  onModuleDestroy(): void {
    this.stopped = true;
  }
}
