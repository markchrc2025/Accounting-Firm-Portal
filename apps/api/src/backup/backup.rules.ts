/**
 * backup.rules.ts — the rules of the database backups (D38), as pure functions.
 *
 * Nothing here touches a database, a bucket, the clock or the file system, so
 * every rule is tested exhaustively in track-a-backup.spec.ts without any of
 * them. The gate, the object keys, the schedule, the retention plan and the
 * "what is pending" computation all live here; backup.service.ts, the
 * scheduler and the pre-migrate command only apply them.
 */

/** Everything the module writes lives under this prefix in the files bucket. */
export const BACKUP_PREFIX = "backups/";
/** Nightly dumps: `backups/daily/<yyyy-mm-dd>.dump` (the Manila date). */
export const DAILY_PREFIX = `${BACKUP_PREFIX}daily/`;
/** Dumps taken before a production migration: `backups/pre-migrate/<utc>-<applied>.dump`. */
export const PRE_MIGRATE_PREFIX = `${BACKUP_PREFIX}pre-migrate/`;

/** Retention: the newest 30 nightly dumps are kept. */
export const DAILY_KEEP = 30;
/** Retention: a pre-migrate dump is kept for a year. */
export const PRE_MIGRATE_KEEP_DAYS = 365;

/** The nightly runs at 02:00 Asia/Manila. Manila is UTC+8 with no DST: 18:00 UTC. */
export const NIGHTLY_UTC_HOUR = 18;
export const BACKUP_TIME_ZONE = "Asia/Manila";

/** The bucket connection the files module already uses; the backups reuse it (R2). */
export const S3_VARIABLES = [
  "S3_ENDPOINT",
  "S3_BUCKET",
  "S3_ACCESS_KEY_ID",
  "S3_SECRET_ACCESS_KEY",
] as const;

export interface BackupEnv {
  NODE_ENV?: string;
  BACKUP_ENABLED?: string;
  S3_ENDPOINT?: string;
  S3_BUCKET?: string;
  S3_ACCESS_KEY_ID?: string;
  S3_SECRET_ACCESS_KEY?: string;
}

/** Why the backups are off is always said in words; a value is never repeated. */
export type BackupGate = { active: true } | { active: false; reason: string };

/**
 * R1(c): backups run only in production with the bucket configured, and
 * `BACKUP_ENABLED=false` turns them off. Local, CI and the test suites never
 * meet the first condition, so they never upload anything.
 */
export function backupGate(env: BackupEnv): BackupGate {
  if ((env.BACKUP_ENABLED ?? "").trim().toLowerCase() === "false") {
    return { active: false, reason: "BACKUP_ENABLED=false" };
  }
  if (env.NODE_ENV !== "production") {
    const seen = env.NODE_ENV ? `"${env.NODE_ENV}"` : "unset";
    return { active: false, reason: `NODE_ENV is ${seen}, not "production"` };
  }
  const missing = S3_VARIABLES.filter((name) => !env[name]);
  if (missing.length > 0) {
    return {
      active: false,
      reason: `bucket not configured: ${missing.join(", ")} unset`,
    };
  }
  return { active: true };
}

/** `20261010T181530Z` — a UTC instant that sorts lexically and is safe in a key. */
export function utcStamp(at: Date): string {
  return `${at.toISOString().replace(/[-:]/g, "").slice(0, 15)}Z`;
}

/** R1(a): `backups/pre-migrate/<UTC timestamp>-<applied-migration-count>.dump`. */
export function preMigrateKey(at: Date, appliedMigrations: number): string {
  return `${PRE_MIGRATE_PREFIX}${utcStamp(at)}-${appliedMigrations}.dump`;
}

/** The calendar date in Manila for an instant, as `yyyy-mm-dd`. */
export function manilaDate(at: Date): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: BACKUP_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(at);
  const part = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((p) => p.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

/** R1(b): `backups/daily/<yyyy-mm-dd>.dump`, dated by the Manila day the run happens in. */
export function dailyKey(at: Date): string {
  return `${DAILY_PREFIX}${manilaDate(at)}.dump`;
}

/** The next 18:00 UTC strictly after `now` — never `now` itself, so a run cannot repeat. */
export function nextNightlyRunAt(now: Date): Date {
  const next = new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate(),
      NIGHTLY_UTC_HOUR,
      0,
      0,
      0,
    ),
  );
  if (next.getTime() <= now.getTime()) next.setUTCDate(next.getUTCDate() + 1);
  return next;
}

const DAILY_KEY = /^backups\/daily\/\d{4}-\d{2}-\d{2}\.dump$/;
const PRE_MIGRATE_KEY =
  /^backups\/pre-migrate\/(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z-\d+\.dump$/;

/**
 * R1(b) retention. Given every key under the two backup prefixes, returns the
 * keys to delete: all but the newest DAILY_KEEP daily dumps (newest by the date
 * in the name), and every pre-migrate dump older than PRE_MIGRATE_KEEP_DAYS (by
 * the timestamp in the name). A key that does not match the module's own
 * naming — anything a person put there by hand, a partial upload, anything
 * outside backups/ — is never in the plan.
 */
export function prunePlan(keys: readonly string[], now: Date): string[] {
  const plan: string[] = [];

  const daily = keys
    .filter((k) => DAILY_KEY.test(k))
    .sort()
    .reverse();
  plan.push(...daily.slice(DAILY_KEEP));

  const cutoff = now.getTime() - PRE_MIGRATE_KEEP_DAYS * 86_400_000;
  for (const key of keys) {
    const m = PRE_MIGRATE_KEY.exec(key);
    if (!m) continue;
    const [, y, mo, d, h, mi, s] = m;
    const takenAt = Date.UTC(
      Number(y),
      Number(mo) - 1,
      Number(d),
      Number(h),
      Number(mi),
      Number(s),
    );
    if (takenAt < cutoff) plan.push(key);
  }
  return plan;
}

/**
 * Migrations present in prisma/migrations that the database's _prisma_migrations
 * table has not recorded as applied — the same comparison `prisma migrate
 * deploy` is about to make. Sorted by name (Prisma's migration order).
 */
export function pendingMigrations(
  directoryNames: readonly string[],
  appliedNames: readonly string[],
): string[] {
  const applied = new Set(appliedNames);
  return [...directoryNames].sort().filter((name) => !applied.has(name));
}
