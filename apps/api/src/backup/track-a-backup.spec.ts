/**
 * track-a-backup.spec.ts — hermetic tests for the backup module (U7, T2–T5).
 *
 * Nothing here touches a database, a bucket, a timer or pg_dump: the store, the
 * dumper, the migrate step and the clock are all injected. What is proven:
 *
 *   T2  the pre-migrate sequence fails closed — a failing dump or upload exits
 *       non-zero and NEVER runs migrate; a good upload runs migrate once, after
 *       the upload; zero pending migrations runs migrate without dumping.
 *   T3  the gate — not production / no bucket credentials / BACKUP_ENABLED=false
 *       skips with one log line, migrate still runs, the nightly is not
 *       registered; production + credentials + flag unset activates both.
 *   T4  retention — 35 daily keys keep the 30 newest; pre-migrate keys younger
 *       than a year are kept, older deleted; nothing outside backups/ is listed.
 *   T5  the nightly — registered for 18:00 UTC; the key carries the MANILA date.
 */
import { writeFile } from "node:fs/promises";
import {
  DAILY_KEEP,
  DAILY_PREFIX,
  NIGHTLY_UTC_HOUR,
  PRE_MIGRATE_KEEP_DAYS,
  PRE_MIGRATE_PREFIX,
  backupGate,
  dailyKey,
  nextNightlyRunAt,
  pendingMigrations,
  checkDumpClient,
  pgMajorFromVersionString,
  preMigrateKey,
  prunePlan,
  serverMajorFromVersionNum,
} from "./backup.rules";
import { connectionFromUrl } from "./pg-dump";
import { BackupLog, BackupSentry, BackupService, BackupStore } from "./backup.service";
import { NightlyScheduler } from "./backup.scheduler";
import { cli, runMigrateWithBackup } from "./pre-migrate";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const PROD_ENV = {
  NODE_ENV: "production",
  S3_ENDPOINT: "https://bucket.example.invalid",
  S3_BUCKET: "a-bucket",
  S3_ACCESS_KEY_ID: "key-id",
  S3_SECRET_ACCESS_KEY: "key-secret",
};

function envReader(env: Record<string, string | undefined>) {
  return (name: string) => env[name];
}

function fakeLog(): BackupLog & { lines: string[] } {
  const lines: string[] = [];
  return {
    lines,
    log: (m) => lines.push(`log ${m}`),
    warn: (m) => lines.push(`warn ${m}`),
    error: (m) => lines.push(`error ${m}`),
  };
}

interface StoreRecord {
  puts: Array<{ key: string; bytes: number; contentType: string }>;
  listedPrefixes: string[];
  deleted: string[];
}

function fakeStore(
  objects: string[] = [],
  opts: { failPut?: Error } = {},
): BackupStore & StoreRecord {
  const rec: StoreRecord = { puts: [], listedPrefixes: [], deleted: [] };
  return {
    ...rec,
    isEnabled: () => true,
    async putObject(key, body, contentType) {
      if (opts.failPut) throw opts.failPut;
      rec.puts.push({ key, bytes: body.byteLength, contentType });
      if (!objects.includes(key)) objects.push(key); // a bucket lists what was put
    },
    async listObjects(prefix) {
      rec.listedPrefixes.push(prefix);
      return objects
        .filter((k) => k.startsWith(prefix))
        .map((key) => ({ key, size: 1, lastModified: null }));
    },
    async deleteObject(key) {
      rec.deleted.push(key);
    },
  };
}

/** A dumper that writes `bytes` real bytes to the file the service asked for. */
function fakeDumper(bytes = 2048, fail?: Error) {
  const calls: string[] = [];
  const dump = async ({ outFile }: { databaseUrl: string; outFile: string }) => {
    calls.push(outFile);
    if (fail) throw fail;
    await writeFile(outFile, Buffer.alloc(bytes, 7));
    return { bytes, target: "localhost:5432/portal" };
  };
  return { dump, calls };
}

function service(
  env: Record<string, string | undefined>,
  store = fakeStore(),
  dumper = fakeDumper(),
  now = () => new Date("2026-10-10T18:00:00.000Z"),
) {
  const logger = fakeLog();
  const svc = new BackupService({
    store,
    env: envReader({
      DATABASE_URL: "postgresql://u:p@localhost:5432/portal?schema=public",
      ...env,
    }),
    dump: dumper.dump,
    logger,
    now,
    // The VM this suite was written on: pg_dump 16 against server 16 (U7-A1 R5).
    clientVersion: async () =>
      "pg_dump (PostgreSQL) 16.13 (Ubuntu 16.13-0ubuntu0.24.04.1)",
    serverVersionNum: async () => 160013,
    sentry: fakeSentry(false),
  });
  return { svc, store, dumper, logger };
}

