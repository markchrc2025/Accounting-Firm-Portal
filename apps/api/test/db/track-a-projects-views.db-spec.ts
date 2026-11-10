/**
 * track-a-projects-views.db-spec.ts — PA2 (D66): the board, the roadmap, My Work, the global
 * search and notifications, over HTTP against the real Nest app and the local PostgreSQL
 * (mail is a fake that records what it is asked to send). Every firm, user and title is invented.
 *
 * T1  Board: column order, card order, the Done window, filters; reorder across statuses; moves
 *     that arrive together keep distinct positions.
 * T2  Roadmap and milestone bars.
 * T3  My Work: contents, order, totals, visibility.
 * T4  Search: groups, limits, the jump, visibility.
 * T5  Notifications: each event, the actor, duplicates, who may see the project, the routes,
 *     preferences, and email after the commit.
 * T6  Tenants, client visibility and permissions on every new route.
 */
import { randomUUID } from "node:crypto";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { truncateOncePerFile } from "./helpers/truncate";
import { AppModule } from "../../src/app.module";
import { TokenService } from "../../src/auth/token.service";
import { MailService } from "../../src/mail/mail.service";
import { PrismaService } from "../../src/prisma/prisma.service";
import { BoardService } from "../../src/projects/board.service";
import { webActor } from "../../src/projects/projects.access";
import { ProjectsActivity } from "../../src/projects/projects-activity.service";
import { addDays, manilaToday } from "../../src/projects/projects.constants";
import type { AuthUser } from "../../src/common/auth/auth-user";

truncateOncePerFile({ firmRoles: ["Super Admin"] });

const TAG = `track-a-views-${randomUUID().slice(0, 8)}`;
const API = "/api/v1";
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the tests read JSON
type Json = Record<string, any>;
const missing = (...p: string[]) => `Missing permission(s): ${p.join(", ")}`;

