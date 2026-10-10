/**
 * backup.scheduler.ts — runs the nightly at 18:00 UTC (02:00 Asia/Manila).
 *
 * A chain of single timers rather than an interval: each run computes the next
 * 18:00 UTC from the clock, so a slow run or a clock step cannot drift it, and
 * a run never fires twice for one night. No scheduler library (A3 found none in
 * the repo, and one timer does not justify a dependency). The timer is unref'd,
 * so it never keeps a process alive on its own. The clock and the timer
 * functions are injectable for the tests.
 */
import { Logger } from "@nestjs/common";
import { BackupGate, nextNightlyRunAt } from "./backup.rules";
import { BackupLog } from "./backup.service";

export interface NightlySchedulerDeps {
  gate: BackupGate;
  /** The job. Receives the moment the timer fired. */
  run: (now: Date) => Promise<void>;
  now?: () => Date;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
  logger?: BackupLog;
}

export interface NightlyRegistration {
  registered: boolean;
  nextRunAt: Date | null;
  reason?: string;
}

function defaultSetTimer(fn: () => void, ms: number): unknown {
  const handle = setTimeout(fn, ms);
  handle.unref();
  return handle;
}

function defaultClearTimer(handle: unknown): void {
  clearTimeout(handle as NodeJS.Timeout);
}

export class NightlyScheduler {
  private readonly gate: BackupGate;
  private readonly run: (now: Date) => Promise<void>;
  private readonly now: () => Date;
  private readonly setTimer: (fn: () => void, ms: number) => unknown;
  private readonly clearTimer: (handle: unknown) => void;
  private readonly logger: BackupLog;
  private handle: unknown = null;
  private next: Date | null = null;
  private stopped = false;

  constructor(deps: NightlySchedulerDeps) {
    this.gate = deps.gate;
    this.run = deps.run;
    this.now = deps.now ?? (() => new Date());
    this.setTimer = deps.setTimer ?? defaultSetTimer;
    this.clearTimer = deps.clearTimer ?? defaultClearTimer;
    this.logger = deps.logger ?? new Logger("Backup");
  }

  /** Registers the first run when the gate is active; otherwise says why not, once. */
  start(): NightlyRegistration {
    if (!this.gate.active) {
      this.logger.log(`nightly backup not scheduled: ${this.gate.reason}`);
      return { registered: false, nextRunAt: null, reason: this.gate.reason };
    }
    this.stopped = false;
    this.arm();
    this.logger.log(
      `nightly backup scheduled for ${this.next?.toISOString()} (02:00 Asia/Manila), then every night`,
    );
    return { registered: true, nextRunAt: this.next };
  }

  stop(): void {
    this.stopped = true;
    if (this.handle !== null) this.clearTimer(this.handle);
    this.handle = null;
    this.next = null;
  }

  get nextRunAt(): Date | null {
    return this.next;
  }

  private arm(): void {
    const now = this.now();
    const next = nextNightlyRunAt(now);
    this.next = next;
    this.handle = this.setTimer(() => void this.tick(), next.getTime() - now.getTime());
  }

  private async tick(): Promise<void> {
    const firedAt = this.now();
    try {
      await this.run(firedAt);
    } catch (err) {
      // runNightly already catches its own failures; this is the belt to that braces.
      this.logger.error(`nightly backup threw: ${(err as Error).message}`);
    }
    if (!this.stopped) this.arm();
  }
}
