/**
 * pre-migrate.ts — the production start sequence's first step (D38, R1a):
 *
 *     pending migrations?  →  pg_dump  →  upload to backups/pre-migrate/  →  prisma migrate deploy
 *
 * Fail closed: if the dump or the upload fails, `prisma migrate deploy` is NOT
 * run and the process exits 1, so the container does not come up on a schema
 * nobody has a copy of. With nothing pending there is no dump. When the gate is
 * off (not production, no bucket, BACKUP_ENABLED=false) one line says why and
 * the migration runs as before.
 *
 * Run by apps/api/docker-start.sh as `pnpm --filter api migrate:with-backup`.
 * The sequence itself, runMigrateWithBackup(), takes every step as a function,
 * which is how track-a-backup.spec.ts proves "never migrates after a failed
 * upload" without a database, a bucket or pg_dump.
 */
import { spawn } from "node:child_process";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { ConfigService } from "@nestjs/config";
import { PrismaClient } from "@prisma/client";
import { StorageService } from "../storage/storage.service";
import { BackupGate, pendingMigrations, preMigrateKey } from "./backup.rules";
import { BackupLog, BackupService } from "./backup.service";
import { readServerVersionNum } from "./server-version";

export interface MigrateWithBackupDeps {
  gate: BackupGate;
  /** Migrations in prisma/migrations the database has not applied, and how many it has. */
  pending: () => Promise<{ pending: string[]; applied: number }>;
  /** dump + upload under the key; throws when either fails. */
  backup: (key: string) => Promise<{ key: string; bytes: number }>;
  /** `prisma migrate deploy`. */
  migrate: () => Promise<void>;
  now?: () => Date;
  log?: (line: string) => void;
}

export type MigrateWithBackupResult =
  | { outcome: "skipped"; reason: string }
  | { outcome: "nothing-pending"; applied: number }
  | { outcome: "backed-up"; key: string; bytes: number; pending: string[] };

/** Marks a failure of the migration itself, as opposed to a failure of the backup before it. */
export class MigrateStepError extends Error {
  constructor(cause: unknown) {
    super(`prisma migrate deploy failed: ${(cause as Error)?.message ?? String(cause)}`);
    this.name = "MigrateStepError";
  }
}

const defaultLog = (line: string): void => console.log(`[backup] ${line}`);

async function migrateStep(deps: MigrateWithBackupDeps): Promise<void> {
  try {
    await deps.migrate();
  } catch (err) {
    throw new MigrateStepError(err);
  }
}

export async function runMigrateWithBackup(
  deps: MigrateWithBackupDeps,
): Promise<MigrateWithBackupResult> {
  const log = deps.log ?? defaultLog;
  const now = deps.now ?? (() => new Date());

  if (!deps.gate.active) {
    log(`pre-migrate backup skipped: ${deps.gate.reason}`);
    await migrateStep(deps);
    return { outcome: "skipped", reason: deps.gate.reason };
  }

  const { pending, applied } = await deps.pending();
  if (pending.length === 0) {
    log(`no pending migrations (${applied} applied); no dump taken`);
    await migrateStep(deps);
    return { outcome: "nothing-pending", applied };
  }

  log(
    `${pending.length} pending migration(s) after ${applied} applied: ${pending.join(", ")}`,
  );
  const key = preMigrateKey(now(), applied);
  const { bytes } = await deps.backup(key); // throws → the migration below never runs
  log(`uploaded ${key} (${bytes} bytes); running prisma migrate deploy`);
  await migrateStep(deps);
  return { outcome: "backed-up", key, bytes, pending };
}

/** The command: 0 when the sequence completed, 1 otherwise, with the reason logged. */
export async function cli(deps: MigrateWithBackupDeps): Promise<number> {
  const log = deps.log ?? defaultLog;
  try {
    await runMigrateWithBackup({ ...deps, log });
    return 0;
  } catch (err) {
    const message = (err as Error).message;
    if (err instanceof MigrateStepError) {
      log(`FAILED: ${message}`);
      log(
        "the backup (if one was due) succeeded; the migration itself failed — see Prisma's output above.",
      );
    } else {
      log(`FAILED before migrating: ${message}`);
      log(
        "the database was NOT migrated: a backup must succeed before a production migration runs (D38). " +
          "Fix the cause and redeploy. docs/BACKUPS.md names the off switch for an emergency.",
      );
    }
    return 1;
  }
}

// ---------------------------------------------------------------------------
// The real steps
// ---------------------------------------------------------------------------

/** Rows of _prisma_migrations that count as applied; an unmigrated database has none. */
export async function appliedMigrations(prisma: PrismaClient): Promise<string[]> {
  try {
    const rows = await prisma.$queryRawUnsafe<Array<{ migration_name: string }>>(
      `SELECT migration_name FROM "_prisma_migrations"
        WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL`,
    );
    return rows.map((r) => r.migration_name);
  } catch (err) {
    if (isUndefinedTable(err)) return [];
    throw err;
  }
}

/** PostgreSQL 42P01 "undefined_table", as Prisma reports it on a raw query. */
function isUndefinedTable(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const meta = (err as { meta?: { code?: unknown } }).meta;
  return meta?.code === "42P01";
}

export function migrationDirectories(apiRoot: string): string[] {
  return readdirSync(join(apiRoot, "prisma", "migrations"), { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^\d{14}_/.test(entry.name))
    .map((entry) => entry.name);
}

/** One short-lived Prisma client per question; the command asks two and exits. */
async function withPrisma<T>(fn: (prisma: PrismaClient) => Promise<T>): Promise<T> {
  const prisma = new PrismaClient();
  try {
    return await fn(prisma);
  } finally {
    await prisma.$disconnect();
  }
}

function readPending(apiRoot: string): Promise<{ pending: string[]; applied: number }> {
  return withPrisma(async (prisma) => {
    const applied = await appliedMigrations(prisma);
    return {
      pending: pendingMigrations(migrationDirectories(apiRoot), applied),
      applied: applied.length,
    };
  });
}

/** `prisma migrate deploy`, output inherited so the log reads as it always has. */
function prismaMigrateDeploy(apiRoot: string): Promise<void> {
  const prismaCli = require.resolve("prisma/build/index.js", { paths: [apiRoot] });
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [prismaCli, "migrate", "deploy"], {
      cwd: apiRoot,
      stdio: "inherit",
      env: process.env,
    });
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`exited with ${code ?? signal}`));
    });
  });
}

const cliLogger: BackupLog = {
  log: defaultLog,
  warn: (m) => defaultLog(`warning: ${m}`),
  error: (m) => defaultLog(`error: ${m}`),
};

export function realDeps(): MigrateWithBackupDeps {
  const config = new ConfigService();
  const env = (name: string): string | undefined => config.get<string>(name);
  const service = new BackupService({
    store: new StorageService(config),
    env,
    serverVersionNum: () => withPrisma(readServerVersionNum),
    logger: cliLogger,
  });
  const apiRoot = join(__dirname, "..", "..");
  return {
    gate: service.gate(),
    pending: () => readPending(apiRoot),
    // backup() logs pg_dump's version against the server's before it dumps (R2).
    backup: (key) => service.backup(key),
    migrate: () => prismaMigrateDeploy(apiRoot),
  };
}

if (require.main === module) {
  let deps: MigrateWithBackupDeps;
  try {
    deps = realDeps();
  } catch (err) {
    defaultLog(`FAILED to start: ${(err as Error).message}`);
    process.exit(1);
  }
  void cli(deps).then((code) => process.exit(code));
}
