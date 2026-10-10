/**
 * track-a-backup.db-spec.ts — the restore drill (U7, T1).
 *
 * A backup nobody has restored is a hope, not a backup. This suite takes a dump
 * of the local database with the unit's own dump(), restores it with pg_restore
 * into a scratch database, and proves the copy is the same database: the same
 * tables, the same row count in every one of them, and the same migration
 * history (name + checksum of every row in _prisma_migrations). It runs the
 * EXACT procedure docs/BACKUPS.md gives a person under pressure, so the doc is
 * tested every time CI's database job runs.
 *
 * Nothing here talks to a bucket. The scratch database is created and dropped
 * by the suite; the local database is only read.
 *
 * Needs a local PostgreSQL on DATABASE_URL:  bash scripts/local-db.sh
 * Run with:                                  pnpm --filter api test:db
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";
import { BackupService } from "../../src/backup/backup.service";
import {
  connectionFromUrl,
  dumpDatabase,
  restoreDatabase,
} from "../../src/backup/pg-dump";
import { readServerVersionNum } from "../../src/backup/server-version";
import { truncateBeforeEach } from "./helpers/truncate";

function loadRootEnv(): void {
  if (process.env.DATABASE_URL) return;
  const envPath = join(__dirname, "..", "..", "..", "..", ".env");
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const m = /^\s*DATABASE_URL\s*=\s*(.*)$/.exec(line);
    if (m && m[1]) {
      process.env.DATABASE_URL = m[1].trim().replace(/^["']|["']$/g, "");
      return;
    }
  }
}
loadRootEnv();

const SCRATCH_DB = "portal_restore";

/** The same URL, pointed at a different database (the path), everything else kept. */
function withDatabase(url: string, database: string): string {
  const u = new URL(url);
  u.pathname = `/${database}`;
  return u.toString();
}

function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

interface MigrationRow {
  migration_name: string;
  checksum: string;
}

/** Per-table row counts for every base table in `public`, as a sorted map. */
async function rowCounts(db: PrismaClient): Promise<Map<string, number>> {
  const tables = await db.$queryRawUnsafe<Array<{ table_name: string }>>(
    `SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
      ORDER BY table_name`,
  );
  const out = new Map<string, number>();
  for (const t of tables) {
    const [row] = await db.$queryRawUnsafe<Array<{ n: number }>>(
      `SELECT count(*)::int AS n FROM public.${quoteIdent(t.table_name)}`,
    );
    out.set(t.table_name, row?.n ?? -1);
  }
  return out;
}

async function migrationRows(db: PrismaClient): Promise<MigrationRow[]> {
  return db.$queryRawUnsafe<MigrationRow[]>(
    `SELECT migration_name, checksum FROM "_prisma_migrations" ORDER BY migration_name`,
  );
}

/**
 * U3 R12: the database is truncated before every test, so the drill seeds its own
 * rows before it dumps — a restore of nothing proves nothing. Six tables get rows,
 * including a FILED BIR form and the draft that amends it, so the drill also proves
 * a sealed row and the seal itself (the trigger) survive a dump and a restore.
 */
async function seedDrillRows(db: PrismaClient): Promise<{ filedFormId: string }> {
  const firm = await db.firm.create({ data: { name: "restore-drill firm" } });
  const user = await db.user.create({
    data: {
      firmId: firm.id,
      userType: "FIRM",
      fullName: "restore-drill user",
      email: "restore-drill@example.com",
      status: "ACTIVE",
    },
  });
  await db.role.create({ data: { name: "restore-drill role", scope: "FIRM" } });
  const client = await db.client.create({
    data: {
      firmId: firm.id,
      businessName: "restore-drill client",
      tin: "000111222",
      taxType: "PERCENTAGE",
    },
  });
  const filed = await db.birForm.create({
    data: {
      firmId: firm.id,
      clientId: client.id,
      form: "2551Q",
      period: "2026-Q2",
      status: "filed",
      filedAt: new Date("2026-07-20T02:00:00.000Z"),
      dataJson: { rows: [{ atc: "PT010", taxable: "100000" }] },
      filedSnapshotJson: { businessName: "restore-drill client", tin: "000111222" },
    },
  });
  await db.birForm.create({
    data: {
      firmId: firm.id,
      clientId: client.id,
      form: "2551Q",
      period: "2026-Q2",
      status: "draft",
      sequence: 2,
      amendsId: filed.id,
    },
  });
  await db.auditLog.create({
    data: {
      userId: user.id,
      action: "restore-drill",
      entityType: "Firm",
      entityId: firm.id,
    },
  });
  return { filedFormId: filed.id };
}

truncateBeforeEach();