describe("PA2 · board, roadmap, My Work, search, notifications (real app over HTTP, db)", () => {
  let app: INestApplication;
  let db: PrismaService;
  let firmId = "";
  let otherFirmId = "";
  let clientId = "";
  const tok: Record<string, string> = {};
  const uid: Record<string, string> = {};
  let st: Record<string, string> = {};
  let ty: Record<string, string> = {};
  let seq = 0;
  const sent: { to: string; subject: string; html: string; text: string }[] = [];
  const mail = {
    isEnabled: jest.fn(() => true),
    send: jest.fn(
      async (m: { to: string; subject: string; html: string; text: string }) => {
        sent.push(m);
        return { provider: "postal", messageId: "x" };
      },
    ),
  };

  const http = () => request(app.getHttpServer());
  const call = (
    method: "get" | "post" | "patch" | "delete",
    path: string,
    who = "sa",
    body?: object,
  ) => {
    const r = http()[method](`${API}${path}`).set("Authorization", `Bearer ${tok[who]}`);
    return body === undefined ? r : r.send(body);
  };
  const pj = (
    method: "get" | "post" | "patch" | "delete",
    path: string,
    who = "sa",
    body?: object,
  ) => call(method, `/projects${path}`, who, body);
  const authUser = (who: string): AuthUser => ({
    id: uid[who]!,
    firmId,
    userType: "FIRM",
    email: `${TAG}-${who}@example.com`,
  });

  async function project(extra: Json = {}, who = "sa") {
    seq += 1;
    const key = extra.key ?? `V${String(seq).padStart(3, "0")}`;
    const res = await pj("post", "", who, { name: `Project ${key}`, ...extra, key });
    expect(res.status).toBe(201);
    return res.body as Json;
  }
  const issue = async (pk: string, body: Json = { title: "An issue" }, who = "sa") => {
    const res = await pj("post", `/${pk}/issues`, who, body);
    expect(res.status).toBe(201);
    return res.body as Json;
  };
  const notes = (who: string) =>
    db.notification.findMany({
      where: { userId: uid[who]! },
      orderBy: { createdAt: "asc" },
    });
  const clearNotes = () => db.notification.deleteMany({ where: { firmId } });

  async function makeRole(name: string, perms: string[]) {
    const role = await db.role.create({ data: { name, scope: "FIRM", isSystem: false } });
    for (const p of perms) {
      const [resource, action] = p.split(":") as [string, string];
      const permission = await db.permission.upsert({
        where: { resource_action: { resource, action } },
        update: {},
        create: { resource, action },
      });
      await db.rolePermission.create({
        data: { roleId: role.id, permissionId: permission.id },
      });
    }
    return role.id;
  }
  async function makeUser(
    label: string,
    opts: { roleId?: string; firm?: string; type?: "FIRM" | "CLIENT"; assign?: string[] },
  ) {
    const fid = opts.firm ?? firmId;
    const u = await db.user.create({
      data: {
        firmId: fid,
        userType: opts.type ?? "FIRM",
        fullName: `${TAG} ${label}`,
        email: `${TAG}-${label}@example.com`,
        status: "ACTIVE",
        ...((opts.type ?? "FIRM") === "FIRM"
          ? {
              firmProfile: {
                create: {
                  title: "Test",
                  ...(opts.assign?.length
                    ? {
                        clientAssignments: {
                          create: opts.assign.map((c) => ({ clientId: c })),
                        },
                      }
                    : {}),
                },
              },
            }
          : {}),
        ...(opts.roleId ? { userRoles: { create: { roleId: opts.roleId } } } : {}),
      },
    });
    uid[label] = u.id;
    tok[label] = app.get(TokenService).signAccess({
      id: u.id,
      firmId: fid,
      userType: opts.type ?? "FIRM",
      email: u.email,
    });
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MailService)
      .useValue(mail)
      .compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix("api/v1");
    await app.init();
    db = app.get(PrismaService);
    firmId = (await db.firm.create({ data: { name: `${TAG} Halimbawa Accounting` } })).id;
    otherFirmId = (await db.firm.create({ data: { name: `${TAG} Ibang Accounting` } }))
      .id;
    const sa = (
      await db.role.findUniqueOrThrow({
        where: { name_scope: { name: "Super Admin", scope: "FIRM" } },
      })
    ).id;
    const member = await makeRole(`${TAG} PA Member`, [
      "Projects:Read",
      "Projects:Create",
      "Projects:Update",
    ]);
    const viewer = await makeRole(`${TAG} PA Viewer`, ["Projects:Read"]);
    clientId = (
      await db.client.create({
        data: { firmId, businessName: `${TAG} Halimbawa Client`, tin: "000555201" },
      })
    ).id;
    await makeUser("sa", { roleId: sa });
    await makeUser("sa2", { roleId: sa, firm: otherFirmId });
    await makeUser("member", { roleId: member });
    await makeUser("member2", { roleId: member });
    await makeUser("viewer", { roleId: viewer });
    await makeUser("norole", {});
    await makeUser("memberAssigned", { roleId: member, assign: [clientId] });
    await makeUser("clientUser", { type: "CLIENT" });
    const meta = (await pj("get", "/meta")).body;
    st = Object.fromEntries(meta.issueStatuses.map((s: Json) => [s.name, s.id]));
    ty = Object.fromEntries(meta.issueTypes.map((t: Json) => [t.name, t.id]));
  });
  beforeEach(() => {
    sent.length = 0;
    mail.send.mockClear();
    mail.isEnabled.mockImplementation(() => true);
    mail.send.mockImplementation(async (m) => {
      sent.push(m);
      return { provider: "postal", messageId: "x" };
    });
  });
  afterAll(async () => {
    jest.restoreAllMocks();
    await app.close();
  });

  // ======================================================================================
  describe("T1 · the board", () => {
    it("a column per status in the firm's order, cards by position then number; the shape", async () => {
      await project({ key: "BRD" });
      const a = await issue("BRD", { title: "a" });
      const b = await issue("BRD", { title: "b" });
      const c = await issue("BRD", { title: "c", statusId: st["In progress"] });
      await pj("post", `/BRD/issues/${b.key}/reorder`, "sa", { position: 0.5 });
      const board = (await pj("get", "/BRD/board", "viewer")).body;
      expect(Object.keys(board).sort()).toEqual([
        "columns",
        "doneRange",
        "doneSince",
        "today",
        "total",
      ]);
      expect(board.doneRange).toBe("14d");
      expect(board.columns.map((x: Json) => x.status.name)).toEqual([
        "New",
        "In progress",
        "Blocked",
        "In review",
        "Done",
        "Won't do",
      ]);
      expect(board.columns[0].status).toEqual({
        id: st["New"],
        name: "New",
        colour: "#57606a",
        category: "TODO",
        isDefault: true,
      });
      expect(board.columns[0].items.map((i: Json) => i.title)).toEqual(["b", "a"]); // b was moved ahead
      expect(board.columns[1].items.map((i: Json) => i.title)).toEqual(["c"]);
      expect(board.columns.every((x: Json) => x.olderHidden === 0)).toBe(true);
      expect(board.total).toBe(3);
      expect(Object.keys(board.columns[0].items[0]).sort()).toEqual(
        Object.keys((await pj("get", `/BRD/issues/${a.key}`)).body)
          .filter(
            (k) =>
              !["description", "author", "parent", "children", "commentCount"].includes(
                k,
              ),
          )
          .sort(),
      );
      void c;
    });

    it("the Done columns hold the last 14 days by Manila days (13 in, 15 out, the 14th day in); the others hold everything; doneRange=all holds all", async () => {
      await project({ key: "DNW" });
      const mk = async (title: string, statusName: string) =>
        await issue("DNW", { title, statusId: st[statusName] });
      const old = await mk("old open", "New");
      const d13 = await mk("closed 13 days ago", "Done");
      const d14 = await mk("closed on day 14", "Done");
      const d15 = await mk("closed 15 days ago", "Done");
      const w15 = await mk("won't do 15 days ago", "Won't do");
      const w1 = await mk("won't do yesterday", "Won't do");
      // now is noon in Manila on 2026-11-10: today = 2026-11-10; the window starts 2026-10-27 00:00 Manila
      const NOW = Date.parse("2026-11-10T04:00:00.000Z");
      const closedAt = (iso: string) => new Date(iso);
      const set = (key: string, at: string) =>
        db.issue.updateMany({ where: { key, firmId }, data: { closedAt: closedAt(at) } });
      await set(d13.key, "2026-10-28T04:00:00.000Z"); // 13 days ago
      await set(d14.key, "2026-10-26T16:00:00.000Z"); // 2026-10-27 00:00 in Manila: the first minute of day 14
      await set(d15.key, "2026-10-26T15:59:59.000Z"); // one second before
      await set(w15.key, "2026-10-26T04:00:00.000Z"); // 15 days ago
      await set(w1.key, "2026-11-09T04:00:00.000Z");
      await db.issue.updateMany({
        where: { key: old.key, firmId },
        data: { createdAt: new Date("2020-01-01T00:00:00Z") },
      });
      const svc = app.get(BoardService);
      const spy = jest.spyOn(Date, "now").mockReturnValue(NOW);
      try {
        const b = await svc.board(webActor(authUser("sa")), "DNW", { doneRange: "14d" });
        expect(b.today).toBe("2026-11-10");
        expect(b.doneSince).toBe("2026-10-26T16:00:00.000Z");
        const col = (n: string) => b.columns.find((c) => c.status.name === n)!;
        expect(col("New").items.map((i) => i.title)).toEqual(["old open"]);
        expect(
          col("Done")
            .items.map((i) => i.title)
            .sort(),
        ).toEqual(["closed 13 days ago", "closed on day 14"]);
        expect(col("Done").olderHidden).toBe(1);
        expect(col("Won't do").items.map((i) => i.title)).toEqual(["won't do yesterday"]);
        expect(col("Won't do").olderHidden).toBe(1);
        expect(col("New").olderHidden).toBe(0);
        expect(b.total).toBe(4);
        const all = await svc.board(webActor(authUser("sa")), "DNW", {
          doneRange: "all",
        });
        expect(all.doneSince).toBeNull();
        expect(all.columns.find((c) => c.status.name === "Done")!.items).toHaveLength(3);
        expect(all.columns.find((c) => c.status.name === "Won't do")!.items).toHaveLength(
          2,
        );
        expect(all.columns.every((c) => c.olderHidden === 0)).toBe(true);
        expect(all.total).toBe(6);
      } finally {
        spy.mockRestore();
      }
      // over HTTP the same, with the real clock: an issue closed just now is in
      const r = (await pj("get", "/DNW/board?doneRange=all", "sa")).body;
      expect(r.total).toBe(6);
      expect((await pj("get", "/DNW/board?doneRange=forever", "sa")).status).toBe(400);
    });

    it("filters: milestone (id, none) and assignee (id, none, me)", async () => {
      await project({ key: "BFL" });
      const m = (await pj("post", "/BFL/milestones", "sa", { name: "M" })).body;
      await issue(
        "BFL",
        { title: "in M, mine", milestoneId: m.id, assigneeId: uid["member"] },
        "sa",
      );
      await issue("BFL", { title: "in M, nobody", milestoneId: m.id });
      await issue("BFL", { title: "no M, sa", assigneeId: uid["sa"] });
      const titles = async (qs: string, who = "sa") =>
        (await pj("get", `/BFL/board${qs}`, who)).body.columns
          .flatMap((c: Json) => c.items.map((i: Json) => i.title))
          .sort();
      expect(await titles(`?milestoneId=${m.id}`)).toEqual([
        "in M, mine",
        "in M, nobody",
      ]);
      expect(await titles("?milestoneId=none")).toEqual(["no M, sa"]);
      expect(await titles(`?assigneeId=${uid["member"]}`)).toEqual(["in M, mine"]);
      expect(await titles("?assigneeId=none")).toEqual(["in M, nobody"]);
      expect(await titles("?assigneeId=me", "sa")).toEqual(["no M, sa"]);
      expect(await titles("?assigneeId=me", "member")).toEqual(["in M, mine"]);
      expect((await pj("get", "/BFL/board?assigneeId=somebody", "sa")).status).toBe(400);
    });

    it("a move into another status runs the status rules of PATCH: closedAt set and cleared, the status logged", async () => {
      await project({ key: "MOV" });
      const i = await issue("MOV", { title: "moves" });
      const j = await issue("MOV", { title: "patched" });
      const done = await pj("post", `/MOV/issues/${i.key}/reorder`, "sa", {
        position: 3,
        statusId: st["Done"],
      });
      expect([done.status, done.body.status.name, done.body.position]).toEqual([
        200,
        "Done",
        3,
      ]);
      expect(done.body.closedAt).not.toBeNull();
      const patched = await pj("patch", `/MOV/issues/${j.key}`, "sa", {
        statusId: st["Done"],
      });
      // the same change, written the same way
      const rows = async (id: string) =>
        (
          await db.projectActivity.findMany({
            where: { issueId: id },
            orderBy: { createdAt: "asc" },
          })
        ).map((r) => [r.action, r.changes]);
      expect((await rows(i.id)).pop()).toEqual((await rows(j.id)).pop());
      expect(patched.body.closedAt).not.toBeNull();
      // between two Done columns: still closed, the same moment; out of Done: cleared
      const wont = await pj("post", `/MOV/issues/${i.key}/reorder`, "sa", {
        position: 1,
        statusId: st["Won't do"],
      });
      expect(wont.body.closedAt).toBe(done.body.closedAt);
      const back = await pj("post", `/MOV/issues/${i.key}/reorder`, "sa", {
        position: 1,
        statusId: st["In progress"],
      });
      expect(back.body.closedAt).toBeNull();
      expect(
        (await rows(i.id)).map((r) =>
          (r[1] as Json[]).map((c) => `${c.field}:${c.old}>${c.new}`),
        ),
      ).toEqual([
        ["title:null>moves", "type:null>Task", "status:null>New", "priority:null>NORMAL"],
        ["status:New>Done"],
        ["status:Done>Won't do"],
        ["status:Won't do>In progress"],
      ]);
      // a move within the column is not an event
      const n = (await rows(i.id)).length;
      await pj("post", `/MOV/issues/${i.key}/reorder`, "sa", { position: 7 });
      expect((await rows(i.id)).length).toBe(n);
      const unknown = await pj("post", `/MOV/issues/${i.key}/reorder`, "sa", {
        position: 1,
        statusId: randomUUID(),
      });
      expect([unknown.status, unknown.body.message]).toEqual([
        404,
        "Issue status not found.",
      ]);
    });

    it("moves that arrive together keep distinct positions in every column, and every card lands where it was sent", async () => {
      await project({ key: "CON" });
      const cards: Json[] = [];
      for (let n = 0; n < 12; n++) cards.push(await issue("CON", { title: `card ${n}` }));
      const toNew = cards.slice(0, 6);
      const toWip = cards.slice(6);
      // everyone is sent to position 5 of a column: half in the column they are in, half to another
      const results = await Promise.all([
        ...toNew.map((c) =>
          pj("post", `/CON/issues/${c.key}/reorder`, "sa", { position: 5 }),
        ),
        ...toWip.map((c) =>
          pj("post", `/CON/issues/${c.key}/reorder`, "sa", {
            position: 5,
            statusId: st["In progress"],
          }),
        ),
      ]);
      expect(results.map((r) => r.status)).toEqual(Array(12).fill(200));
      const rows = await db.issue.findMany({
        where: { project: { key: "CON" }, firmId },
        select: { key: true, position: true, statusId: true },
      });
      for (const col of [st["New"], st["In progress"]]) {
        const ps = rows.filter((r) => r.statusId === col).map((r) => r.position);
        expect(ps).toHaveLength(6);
        expect(new Set(ps).size).toBe(6); // all distinct
      }
      expect(
        rows
          .filter((r) => r.statusId === st["In progress"])
          .map((r) => r.key)
          .sort(),
      ).toEqual(toWip.map((c) => c.key).sort());
      // the board lists them in a stable order, each card once
      const board = (await pj("get", "/CON/board", "sa")).body;
      expect(board.total).toBe(12);
      for (const name of ["New", "In progress"]) {
        const col = board.columns.find((c: Json) => c.status.name === name);
        const ps = col.items.map((i: Json) => i.position);
        expect(ps).toEqual([...ps].sort((a, b) => a - b));
      }
      // renumbering other cards is not a change to them
      const stamp = await db.issue.findFirstOrThrow({
        where: { key: toNew[0]!.key, firmId },
      });
      const before = stamp.updatedAt.getTime();
      await pj("post", `/CON/issues/${toNew[1]!.key}/reorder`, "sa", {
        position: stamp.position,
      });
      expect(
        (
          await db.issue.findFirstOrThrow({ where: { key: toNew[0]!.key, firmId } })
        ).updatedAt.getTime(),
      ).toBe(before);
    });
  });

  // ======================================================================================
  describe("T2 · the roadmap", () => {
    it("every milestone answers percent done, startDate, dueDate and today; GET roadmap splits dated from undated", async () => {
      await project({ key: "RDM" });
      const m1 = (
        await pj("post", "/RDM/milestones", "sa", {
          name: "Later",
          startDate: "2026-12-01",
          dueDate: "2026-12-31",
        })
      ).body;
      const m2 = (
        await pj("post", "/RDM/milestones", "sa", {
          name: "Sooner",
          dueDate: "2026-11-15",
        })
      ).body;
      const m3 = (
        await pj("post", "/RDM/milestones", "sa", {
          name: "Only a start",
          startDate: "2026-11-20",
        })
      ).body;
      const m4 = (await pj("post", "/RDM/milestones", "sa", { name: "No dates" })).body;
      await issue("RDM", { title: "a", milestoneId: m1.id });
      await issue("RDM", { title: "b", milestoneId: m1.id, statusId: st["Done"] });
      await issue("RDM", { title: "c", milestoneId: m1.id, statusId: st["Done"] });
      const list = (await pj("get", "/RDM/milestones", "viewer")).body;
      const later = list.find((m: Json) => m.name === "Later");
      expect(later).toMatchObject({
        percent: 67,
        startDate: "2026-12-01",
        dueDate: "2026-12-31",
        today: manilaToday(),
        progress: { done: 2, total: 3, percent: 67 },
      });
      const road = (await pj("get", "/RDM/roadmap", "viewer")).body;
      expect(Object.keys(road).sort()).toEqual(["dated", "today", "undated"]);
      expect(road.today).toBe(manilaToday());
      expect(road.dated.map((m: Json) => m.name)).toEqual([
        "Sooner",
        "Only a start",
        "Later",
      ]); // by due date, else start date
      expect(road.undated.map((m: Json) => m.name)).toEqual(["No dates"]);
      expect(road.dated[2]).toMatchObject({ id: m1.id, percent: 67 });
      // a closed milestone stays on the roadmap, with its state
      await pj("patch", `/RDM/milestones/${m2.id}`, "sa", { state: "CLOSED" });
      expect(
        (await pj("get", "/RDM/roadmap", "sa")).body.dated.find(
          (m: Json) => m.id === m2.id,
        ).state,
      ).toBe("CLOSED");
      void m3;
      void m4;
    });
  });

  // ======================================================================================
  describe("T3 · My Work", () => {
    it("my open issues by priority then due date, overdue across projects, milestones in 30 days, recent activity, totals", async () => {
      const today = manilaToday();
      await project({ key: "MW1" });
      await project({ key: "MW2" });
      const mk = (pk: string, title: string, extra: Json = {}) =>
        issue(pk, { title, assigneeId: uid["member"], ...extra });
      const low = await mk("MW1", "low, due soon", {
        priority: "LOW",
        dueDate: addDays(today, 2),
      });
      const urgentLate = await mk("MW1", "urgent, no date", { priority: "URGENT" });
      const high1 = await mk("MW2", "high, due in 3 days", {
        priority: "HIGH",
        dueDate: addDays(today, 3),
      });
      const high2 = await mk("MW2", "high, due tomorrow", {
        priority: "HIGH",
        dueDate: addDays(today, 1),
      });
      const overdueMine = await mk("MW1", "overdue, mine", {
        priority: "NORMAL",
        dueDate: addDays(today, -3),
      });
      await mk("MW1", "done, mine", { statusId: st["Done"] });
      await mk("MW1", "mine, due in 20 days", { dueDate: addDays(today, 20) });
      const overdueOther = await issue("MW2", {
        title: "overdue, not mine",
        dueDate: addDays(today, -10),
        assigneeId: uid["member2"],
      });
      await issue("MW2", { title: "not mine, not late", assigneeId: uid["member2"] });
      await issue("MW2", {
        title: "overdue but done",
        dueDate: addDays(today, -10),
        statusId: st["Done"],
      });
      const mine = (await pj("get", "/my-work", "member")).body;
      expect(Object.keys(mine).sort()).toEqual([
        "assigned",
        "overdue",
        "recentActivity",
        "today",
        "totals",
        "upcomingMilestones",
      ]);
      expect(mine.today).toBe(today);
      // urgent first, high by nearest due date, then normal ones (overdue first, then 20 days), low last
      expect(mine.assigned.map((i: Json) => i.title)).toEqual([
        "urgent, no date",
        "high, due tomorrow",
        "high, due in 3 days",
        "overdue, mine",
        "mine, due in 20 days",
        "in M, mine", // left over from the board tests: normal priority, no date, sorts after dated ones
        "low, due soon",
      ]);
      expect(
        mine.assigned.every(
          (i: Json) => i.assignee.id === uid["member"] && i.status.category !== "DONE",
        ),
      ).toBe(true);
      // overdue across all the projects I can see: mine and other people's, nearest first
      expect(mine.overdue.map((i: Json) => i.title)).toEqual([
        "overdue, not mine",
        "overdue, mine",
      ]);
      expect(mine.totals).toEqual({ assignedOpen: 7, overdue: 2, dueThisWeek: 3 });
      // due this week: today and the next 6 days, mine, open: low (2), high (3), high (1)
      void low;
      void urgentLate;
      void high1;
      void high2;
      void overdueMine;
      void overdueOther;
      expect(mine.recentActivity.length).toBeGreaterThan(0);
      expect(mine.recentActivity.length).toBeLessThanOrEqual(20);
      expect(mine.recentActivity[0]).toMatchObject({
        project: { key: expect.any(String) },
        actorType: "USER",
      });
      // another person's own list is their own
      const other = (await pj("get", "/my-work", "member2")).body;
      expect(other.totals.assignedOpen).toBe(2);
      expect(other.assigned.map((i: Json) => i.title).sort()).toEqual([
        "not mine, not late",
        "overdue, not mine",
      ]);
      expect(other.totals.overdue).toBe(2); // the same overdue ones: they are across all projects
    });

    it("recent activity is the latest 20 over the visible projects, newest first", async () => {
      await project({ key: "MW3" });
      for (let n = 0; n < 24; n++) await issue("MW3", { title: `bulk ${n}` });
      const mine = (await pj("get", "/my-work", "viewer")).body;
      expect(mine.recentActivity).toHaveLength(20);
      const times = mine.recentActivity.map((a: Json) => a.createdAt);
      expect(times).toEqual([...times].sort().reverse());
      expect(mine.recentActivity[0].issueKey).toMatch(/^MW3-/);
    });

    it("open milestones due in the next 30 days, with their project and progress; nothing later, closed or locked", async () => {
      const today = manilaToday();
      await project({ key: "MW4" });
      const mk = (name: string, dueDate: string | null, state?: string) =>
        pj("post", "/MW4/milestones", "sa", {
          name,
          ...(dueDate ? { dueDate } : {}),
        }).then(async (r) => {
          if (state) await pj("patch", `/MW4/milestones/${r.body.id}`, "sa", { state });
          return r.body as Json;
        });
      const today0 = await mk("due today", today);
      await mk("due in 30 days", addDays(today, 30));
      await mk("due in 31 days", addDays(today, 31));
      await mk("yesterday", addDays(today, -1));
      await mk("closed", addDays(today, 5), "CLOSED");
      await mk("locked", addDays(today, 5), "LOCKED");
      await mk("no date", null);
      await issue("MW4", {
        title: "in today's",
        milestoneId: today0.id,
        statusId: st["Done"],
      });
      await issue("MW4", { title: "in today's too", milestoneId: today0.id });
      const w = (await pj("get", "/my-work", "viewer")).body;
      const mine = w.upcomingMilestones.filter((m: Json) => m.project.key === "MW4");
      expect(mine.map((m: Json) => m.name)).toEqual(["due today", "due in 30 days"]);
      expect(mine[0]).toMatchObject({
        project: { key: "MW4", name: "Project MW4" },
        progress: { done: 1, total: 2, percent: 50 },
        dueDate: today,
      });
    });

    it("visibility: a client's project is not in My Work for a person who cannot see that client; archived projects are not in it", async () => {
      const today = manilaToday();
      await project({ key: "MWC", clientId });
      await project({ key: "MWA" });
      const c1 = await issue("MWC", {
        title: "client work, mine",
        assigneeId: uid["memberAssigned"],
        dueDate: addDays(today, -1),
      });
      await issue("MWC", {
        title: "client work, assigned to member",
        assigneeId: uid["member"],
        dueDate: addDays(today, -1),
      });
      await pj("post", "/MWC/milestones", "sa", {
        name: "Client milestone",
        dueDate: addDays(today, 3),
      });
      await issue("MWA", {
        title: "in an archived project",
        assigneeId: uid["member"],
        dueDate: addDays(today, -1),
      });
      await pj("post", "/MWA/archive", "sa");
      const titles = (w: Json) => [...w.assigned, ...w.overdue].map((i: Json) => i.title);
      const seesClient = (await pj("get", "/my-work", "memberAssigned")).body;
      expect(titles(seesClient)).toContain("client work, mine");
      expect(seesClient.upcomingMilestones.map((m: Json) => m.name)).toContain(
        "Client milestone",
      );
      expect(seesClient.recentActivity.some((a: Json) => a.project.key === "MWC")).toBe(
        true,
      );
      // "member" is not assigned to the client: assigned to them, but they cannot see it
      const hidden = (await pj("get", "/my-work", "member")).body;
      expect(titles(hidden)).not.toContain("client work, assigned to member");
      expect(titles(hidden)).not.toContain("client work, mine");
      expect(hidden.upcomingMilestones.map((m: Json) => m.name)).not.toContain(
        "Client milestone",
      );
      expect(hidden.recentActivity.some((a: Json) => a.project.key === "MWC")).toBe(
        false,
      );
      expect(hidden.totals.assignedOpen).toBe(hidden.assigned.length); // the totals do not count it either
      // archived
      expect(titles((await pj("get", "/my-work", "sa")).body)).not.toContain(
        "in an archived project",
      );
      // Super Admin sees every client
      expect(titles((await pj("get", "/my-work", "sa")).body)).toContain(
        "client work, mine",
      );
      void c1;
    });
  });

  // ======================================================================================
  describe("T4 · search", () => {
    it("issues by key, title or description; projects by key or name; 20 in each group", async () => {
      await project({ key: "SRCH", name: "Zebra Crossing" });
      await project({ key: "ZEB", name: "Other" });
      await issue("SRCH", { title: "Findable aardvark title" });
      await issue("SRCH", {
        title: "Plain",
        description: "mentions the aardvark inside",
      });
      await issue("SRCH", { title: "Unrelated" });
      const r = (await pj("get", "/search?q=aardvark", "viewer")).body;
      expect(Object.keys(r).sort()).toEqual(["issues", "jump", "projects"]);
      expect(r.jump).toBeNull();
      expect(r.issues.map((i: Json) => i.title).sort()).toEqual([
        "Findable aardvark title",
        "Plain",
      ]);
      expect(r.projects).toEqual([]);
      const byProject = (await pj("get", "/search?q=zeb", "viewer")).body;
      expect(byProject.projects.map((p: Json) => p.key)).toEqual(["SRCH", "ZEB"]); // name Zebra, key ZEB
      expect(byProject.projects[0]).toEqual({
        id: expect.any(String),
        key: "SRCH",
        name: "Zebra Crossing",
        archived: false,
        client: null,
      });
      const byKey = (await pj("get", "/search?q=SRCH", "viewer")).body;
      expect(byKey.projects.map((p: Json) => p.key)).toContain("SRCH");
      expect(byKey.issues.map((i: Json) => i.key).sort()).toEqual([
        "SRCH-1",
        "SRCH-2",
        "SRCH-3",
      ]); // an issue key contains it
      for (let n = 0; n < 24; n++) await issue("SRCH", { title: `Bulk marmot ${n}` });
      const many = (await pj("get", "/search?q=marmot", "viewer")).body;
      expect(many.issues).toHaveLength(20);
      expect(new Set(many.issues.map((i: Json) => i.key)).size).toBe(20);
    });

    it("an exact issue key jumps there (any case, spaces trimmed); an unknown key falls back to the search", async () => {
      await project({ key: "JMP" });
      await issue("JMP", { title: "Jump target" });
      for (const q of ["JMP-1", "jmp-1", "  Jmp-1  "]) {
        const r = await pj("get", `/search?q=${encodeURIComponent(q)}`, "viewer");
        expect([q, r.status, r.body.jump]).toEqual([
          q,
          200,
          { projectKey: "JMP", issueKey: "JMP-1" },
        ]);
        expect(r.body.issues).toEqual([]);
      }
      const unknown = (await pj("get", "/search?q=jmp-99", "viewer")).body;
      expect(unknown).toEqual({ jump: null, issues: [], projects: [] });
      // a deleted issue does not jump
      await pj("delete", "/JMP/issues/JMP-1", "sa");
      expect((await pj("get", "/search?q=jmp-1", "viewer")).body.jump).toBeNull();
      // a key that is also words falls back to the ordinary search
      await issue("JMP", { title: "mentions JMP-77 in passing" });
      const words = (await pj("get", "/search?q=jmp-77", "viewer")).body;
      expect(words.jump).toBeNull();
      expect(words.issues.map((i: Json) => i.title)).toEqual([
        "mentions JMP-77 in passing",
      ]);
    });

    it("only what the caller may see: a hidden client project's issues are not found and its key does not jump; other firms never", async () => {
      await project({ key: "SCL", clientId });
      await issue("SCL", { title: "Confidential clientwork zzz" });
      await project({ key: "SOP" });
      await issue("SOP", { title: "Open clientwork zzz" });
      const seen = (await pj("get", "/search?q=zzz", "memberAssigned")).body;
      expect(seen.issues.map((i: Json) => i.title).sort()).toEqual([
        "Confidential clientwork zzz",
        "Open clientwork zzz",
      ]);
      const hidden = (await pj("get", "/search?q=zzz", "member")).body;
      expect(hidden.issues.map((i: Json) => i.title)).toEqual(["Open clientwork zzz"]);
      expect((await pj("get", "/search?q=SCL-1", "member")).body).toEqual({
        jump: null,
        issues: [],
        projects: [],
      });
      expect((await pj("get", "/search?q=SCL", "member")).body.projects).toEqual([]);
      expect((await pj("get", "/search?q=SCL-1", "memberAssigned")).body.jump).toEqual({
        projectKey: "SCL",
        issueKey: "SCL-1",
      });
      const other = (await pj("get", "/search?q=zzz", "sa2")).body;
      expect(other).toEqual({ jump: null, issues: [], projects: [] });
      expect((await pj("get", "/search?q=SOP-1", "sa2")).body.jump).toBeNull();
    });

    it("an empty search is a 400", async () => {
      for (const qs of ["", "?q=", "?q=%20%20"]) {
        const r = await pj("get", `/search${qs}`, "viewer");
        expect([qs, r.status, r.body.message]).toEqual([qs, 400, "Validation failed"]);
      }
    });
  });

  // ======================================================================================
  describe("T5 · notifications", () => {
    beforeEach(clearNotes);

    it("assigned: the assignee is told, once; the person acting is not; nobody else", async () => {
      await project({ key: "NA" });
      const i = await issue("NA", { title: "Assign me", assigneeId: uid["member"] });
      const got = await notes("member");
      expect(got).toHaveLength(1);
      expect(got[0]).toMatchObject({
        firmId,
        kind: "project.issue.assigned",
        title: "NA-1 was assigned to you",
        body: `${TAG} sa assigned you NA-1: Assign me`,
        link: "/projects/NA/issues/NA-1",
        entityType: "Issue",
        entityId: i.id,
        readAt: null,
      });
      expect(await notes("sa")).toHaveLength(0);
      expect(await db.notification.count({ where: { firmId } })).toBe(1);
      // giving it to yourself tells no one
      await pj("patch", "/NA/issues/NA-1", "member", { assigneeId: uid["member"] });
      await issue("NA", { title: "Mine", assigneeId: uid["sa"] }, "sa");
      expect(await db.notification.count({ where: { firmId } })).toBe(1);
      // a new assignee is told; the old one is not
      await pj("patch", "/NA/issues/NA-1", "sa", { assigneeId: uid["member2"] });
      expect(await notes("member2")).toHaveLength(1);
      expect(await notes("member")).toHaveLength(1);
      // clearing the assignee tells no one
      await pj("patch", "/NA/issues/NA-1", "sa", { assigneeId: null });
      expect(await db.notification.count({ where: { firmId } })).toBe(2);
    });

    it("comments: the assignee, the author and earlier commenters are told, not the commenter; one each", async () => {
      await project({ key: "NC" });
      await issue("NC", { title: "Discuss", assigneeId: uid["member"] }, "sa"); // author sa, assignee member
      await clearNotes();
      await pj("post", "/NC/issues/NC-1/comments", "member2", {
        body: "First from member2",
      });
      expect((await notes("member")).map((n) => n.kind)).toEqual([
        "project.issue.commented",
      ]);
      expect((await notes("sa")).map((n) => n.kind)).toEqual(["project.issue.commented"]);
      expect(await notes("member2")).toHaveLength(0);
      const n = (await notes("member"))[0]!;
      expect([n.title, n.body, n.link]).toEqual([
        "New comment on NC-1",
        `${TAG} member2 commented on NC-1: First from member2`,
        "/projects/NC/issues/NC-1",
      ]);
      await clearNotes();
      // member2 is now an earlier commenter: told when the assignee comments
      await pj("post", "/NC/issues/NC-1/comments", "member", { body: "Reply" });
      expect((await notes("member2")).map((x) => x.kind)).toEqual([
        "project.issue.commented",
      ]);
      expect((await notes("sa")).length).toBe(1);
      expect(await notes("member")).toHaveLength(0);
      // somebody uninvolved is not told
      expect(await notes("viewer")).toHaveLength(0);
    });

    it("someone who is both author and assignee is told once, not twice", async () => {
      await project({ key: "ND" });
      await issue("ND", { title: "Both", assigneeId: uid["member"] }, "member"); // member authors and assigns themselves
      await clearNotes();
      await pj("post", "/ND/issues/ND-1/comments", "sa", { body: "Hello" });
      expect(await notes("member")).toHaveLength(1);
      await clearNotes();
      await pj("patch", "/ND/issues/ND-1", "sa", { statusId: st["In progress"] });
      expect(await notes("member")).toHaveLength(1);
    });

    it("a status change tells the involved; a move into a done status is 'closed' instead; reopening is a status change", async () => {
      await project({ key: "NS" });
      await issue("NS", { title: "Move me", assigneeId: uid["member"] }, "sa");
      await pj("post", "/NS/issues/NS-1/comments", "member2", { body: "I am watching" });
      await clearNotes();
      await pj("patch", "/NS/issues/NS-1", "sa", { statusId: st["In progress"] });
      const wip = [...(await notes("member")), ...(await notes("member2"))];
      expect(wip.map((n) => n.kind)).toEqual([
        "project.issue.status",
        "project.issue.status",
      ]);
      expect(wip[0]).toMatchObject({
        title: "NS-1 moved to In progress",
        body: `${TAG} sa moved NS-1: Move me to In progress`,
      });
      expect(await notes("sa")).toHaveLength(0);
      await clearNotes();
      await pj("patch", "/NS/issues/NS-1", "member", { statusId: st["Done"] });
      expect((await notes("member")).length).toBe(0); // the actor
      expect((await notes("member2")).map((n) => [n.kind, n.title])).toEqual([
        ["project.issue.closed", "NS-1 was closed"],
      ]);
      expect((await notes("sa")).map((n) => n.kind)).toEqual(["project.issue.closed"]); // the author
      await clearNotes();
      // Done to Won't do: both closed, so a plain status change
      await pj("patch", "/NS/issues/NS-1", "sa", { statusId: st["Won't do"] });
      expect((await notes("member2")).map((n) => n.kind)).toEqual([
        "project.issue.status",
      ]);
      await clearNotes();
      await pj("patch", "/NS/issues/NS-1", "sa", { statusId: st["New"] });
      expect((await notes("member2")).map((n) => n.kind)).toEqual([
        "project.issue.status",
      ]);
      // the board's move tells them the same
      await clearNotes();
      await pj("post", "/NS/issues/NS-1/reorder", "sa", {
        position: 2,
        statusId: st["Done"],
      });
      expect((await notes("member")).map((n) => n.kind)).toEqual([
        "project.issue.closed",
      ]);
      // a move inside the column, or a change that is not a status, tells no one
      await clearNotes();
      await pj("post", "/NS/issues/NS-1/reorder", "sa", { position: 5 });
      await pj("patch", "/NS/issues/NS-1", "sa", { title: "Renamed", priority: "HIGH" });
      expect(await db.notification.count({ where: { firmId } })).toBe(0);
    });

    it("one change, one notification per person: assigned wins over the status change in the same update", async () => {
      await project({ key: "NO" });
      await issue("NO", { title: "Two things at once", assigneeId: uid["member"] }, "sa");
      await clearNotes();
      await pj("patch", "/NO/issues/NO-1", "sa", {
        assigneeId: uid["member2"],
        statusId: st["In progress"],
      });
      expect((await notes("member2")).map((n) => n.kind)).toEqual([
        "project.issue.assigned",
      ]);
      // the previous assignee is no longer involved in the issue, so hears nothing
      expect(await notes("member")).toHaveLength(0);
    });

    it("only people who may see the project are told: client visibility and Projects:Read", async () => {
      await project({ key: "NV", clientId });
      // member cannot see this client's project, memberAssigned can; norole has no Projects permission
      await issue("NV", { title: "Hidden", assigneeId: uid["member"] }, "sa");
      await issue("NV", { title: "Visible", assigneeId: uid["memberAssigned"] }, "sa");
      await issue("NV", { title: "No permission", assigneeId: uid["norole"] }, "sa");
      expect(await notes("member")).toHaveLength(0);
      expect(await notes("norole")).toHaveLength(0);
      expect((await notes("memberAssigned")).map((n) => n.title)).toEqual([
        "NV-2 was assigned to you",
      ]);
      // the author who can no longer see the client's project hears nothing about a comment
      await pj("post", "/NV/issues/NV-1/comments", "memberAssigned", {
        body: "A comment",
      });
      expect(await notes("member")).toHaveLength(0);
    });

    it("a change that rolls back leaves no notification and sends no email", async () => {
      await project({ key: "NR" });
      await db.notificationPreference.create({
        data: { userId: uid["member"]!, firmId, emailEnabled: true },
      });
      const activity = app.get(ProjectsActivity);
      const original = activity.log.bind(activity);
      const spy = jest
        .spyOn(activity, "log")
        .mockImplementation(async (tx, actor, input) => {
          await original(tx, actor, input);
          throw new Error("boom after the activity and the notification");
        });
      try {
        const res = await pj("post", "/NR/issues", "sa", {
          title: "Never made",
          assigneeId: uid["member"],
        });
        expect(res.status).toBe(500);
      } finally {
        spy.mockRestore();
      }
      expect(await db.notification.count({ where: { firmId } })).toBe(0);
      expect(mail.send).not.toHaveBeenCalled();
      await db.notificationPreference.deleteMany({ where: { userId: uid["member"]! } });
    });

    it("the routes: list (unread first or newest), unread count, read one, read all", async () => {
      await project({ key: "NL" });
      for (let n = 0; n < 5; n++)
        await issue("NL", { title: `Issue ${n}`, assigneeId: uid["member"] }, "sa");
      expect((await call("get", "/notifications/unread-count", "member")).body).toEqual({
        count: 5,
      });
      const all = (await call("get", "/notifications?order=newest", "member")).body;
      expect(Object.keys(all).sort()).toEqual([
        "items",
        "page",
        "pageSize",
        "total",
        "unread",
      ]);
      expect([all.total, all.unread, all.page, all.pageSize]).toEqual([5, 5, 1, 25]);
      expect(Object.keys(all.items[0]).sort()).toEqual([
        "body",
        "createdAt",
        "entityId",
        "entityType",
        "id",
        "kind",
        "link",
        "readAt",
        "title",
      ]);
      expect(all.items.map((i: Json) => i.title)).toEqual(
        [4, 3, 2, 1, 0].map((n) => `NL-${n + 1} was assigned to you`),
      );
      // read the newest: unread-first puts it last
      const one = await call("post", `/notifications/${all.items[0].id}/read`, "member");
      expect(one.status).toBe(200);
      expect(one.body.readAt).not.toBeNull();
      const again = await call(
        "post",
        `/notifications/${all.items[0].id}/read`,
        "member",
      );
      expect(again.body.readAt).toBe(one.body.readAt); // reading twice changes nothing
      expect(
        (await call("get", "/notifications/unread-count", "member")).body.count,
      ).toBe(4);
      const unreadFirst = (await call("get", "/notifications", "member")).body;
      expect(unreadFirst.items.map((i: Json) => i.title)).toEqual(
        ["NL-4", "NL-3", "NL-2", "NL-1", "NL-5"].map((k) => `${k} was assigned to you`),
      );
      expect(unreadFirst.items.map((i: Json) => i.readAt !== null)).toEqual([
        false,
        false,
        false,
        false,
        true,
      ]);
      // paging
      const p2 = (
        await call("get", "/notifications?order=newest&page=2&pageSize=2", "member")
      ).body;
      expect([
        p2.page,
        p2.pageSize,
        p2.total,
        p2.items.map((i: Json) => i.title),
      ]).toEqual([2, 2, 5, ["NL-3 was assigned to you", "NL-2 was assigned to you"]]);
      // someone else's notification cannot be read
      const stranger = await call(
        "post",
        `/notifications/${all.items[1].id}/read`,
        "member2",
      );
      expect([stranger.status, stranger.body.message]).toEqual([
        404,
        "Notification not found.",
      ]);
      expect(
        (await call("post", `/notifications/${randomUUID()}/read`, "member")).status,
      ).toBe(404);
      expect((await call("post", "/notifications/not-an-id/read", "member")).status).toBe(
        404,
      );
      expect(
        (await call("get", "/notifications/unread-count", "member")).body.count,
      ).toBe(4);
      // read all
      const ra = await call("post", "/notifications/read-all", "member");
      expect([ra.status, ra.body]).toEqual([200, { updated: 4 }]);
      expect(
        (await call("get", "/notifications/unread-count", "member")).body.count,
      ).toBe(0);
      expect((await call("post", "/notifications/read-all", "member")).body).toEqual({
        updated: 0,
      });
      // each person has their own, in each firm
      expect((await call("get", "/notifications", "member2")).body.total).toBe(0);
      expect((await call("get", "/notifications", "sa2")).body.total).toBe(0);
      expect((await call("get", "/notifications?order=sideways", "member")).status).toBe(
        400,
      );
    });

    it("preferences: email off until switched on, per person", async () => {
      expect((await call("get", "/notifications/preferences", "member")).body).toEqual({
        emailEnabled: false,
      });
      const on = await call("patch", "/notifications/preferences", "member", {
        emailEnabled: true,
      });
      expect([on.status, on.body]).toEqual([200, { emailEnabled: true }]);
      expect((await call("get", "/notifications/preferences", "member")).body).toEqual({
        emailEnabled: true,
      });
      expect((await call("get", "/notifications/preferences", "member2")).body).toEqual({
        emailEnabled: false,
      });
      expect(
        (
          await call("patch", "/notifications/preferences", "member", {
            emailEnabled: "yes",
          })
        ).status,
      ).toBe(400);
      expect(
        (await call("patch", "/notifications/preferences", "member", {})).status,
      ).toBe(400);
      expect(
        (
          await call("patch", "/notifications/preferences", "member", {
            emailEnabled: false,
          })
        ).body,
      ).toEqual({ emailEnabled: false });
    });

    it("email: only to people who switched it on, only after the commit, with the issue link; a mail failure changes nothing", async () => {
      await project({ key: "NE" });
      await call("patch", "/notifications/preferences", "member", { emailEnabled: true });
      // member2 has email off
      let seenInDb: unknown = null;
      mail.send.mockImplementation(async (m) => {
        // at the moment of sending the change is already committed and visible to everyone
        seenInDb = {
          notifications: await db.notification.count({
            where: { userId: uid["member"]!, readAt: null },
          }),
          issue: await db.issue.count({ where: { key: "NE-1", firmId } }),
        };
        sent.push(m);
        return { provider: "postal", messageId: "x" };
      });
      await issue("NE", { title: "Mail me", assigneeId: uid["member"] }, "sa");
      await issue("NE", { title: "Do not mail", assigneeId: uid["member2"] }, "sa");
      expect(sent).toHaveLength(1);
      expect(seenInDb).toEqual({ notifications: 1, issue: 1 });
      expect(sent[0]!.to).toBe(`${TAG}-member@example.com`);
      expect(sent[0]!.subject).toBe("NE-1 was assigned to you");
      expect(sent[0]!.html).toContain("/projects/NE/issues/NE-1");
      expect(sent[0]!.html).toContain(`${TAG} sa assigned you NE-1: Mail me`);
      expect(sent[0]!.text).toContain("/projects/NE/issues/NE-1");
      expect(sent[0]!.text).toMatch(/https?:\/\//);
      // the actor is never mailed even when they switched it on
      await call("patch", "/notifications/preferences", "sa", { emailEnabled: true });
      sent.length = 0;
      await pj("post", "/NE/issues/NE-1/comments", "sa", { body: "From the actor" });
      expect(sent.map((m) => m.to)).toEqual([`${TAG}-member@example.com`]);
      // an update and a board move each send exactly one email to each person told
      sent.length = 0;
      await pj("post", "/NE/issues", "sa", { title: "Reassign me" });
      sent.length = 0;
      await pj("patch", "/NE/issues/NE-3", "sa", { assigneeId: uid["member"] });
      expect(sent.map((m) => m.subject)).toEqual(["NE-3 was assigned to you"]);
      sent.length = 0;
      await pj("post", "/NE/issues/NE-3/reorder", "sa", {
        position: 1,
        statusId: st["Done"],
      });
      expect(sent).toHaveLength(1);
      expect(sent[0]!.to).toBe(`${TAG}-member@example.com`);
      // a mail failure: the change stays, the answer is the same, the notification is there
      sent.length = 0;
      mail.send.mockImplementation(async () => {
        throw new Error("mail server down");
      });
      const res = await pj("post", "/NE/issues", "sa", {
        title: "Mail fails",
        assigneeId: uid["member"],
      });
      expect(res.status).toBe(201);
      expect(await db.issue.count({ where: { key: res.body.key, firmId } })).toBe(1);
      expect(
        (await notes("member")).some(
          (n) => n.title === `${res.body.key} was assigned to you`,
        ),
      ).toBe(true);
      expect(
        (await call("get", "/notifications/unread-count", "member")).body.count,
      ).toBeGreaterThan(0);
      // mail not configured: nothing is sent, nothing fails
      mail.isEnabled.mockImplementation(() => false);
      mail.send.mockClear();
      const quiet = await pj("post", "/NE/issues", "sa", {
        title: "No mail configured",
        assigneeId: uid["member"],
      });
      expect(quiet.status).toBe(201);
      expect(mail.send).not.toHaveBeenCalled();
      await call("patch", "/notifications/preferences", "member", {
        emailEnabled: false,
      });
      await call("patch", "/notifications/preferences", "sa", { emailEnabled: false });
    });
  });

  // ======================================================================================
  describe("T6 · tenants, client visibility, permissions", () => {
    it("another firm's project is a 404 on the board and the roadmap; a hidden client project is a 404 for a user who cannot see it", async () => {
      await project({ key: "TNB" });
      await project({ key: "CLB", clientId });
      for (const path of ["/TNB/board", "/TNB/roadmap"]) {
        expect([path, (await pj("get", path, "sa2")).status]).toEqual([path, 404]);
      }
      for (const path of ["/CLB/board", "/CLB/roadmap"]) {
        expect([path, (await pj("get", path, "member")).status]).toEqual([path, 404]);
        expect([path, (await pj("get", path, "memberAssigned")).status]).toEqual([
          path,
          200,
        ]);
        expect([path, (await pj("get", path, "sa")).status]).toEqual([path, 200]);
      }
      expect((await pj("get", "/NOSUCH/board", "sa")).body.message).toBe(
        "Project not found.",
      );
      expect((await pj("get", "/NOSUCH/roadmap", "sa")).status).toBe(404);
    });

    it("the new Projects routes need Projects:Read: a client user and a firm user with no role are refused; a Viewer may read", async () => {
      await project({ key: "PRN" });
      for (const path of ["/PRN/board", "/PRN/roadmap", "/my-work", "/search?q=x"]) {
        for (const who of ["clientUser", "norole"]) {
          const r = await pj("get", path, who);
          expect([who, path, r.status, r.body.message]).toEqual([
            who,
            path,
            403,
            missing("Projects:Read"),
          ]);
        }
        expect([path, (await pj("get", path, "viewer")).status]).toEqual([path, 200]);
      }
    });

    it("the notification routes need a signed-in person, whatever their role; a client user has an empty list of their own", async () => {
      for (const path of [
        "/notifications",
        "/notifications/unread-count",
        "/notifications/preferences",
      ]) {
        const bare = await http().get(`${API}${path}`);
        expect([path, bare.status]).toEqual([path, 401]);
        for (const who of ["norole", "clientUser", "viewer"])
          expect([path, who, (await call("get", path, who)).status]).toEqual([
            path,
            who,
            200,
          ]);
      }
      expect((await http().post(`${API}/notifications/read-all`)).status).toBe(401);
      expect((await call("post", "/notifications/read-all", "clientUser")).body).toEqual({
        updated: 0,
      });
    });
  });
});
