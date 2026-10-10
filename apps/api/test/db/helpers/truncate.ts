/**
 * truncate.ts — the database-backed suite runs against a truncated database (U3 R12).
 *
 * truncateAll() empties every table in the public schema except _prisma_migrations,
 * reading the table list from pg_class (so a table added by a later migration is
 * covered without editing this file), in ONE statement:
 *
 *     TRUNCATE TABLE … RESTART IDENTITY CASCADE
 *
 * TRUNCATE fires no row-level trigger, so it also empties sealed (filed) BIR forms:
 * that is what lets every test start from nothing. Production code never truncates.
 *
 * Each test then seeds only what it needs. CI still runs db:seed before this suite;
 * the suite truncates after it, so a local run leaves the database empty —
 * `bash scripts/local-db.sh` puts the seed back.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";
import { seedChartOfAccounts } from "../../../src/coa/coa-seed";
import { DEFAULT_ROLES } from "../../../src/rbac/permissions.constants";

/** Same rule as every db-spec: an already-set DATABASE_URL wins; else the repo-root .env. */
function loadRootEnv(): void {
  if (process.env.DATABASE_URL) return;
  const envPath = join(__dirname, "..", "..", "..", "..", "..", ".env");
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

/** What the helper needs from a Prisma client (PrismaClient and PrismaService both fit). */
export interface RawDb {
  $queryRawUnsafe<T = unknown>(query: string, ...values: unknown[]): Promise<T>;
  $executeRawUnsafe(query: string, ...values: unknown[]): Promise<number>;
}

const KEEP = "_prisma_migrations";

function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

/** Every ordinary or partitioned table in `public` except _prisma_migrations, from pg_class. */
export async function tablesToTruncate(db: RawDb): Promise<string[]> {
  const rows = await db.$queryRawUnsafe<Array<{ relname: string }>>(
    `SELECT c.relname
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relkind IN ('r', 'p')
        AND c.relname <> $1
      ORDER BY c.relname`,
    KEEP,
  );
  return rows.map((r) => r.relname);
}

/**
 * Empty every table but _prisma_migrations. Uses `db` when given, else a short-lived
 * PrismaClient of its own. Returns the tables it truncated.
 */
export async function truncateAll(db?: RawDb): Promise<string[]> {
  const own = db ? null : new PrismaClient();
  const exec: RawDb = db ?? (own as PrismaClient);
  try {
    const tables = await tablesToTruncate(exec);
    if (tables.length > 0) {
      await exec.$executeRawUnsafe(
        `TRUNCATE TABLE ${tables.map(quoteIdent).join(", ")} RESTART IDENTITY CASCADE`,
      );
    }
    return tables;
  } finally {
    if (own) await own.$disconnect();
  }
}

/**
 * R12 as a hook: truncate before every test in the file that calls it — and once
 * more after the file, so neither the next file nor the developer after a test run
 * inherits the last test's rows.
 */
export function truncateBeforeEach(): void {
  beforeEach(async () => {
    await truncateAll();
  });
  afterAll(async () => {
    await truncateAll();
  });
}

/**
 * For a spec file whose fixtures are built once, in beforeAll, and read across its
 * tests (U6's two): truncate once before the file — registered at module level, so
 * it runs ahead of the file's own beforeAll — put back only the seeded reference
 * data that file reads, and truncate once more after it. The reference data comes
 * from the functions and constants prisma/seed.ts itself uses, never a copy:
 *   firmRoles       — DEFAULT_ROLES' roles by name, with their grants (ensureFirmRole)
 *   chartOfAccounts — seedChartOfAccounts(prisma, prisma/data), as the seed runs it
 */
export function truncateOncePerFile(
  opts: { firmRoles?: string[]; chartOfAccounts?: boolean } = {},
): void {
  beforeAll(async () => {
    await truncateAll();
    for (const role of opts.firmRoles ?? []) await ensureFirmRole(role);
    if (opts.chartOfAccounts) {
      const db = new PrismaClient();
      try {
        await seedChartOfAccounts(
          db,
          join(__dirname, "..", "..", "..", "prisma", "data"),
        );
      } finally {
        await db.$disconnect();
      }
    }
  });
  afterAll(async () => {
    await truncateAll();
  });
}

/**
 * The seeded rows the U6 db-specs need: a FIRM-scope role by name, with exactly the
 * permission grants DEFAULT_ROLES gives it — read from the same constants
 * prisma/seed.ts reads, never re-typed here. They attach their test user to "Super
 * Admin", and the importer authorises through RBAC (rbac.service authorize), which
 * reads those grants from the database. No other role, user or firm is restored.
 */
export async function ensureFirmRole(name: string, db?: PrismaClient): Promise<void> {
  const def = DEFAULT_ROLES.find((r) => r.name === name && r.scope === "FIRM");
  if (!def) throw new Error(`No FIRM role named "${name}" in DEFAULT_ROLES`);
  const own = db ? null : new PrismaClient();
  const client = db ?? (own as PrismaClient);
  try {
    const role = await client.role.upsert({
      where: { name_scope: { name, scope: "FIRM" } },
      update: {},
      create: { name, scope: "FIRM", isSystem: true },
    });
    for (const p of def.permissions) {
      const [resource, action] = p.split(":") as [string, string];
      const permission = await client.permission.upsert({
        where: { resource_action: { resource, action } },
        update: {},
        create: { resource, action },
      });
      await client.rolePermission.upsert({
        where: { roleId_permissionId: { roleId: role.id, permissionId: permission.id } },
        update: {},
        create: { roleId: role.id, permissionId: permission.id },
      });
    }
  } finally {
    if (own) await own.$disconnect();
  }
}