describe("restore drill: dump() → pg_restore into a scratch database → same database", () => {
  let databaseUrl = "";
  let source: PrismaClient;
  let restored: PrismaClient | null = null;
  let workDir = "";
  let dumpFile = "";

  beforeAll(async () => {
    if (!process.env.DATABASE_URL) {
      throw new Error(
        "DATABASE_URL is not set. Run `bash scripts/local-db.sh` first (see docs/LOCAL-DB.md).",
      );
    }
    databaseUrl = process.env.DATABASE_URL;
    source = new PrismaClient();
    workDir = await mkdtemp(join(tmpdir(), "track-a-backup-"));
    dumpFile = join(workDir, "drill.dump");
    // A leftover scratch database from an interrupted run must not make this
    // run pass by accident: start from nothing.
    await source.$executeRawUnsafe(
      `DROP DATABASE IF EXISTS ${quoteIdent(SCRATCH_DB)} WITH (FORCE)`,
    );
  });

  afterAll(async () => {
    if (restored) await restored.$disconnect();
    await source.$executeRawUnsafe(
      `DROP DATABASE IF EXISTS ${quoteIdent(SCRATCH_DB)} WITH (FORCE)`,
    );
    await source.$disconnect();
    if (workDir) await rm(workDir, { recursive: true, force: true });
  });

  it("connectionFromUrl() hands pg_dump the connection without the URL's schema parameter or a password in argv", () => {
    const conn = connectionFromUrl(databaseUrl);
    expect(conn.env.PGDATABASE).toBe("portal");
    expect(conn.env.PGHOST).toBeTruthy();
    expect(conn.env.PGPORT).toBeTruthy();
    expect(conn.env.PGUSER).toBeTruthy();
    expect(Object.keys(conn.env)).not.toContain("DATABASE_URL");
    // The printable target names host, port and database only. (That it never
    // carries the password is proven hermetically in track-a-backup.spec.ts with
    // a password distinct from every other part; the local .env.example URL
    // reuses one word for user, password and database, so a substring check
    // here would be meaningless.)
    expect(conn.target).toBe(
      `${conn.env.PGHOST}:${conn.env.PGPORT}/${conn.env.PGDATABASE}`,
    );
  });

  it("U7-A1: the real pg_dump is not older than the real server (16 vs 16 on the VM this was written on): the check passes and agrees with SHOW server_version", async () => {
    const num = await readServerVersionNum(source);
    const [shown] =
      await source.$queryRawUnsafe<Array<{ server_version: string }>>(
        "SHOW server_version",
      );
    const shownMajor = Number((shown?.server_version ?? "").split(".")[0]);
    expect(Number.isInteger(num) && num >= 100000).toBe(true);
    expect(Math.floor(num / 10000)).toBe(shownMajor);

    // A store that refuses everything: the check must need no bucket at all.
    const refusingStore = {
      isEnabled: () => false,
      putObject: async () => {
        throw new Error("no uploads in a test");
      },
      listObjects: async () => [],
      deleteObject: async () => {
        throw new Error("no deletes in a test");
      },
    };
    const svc = new BackupService({
      store: refusingStore,
      env: (name) => process.env[name],
      serverVersionNum: () => readServerVersionNum(source),
      logger: { log() {}, warn() {}, error() {} },
    });
    const check = await svc.checkDumpClient();
    expect(check.ok).toBe(true);
    if (check.ok) {
      expect(check.serverMajor).toBe(shownMajor);
      expect(check.clientMajor).toBeGreaterThanOrEqual(check.serverMajor);
    }
  });

  it("dump() writes a custom-format, compressed archive of the live database", async () => {
    await seedDrillRows(source);
    const result = await dumpDatabase({ databaseUrl, outFile: dumpFile });
    const size = statSync(dumpFile).size;
    expect(result.bytes).toBe(size);
    expect(size).toBeGreaterThan(1024);
    // pg_dump's custom format starts with the magic bytes "PGDMP".
    const head = readFileSync(dumpFile).subarray(0, 5).toString("latin1");
    expect(head).toBe("PGDMP");
  });

  it("pg_restore into a fresh database reproduces every table, every row count and the migration history", async () => {
    // Seed and dump here, in this test: the truncation before it emptied the database,
    // so the archive the previous test wrote is not of this database's rows.
    const { filedFormId } = await seedDrillRows(source);
    await dumpDatabase({ databaseUrl, outFile: dumpFile });
    await source.$executeRawUnsafe(`CREATE DATABASE ${quoteIdent(SCRATCH_DB)}`);
    await restoreDatabase({
      databaseUrl: withDatabase(databaseUrl, SCRATCH_DB),
      inFile: dumpFile,
    });
    restored = new PrismaClient({ datasourceUrl: withDatabase(databaseUrl, SCRATCH_DB) });

    const before = await rowCounts(source);
    const after = await rowCounts(restored);

    // Same set of tables (the schema came across, including _prisma_migrations).
    expect([...after.keys()]).toEqual([...before.keys()]);
    expect(before.size).toBeGreaterThanOrEqual(36);
    expect(after.has("_prisma_migrations")).toBe(true);

    // Not a restore of nothing: at least five tables carry rows on both sides.
    const nonEmpty = [...before.entries()]
      .filter(([t, n]) => t !== "_prisma_migrations" && n > 0)
      .map(([t]) => t);
    expect(nonEmpty.length).toBeGreaterThanOrEqual(5);

    // Same number of rows in every table — not just overall.
    const mismatches = [...before.entries()]
      .filter(([table, n]) => after.get(table) !== n)
      .map(([table, n]) => `${table}: source=${n} restored=${after.get(table)}`);
    expect(mismatches).toEqual([]);

    // Same migration history, name and checksum — what `prisma migrate deploy`
    // reads to decide that nothing is pending on the restored copy.
    const srcMigrations = await migrationRows(source);
    const dstMigrations = await migrationRows(restored);
    expect(srcMigrations.length).toBeGreaterThanOrEqual(33);
    expect(dstMigrations).toEqual(srcMigrations);

    // U3: the filed form came across filed, and the seal came across with it.
    await expect(
      restored.$executeRawUnsafe(
        `UPDATE bir_forms SET "dataJson" = '{}'::jsonb WHERE id = $1::uuid`,
        filedFormId,
      ),
    ).rejects.toThrow(/BIR_FORM_SEALED/);
  });
});
