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
import {
  connectionFromUrl,
  dumpDatabase,
  restoreDatabase,
} from "../../src/backup/pg-dump";

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

  it("dump() writes a custom-format, compressed archive of the live database", async () => {
    const result = await dumpDatabase({ databaseUrl, outFile: dumpFile });
    const size = statSync(dumpFile).size;
    expect(result.bytes).toBe(size);
    expect(size).toBeGreaterThan(1024);
    // pg_dump's custom format starts with the magic bytes "PGDMP".
    const head = readFileSync(dumpFile).subarray(0, 5).toString("latin1");
    expect(head).toBe("PGDMP");
  });

  it("pg_restore into a fresh database reproduces every table, every row count and the migration history", async () => {
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
  });
});
