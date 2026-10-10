/**
 * backup.service.ts — dump the database, put it in the bucket, keep the bucket tidy.
 *
 * The store is the files module's StorageService (the same bucket connection,
 * the same env variables — R2); this class only adds the `backups/` prefix. The
 * dumper, the clock and the logger are injectable so the whole class is tested
 * without PostgreSQL or S3 (track-a-backup.spec.ts).
 *
 * The archive is uploaded from a Buffer through StorageService.putObject — the
 * request shape the files module already sends to this bucket in production.
 * With a stream body the AWS SDK switches to `Content-Encoding: aws-chunked`
 * with a trailing checksum, a shape this bucket has never been sent and that
 * cannot be tried from a development VM (no upload may leave one).
 */
import { Logger } from "@nestjs/common";
import * as Sentry from "@sentry/node";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sentryEnabled } from "../observability/sentry";
import {
  BackupGate,
  DAILY_PREFIX,
  DumpClientCheck,
  PRE_MIGRATE_PREFIX,
  backupGate,
  checkDumpClient,
  dailyKey,
  prunePlan,
} from "./backup.rules";
import { dumpDatabase, pgDumpVersion } from "./pg-dump";

/** What the backups need from the files module's StorageService — nothing more. */
export interface BackupStore {
  isEnabled(): boolean;
  putObject(key: string, body: Uint8Array, contentType: string): Promise<void>;
  listObjects(
    prefix: string,
  ): Promise<Array<{ key: string; size: number; lastModified: string | null }>>;
  deleteObject(key: string): Promise<void>;
}