function fakeSentry(enabled: boolean): BackupSentry & { captured: unknown[] } {
  const captured: unknown[] = [];
  return {
    captured,
    isEnabled: () => enabled,
    captureException: (error) => {
      captured.push(error);
      return "event-id";
    },
  };
}

// ---------------------------------------------------------------------------
// The gate (T3)
// ---------------------------------------------------------------------------

describe("backupGate — only production with bucket credentials, unless switched off", () => {
  it("is active in production with all four S3 variables set and BACKUP_ENABLED unset", () => {
    expect(backupGate(PROD_ENV)).toEqual({ active: true });
  });

  it("is active when BACKUP_ENABLED is anything but false", () => {
    expect(backupGate({ ...PROD_ENV, BACKUP_ENABLED: "true" })).toEqual({ active: true });
    expect(backupGate({ ...PROD_ENV, BACKUP_ENABLED: "" })).toEqual({ active: true });
  });

  it("is off when BACKUP_ENABLED=false (any case), and says so", () => {
    const g = backupGate({ ...PROD_ENV, BACKUP_ENABLED: "false" });
    expect(g.active).toBe(false);
    if (!g.active) expect(g.reason).toBe("BACKUP_ENABLED=false");
    expect(backupGate({ ...PROD_ENV, BACKUP_ENABLED: " FALSE " }).active).toBe(false);
  });

  it("is off outside production, naming the NODE_ENV it saw", () => {
    const g = backupGate({ ...PROD_ENV, NODE_ENV: "development" });
    expect(g).toEqual({
      active: false,
      reason: 'NODE_ENV is "development", not "production"',
    });
    expect(backupGate({ ...PROD_ENV, NODE_ENV: undefined })).toEqual({
      active: false,
      reason: 'NODE_ENV is unset, not "production"',
    });
    expect(backupGate({ ...PROD_ENV, NODE_ENV: "test" }).active).toBe(false);
  });

  it("is off when any bucket credential is missing, naming the variable (never a value)", () => {
    const g = backupGate({
      ...PROD_ENV,
      S3_SECRET_ACCESS_KEY: undefined,
      S3_ENDPOINT: "",
    });
    expect(g).toEqual({
      active: false,
      reason: "bucket not configured: S3_ENDPOINT, S3_SECRET_ACCESS_KEY unset",
    });
    if (!g.active) {
      expect(g.reason).not.toContain("key-id");
      expect(g.reason).not.toContain("a-bucket");
    }
  });

  it("reports the off switch before anything else", () => {
    const g = backupGate({ NODE_ENV: "development", BACKUP_ENABLED: "false" });
    if (!g.active) expect(g.reason).toBe("BACKUP_ENABLED=false");
    expect(g.active).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Keys and the clock (T5, R1a)
// ---------------------------------------------------------------------------

describe("object keys", () => {
  it("pre-migrate: backups/pre-migrate/<UTC timestamp>-<applied-migration-count>.dump", () => {
    expect(preMigrateKey(new Date("2026-10-10T18:15:30.250Z"), 33)).toBe(
      "backups/pre-migrate/20261010T181530Z-33.dump",
    );
    expect(preMigrateKey(new Date("2026-01-02T03:04:05Z"), 0)).toBe(
      "backups/pre-migrate/20260102T030405Z-0.dump",
    );
  });

  it("daily: backups/daily/<yyyy-mm-dd>.dump for the MANILA date, not the UTC date", () => {
    // 18:00 UTC on the 10th is 02:00 on the 11th in Manila (UTC+8, no DST).
    expect(dailyKey(new Date("2026-10-10T18:00:00Z"))).toBe(
      "backups/daily/2026-10-11.dump",
    );
    // 15:59:59 UTC is still 23:59:59 on the same Manila day.
    expect(dailyKey(new Date("2026-10-10T15:59:59Z"))).toBe(
      "backups/daily/2026-10-10.dump",
    );
    // 16:00:00 UTC is midnight in Manila: the next day.
    expect(dailyKey(new Date("2026-10-10T16:00:00Z"))).toBe(
      "backups/daily/2026-10-11.dump",
    );
    // Year boundary.
    expect(dailyKey(new Date("2026-12-31T18:00:00Z"))).toBe(
      "backups/daily/2027-01-01.dump",
    );
  });

  it("prefixes are exactly the two the retention rules name", () => {
    expect(DAILY_PREFIX).toBe("backups/daily/");
    expect(PRE_MIGRATE_PREFIX).toBe("backups/pre-migrate/");
  });
});

describe("nextNightlyRunAt — the next 18:00 UTC (02:00 Asia/Manila) strictly after now", () => {
  it("is 18:00 today when now is before it", () => {
    expect(NIGHTLY_UTC_HOUR).toBe(18);
    expect(nextNightlyRunAt(new Date("2026-10-10T10:00:00Z")).toISOString()).toBe(
      "2026-10-10T18:00:00.000Z",
    );
    expect(nextNightlyRunAt(new Date("2026-10-10T17:59:59.999Z")).toISOString()).toBe(
      "2026-10-10T18:00:00.000Z",
    );
  });

  it("is 18:00 tomorrow when now is 18:00 or later (never 'now', never twice)", () => {
    expect(nextNightlyRunAt(new Date("2026-10-10T18:00:00.000Z")).toISOString()).toBe(
      "2026-10-11T18:00:00.000Z",
    );
    expect(nextNightlyRunAt(new Date("2026-10-10T23:30:00Z")).toISOString()).toBe(
      "2026-10-11T18:00:00.000Z",
    );
  });
});

// ---------------------------------------------------------------------------
// Pending migrations
// ---------------------------------------------------------------------------

describe("pendingMigrations — directory names the database has not applied", () => {
  const dirs = ["20240101000000_a", "20240201000000_b", "20240301000000_c"];

  it("is empty when every directory is applied", () => {
    expect(pendingMigrations(dirs, [...dirs])).toEqual([]);
  });

  it("lists the unapplied ones in order, ignoring applied names that have no directory", () => {
    expect(pendingMigrations(dirs, ["20240101000000_a", "19990101000000_gone"])).toEqual([
      "20240201000000_b",
      "20240301000000_c",
    ]);
  });

  it("treats an empty history (fresh database) as everything pending", () => {
    expect(pendingMigrations(dirs, [])).toEqual(dirs);
  });
});

// ---------------------------------------------------------------------------
// The connection handed to pg_dump
// ---------------------------------------------------------------------------

describe("connectionFromUrl — PG* variables, no schema parameter, no password in the printable target", () => {
  it("splits a Prisma URL into libpq variables and drops ?schema=", () => {
    const c = connectionFromUrl(
      "postgresql://portal:s3cr%40t@db.internal:6543/portal_db?schema=public",
    );
    expect(c.env).toEqual({
      PGHOST: "db.internal",
      PGPORT: "6543",
      PGUSER: "portal",
      PGPASSWORD: "s3cr@t",
      PGDATABASE: "portal_db",
    });
    expect(c.target).toBe("db.internal:6543/portal_db");
  });

  it("defaults the port, accepts postgres://, and passes sslmode through", () => {
    const c = connectionFromUrl("postgres://u:p@host/db?schema=public&sslmode=require");
    expect(c.env.PGPORT).toBe("5432");
    expect(c.env.PGSSLMODE).toBe("require");
    expect(c.env.PGDATABASE).toBe("db");
  });

  it("refuses a URL that is not PostgreSQL or names no database", () => {
    expect(() => connectionFromUrl("mysql://u:p@h/db")).toThrow(/postgres/i);
    expect(() => connectionFromUrl("postgresql://u:p@h/")).toThrow(/database/i);
  });
});

// ---------------------------------------------------------------------------
// Retention (T4)
// ---------------------------------------------------------------------------

function dailyKeys(from: string, days: number): string[] {
  const start = new Date(`${from}T00:00:00Z`).getTime();
  const out: string[] = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(start + i * 86_400_000).toISOString().slice(0, 10);
    out.push(`${DAILY_PREFIX}${d}.dump`);
  }
  return out;
}

describe("prunePlan — newest 30 daily, a year of pre-migrate, nothing else", () => {
  const now = new Date("2026-10-11T18:05:00Z");

  it("with 35 daily dumps keeps the 30 newest and deletes the 5 oldest", () => {
    expect(DAILY_KEEP).toBe(30);
    const keys = dailyKeys("2026-09-07", 35); // 2026-09-07 … 2026-10-11
    const shuffled = [...keys].reverse();
    const plan = prunePlan(shuffled, now);
    expect(plan.sort()).toEqual(dailyKeys("2026-09-07", 5).sort());
    for (const kept of dailyKeys("2026-09-12", 30)) expect(plan).not.toContain(kept);
  });

  it("with 30 or fewer daily dumps deletes none", () => {
    expect(prunePlan(dailyKeys("2026-09-12", 30), now)).toEqual([]);
    expect(prunePlan(dailyKeys("2026-10-01", 3), now)).toEqual([]);
  });

  it("keeps a pre-migrate dump younger than 365 days and deletes an older one", () => {
    expect(PRE_MIGRATE_KEEP_DAYS).toBe(365);
    const young = `${PRE_MIGRATE_PREFIX}20251012T000000Z-30.dump`; // 364d 18h ago
    const edge = `${PRE_MIGRATE_PREFIX}20251011T180500Z-30.dump`; // exactly 365d ago
    const old = `${PRE_MIGRATE_PREFIX}20251011T180459Z-29.dump`; // 365d + 1s ago
    const ancient = `${PRE_MIGRATE_PREFIX}20240101T000000Z-1.dump`;
    const plan = prunePlan([young, edge, old, ancient], now);
    expect(plan).toEqual([old, ancient]);
  });

  it("never plans a delete outside backups/daily/ and backups/pre-migrate/, nor a key it cannot date", () => {
    const foreign = [
      "avatars/user-1",
      "firm-1/client-1",
      "bir-forms/firm-1/form-1/2550Q.pdf",
      "backups/manual/keep-me.dump",
      "backups/daily/notes.txt",
      "backups/daily/2026-10-11.dump.partial",
      "backups/pre-migrate/README",
      "backups/pre-migrate/20240101T000000Z.dump", // no applied count: not ours
    ];
    expect(prunePlan(foreign, now)).toEqual([]);
    // Even when mixed with 35 real daily keys, only the 5 oldest daily keys go.
    const plan = prunePlan([...foreign, ...dailyKeys("2026-09-07", 35)], now);
    expect(plan.length).toBe(5);
    for (const f of foreign) expect(plan).not.toContain(f);
  });
});

describe("BackupService.prune — lists only the two backup prefixes and deletes only the plan", () => {
  it("deletes the 5 oldest of 35 daily keys and an old pre-migrate key, nothing else", async () => {
    const objects = [
      ...dailyKeys("2026-09-07", 35),
      `${PRE_MIGRATE_PREFIX}20240101T000000Z-1.dump`,
      `${PRE_MIGRATE_PREFIX}20261001T000000Z-33.dump`,
      "avatars/user-1",
      "backups/manual/keep-me.dump",
    ];
    const store = fakeStore(objects);
    const { svc } = service(
      PROD_ENV,
      store,
      fakeDumper(),
      () => new Date("2026-10-11T18:05:00Z"),
    );

    const result = await svc.prune();

    expect(store.listedPrefixes.sort()).toEqual(
      [DAILY_PREFIX, PRE_MIGRATE_PREFIX].sort(),
    );
    expect(store.deleted.sort()).toEqual(
      [
        ...dailyKeys("2026-09-07", 5),
        `${PRE_MIGRATE_PREFIX}20240101T000000Z-1.dump`,
      ].sort(),
    );
    expect(result.deleted.length).toBe(6);
    expect(store.deleted).not.toContain("avatars/user-1");
    expect(store.deleted).not.toContain("backups/manual/keep-me.dump");
  });
});

// ---------------------------------------------------------------------------
// dump → upload (the service)
// ---------------------------------------------------------------------------

describe("BackupService.backup — dumps to a temp file, uploads it under the key, removes the file", () => {
  it("uploads the dumped bytes as application/octet-stream and cleans up", async () => {
    const { svc, store, dumper } = service(PROD_ENV, fakeStore(), fakeDumper(4096));
    const result = await svc.backup("backups/daily/2026-10-11.dump");
    expect(result).toEqual({ key: "backups/daily/2026-10-11.dump", bytes: 4096 });
    expect(store.puts).toEqual([
      {
        key: "backups/daily/2026-10-11.dump",
        bytes: 4096,
        contentType: "application/octet-stream",
      },
    ]);
    expect(dumper.calls.length).toBe(1);
    expect(svc.tempDirsOpen).toBe(0);
  });

  it("a failing upload propagates and still removes the temp file", async () => {
    const store = fakeStore([], { failPut: new Error("bucket said 403") });
    const { svc } = service(PROD_ENV, store);
    await expect(svc.backup("backups/daily/x.dump")).rejects.toThrow("bucket said 403");
    expect(svc.tempDirsOpen).toBe(0);
  });

  it("a failing dump never calls the store", async () => {
    const store = fakeStore();
    const { svc } = service(
      PROD_ENV,
      store,
      fakeDumper(0, new Error("pg_dump: server version mismatch")),
    );
    await expect(svc.backup("backups/daily/x.dump")).rejects.toThrow(
      "server version mismatch",
    );
    expect(store.puts).toEqual([]);
    expect(svc.tempDirsOpen).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// The nightly run (T5, B3)
// ---------------------------------------------------------------------------

describe("BackupService.runNightly — one line per run, failures logged and never thrown", () => {
  it("uploads backups/daily/<Manila date>.dump, prunes, and logs key and size on one line", async () => {
    // 35 nightly dumps already there, 2026-09-06 … 2026-10-10; tonight's is the 36th.
    const store = fakeStore(dailyKeys("2026-09-06", 35));
    const { svc, logger } = service(
      PROD_ENV,
      store,
      fakeDumper(104_449),
      () => new Date("2026-10-10T18:00:00Z"),
    );
    await svc.runNightly();
    expect(store.puts.map((p) => p.key)).toEqual(["backups/daily/2026-10-11.dump"]);
    const line = logger.lines.find((l) => l.includes("nightly"));
    expect(line).toBeDefined();
    expect(line).toContain("backups/daily/2026-10-11.dump");
    expect(line).toContain("104449");
    // Prune ran AFTER the upload: the new object counts, 36 daily → the 6 oldest go.
    expect(store.deleted.sort()).toEqual(dailyKeys("2026-09-06", 6).sort());
    expect(store.deleted).not.toContain("backups/daily/2026-10-11.dump");
  });

  it("does not throw when the upload fails, and does not prune", async () => {
    const store = fakeStore(dailyKeys("2026-09-07", 35), {
      failPut: new Error("no route to bucket"),
    });
    const { svc, logger } = service(PROD_ENV, store);
    await expect(svc.runNightly()).resolves.toBeUndefined();
    expect(
      logger.lines.some((l) => l.startsWith("error") && l.includes("no route to bucket")),
    ).toBe(true);
    expect(store.deleted).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// The scheduler (T3, T5)
// ---------------------------------------------------------------------------

interface FakeTimer {
  fn: () => void;
  ms: number;
  cleared: boolean;
}

function fakeClock(start: string) {
  let now = new Date(start);
  const timers: FakeTimer[] = [];
  return {
    timers,
    now: () => now,
    advanceTo: (iso: string) => {
      now = new Date(iso);
    },
    setTimer: (fn: () => void, ms: number) => {
      const t: FakeTimer = { fn, ms, cleared: false };
      timers.push(t);
      return t;
    },
    clearTimer: (t: unknown) => {
      (t as FakeTimer).cleared = true;
    },
  };
}

describe("NightlyScheduler", () => {
  it("is not registered when the gate is off, and says why", () => {
    const clock = fakeClock("2026-10-10T10:00:00Z");
    const logger = fakeLog();
    const runs: Date[] = [];
    const s = new NightlyScheduler({
      gate: backupGate({ ...PROD_ENV, NODE_ENV: "test" }),
      run: async (now) => {
        runs.push(now);
      },
      logger,
      ...clock,
    });
    const r = s.start();
    expect(r.registered).toBe(false);
    expect(r.nextRunAt).toBeNull();
    expect(clock.timers).toEqual([]);
    expect(
      logger.lines.some(
        (l) => l.includes("not scheduled") && l.includes('NODE_ENV is "test"'),
      ),
    ).toBe(true);
  });

  it("when active, registers the first run at the next 18:00 UTC and re-arms after each run", async () => {
    const clock = fakeClock("2026-10-10T10:00:00Z");
    const logger = fakeLog();
    const runs: Date[] = [];
    const s = new NightlyScheduler({
      gate: backupGate(PROD_ENV),
      run: async (now) => {
        runs.push(now);
      },
      logger,
      ...clock,
    });
    const r = s.start();
    expect(r.registered).toBe(true);
    expect(r.nextRunAt?.toISOString()).toBe("2026-10-10T18:00:00.000Z");
    expect(clock.timers.length).toBe(1);
    expect(clock.timers[0]?.ms).toBe(8 * 3600 * 1000);
    expect(logger.lines.some((l) => l.includes("2026-10-10T18:00:00.000Z"))).toBe(true);

    // The timer fires at 18:00: the job runs with that moment, then the next
    // run is armed for 18:00 tomorrow — 24 h later, never immediately again.
    clock.advanceTo("2026-10-10T18:00:00.000Z");
    clock.timers[0]?.fn();
    await new Promise((resolve) => setImmediate(resolve));
    expect(runs.map((d) => d.toISOString())).toEqual(["2026-10-10T18:00:00.000Z"]);
    expect(clock.timers.length).toBe(2);
    expect(clock.timers[1]?.ms).toBe(24 * 3600 * 1000);
    expect(s.nextRunAt?.toISOString()).toBe("2026-10-11T18:00:00.000Z");

    s.stop();
    expect(clock.timers[1]?.cleared).toBe(true);
    expect(s.nextRunAt).toBeNull();
  });

  it("a job that throws does not stop the chain", async () => {
    const clock = fakeClock("2026-10-10T17:00:00Z");
    const logger = fakeLog();
    const s = new NightlyScheduler({
      gate: backupGate(PROD_ENV),
      run: async () => {
        throw new Error("boom");
      },
      logger,
      ...clock,
    });
    s.start();
    clock.advanceTo("2026-10-10T18:00:00.000Z");
    clock.timers[0]?.fn();
    await new Promise((resolve) => setImmediate(resolve));
    expect(clock.timers.length).toBe(2);
    expect(logger.lines.some((l) => l.startsWith("error") && l.includes("boom"))).toBe(
      true,
    );
  });
});

// ---------------------------------------------------------------------------
// The pre-migrate sequence (T2, T3)
// ---------------------------------------------------------------------------

function sequence(opts: {
  gate?: ReturnType<typeof backupGate>;
  pending?: string[];
  applied?: number;
  backupError?: Error;
  pendingError?: Error;
}) {
  const events: string[] = [];
  const lines: string[] = [];
  const deps = {
    gate: opts.gate ?? backupGate(PROD_ENV),
    pending: async () => {
      events.push("pending");
      if (opts.pendingError) throw opts.pendingError;
      return { pending: opts.pending ?? [], applied: opts.applied ?? 33 };
    },
    backup: async (key: string) => {
      events.push(`backup:${key}`);
      if (opts.backupError) throw opts.backupError;
      return { key, bytes: 104_449 };
    },
    migrate: async () => {
      events.push("migrate");
    },
    now: () => new Date("2026-10-10T18:15:30Z"),
    log: (line: string) => lines.push(line),
  };
  return { deps, events, lines };
}

describe("runMigrateWithBackup — the production start sequence (T2)", () => {
  it("pending + failing upload: throws, and migrate is NEVER invoked", async () => {
    const { deps, events } = sequence({
      pending: ["20261010000000_u8"],
      backupError: new Error("upload failed: bucket said 403"),
    });
    await expect(runMigrateWithBackup(deps)).rejects.toThrow("bucket said 403");
    expect(events).toEqual([
      "pending",
      "backup:backups/pre-migrate/20261010T181530Z-33.dump",
    ]);
    expect(events).not.toContain("migrate");
  });

  it("…and the command exits non-zero (1) in that case", async () => {
    const { deps, events, lines } = sequence({
      pending: ["20261010000000_u8"],
      backupError: new Error("upload failed: bucket said 403"),
    });
    await expect(cli(deps)).resolves.toBe(1);
    expect(events).not.toContain("migrate");
    expect(lines.some((l) => l.includes("bucket said 403"))).toBe(true);
    expect(lines.some((l) => l.includes("NOT migrated"))).toBe(true);
  });

  it("pending + succeeding upload: migrate runs exactly once, after the upload", async () => {
    const { deps, events, lines } = sequence({
      pending: ["20261010000000_u8", "20261011000000_u9"],
    });
    const result = await runMigrateWithBackup(deps);
    expect(events).toEqual([
      "pending",
      "backup:backups/pre-migrate/20261010T181530Z-33.dump",
      "migrate",
    ]);
    expect(events.filter((e) => e === "migrate").length).toBe(1);
    expect(result).toEqual({
      outcome: "backed-up",
      key: "backups/pre-migrate/20261010T181530Z-33.dump",
      bytes: 104_449,
      pending: ["20261010000000_u8", "20261011000000_u9"],
    });
    expect(
      lines.some(
        (l) => l.includes("20261010000000_u8") && l.includes("20261011000000_u9"),
      ),
    ).toBe(true);
    expect(
      lines.some(
        (l) =>
          l.includes("backups/pre-migrate/20261010T181530Z-33.dump") &&
          l.includes("104449"),
      ),
    ).toBe(true);
    await expect(cli(deps)).resolves.toBe(0);
  });

  it("zero pending: migrate runs once and nothing is dumped", async () => {
    const { deps, events, lines } = sequence({ pending: [], applied: 33 });
    const result = await runMigrateWithBackup(deps);
    expect(events).toEqual(["pending", "migrate"]);
    expect(result).toEqual({ outcome: "nothing-pending", applied: 33 });
    expect(
      lines.some((l) => l.includes("no pending migrations") && l.includes("33")),
    ).toBe(true);
  });

  it("a failure reading the migration history also fails closed", async () => {
    const { deps, events } = sequence({ pendingError: new Error("connection refused") });
    await expect(cli(deps)).resolves.toBe(1);
    expect(events).toEqual(["pending"]);
  });

  it("the key counts the migrations applied at dump time", async () => {
    const { deps, events } = sequence({ pending: ["x"], applied: 7 });
    await runMigrateWithBackup(deps);
    expect(events[1]).toBe("backup:backups/pre-migrate/20261010T181530Z-7.dump");
  });
});

describe("runMigrateWithBackup — the gate (T3)", () => {
  it.each([
    [
      "not production",
      { ...PROD_ENV, NODE_ENV: "development" },
      'NODE_ENV is "development"',
    ],
    ["no bucket credentials", { NODE_ENV: "production" }, "bucket not configured"],
    [
      "BACKUP_ENABLED=false",
      { ...PROD_ENV, BACKUP_ENABLED: "false" },
      "BACKUP_ENABLED=false",
    ],
  ])(
    "%s: skips with one line saying why, migrate still runs, nothing is read or dumped",
    async (_name, env, why) => {
      const { deps, events, lines } = sequence({
        gate: backupGate(env),
        pending: ["20261010000000_u8"],
      });
      const result = await runMigrateWithBackup(deps);
      expect(events).toEqual(["migrate"]);
      expect(result).toEqual({
        outcome: "skipped",
        reason: expect.stringContaining(why),
      });
      const skipLines = lines.filter((l) => l.includes("skipped"));
      expect(skipLines.length).toBe(1);
      expect(skipLines[0]).toContain(why);
      await expect(cli(deps)).resolves.toBe(0);
    },
  );

  it("production + credentials + flag unset: the pre-migrate dump is taken and the nightly is registered", async () => {
    const gate = backupGate(PROD_ENV);
    const { deps, events } = sequence({ gate, pending: ["20261010000000_u8"] });
    await runMigrateWithBackup(deps);
    expect(events).toEqual([
      "pending",
      "backup:backups/pre-migrate/20261010T181530Z-33.dump",
      "migrate",
    ]);

    const clock = fakeClock("2026-10-10T10:00:00Z");
    const s = new NightlyScheduler({
      gate,
      run: async () => undefined,
      logger: fakeLog(),
      ...clock,
    });
    expect(s.start().registered).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// U7-A1: pg_dump must not be older than the server (R2)
// ---------------------------------------------------------------------------

const R2_MESSAGE =
  "pg_dump 17 is older than the server 18: install postgresql-client-18 in apps/api/Dockerfile";

/** A BackupService whose pg_dump and server report the given majors; everything else faked. */
function serviceWithVersions(
  clientVersionLine: string,
  serverVersionNum: number,
  opts: {
    store?: ReturnType<typeof fakeStore>;
    dumper?: ReturnType<typeof fakeDumper>;
    sentry?: BackupSentry;
  } = {},
) {
  const store = opts.store ?? fakeStore();
  const dumper = opts.dumper ?? fakeDumper(2048);
  const logger = fakeLog();
  const versions = {
    clientVersion: async () => clientVersionLine,
    serverVersionNum: async () => serverVersionNum,
  };
  const svc = new BackupService({
    store,
    env: envReader({
      DATABASE_URL: "postgresql://u:p@localhost:5432/portal?schema=public",
      ...PROD_ENV,
    }),
    dump: dumper.dump,
    logger,
    now: () => new Date("2026-10-10T18:15:30Z"),
    sentry: opts.sentry ?? fakeSentry(false),
    ...versions,
  });
  return { svc, store, dumper, logger };
}

describe("U7-A1 T1 — pg_dump older than the server: the pre-migrate command refuses before any dump", () => {
  it("(client 17, server 18) with pending migrations: no dump attempted, migrate never invoked, exit 1, the R2 line", async () => {
    const { svc, store, dumper } = serviceWithVersions(
      "pg_dump (PostgreSQL) 17.6 (Debian 17.6-1.pgdg120+1)",
      180000,
    );
    const events: string[] = [];
    const lines: string[] = [];
    const code = await cli({
      gate: backupGate(PROD_ENV),
      pending: async () => ({ pending: ["20261011000000_u3_seal"], applied: 33 }),
      backup: (key: string) => svc.backup(key),
      migrate: async () => {
        events.push("migrate");
      },
      now: () => new Date("2026-10-10T18:15:30Z"),
      log: (line: string) => lines.push(line),
    });
    expect(dumper.calls).toEqual([]); // today the dump is attempted — this is the line that fails first
    expect(store.puts).toEqual([]);
    expect(events).toEqual([]);
    expect(code).toBe(1);
    expect(lines.some((l) => l.includes(R2_MESSAGE))).toBe(true);
    expect(lines.some((l) => l.includes("NOT migrated"))).toBe(true);
  });
});

describe("U7-A1 T2 — equal or newer clients dump; the nightly on an older client refuses, logs and reports", () => {
  it.each([
    ["18 vs 18", "pg_dump (PostgreSQL) 18.0 (Debian 18.0-1.pgdg120+1)", 180000],
    ["18 vs 16", "pg_dump (PostgreSQL) 18.0 (Debian 18.0-1.pgdg120+1)", 160013],
  ])(
    "client %s: proceeds to the dump and the upload, logging both versions",
    async (_name, client, server) => {
      const { svc, store, dumper, logger } = serviceWithVersions(client, server);
      const result = await svc.backup("backups/daily/2026-10-11.dump");
      expect(dumper.calls.length).toBe(1);
      expect(store.puts.map((p) => p.key)).toEqual(["backups/daily/2026-10-11.dump"]);
      expect(result.bytes).toBe(2048);
      expect(
        logger.lines.some(
          (l) => l.includes(client) && l.includes(`server_version_num ${server}`),
        ),
      ).toBe(true);
    },
  );

  it("checkDumpClient: (17, 18) is the exact R2 line; 18beta1 counts as 18; 9.6 numbering; an unreadable version is refused", () => {
    expect(
      checkDumpClient("pg_dump (PostgreSQL) 17.6 (Debian 17.6-1.pgdg120+1)", 180000),
    ).toEqual({
      ok: false,
      clientMajor: 17,
      serverMajor: 18,
      message: R2_MESSAGE,
    });
    expect(checkDumpClient("pg_dump (PostgreSQL) 18beta1", 180000)).toEqual({
      ok: true,
      clientMajor: 18,
      serverMajor: 18,
    });
    expect(
      checkDumpClient(
        "pg_dump (PostgreSQL) 16.13 (Ubuntu 16.13-0ubuntu0.24.04.1)",
        160013,
      ),
    ).toEqual({
      ok: true,
      clientMajor: 16,
      serverMajor: 16,
    });
    expect(serverMajorFromVersionNum(90624)).toBe(9);
    expect(serverMajorFromVersionNum(100000)).toBe(10);
    expect(pgMajorFromVersionString("sh: pg_dump: not found")).toBeNull();
    const bad = checkDumpClient("garbage", 180000);
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.message).toContain("could not be read");
  });

  it("the pre-migrate command on (18, 18) with pending migrations dumps, uploads and migrates (exit 0)", async () => {
    const { svc, store, dumper } = serviceWithVersions(
      "pg_dump (PostgreSQL) 18.0 (Debian 18.0-1.pgdg120+1)",
      180000,
    );
    const events: string[] = [];
    const lines: string[] = [];
    const code = await cli({
      gate: backupGate(PROD_ENV),
      pending: async () => ({ pending: ["20261011000000_u3_seal"], applied: 33 }),
      backup: (key: string) => svc.backup(key),
      migrate: async () => {
        events.push("migrate");
      },
      now: () => new Date("2026-10-10T18:15:30Z"),
      log: (line: string) => lines.push(line),
    });
    expect(code).toBe(0);
    expect(dumper.calls.length).toBe(1);
    expect(store.puts.map((p) => p.key)).toEqual([
      "backups/pre-migrate/20261010T181530Z-33.dump",
    ]);
    expect(events).toEqual(["migrate"]);
  });

  it("nightly on (17, 18): logs the failure line with the R2 message, uploads nothing, prunes nothing", async () => {
    const store = fakeStore(dailyKeys("2026-09-06", 35));
    const { svc, dumper, logger } = serviceWithVersions(
      "pg_dump (PostgreSQL) 17.6 (Debian 17.6-1.pgdg120+1)",
      180000,
      {
        store,
      },
    );
    await expect(
      svc.runNightly(new Date("2026-10-10T18:00:00Z")),
    ).resolves.toBeUndefined();
    expect(dumper.calls).toEqual([]);
    expect(store.puts).toEqual([]);
    expect(store.deleted).toEqual([]);
    const line = logger.lines.find((l) => l.startsWith("error"));
    expect(line).toBe(
      `error nightly backup FAILED for backups/daily/2026-10-11.dump: ${R2_MESSAGE}`,
    );
  });

  it("a failed nightly reaches Sentry once when Sentry is configured", async () => {
    const sentry = fakeSentry(true);
    const { svc } = serviceWithVersions(
      "pg_dump (PostgreSQL) 17.6 (Debian 17.6-1.pgdg120+1)",
      180000,
      { sentry },
    );
    await svc.runNightly(new Date("2026-10-10T18:00:00Z"));
    expect(sentry.captured.length).toBe(1);
    const reported = sentry.captured[0] as Error & { cause?: unknown };
    expect(reported).toBeInstanceOf(Error);
    expect(reported.message).toBe(
      `nightly backup FAILED for backups/daily/2026-10-11.dump: ${R2_MESSAGE}`,
    );
    expect(reported.cause).toBeInstanceOf(Error);
  });

  it("…and is not reported when Sentry is not configured (the log line still is)", async () => {
    const sentry = fakeSentry(false);
    const { svc, logger } = serviceWithVersions(
      "pg_dump (PostgreSQL) 17.6 (Debian 17.6-1.pgdg120+1)",
      180000,
      { sentry },
    );
    await svc.runNightly(new Date("2026-10-10T18:00:00Z"));
    expect(sentry.captured).toEqual([]);
    expect(
      logger.lines.some((l) => l.startsWith("error") && l.includes(R2_MESSAGE)),
    ).toBe(true);
  });

  it("a successful nightly reports nothing to Sentry even when it is configured", async () => {
    const sentry = fakeSentry(true);
    const { svc, store } = serviceWithVersions(
      "pg_dump (PostgreSQL) 18.0 (Debian 18.0-1.pgdg120+1)",
      180000,
      { sentry },
    );
    await svc.runNightly(new Date("2026-10-10T18:00:00Z"));
    expect(store.puts.length).toBe(1);
    expect(sentry.captured).toEqual([]);
  });

  it("a Sentry client that throws cannot break the nightly", async () => {
    const sentry: BackupSentry = {
      isEnabled: () => true,
      captureException: () => {
        throw new Error("sentry down");
      },
    };
    const { svc, logger } = serviceWithVersions("pg_dump (PostgreSQL) 17.6", 180000, {
      sentry,
    });
    await expect(
      svc.runNightly(new Date("2026-10-10T18:00:00Z")),
    ).resolves.toBeUndefined();
    expect(
      logger.lines.some((l) => l.startsWith("warn") && l.includes("sentry down")),
    ).toBe(true);
  });
});
