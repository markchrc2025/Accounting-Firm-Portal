/**
 * track-a-projects-recurrence.db-spec.ts — PA8 (D70): recurring projects, over HTTP against the real
 * Nest app and the local PostgreSQL, with a real Redis for the daily run (REDIS_URL, or a
 * redis-server started for the run). Two Nest apps stand for two API processes. "Today" is stood in
 * for (the Manila date) so the lead times and the catch-up are exact. Every firm and user is invented.
 *
 * C1  The fields and their refusals.
 * C2  Generation: lead times, the task, its title, who made it.
 * C3  Once per occurrence; a deleted task is never made again.
 * C4  The daily run: catch-up, once across processes, the Redis lock.
 * C5  Changing the schedule, turning it off, the end date, archived, the start in the future.
 * C6  GET /projects/:key/recurrence-preview.
 */
import { randomUUID } from "node:crypto";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import net from "node:net";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import Redis from "ioredis";
import request from "supertest";
import { truncateOncePerFile } from "./helpers/truncate";
import { AppModule } from "../../src/app.module";
import { TokenService } from "../../src/auth/token.service";
import { PrismaService } from "../../src/prisma/prisma.service";
import * as constants from "../../src/projects/projects.constants";
import { ProjectRecurrenceService } from "../../src/projects/project-recurrence.service";

truncateOncePerFile({ firmRoles: ["Super Admin"] });

const TAG = `track-a-rec-${randomUUID().slice(0, 8)}`;
const API = "/api/v1";
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the tests read JSON
type Json = Record<string, any>;
const missing = (...p: string[]) => `Missing permission(s): ${p.join(", ")}`;
const TODAY = "2026-11-11";
const addDays = (d: string, n: number) =>
  new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const hasRedisBinary = spawnSync("which", ["redis-server"]).status === 0;

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.listen(0, "127.0.0.1", () => {
      const port = (s.address() as net.AddressInfo).port;
      s.close(() => resolve(port));
    });
    s.on("error", reject);
  });
}