export interface BackupLog {
  log(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

export type Dumper = (opts: {
  databaseUrl: string;
  outFile: string;
}) => Promise<{ bytes: number; target: string }>;

/** Where a failed nightly is reported besides the log (R3). Sentry in the app; a fake in tests. */
export interface BackupSentry {
  isEnabled(): boolean;
  captureException(error: unknown): unknown;
}

export interface BackupServiceDeps {
  store: BackupStore;
  /** Reads one environment variable (ConfigService.get in the app). */
  env: (name: string) => string | undefined;
  /** The server's server_version_num, read through the caller's database client. */
  serverVersionNum: () => Promise<number>;
  /** `pg_dump --version`'s first line. Defaults to running pg_dump. */
  clientVersion?: () => Promise<string>;
  dump?: Dumper;
  logger?: BackupLog;
  now?: () => Date;
  sentry?: BackupSentry;
}

const realSentry: BackupSentry = {
  isEnabled: sentryEnabled,
  captureException: (error) => Sentry.captureException(error),
};

export const DUMP_CONTENT_TYPE = "application/octet-stream";

export class BackupService {
  private readonly store: BackupStore;
  private readonly env: (name: string) => string | undefined;
  private readonly dumpFn: Dumper;
  private readonly serverVersionNum: () => Promise<number>;
  private readonly clientVersion: () => Promise<string>;
  private readonly logger: BackupLog;
  private readonly now: () => Date;
  private readonly sentry: BackupSentry;
  private openTempDirs = 0;

  constructor(deps: BackupServiceDeps) {
    this.store = deps.store;
    this.env = deps.env;
    this.dumpFn = deps.dump ?? dumpDatabase;
    this.serverVersionNum = deps.serverVersionNum;
    this.clientVersion = deps.clientVersion ?? (() => pgDumpVersion());
    this.logger = deps.logger ?? new Logger("Backup");
    this.now = deps.now ?? (() => new Date());
    this.sentry = deps.sentry ?? realSentry;
  }

  /** R1(c), read from the environment this process runs in. */
  gate(): BackupGate {
    return backupGate({
      NODE_ENV: this.env("NODE_ENV"),
      BACKUP_ENABLED: this.env("BACKUP_ENABLED"),
      S3_ENDPOINT: this.env("S3_ENDPOINT"),
      S3_BUCKET: this.env("S3_BUCKET"),
      S3_ACCESS_KEY_ID: this.env("S3_ACCESS_KEY_ID"),
      S3_SECRET_ACCESS_KEY: this.env("S3_SECRET_ACCESS_KEY"),
    });
  }

  /** Temp directories created by dump() and not yet removed — zero after every path. */
  get tempDirsOpen(): number {
    return this.openTempDirs;
  }

  /**
   * R2: before any dump, compare pg_dump's major with the server's. Runs once
   * per dump, here, because dump() is the one step both the nightly and the
   * pre-migrate command pass through. Logs one line naming both.
   */
  async checkDumpClient(): Promise<DumpClientCheck> {
    const [clientLine, serverNum] = await Promise.all([
      this.clientVersion(),
      this.serverVersionNum(),
    ]);
    const check = checkDumpClient(clientLine, serverNum);
    this.logger.log(
      `${clientLine.trim()}; server_version_num ${serverNum} (major ${check.serverMajor})`,
    );
    return check;
  }

  /**
   * pg_dump the database DATABASE_URL names into a fresh temp directory. The
   * caller removes the directory with cleanup(); backup() does both. Refuses,
   * before touching the disk, when pg_dump is older than the server (R2).
   */
  async dump(): Promise<{ dir: string; file: string; bytes: number; target: string }> {
    const databaseUrl = this.env("DATABASE_URL");
    if (!databaseUrl)
      throw new Error("DATABASE_URL is not set; there is nothing to dump");
    const check = await this.checkDumpClient();
    if (!check.ok) throw new Error(check.message);
    const dir = await mkdtemp(join(tmpdir(), "portal-backup-"));
    this.openTempDirs += 1;
    const file = join(dir, "db.dump");
    try {
      const { bytes, target } = await this.dumpFn({ databaseUrl, outFile: file });
      return { dir, file, bytes, target };
    } catch (err) {
      await this.cleanup(dir);
      throw err;
    }
  }

  /** Put an archive in the bucket under `key`. */
  async upload(file: string, key: string): Promise<{ key: string; bytes: number }> {
    const body = await readFile(file);
    await this.store.putObject(key, body, DUMP_CONTENT_TYPE);
    return { key, bytes: body.byteLength };
  }

  async cleanup(dir: string): Promise<void> {
    await rm(dir, { recursive: true, force: true });
    this.openTempDirs -= 1;
  }

  /** dump → upload under `key` → remove the temp file, whatever happened in between. */
  async backup(key: string): Promise<{ key: string; bytes: number }> {
    const dumped = await this.dump();
    try {
      return await this.upload(dumped.file, key);
    } finally {
      await this.cleanup(dumped.dir);
    }
  }

  /**
   * R1(b) retention, applied to backups/daily/ and backups/pre-migrate/ only.
   * Those two prefixes are the only ones listed, and only the plan is deleted.
   */
  async prune(now: Date = this.now()): Promise<{ listed: number; deleted: string[] }> {
    const keys: string[] = [];
    for (const prefix of [DAILY_PREFIX, PRE_MIGRATE_PREFIX]) {
      for (const object of await this.store.listObjects(prefix)) keys.push(object.key);
    }
    const plan = prunePlan(keys, now);
    for (const key of plan) await this.store.deleteObject(key);
    return { listed: keys.length, deleted: plan };
  }

  /**
   * The nightly run: dump to backups/daily/<Manila date>.dump, then prune. One
   * log line per run. Never throws — a failure is logged, reported to Sentry
   * when Sentry is configured (R3), and the next night tries again; nothing
   * here can reach a request handler.
   */
  async runNightly(now: Date = this.now()): Promise<void> {
    const key = dailyKey(now);
    try {
      const { bytes } = await this.backup(key);
      const pruned = await this.prune(now);
      this.logger.log(
        `nightly backup uploaded ${key} (${bytes} bytes); retention removed ${pruned.deleted.length} of ${pruned.listed} objects`,
      );
    } catch (err) {
      const line = `nightly backup FAILED for ${key}: ${(err as Error).message}`;
      this.logger.error(line);
      try {
        if (this.sentry.isEnabled()) {
          this.sentry.captureException(new Error(line, { cause: err }));
        }
      } catch (reportErr) {
        this.logger.warn(
          `could not report the failed nightly to Sentry: ${(reportErr as Error).message}`,
        );
      }
    }
  }
}
