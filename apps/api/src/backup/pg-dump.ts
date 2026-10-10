/**
 * pg-dump.ts — running pg_dump / pg_restore from Node without ever putting the
 * connection string on a command line.
 *
 * DATABASE_URL (Prisma's form, with `?schema=public`) is split into libpq's
 * PGHOST / PGPORT / PGUSER / PGPASSWORD / PGDATABASE variables and handed to the
 * child through its environment. Nothing secret is in argv (visible in `ps`) and
 * the `schema` parameter — which pg_dump rejects as an unknown URI parameter —
 * never reaches it. The only connection detail this module ever prints is
 * `host:port/database`.
 */
import { execFile } from "node:child_process";
import { stat } from "node:fs/promises";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface PgConnection {
  /** libpq variables for the child process. Never log this object. */
  env: Record<string, string>;
  /** `host:port/database` — safe to print. */
  target: string;
}

/** Split a postgresql:// URL into libpq variables. Drops Prisma-only parameters. */
export function connectionFromUrl(url: string): PgConnection {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new Error("DATABASE_URL is not a valid URL");
  }
  if (u.protocol !== "postgresql:" && u.protocol !== "postgres:") {
    throw new Error(`DATABASE_URL must be a postgresql:// URL (got ${u.protocol})`);
  }
  const database = decodeURIComponent(u.pathname.replace(/^\//, ""));
  if (!database) throw new Error("DATABASE_URL names no database");

  const host = decodeURIComponent(u.hostname).replace(/^\[(.*)\]$/, "$1");
  const env: Record<string, string> = {
    PGHOST: host,
    PGPORT: u.port || "5432",
    PGDATABASE: database,
  };
  if (u.username) env.PGUSER = decodeURIComponent(u.username);
  if (u.password) env.PGPASSWORD = decodeURIComponent(u.password);
  // libpq understands these two; everything else on a Prisma URL is Prisma's.
  const sslmode = u.searchParams.get("sslmode");
  if (sslmode) env.PGSSLMODE = sslmode;
  const connectTimeout = u.searchParams.get("connect_timeout");
  if (connectTimeout) env.PGCONNECT_TIMEOUT = connectTimeout;

  return { env, target: `${env.PGHOST}:${env.PGPORT}/${database}` };
}

/** The child's environment: ours (for PATH), minus any inherited PG* value, plus the URL's. */
function childEnv(conn: PgConnection): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [name, value] of Object.entries(process.env)) {
    if (!name.startsWith("PG")) env[name] = value;
  }
  return { ...env, ...conn.env };
}

async function run(bin: string, args: string[], conn: PgConnection): Promise<void> {
  try {
    await execFileAsync(bin, args, { env: childEnv(conn), maxBuffer: 16 * 1024 * 1024 });
  } catch (err) {
    const e = err as NodeJS.ErrnoException & { stderr?: string | Buffer };
    if (e.code === "ENOENT") {
      throw new Error(
        `${bin} is not installed or not on PATH (the database backups need it)`,
      );
    }
    const stderr = (e.stderr ?? "").toString().trim();
    throw new Error(`${bin} failed against ${conn.target}: ${stderr || e.message}`);
  }
}

/** `pg_dump (PostgreSQL) 17.x` — logged so a deploy log shows which client ran. */
export async function pgDumpVersion(pgDump = "pg_dump"): Promise<string> {
  const { stdout } = await execFileAsync(pgDump, ["--version"]);
  return stdout.trim();
}

export interface DumpOptions {
  databaseUrl: string;
  /** Where to write the archive. The caller owns the file. */
  outFile: string;
  pgDump?: string;
}

/**
 * `pg_dump --format=custom --compress=6` of the database DATABASE_URL names.
 * Custom format is what pg_restore reads and lets a restore pick tables; the
 * compression keeps the object small. Returns the archive size in bytes.
 */
export async function dumpDatabase(
  opts: DumpOptions,
): Promise<{ bytes: number; target: string }> {
  const conn = connectionFromUrl(opts.databaseUrl);
  await run(
    opts.pgDump ?? "pg_dump",
    ["--format=custom", "--compress=6", "--no-password", `--file=${opts.outFile}`],
    conn,
  );
  const { size } = await stat(opts.outFile);
  return { bytes: size, target: conn.target };
}

export interface RestoreOptions {
  /** A URL naming the database to restore INTO. It must already exist and be empty. */
  databaseUrl: string;
  inFile: string;
  pgRestore?: string;
}

/**
 * `pg_restore --no-owner --no-privileges --exit-on-error` into an existing,
 * empty database — the exact command docs/BACKUPS.md gives. `--exit-on-error`
 * is deliberate: a restore that stops is loud; a restore that skips objects is
 * a copy nobody can trust.
 */
export async function restoreDatabase(opts: RestoreOptions): Promise<{ target: string }> {
  const conn = connectionFromUrl(opts.databaseUrl);
  await run(
    opts.pgRestore ?? "pg_restore",
    [
      "--no-owner",
      "--no-privileges",
      "--exit-on-error",
      "--no-password",
      `--dbname=${conn.env.PGDATABASE}`,
      opts.inFile,
    ],
    conn,
  );
  return { target: conn.target };
}