describe("PA8 · recurring projects (real app over HTTP, db, Redis)", () => {
  let appA: INestApplication;
  let appB: INestApplication; // a second API process
  let db: PrismaService;
  let firmId = "";
  let otherFirmId = "";
  let clientId = "";
  const jwt: Record<string, string> = {};
  let seq = 0;
  let redisProc: ChildProcess | null = null;
  let prevRedis: string | undefined;
  let redisUrl = "";
  let redisClient: Redis;
  let today = TODAY;
  let spy: jest.SpyInstance;

  const http = () => request(appA.getHttpServer());
  const as = (method: "get" | "post" | "patch" | "delete", path: string, who = "sa", body?: object) => {
    const r = http()[method](`${API}${path}`).set("Authorization", `Bearer ${jwt[who]}`);
    return body === undefined ? r : r.send(body);
  };
  const setToday = (d: string) => {
    today = d;
  };
  async function project(extra: Json = {}, who = "sa") {
    seq += 1;
    const key = extra.key ?? `R${String(seq).padStart(3, "0")}`;
    const res = await as("post", "/projects", who, { name: `Encoding ${key}`, ...extra, key });
    return { key: key as string, res };
  }
  const recurring = (frequency: string, start = TODAY, extra: Json = {}) => ({
    isRecurring: true,
    recurrenceStart: start,
    recurrenceFrequency: frequency,
    ...extra,
  });
  /** The generated tasks of a project, by due date, deleted ones included. */
  async function tasks(key: string) {
    return db.issue.findMany({
      where: { firmId, project: { key } },
      orderBy: [{ dueDate: "asc" }, { number: "asc" }],
      include: { type: true, status: true, assignee: true, author: true },
    });
  }
  const dueOf = async (key: string) =>
    (await tasks(key)).map((t) => t.dueDate!.toISOString().slice(0, 10));
  async function makeRole(name: string, perms: string[]) {
    const role = await db.role.create({ data: { name, scope: "FIRM", isSystem: false } });
    for (const p of perms) {
      const [resource, action] = p.split(":") as [string, string];
      const permission = await db.permission.upsert({
        where: { resource_action: { resource, action } },
        update: {},
        create: { resource, action },
      });
      await db.rolePermission.create({ data: { roleId: role.id, permissionId: permission.id } });
    }
    return role.id;
  }
  async function makeUser(label: string, roleId?: string, firm?: string, assign?: string[]) {
    const fid = firm ?? firmId;
    const u = await db.user.create({
      data: {
        firmId: fid,
        userType: "FIRM",
        fullName: `${TAG} ${label}`,
        email: `${TAG}-${label}@example.com`,
        status: "ACTIVE",
        firmProfile: {
          create: {
            title: "Test",
            ...(assign?.length ? { clientAssignments: { create: assign.map((c) => ({ clientId: c })) } } : {}),
          },
        },
        ...(roleId ? { userRoles: { create: { roleId } } } : {}),
      },
    });
    jwt[label] = appA.get(TokenService).signAccess({ id: u.id, firmId: fid, userType: "FIRM", email: u.email });
  }
  async function pingable(url: string) {
    const probe = new Redis(url, { lazyConnect: true, maxRetriesPerRequest: 0, retryStrategy: () => null });
    probe.on("error", () => undefined);
    try {
      await probe.connect();
      return (await probe.ping()) === "PONG";
    } catch {
      return false;
    } finally {
      probe.disconnect();
    }
  }
  async function startRedis(): Promise<string> {
    const given = process.env.REDIS_URL;
    if (given && (await pingable(given))) return given;
    if (hasRedisBinary) {
      const port = await freePort();
      redisProc = spawn("redis-server", ["--port", String(port), "--bind", "127.0.0.1", "--save", "", "--appendonly", "no"], { stdio: "ignore" });
      const url = `redis://127.0.0.1:${port}`;
      for (let n = 0; n < 50; n++) {
        if (await pingable(url)) return url;
        await new Promise((r) => setTimeout(r, 100));
      }
      throw new Error("redis-server did not start");
    }
    throw new Error("Redis is required for the recurrence daily-run test: set REDIS_URL or install redis-server.");
  }
  async function makeApp(): Promise<INestApplication> {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    const app = moduleRef.createNestApplication();
    app.setGlobalPrefix("api/v1");
    await app.init();
    return app;
  }
  const svc = (app: INestApplication) => app.get(ProjectRecurrenceService);

  beforeAll(async () => {
    prevRedis = process.env.REDIS_URL;
    redisUrl = await startRedis();
    process.env.REDIS_URL = redisUrl;
    redisClient = new Redis(redisUrl);
    spy = jest.spyOn(constants, "manilaToday").mockImplementation(() => today);
    appA = await makeApp();
    appB = await makeApp();
    db = appA.get(PrismaService);
    firmId = (await db.firm.create({ data: { name: `${TAG} Halimbawa Accounting` } })).id;
    otherFirmId = (await db.firm.create({ data: { name: `${TAG} Ibang Accounting` } })).id;
    const sa = (await db.role.findUniqueOrThrow({ where: { name_scope: { name: "Super Admin", scope: "FIRM" } } })).id;
    const member = await makeRole(`${TAG} REC Member`, ["Projects:Read", "Projects:Create", "Projects:Update"]);
    const viewer = await makeRole(`${TAG} REC Viewer`, ["Projects:Read"]);
    clientId = (await db.client.create({ data: { firmId, businessName: `${TAG} Halimbawa Client`, tin: "000888001" } })).id;
    await makeUser("sa", sa);
    await makeUser("sa2", sa, otherFirmId);
    await makeUser("member", member);
    await makeUser("memberAssigned", member, undefined, [clientId]);
    await makeUser("viewer", viewer);
    await makeUser("norole");
  });
  beforeEach(async () => {
    setToday(TODAY);
    // each test starts with no run recorded and no lock held
    await redisClient.del("projects:recurrence:last-run", "projects:recurrence:lock");
  });
  afterAll(async () => {
    spy.mockRestore();
    redisClient.disconnect();
    await appA.close();
    await appB.close();
    if (redisProc) redisProc.kill();
    if (prevRedis === undefined) delete process.env.REDIS_URL;
    else process.env.REDIS_URL = prevRedis;
  });

  // ======================================================================================
  describe("C1 · the fields", () => {
    it("a recurring project needs a start and a frequency; the end is optional", async () => {
      const none = await project({ isRecurring: true });
      expect(none.res.status).toBe(400);
      expect(none.res.body.message).toBe("Choose a start date for the recurring project.");
      expect(none.res.body.problems).toEqual([
        "Choose a start date for the recurring project.",
        "Choose how often the project repeats: Daily, Weekly, Bi-Weekly, Monthly, Quarterly or Annually.",
      ]);
      const ok = await project(recurring("MONTHLY", "2027-03-15"));
      expect(ok.res.status).toBe(201);
      expect(ok.res.body).toMatchObject({
        isRecurring: true,
        recurrenceStart: "2027-03-15",
        recurrenceEnd: null,
        recurrenceFrequency: "MONTHLY",
      });
    });
    it("refuses a bad frequency, a bad date, an end before the start", async () => {
      const f = await project(recurring("FORTNIGHTLY"));
      expect(f.res.status).toBe(400);
      expect(f.res.body.message).toBe(
        '"FORTNIGHTLY" is not a frequency. Choose Daily, Weekly, Bi-Weekly, Monthly, Quarterly or Annually.',
      );
      const d = await project(recurring("DAILY", "2026-02-30"));
      expect(d.res.body.message).toBe("The start date must be a real date written YYYY-MM-DD.");
      const e = await project(recurring("DAILY", "2026-12-01", { recurrenceEnd: "2026-11-30" }));
      expect(e.res.body.message).toBe("The end date cannot be before the start date.");
    });
    it("the six frequencies are DAILY, WEEKLY, BI_WEEKLY, MONTHLY, QUARTERLY and ANNUALLY", async () => {
      for (const f of ["DAILY", "WEEKLY", "BI_WEEKLY", "MONTHLY", "QUARTERLY", "ANNUALLY"]) {
        const p = await project(recurring(f, "2030-01-01"));
        expect(p.res.status).toBe(201);
        expect(p.res.body.recurrenceFrequency).toBe(f);
      }
    });
    it("a project that is not recurring needs nothing, and a bad value is still refused", async () => {
      const p = await project({ isRecurring: false });
      expect(p.res.status).toBe(201);
      expect(p.res.body).toMatchObject({ isRecurring: false, recurrenceStart: null, recurrenceFrequency: null });
      const bad = await project({ isRecurring: false, recurrenceFrequency: "x" });
      expect(bad.res.status).toBe(400);
    });
    it("a patch is checked against what is stored; a blank end means endless", async () => {
      const { key } = await project(recurring("MONTHLY", "2030-05-01", { recurrenceEnd: "2030-12-31" }));
      const early = await as("patch", `/projects/${key}`, "sa", { recurrenceEnd: "2030-04-01" });
      expect(early.status).toBe(400);
      expect(early.body.message).toBe("The end date cannot be before the start date.");
      const freq = await as("patch", `/projects/${key}`, "sa", { recurrenceFrequency: "WEEKLY" });
      expect(freq.body).toMatchObject({ recurrenceFrequency: "WEEKLY", recurrenceStart: "2030-05-01", recurrenceEnd: "2030-12-31" });
      const endless = await as("patch", `/projects/${key}`, "sa", { recurrenceEnd: "" });
      expect(endless.body.recurrenceEnd).toBeNull();
      expect((await as("patch", `/projects/${key}`, "sa", { recurrenceEnd: null })).body.recurrenceEnd).toBeNull();
    });
    it("turning it off keeps the schedule; turning it on again needs it whole", async () => {
      const { key } = await project(recurring("QUARTERLY", "2030-05-01"));
      const off = await as("patch", `/projects/${key}`, "sa", { isRecurring: false });
      expect(off.body).toMatchObject({ isRecurring: false, recurrenceStart: "2030-05-01", recurrenceFrequency: "QUARTERLY" });
      const { key: k2 } = await project({});
      const on = await as("patch", `/projects/${k2}`, "sa", { isRecurring: true });
      expect(on.status).toBe(400);
      expect(on.body.message).toBe("Choose a start date for the recurring project.");
    });
    it("the portfolio and the overview carry the fields; the change is on the activity log", async () => {
      const { key } = await project(recurring("WEEKLY", "2030-05-01"));
      const row = ((await as("get", "/projects", "sa")).body as Json[]).find((p) => p.key === key)!;
      expect(row).toMatchObject({ isRecurring: true, recurrenceFrequency: "WEEKLY", recurrenceStart: "2030-05-01", recurrenceEnd: null });
      expect((await as("get", `/projects/${key}`, "viewer")).body.project.isRecurring).toBe(true);
      await as("patch", `/projects/${key}`, "sa", { recurrenceFrequency: "DAILY" });
      const feed = (await as("get", `/projects/${key}/activity`, "sa")).body.items as Json[];
      expect(feed.flatMap((a) => a.changes)).toContainEqual({ field: "recurrenceFrequency", old: "WEEKLY", new: "DAILY" });
    });
  });

  // ======================================================================================
  describe("C2 · generation at create: lead times and the task", () => {
    it.each([
      ["DAILY", [TODAY, "2026-11-12"]],
      ["WEEKLY", [TODAY, "2026-11-18"]],
      ["BI_WEEKLY", [TODAY, "2026-11-25"]],
      ["MONTHLY", [TODAY, "2026-12-11"]],
      ["QUARTERLY", [TODAY]],
      ["ANNUALLY", [TODAY]],
    ])("%s starting today makes the tasks due %j", async (frequency, dates) => {
      const { key, res } = await project(recurring(frequency));
      expect(res.status).toBe(201);
      expect(await dueOf(key)).toEqual(dates);
    });
    it("an occurrence is made exactly its lead time ahead, not a day sooner", async () => {
      const a = await project(recurring("MONTHLY", "2026-12-12")); // 31 days away
      expect(await dueOf(a.key)).toEqual([]);
      setToday("2026-11-12");
      await as("patch", `/projects/${a.key}`, "sa", { name: "Touched" });
      expect(await dueOf(a.key)).toEqual(["2026-12-12"]); // 30 days away
    });
    it("the task is a Task in the default status, Normal, unassigned, due on the occurrence, made by the system", async () => {
      const { key } = await project(recurring("MONTHLY", "2026-11-20", { name: "Encoding" }));
      const [t] = await tasks(key);
      expect(t).toMatchObject({ title: "Encoding: November 2026", priority: "NORMAL", assigneeId: null, authorId: null, deleted: false });
      expect(t!.type.name).toBe("Task");
      expect(t!.status.isDefault).toBe(true);
      expect(t!.dueDate!.toISOString().slice(0, 10)).toBe("2026-11-20");
      expect(t!.startDate).toBeNull();
      const feed = (await as("get", `/projects/${key}/activity`, "sa")).body.items as Json[];
      const made = feed.find((a) => a.action === "issue.created" && a.issueKey === t!.key)!;
      expect(made).toMatchObject({ actorType: "SYSTEM", channel: "system", actor: null });
      // the project's counter moved with it
      expect((await db.project.findFirstOrThrow({ where: { firmId, key } })).issueCounter).toBe(1);
    });
    it.each([
      ["DAILY", "5 November 2026", "2026-11-05"],
      ["WEEKLY", "Week of 12 November 2026", "2026-11-12"],
      ["BI_WEEKLY", "Fortnight of 12 November 2026", "2026-11-12"],
      ["MONTHLY", "November 2026", "2026-11-12"],
      ["QUARTERLY", "Q4 2026", "2026-11-12"],
      ["ANNUALLY", "2026", "2026-11-12"],
    ])("%s is titled with %s", async (frequency, label, start) => {
      setToday(start);
      const { key } = await project(recurring(frequency, start, { name: "Encoding" }));
      expect((await tasks(key))[0]!.title).toBe(`Encoding: ${label}`);
    });
    it("the occurrences are recorded, one row for each date", async () => {
      const { key } = await project(recurring("DAILY"));
      const rows = await db.projectOccurrence.findMany({ where: { project: { key, firmId } }, orderBy: { occurrenceDate: "asc" } });
      expect(rows.map((r) => r.occurrenceDate.toISOString().slice(0, 10))).toEqual([TODAY, "2026-11-12"]);
      expect(rows.every((r) => r.issueId !== null && r.firmId === firmId)).toBe(true);
    });
    it("nothing is made before the day generation began, whatever the start date", async () => {
      const { key } = await project(recurring("DAILY", "2020-01-01"));
      expect(await dueOf(key)).toEqual([TODAY, "2026-11-12"]);
    });
    it("a project made by someone who cannot see a client still generates, in its own firm only", async () => {
      const { key, res } = await project(recurring("DAILY"), "member");
      expect(res.status).toBe(201);
      expect((await tasks(key)).every((t) => t.firmId === firmId)).toBe(true);
    });
  });

  // ======================================================================================
  describe("C3 · once per occurrence", () => {
    it("saving the project again makes nothing twice", async () => {
      const { key } = await project(recurring("DAILY"));
      await as("patch", `/projects/${key}`, "sa", { name: "Renamed" });
      await as("patch", `/projects/${key}`, "sa", { description: "More words" });
      expect(await dueOf(key)).toEqual([TODAY, "2026-11-12"]);
      expect(await db.projectOccurrence.count({ where: { project: { key, firmId } } })).toBe(2);
    });
    it("a task the owner deleted is never made again", async () => {
      const { key } = await project(recurring("DAILY"));
      const [first] = await tasks(key);
      expect((await as("delete", `/projects/${key}/issues/${first!.key}`, "sa")).status).toBe(200);
      await as("patch", `/projects/${key}`, "sa", { name: "After the delete" });
      await svc(appA).runDaily({ force: true });
      const rows = await tasks(key);
      expect(rows).toHaveLength(2); // the deleted one is flagged, not replaced
      expect(rows.filter((t) => !t.deleted)).toHaveLength(1);
      expect(await db.projectOccurrence.count({ where: { project: { key, firmId } } })).toBe(2);
    });
    it("two requests at once, on two processes, make each occurrence once", async () => {
      const { key } = await project({ ...recurring("DAILY", "2030-01-01") });
      setToday("2030-01-01");
      const row = await db.project.findFirstOrThrow({ where: { firmId, key } });
      await db.project.update({ where: { id: row.id }, data: { recurrenceActiveFrom: new Date("2030-01-01T00:00:00Z") } });
      const results = await Promise.all([
        svc(appA).generateForProject(row.id),
        svc(appB).generateForProject(row.id),
        svc(appA).generateForProject(row.id),
      ]);
      expect(await dueOf(key)).toEqual(["2030-01-01", "2030-01-02"]);
      expect(results.reduce((n, r) => n + r.created, 0)).toBe(2);
      expect(await db.projectOccurrence.count({ where: { project: { key, firmId } } })).toBe(2);
    });
  });

  // ======================================================================================
  describe("C4 · the daily run", () => {
    it("catches up the days that were missed", async () => {
      const { key } = await project(recurring("DAILY"));
      expect(await dueOf(key)).toEqual([TODAY, "2026-11-12"]);
      setToday("2026-11-16"); // five days with no run
      const r = await svc(appA).runDaily();
      expect(r).toMatchObject({ ran: true });
      expect(await dueOf(key)).toEqual(
        ["2026-11-11", "2026-11-12", "2026-11-13", "2026-11-14", "2026-11-15", "2026-11-16", "2026-11-17"],
      );
    });
    it("runs once a day: a second run the same day does nothing, a forced one finds nothing to make", async () => {
      const { key } = await project(recurring("WEEKLY"));
      setToday("2026-11-25");
      expect((await svc(appA).runDaily()).ran).toBe(true);
      const again = await svc(appA).runDaily();
      expect(again).toEqual({ ran: false, reason: "already-run" });
      const forced = await svc(appA).runDaily({ force: true });
      expect(forced).toMatchObject({ ran: true, result: expect.objectContaining({ created: 0 }) });
      expect(await dueOf(key)).toEqual(["2026-11-11", "2026-11-18", "2026-11-25", "2026-12-02"]);
    });
    it("two API processes at once: one runs, the other does not, and every task is made once", async () => {
      const { key } = await project(recurring("DAILY"));
      setToday("2026-11-14");
      const [a, b] = await Promise.all([svc(appA).runDaily(), svc(appB).runDaily()]);
      const ran = [a, b].filter((r) => r.ran);
      expect(ran).toHaveLength(1);
      expect([a, b].find((r) => !r.ran)).toMatchObject({ ran: false });
      expect(["locked", "already-run"]).toContain((([a, b].find((r) => !r.ran)) as Json).reason);
      expect(await dueOf(key)).toEqual(
        ["2026-11-11", "2026-11-12", "2026-11-13", "2026-11-14", "2026-11-15"],
      );
      expect(await db.projectOccurrence.count({ where: { project: { key, firmId } } })).toBe(5);
    });
    it("the lock is a Redis key that is gone when the run is done", async () => {
      await project(recurring("DAILY"));
      setToday("2026-11-15");
      await svc(appA).runDaily();
      const r = new Redis(redisUrl);
      expect(await r.get("projects:recurrence:lock")).toBeNull();
      expect(await r.get("projects:recurrence:last-run")).toBe("2026-11-15");
      r.disconnect();
    });
    it("a lock held by another process stops the run", async () => {
      await project(recurring("DAILY"));
      setToday("2026-11-17");
      const r = new Redis(redisUrl);
      await r.set("projects:recurrence:lock", "another-process", "EX", 60);
      expect(await svc(appA).runDaily()).toEqual({ ran: false, reason: "locked" });
      await r.del("projects:recurrence:lock");
      r.disconnect();
      expect((await svc(appA).runDaily()).ran).toBe(true);
    });
    it("reads every firm's recurring projects, and only those", async () => {
      const own = await project(recurring("DAILY"));
      const plain = await project({});
      const other = await as("post", "/projects", "sa2", { key: "OTH1", name: "Other firm", ...recurring("DAILY") });
      expect(other.status).toBe(201);
      setToday("2026-11-20");
      const r = await svc(appA).runDaily();
      expect(r.ran).toBe(true);
      expect((await tasks(own.key)).length).toBeGreaterThan(2);
      expect(await tasks(plain.key)).toHaveLength(0);
      const theirs = await db.issue.findMany({ where: { firmId: otherFirmId, project: { key: "OTH1" } } });
      expect(theirs.length).toBeGreaterThan(2);
      expect(theirs.every((t) => t.firmId === otherFirmId)).toBe(true);
    });
  });

  // ======================================================================================
  describe("C5 · changing, stopping, ending", () => {
    it("a new schedule changes only the occurrences not yet made", async () => {
      const { key } = await project(recurring("MONTHLY"));
      const before = await tasks(key);
      expect(before.map((t) => t.dueDate!.toISOString().slice(0, 10))).toEqual([TODAY, "2026-12-11"]);
      await as("patch", `/projects/${key}`, "sa", { recurrenceFrequency: "WEEKLY" });
      const after = await tasks(key);
      // the two made tasks are the same rows, untouched; one new weekly task is added (the 18th)
      expect(after.map((t) => t.dueDate!.toISOString().slice(0, 10))).toEqual([TODAY, "2026-11-18", "2026-12-11"]);
      for (const t of before) expect(after.find((a) => a.id === t.id)).toMatchObject({ title: t.title, deleted: false });
    });
    it("a later start makes nothing earlier and removes nothing", async () => {
      const { key } = await project(recurring("DAILY"));
      await as("patch", `/projects/${key}`, "sa", { recurrenceStart: "2027-06-01" });
      expect(await dueOf(key)).toEqual([TODAY, "2026-11-12"]);
      setToday("2027-05-20");
      await svc(appA).runDaily({ force: true });
      expect(await dueOf(key)).toEqual([TODAY, "2026-11-12"]); // 1 June is 12 days away: a day's lead is 1
      setToday("2027-05-31");
      await svc(appA).runDaily({ force: true });
      expect(await dueOf(key)).toEqual([TODAY, "2026-11-12", "2027-06-01"]);
    });
    it("turning it off stops generation and keeps the tasks", async () => {
      const { key } = await project(recurring("DAILY"));
      await as("patch", `/projects/${key}`, "sa", { isRecurring: false });
      setToday("2026-11-20");
      await svc(appA).runDaily({ force: true });
      expect(await dueOf(key)).toEqual([TODAY, "2026-11-12"]);
    });
    it("turning it on again does not make the days it was off", async () => {
      const { key } = await project(recurring("DAILY"));
      await as("patch", `/projects/${key}`, "sa", { isRecurring: false });
      setToday("2026-11-20");
      await as("patch", `/projects/${key}`, "sa", { isRecurring: true });
      expect(await dueOf(key)).toEqual(["2026-11-11", "2026-11-12", "2026-11-20", "2026-11-21"]);
    });
    it("nothing is made after the end date", async () => {
      const { key } = await project(recurring("DAILY", TODAY, { recurrenceEnd: "2026-11-12" }));
      setToday("2026-12-31");
      await svc(appA).runDaily({ force: true });
      expect(await dueOf(key)).toEqual([TODAY, "2026-11-12"]);
    });
    it("the end date on the last occurrence itself is included", async () => {
      const { key } = await project(recurring("DAILY", TODAY, { recurrenceEnd: TODAY }));
      expect(await dueOf(key)).toEqual([TODAY]);
    });
    it("an archived project makes nothing until it is unarchived", async () => {
      const { key } = await project(recurring("DAILY"));
      await as("post", `/projects/${key}/archive`, "sa");
      setToday("2026-11-15");
      await svc(appA).runDaily({ force: true });
      expect(await dueOf(key)).toEqual([TODAY, "2026-11-12"]);
      await as("post", `/projects/${key}/unarchive`, "sa");
      await svc(appA).runDaily({ force: true });
      expect(await dueOf(key)).toEqual(
        ["2026-11-11", "2026-11-12", "2026-11-13", "2026-11-14", "2026-11-15", "2026-11-16"],
      );
    });
    it("a start in the future waits for its lead time", async () => {
      const { key } = await project(recurring("MONTHLY", "2027-03-15"));
      expect(await dueOf(key)).toEqual([]);
      setToday("2027-02-12");
      await svc(appA).runDaily({ force: true });
      expect(await dueOf(key)).toEqual([]); // 12 Feb plus 30 days is 14 March
      setToday("2027-02-13");
      await svc(appA).runDaily({ force: true });
      expect(await dueOf(key)).toEqual(["2027-03-15"]); // 13 Feb plus 30 days is 15 March
    });
  });

  // ======================================================================================
  describe("C6 · GET /projects/:key/recurrence-preview", () => {
    it("answers the next 5 dates by default, today included", async () => {
      const { key } = await project(recurring("WEEKLY"));
      const res = await as("get", `/projects/${key}/recurrence-preview`, "viewer");
      expect(res.status).toBe(200);
      expect(Object.keys(res.body).sort()).toEqual(["dates", "end", "frequency", "leadDays", "recurring", "start"]);
      expect(res.body).toEqual({
        recurring: true,
        frequency: "WEEKLY",
        start: TODAY,
        end: null,
        leadDays: 7,
        dates: ["2026-11-11", "2026-11-18", "2026-11-25", "2026-12-02", "2026-12-09"],
      });
    });
    it("count sets how many, from 1 to 24", async () => {
      const { key } = await project(recurring("DAILY"));
      expect((await as("get", `/projects/${key}/recurrence-preview?count=2`, "sa")).body.dates).toHaveLength(2);
      expect((await as("get", `/projects/${key}/recurrence-preview?count=100`, "sa")).body.dates).toHaveLength(24);
      expect((await as("get", `/projects/${key}/recurrence-preview?count=0`, "sa")).body.dates).toHaveLength(1);
    });
    it("stops at the end date", async () => {
      const { key } = await project(recurring("DAILY", TODAY, { recurrenceEnd: "2026-11-13" }));
      expect((await as("get", `/projects/${key}/recurrence-preview`, "sa")).body.dates).toEqual(["2026-11-11", "2026-11-12", "2026-11-13"]);
    });
    it("a project that is not recurring has no dates", async () => {
      const { key } = await project({});
      expect((await as("get", `/projects/${key}/recurrence-preview`, "sa")).body).toEqual({
        recurring: false,
        frequency: null,
        start: null,
        end: null,
        leadDays: null,
        dates: [],
      });
    });
    it("start, end and frequency in the query preview a schedule that is not saved", async () => {
      const { key } = await project({});
      const res = await as("get", `/projects/${key}/recurrence-preview?start=2026-12-31&frequency=MONTHLY&count=4`, "sa");
      expect(res.body).toMatchObject({ recurring: true, frequency: "MONTHLY", start: "2026-12-31", leadDays: 30 });
      expect(res.body.dates).toEqual(["2026-12-31", "2027-01-31", "2027-02-28", "2027-03-31"]);
      const bad = await as("get", `/projects/${key}/recurrence-preview?start=2026-12-31&frequency=x`, "sa");
      expect(bad.status).toBe(400);
      expect(bad.body.message).toBe('"x" is not a frequency. Choose Daily, Weekly, Bi-Weekly, Monthly, Quarterly or Annually.');
      expect((await as("get", `/projects/${key}/recurrence-preview?start=2026-12-31`, "sa")).status).toBe(400);
    });
    it("who may ask: Projects:Read, and the client rule applies to a linked project", async () => {
      const free = await project(recurring("DAILY"));
      expect((await as("get", `/projects/${free.key}/recurrence-preview`, "norole")).body.message).toBe(missing("Projects:Read"));
      const linked = await project(recurring("DAILY", TODAY, { clientId }), "memberAssigned");
      expect(linked.res.status).toBe(201);
      expect((await as("get", `/projects/${linked.key}/recurrence-preview`, "member")).status).toBe(404);
      expect((await as("get", `/projects/${linked.key}/recurrence-preview`, "memberAssigned")).status).toBe(200);
      expect((await as("get", `/projects/${free.key}/recurrence-preview`, "sa2")).status).toBe(404);
      expect((await as("get", "/projects/NOPE/recurrence-preview", "sa")).status).toBe(404);
    });
  });
});
