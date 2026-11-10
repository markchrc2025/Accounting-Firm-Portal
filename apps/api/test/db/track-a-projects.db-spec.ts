/**
 * track-a-projects.db-spec.ts — PA1 (D65): the Projects module core, over HTTP against the real
 * Nest app and the local PostgreSQL (the service layer behind it), plus direct service calls
 * where the clock or a rollback is the point. Every firm, client, user and title is invented.
 *
 * T1  Key numbering under 20 parallel creates; numbers never reused; key format and immutability.
 * T2  closedAt follows the status category; overdue by the Manila date.
 * T3  Soft delete detaches the children; activity field by field; none after a rollback.
 * T4  Who sees what: client-linked projects, client users, permissions, tenants.
 * T5  The portfolio counts, the overview, filters, sorts and views.
 * T6  Admin lists (types, statuses, labels), milestones, comments, status updates, activity.
 */
import { randomUUID } from "node:crypto";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { truncateOncePerFile } from "./helpers/truncate";
import { AppModule } from "../../src/app.module";
import { TokenService } from "../../src/auth/token.service";
import { PrismaService } from "../../src/prisma/prisma.service";
import { IssuesService } from "../../src/projects/issues.service";
import { ProjectsActivity } from "../../src/projects/projects-activity.service";
import { ProjectsService } from "../../src/projects/projects.service";
import { webActor } from "../../src/projects/projects.access";
import type { AuthUser } from "../../src/common/auth/auth-user";

truncateOncePerFile({ firmRoles: ["Super Admin"] });

const TAG = `track-a-projects-${randomUUID().slice(0, 8)}`;
const API = "/api/v1";
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the tests read JSON
type Json = Record<string, any>;

const missing = (...p: string[]) => `Missing permission(s): ${p.join(", ")}`;

describe("PA1 · the Projects module core (real app over HTTP, db)", () => {
  let app: INestApplication;
  let db: PrismaService;
  let firmId = "";
  let otherFirmId = "";
  const tok: Record<string, string> = {};
  const uid: Record<string, string> = {};
  let clientId = "";
  let otherClientId = "";
  let statusId: Record<string, string> = {};
  let typeId: Record<string, string> = {};
  let seq = 0;

  const http = () => request(app.getHttpServer());
  const call = (
    method: "get" | "post" | "patch" | "delete",
    path: string,
    who = "sa",
    body?: object,
  ) => {
    const r = http()
      [method](`${API}/projects${path}`)
      .set("Authorization", `Bearer ${tok[who]}`);
    return body === undefined ? r : r.send(body);
  };
  const authUser = (who: string): AuthUser => ({
    id: uid[who]!,
    firmId: who === "sa2" ? otherFirmId : firmId,
    userType: who === "clientUser" ? "CLIENT" : "FIRM",
    email: `${TAG}-${who}@example.com`,
  });

  /** A new project with a fresh key, over HTTP. */
  async function project(extra: Json = {}, who = "sa") {
    seq += 1;
    const key = extra.key ?? `T${String(seq).padStart(3, "0")}`;
    const res = await call("post", "", who, { name: `Project ${key}`, ...extra, key });
    expect(res.status).toBe(201);
    return res.body as Json;
  }
  const issue = async (pk: string, body: Json = { title: "An issue" }, who = "sa") => {
    const res = await call("post", `/${pk}/issues`, who, body);
    expect(res.status).toBe(201);
    return res.body as Json;
  };
  const activityRows = (where: Json) =>
    db.projectActivity.findMany({ where, orderBy: { createdAt: "asc" } });

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
    opts: {
      roleId?: string;
      firm?: string;
      type?: "FIRM" | "CLIENT";
      assign?: string[];
      viewAll?: boolean;
    },
  ) {
    const fid = opts.firm ?? firmId;
    const viewAllRole = opts.viewAll
      ? await db.permission.upsert({
          where: { resource_action: { resource: "Clients", action: "ViewAll" } },
          update: {},
          create: { resource: "Clients", action: "ViewAll" },
        })
      : null;
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
    void viewAllRole;
    return u.id;
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
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
    const owner = await makeRole(`${TAG} PA Owner`, [
      "Projects:Read",
      "Projects:Create",
      "Projects:Update",
      "Projects:Configure",
    ]);
    const member = await makeRole(`${TAG} PA Member`, [
      "Projects:Read",
      "Projects:Create",
      "Projects:Update",
    ]);
    const viewer = await makeRole(`${TAG} PA Viewer`, ["Projects:Read"]);
    clientId = (
      await db.client.create({
        data: { firmId, businessName: `${TAG} Halimbawa Client`, tin: "000555101" },
      })
    ).id;
    otherClientId = (
      await db.client.create({
        data: { firmId: otherFirmId, businessName: `${TAG} Other`, tin: "000555102" },
      })
    ).id;
    await makeUser("sa", { roleId: sa });
    await makeUser("sa2", { roleId: sa, firm: otherFirmId });
    await makeUser("owner", { roleId: owner });
    await makeUser("member", { roleId: member });
    await makeUser("viewer", { roleId: viewer });
    await makeUser("norole", {});
    await makeUser("memberAssigned", { roleId: member, assign: [clientId] });
    await makeUser("viewerAssigned", { roleId: viewer, assign: [clientId] });
    await makeUser("clientUser", { type: "CLIENT" });
    // the starting types and statuses are made the first time a firm uses Projects
    const meta = await call("get", "/meta");
    expect(meta.status).toBe(200);
    statusId = Object.fromEntries(
      meta.body.issueStatuses.map((s: Json) => [s.name, s.id]),
    );
    typeId = Object.fromEntries(meta.body.issueTypes.map((t: Json) => [t.name, t.id]));
  });
  afterAll(async () => {
    jest.restoreAllMocks();
    await app.close();
  });

  // ======================================================================================
  describe("T1 · numbering, keys", () => {
    it("20 parallel creates on one project give 20 distinct consecutive numbers; a deleted number is never reused", async () => {
      const p = await project({ key: "NUM" });
      const results = await Promise.all(
        Array.from({ length: 20 }, (_, i) =>
          call("post", "/NUM/issues/quick", "sa", { title: `Parallel ${i}` }),
        ),
      );
      expect(results.map((r) => r.status)).toEqual(Array(20).fill(201));
      const numbers = results.map((r) => r.body.number as number).sort((a, b) => a - b);
      expect(numbers).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
      expect(new Set(results.map((r) => r.body.key)).size).toBe(20);
      expect(results.every((r) => r.body.key === `NUM-${r.body.number}`)).toBe(true);

      // delete the last one: the next number is 21, not 20
      expect((await call("delete", "/NUM/issues/NUM-20")).status).toBe(200);
      const next = await call("post", "/NUM/issues/quick", "sa", {
        title: "After the delete",
      });
      expect(next.body.key).toBe("NUM-21");
      expect(
        (await db.project.findFirstOrThrow({ where: { id: p.id } })).issueCounter,
      ).toBe(21);
      // and again after deleting the newest
      expect((await call("delete", "/NUM/issues/NUM-21")).status).toBe(200);
      expect(
        (await call("post", "/NUM/issues/quick", "sa", { title: "And again" })).body.key,
      ).toBe("NUM-22");
      // the deleted ones stay in the table (soft delete), so the key can never be given again
      expect(await db.issue.count({ where: { projectId: p.id, deleted: true } })).toBe(2);
    });

    it("a firm that has never used Projects gets its starting types and statuses at the first request, even when many arrive at once", async () => {
      const fresh = await db.firm.create({ data: { name: `${TAG} Fresh Accounting` } });
      const sa = (
        await db.role.findUniqueOrThrow({
          where: { name_scope: { name: "Super Admin", scope: "FIRM" } },
        })
      ).id;
      await makeUser("fresh", { roleId: sa, firm: fresh.id });
      expect(await db.issueStatus.count({ where: { firmId: fresh.id } })).toBe(0);
      const first = await Promise.all(
        Array.from({ length: 8 }, () => call("get", "/meta", "fresh")),
      );
      expect(first.map((r) => r.status)).toEqual(Array(8).fill(200));
      const meta = (await call("get", "/meta", "fresh")).body;
      expect(meta.issueTypes.map((t: Json) => t.name)).toEqual([
        "Task",
        "Bug",
        "Feature",
        "Epic",
      ]);
      expect(
        meta.issueStatuses.map((s: Json) => [s.name, s.category, s.isDefault]),
      ).toEqual([
        ["New", "TODO", true],
        ["In progress", "IN_PROGRESS", false],
        ["Blocked", "IN_PROGRESS", false],
        ["In review", "IN_PROGRESS", false],
        ["Done", "DONE", false],
        ["Won't do", "DONE", false],
      ]);
      expect(await db.issueStatus.count({ where: { firmId: fresh.id } })).toBe(6);
    });

    it("the key format: 2 to 10 capital letters or digits, starting with a letter; lower case is read as capitals", async () => {
      const BAD =
        "The key must be 2 to 10 capital letters or digits and start with a letter.";
      for (const key of ["P", "1AB", "ABCDEFGHIJK", "PA-Y", "A B", "ÑAB"]) {
        const res = await call("post", "", "sa", { key, name: "Bad key" });
        expect([key, res.status, res.body.message]).toEqual([key, 400, BAD]);
      }
      const ok = await call("post", "", "sa", { key: " fmt1 ", name: "Lower case" });
      expect([ok.status, ok.body.key]).toEqual([201, "FMT1"]);
      const used = await call("post", "", "sa", { key: "FMT1", name: "Again" });
      expect([used.status, used.body.message]).toEqual([
        409,
        "A project with this key already exists.",
      ]);
      const empty = await call("post", "", "sa", { key: "FMT2", name: "   " });
      expect([empty.status, empty.body.message]).toEqual([400, "The name is required."]);
    });

    it("a project key and an issue key never change: the API refuses, and so does the database", async () => {
      const p = await project({ key: "FIX" });
      const i = await issue("FIX");
      const change = await call("patch", "/FIX", "sa", { key: "OTHER" });
      expect([change.status, change.body.message]).toEqual([
        400,
        "A project key cannot be changed.",
      ]);
      expect(
        (await call("patch", "/FIX", "sa", { key: "FIX", name: "Renamed" })).status,
      ).toBe(200);
      expect(i.key).toBe("FIX-1");
      await expect(
        db.project.update({ where: { id: p.id }, data: { key: "ZZZ" } }),
      ).rejects.toThrow(/PROJECT_KEY_FIXED/);
      await expect(
        db.issue.update({ where: { id: i.id }, data: { number: 9 } }),
      ).rejects.toThrow(/ISSUE_KEY_FIXED/);
      await expect(
        db.issue.update({ where: { id: i.id }, data: { key: "FIX-9" } }),
      ).rejects.toThrow(/ISSUE_KEY_FIXED/);
      // a lower case issue key in the URL still finds it
      expect((await call("get", "/fix/issues/fix-1")).body.key).toBe("FIX-1");
    });

    it("the starting types and statuses exist for a firm, with one default; the database allows one default only", async () => {
      expect(Object.keys(typeId).sort()).toEqual(["Bug", "Epic", "Feature", "Task"]);
      expect(Object.keys(statusId).sort()).toEqual([
        "Blocked",
        "Done",
        "In progress",
        "In review",
        "New",
        "Won't do",
      ]);
      const meta = (await call("get", "/meta")).body;
      expect(
        meta.issueStatuses.filter((s: Json) => s.isDefault).map((s: Json) => s.name),
      ).toEqual(["New"]);
      await expect(
        db.issueStatus.update({
          where: { id: statusId["Done"]! },
          data: { isDefault: true },
        }),
      ).rejects.toThrow();
      await expect(
        db.issue.create({
          data: {
            firmId,
            projectId: (await project({ key: "CHK" })).id,
            number: 1,
            key: "CHK-1",
            title: "x",
            typeId: typeId["Task"]!,
            statusId: statusId["New"]!,
            priority: "SOMETIMES",
          },
        }),
      ).rejects.toThrow();
    });
  });

  // ======================================================================================
  describe("T2 · closing and overdue", () => {
    it("entering a DONE status sets closedAt, leaving clears it, moving between two DONE statuses keeps it", async () => {
      await project({ key: "CLS" });
      const i = await issue("CLS");
      expect(i.closedAt).toBeNull();
      const done = await call("patch", "/CLS/issues/CLS-1", "sa", {
        statusId: statusId["Done"],
      });
      expect(done.body.closedAt).not.toBeNull();
      expect(done.body.status.category).toBe("DONE");
      const wont = await call("patch", "/CLS/issues/CLS-1", "sa", {
        statusId: statusId["Won't do"],
      });
      expect(wont.body.closedAt).toBe(done.body.closedAt); // still closed: the same moment
      const back = await call("patch", "/CLS/issues/CLS-1", "sa", {
        statusId: statusId["In progress"],
      });
      expect(back.body.closedAt).toBeNull();
      const again = await call("patch", "/CLS/issues/CLS-1", "sa", {
        statusId: statusId["Done"],
      });
      expect(again.body.closedAt).not.toBeNull();
      const born = await issue("CLS", { title: "Born done", statusId: statusId["Done"] });
      expect(born.closedAt).not.toBeNull();
      // activity says the status moved, with the names
      const rows = await activityRows({ issueId: i.id });
      expect(
        rows.map((r) => (r.changes as Json[]).map((c) => `${c.field}:${c.old}>${c.new}`)),
      ).toEqual([
        [
          "title:null>An issue",
          "type:null>Task",
          "status:null>New",
          "priority:null>NORMAL",
        ],
        ["status:New>Done"],
        ["status:Done>Won't do"],
        ["status:Won't do>In progress"],
        ["status:In progress>Done"],
      ]);
    });

    it("overdue is the due date before today in Manila and not done; the day turns at midnight in Manila", async () => {
      await project({ key: "OVR" });
      const pr = await db.project.findFirstOrThrow({ where: { firmId, key: "OVR" } });
      const issues = app.get(IssuesService);
      const projects = app.get(ProjectsService);
      const actor = webActor(authUser("sa"));
      const due = await issue("OVR", { title: "Due on the 10th", dueDate: "2026-11-10" });
      const doneLate = await issue("OVR", {
        title: "Done, due on the 10th",
        dueDate: "2026-11-10",
        statusId: statusId["Done"],
      });
      const open9 = await issue("OVR", {
        title: "Due on the 9th",
        dueDate: "2026-11-09",
      });
      await issue("OVR", { title: "No date" });
      const overdueKeys = async () =>
        (
          await issues.list(actor, "OVR", { view: "overdue", limit: 100, offset: 0 })
        ).items
          .map((i) => i.key)
          .sort();
      const flag = async (key: string) => (await issues.get(actor, "OVR", key)).overdue;
      const portfolioOverdue = async () =>
        (await projects.list(actor, { includeArchived: false })).find(
          (p) => p.key === "OVR",
        )!.counts.overdue;
      const spy = jest.spyOn(Date, "now");
      try {
        // 23:59:59 on the 10th in Manila (15:59:59 UTC): the 10th is not over yet
        spy.mockReturnValue(Date.parse("2026-11-10T15:59:59.000Z"));
        expect(await overdueKeys()).toEqual([open9.key]);
        expect([
          await flag(due.key),
          await flag(open9.key),
          await flag(doneLate.key),
        ]).toEqual([false, true, false]);
        expect(await portfolioOverdue()).toBe(1);
        // one second later it is the 11th in Manila
        spy.mockReturnValue(Date.parse("2026-11-10T16:00:00.000Z"));
        expect(await overdueKeys()).toEqual([due.key, open9.key].sort());
        expect([await flag(due.key), await flag(doneLate.key)]).toEqual([true, false]);
        expect(await portfolioOverdue()).toBe(2);
        // finishing an overdue issue takes it out
        await issues.update(actor, "OVR", due.key, { statusId: statusId["Done"]! });
        expect(await overdueKeys()).toEqual([open9.key]);
      } finally {
        spy.mockRestore();
      }
      void pr;
    });

    it("dates must be real, and the due date cannot be before the start date", async () => {
      await project({ key: "DAT" });
      for (const dueDate of ["11/10/2026", "tomorrow"]) {
        const res = await call("post", "/DAT/issues", "sa", { title: "x", dueDate });
        expect([dueDate, res.status, res.body.message]).toEqual([
          dueDate,
          400,
          "Validation failed",
        ]);
      }
      const bad = await call("post", "/DAT/issues", "sa", {
        title: "x",
        dueDate: "2026-02-30",
      });
      expect(bad.body.message).toBe("Dates must be real dates written as YYYY-MM-DD.");
      const order = await call("post", "/DAT/issues", "sa", {
        title: "x",
        startDate: "2026-11-10",
        dueDate: "2026-11-09",
      });
      expect([order.status, order.body.message]).toEqual([
        400,
        "The due date cannot be before the start date.",
      ]);
    });
  });

  // ======================================================================================
  describe("T3 · soft delete, activity, rollback", () => {
    it("deleting an issue detaches its children, each logged; the deleted issue vanishes but its row stays", async () => {
      await project({ key: "DEL" });
      const parent = await issue("DEL", { title: "Parent" });
      const c1 = await issue("DEL", { title: "Child one", parentKey: parent.key });
      const c2 = await issue("DEL", { title: "Child two", parentKey: parent.key });
      expect(
        (await call("get", "/DEL/issues/DEL-1")).body.children.map((c: Json) => c.key),
      ).toEqual([c1.key, c2.key]);
      const res = await call("delete", "/DEL/issues/DEL-1");
      expect([res.status, res.body]).toEqual([200, { deleted: true, key: "DEL-1" }]);
      expect((await call("get", "/DEL/issues/DEL-1")).status).toBe(404);
      expect(
        (await call("get", "/DEL/issues")).body.items.map((i: Json) => i.key),
      ).toEqual(expect.not.arrayContaining(["DEL-1"]));
      for (const c of [c1, c2]) {
        const got = (await call("get", `/DEL/issues/${c.key}`)).body;
        expect(got.parentKey).toBeNull();
        const rows = await activityRows({ issueId: c.id });
        const last = rows[rows.length - 1]!;
        expect([last.action, last.changes]).toEqual([
          "issue.updated",
          [{ field: "parent", old: "DEL-1", new: null }],
        ]);
      }
      const deleted = await db.issue.findFirstOrThrow({
        where: { key: "DEL-1", firmId },
      });
      expect(deleted.deleted).toBe(true);
      const last = (await activityRows({ issueId: parent.id })).pop()!;
      expect([last.action, last.changes]).toEqual([
        "issue.deleted",
        [{ field: "deleted", old: false, new: true }],
      ]);
      // a second delete finds nothing
      expect((await call("delete", "/DEL/issues/DEL-1")).status).toBe(404);
    });

    it("activity is written field by field with who and how; a change that changes nothing writes nothing", async () => {
      await project({ key: "ACT" });
      const mil = (await call("post", "/ACT/milestones", "sa", { name: "First release" }))
        .body;
      const label = (
        await call("post", "/admin/labels", "sa", { name: `${TAG} urgent-ish` })
      ).body;
      const i = await issue("ACT", { title: "Before" });
      const before = (await activityRows({ issueId: i.id })).length;
      const res = await call("patch", "/ACT/issues/ACT-1", "sa", {
        title: "After",
        description: "Some words",
        priority: "HIGH",
        statusId: statusId["In progress"],
        assigneeId: uid["member"],
        milestoneId: mil.id,
        dueDate: "2026-12-01",
        labelIds: [label.id],
      });
      expect(res.status).toBe(200);
      const rows = await activityRows({ issueId: i.id });
      expect(rows).toHaveLength(before + 1);
      const row = rows[rows.length - 1]!;
      expect(row).toMatchObject({
        firmId,
        action: "issue.updated",
        actorType: "USER",
        actorUserId: uid["sa"],
        channel: "web",
        sessionId: null,
      });
      expect(row.changes).toEqual([
        { field: "title", old: "Before", new: "After" },
        { field: "description", old: "(previous text)", new: "(new text)" },
        { field: "status", old: "New", new: "In progress" },
        { field: "priority", old: "NORMAL", new: "HIGH" },
        { field: "assignee", old: null, new: `${TAG} member` },
        { field: "milestone", old: null, new: "First release" },
        { field: "dueDate", old: null, new: "2026-12-01" },
        { field: "labels", old: null, new: `${TAG} urgent-ish` },
      ]);
      // the same values again change nothing, so nothing is logged
      await call("patch", "/ACT/issues/ACT-1", "sa", {
        title: "After",
        priority: "HIGH",
        dueDate: "2026-12-01",
      });
      expect(await activityRows({ issueId: i.id })).toHaveLength(before + 1);
      // clearing: old to null
      await call("patch", "/ACT/issues/ACT-1", "sa", { assigneeId: null, dueDate: null });
      const cleared = (await activityRows({ issueId: i.id })).pop()!;
      expect(cleared.changes).toEqual([
        { field: "assignee", old: `${TAG} member`, new: null },
        { field: "dueDate", old: "2026-12-01", new: null },
      ]);
    });

    it("a change that rolls back leaves no activity and no change, whichever step fails", async () => {
      await project({ key: "RLB" });
      const i = await issue("RLB", { title: "Stays as it is" });
      const activity = app.get(ProjectsActivity);
      const original = activity.log.bind(activity);
      const countAll = () => db.projectActivity.count({ where: { firmId } });
      const base = await countAll();

      // the activity row is written (inside the transaction) and then the change fails
      const spy = jest
        .spyOn(activity, "log")
        .mockImplementation(async (tx, actor, input) => {
          await original(tx, actor, input);
          throw new Error("boom after the activity row");
        });
      try {
        const upd = await call("patch", "/RLB/issues/RLB-1", "sa", {
          title: "Changed",
          priority: "URGENT",
        });
        expect(upd.status).toBe(500);
        const created = await call("post", "/RLB/issues/quick", "sa", {
          title: "Never made",
        });
        expect(created.status).toBe(500);
        const del = await call("delete", "/RLB/issues/RLB-1");
        expect(del.status).toBe(500);
        const proj = await call("post", "", "sa", { key: "RLB2", name: "Never made" });
        expect(proj.status).toBe(500);
      } finally {
        spy.mockRestore();
      }
      expect(await countAll()).toBe(base);
      const row = await db.issue.findUniqueOrThrow({ where: { id: i.id } });
      expect([row.title, row.priority, row.deleted]).toEqual([
        "Stays as it is",
        "NORMAL",
        false,
      ]);
      expect(await db.issue.count({ where: { project: { key: "RLB" } } })).toBe(1);
      // the counter rolled back with the failed create: the next number is 2, none was lost
      expect(
        (await db.project.findFirstOrThrow({ where: { firmId, key: "RLB" } }))
          .issueCounter,
      ).toBe(1);
      expect(await db.project.count({ where: { firmId, key: "RLB2" } })).toBe(0);
      expect(
        (await call("post", "/RLB/issues/quick", "sa", { title: "Now it works" })).body
          .key,
      ).toBe("RLB-2");
    });

    it("a project, a status update, a milestone and a comment are logged too", async () => {
      const p = await project({ key: "LOG", description: "x" });
      await call("patch", "/LOG", "sa", {
        name: "Renamed",
        repoUrl: "https://example.test/r",
      });
      await call("post", "/LOG/status-updates", "sa", {
        status: "ON_TRACK",
        note: "Fine",
      });
      await call("post", "/LOG/milestones", "sa", { name: "M1", dueDate: "2026-12-31" });
      await issue("LOG");
      await call("post", "/LOG/issues/LOG-1/comments", "sa", { body: "A comment" });
      await call("post", "/LOG/archive", "sa");
      await call("post", "/LOG/archive", "sa"); // already archived: nothing new
      await call("post", "/LOG/unarchive", "sa");
      const actions = (await activityRows({ projectId: p.id })).map((r) => r.action);
      expect(actions).toEqual([
        "project.created",
        "project.updated",
        "project.status",
        "milestone.created",
        "issue.created",
        "comment.added",
        "project.archived",
        "project.unarchived",
      ]);
    });
  });

  // ======================================================================================
  describe("T4 · who sees what", () => {
    it("a client-linked project is hidden from a user who cannot see that client, with its issues", async () => {
      const px = await project({ key: "CLK", clientId });
      expect(px.client).toEqual({
        id: clientId,
        businessName: `${TAG} Halimbawa Client`,
      });
      const ix = await issue("CLK", { title: "Engagement work" });
      const open = await project({ key: "OPN" });
      // not assigned to the client: the project is invisible in every way
      const reads: [Parameters<typeof call>[0], string, object?][] = [
        ["get", "/CLK"],
        ["get", "/CLK/issues"],
        ["get", `/CLK/issues/${ix.key}`],
        ["get", `/CLK/issues/${ix.key}/comments`],
        ["get", "/CLK/milestones"],
        ["get", "/CLK/activity"],
        ["get", "/CLK/status-updates"],
        ["get", `/issue-keys/${ix.key}`],
      ];
      const writes: [Parameters<typeof call>[0], string, object?][] = [
        ["patch", "/CLK", { name: "x" }],
        ["post", "/CLK/archive"],
        ["post", "/CLK/issues/quick", { title: "x" }],
        ["post", "/CLK/issues", { title: "x" }],
        ["patch", `/CLK/issues/${ix.key}`, { title: "x" }],
        ["delete", `/CLK/issues/${ix.key}`],
        ["post", `/CLK/issues/${ix.key}/comments`, { body: "x" }],
        ["post", "/CLK/milestones", { name: "x" }],
        ["post", "/CLK/status-updates", { status: "ON_TRACK" }],
      ];
      for (const who of ["viewer", "member"]) {
        const list = (await call("get", "", who)).body.map((p: Json) => p.key);
        expect(list).toContain("OPN");
        expect(list).not.toContain("CLK");
        for (const [method, path, body] of who === "viewer"
          ? reads
          : [...reads, ...writes]) {
          const res = await call(method, path, who, body);
          expect([who, method, path, res.status]).toEqual([who, method, path, 404]);
        }
        expect((await call("get", "/OPN", who)).status).toBe(200); // a project with no client is open to all
      }
      expect((await call("get", "/CLK/issues", "sa")).body.total).toBe(1);
      // assigned to the client: sees it; the Update/Create permission decides the rest
      expect(
        (await call("get", "", "viewerAssigned")).body.map((p: Json) => p.key),
      ).toContain("CLK");
      expect((await call("get", "/CLK/issues", "viewerAssigned")).body.total).toBe(1);
      expect(
        (await call("post", "/CLK/issues/quick", "viewerAssigned", { title: "x" }))
          .status,
      ).toBe(403);
      const made = await call("post", "/CLK/issues/quick", "memberAssigned", {
        title: "From the assigned member",
      });
      expect([made.status, made.body.key]).toEqual([201, "CLK-2"]);
      // Super Admin holds Clients:ViewAll, so sees every client's project
      expect((await call("get", "/CLK", "sa")).status).toBe(200);
      void open;
    });

    it("linking a project to a client needs a client of this firm that the user can see", async () => {
      // a member who is not assigned to the client cannot link it, and the other firm's client does not exist
      const noSee = await call("post", "", "member", {
        key: "LNK",
        name: "Link",
        clientId,
      });
      expect([noSee.status, noSee.body.message]).toEqual([404, "Client not found."]);
      const foreign = await call("post", "", "sa", {
        key: "LNK",
        name: "Link",
        clientId: otherClientId,
      });
      expect([foreign.status, foreign.body.message]).toEqual([404, "Client not found."]);
      const ok = await call("post", "", "memberAssigned", {
        key: "LNK",
        name: "Link",
        clientId,
      });
      expect(ok.status).toBe(201);
      // unlinking and relinking is a change, logged with the client's name
      const un = await call("patch", "/LNK", "memberAssigned", { clientId: null });
      expect(un.body.client).toBeNull();
      const rows = await activityRows({ projectId: ok.body.id });
      expect(rows.pop()!.changes).toEqual([
        { field: "client", old: `${TAG} Halimbawa Client`, new: null },
      ]);
      // now it has no client, so everyone with Projects:Read sees it
      expect((await call("get", "/LNK", "viewer")).status).toBe(200);
    });

    it("client users never see Projects, and a firm user with no Projects permission is refused", async () => {
      for (const who of ["clientUser", "norole"]) {
        for (const [method, path] of [
          ["get", ""],
          ["get", "/meta"],
          ["get", "/CLK"],
          ["post", ""],
        ] as [Parameters<typeof call>[0], string][]) {
          const res = await call(
            method,
            path,
            who,
            method === "post" ? { key: "ZZ", name: "x" } : undefined,
          );
          expect([who, path, res.status]).toEqual([who, path, 403]);
        }
      }
      expect((await call("get", "", "clientUser")).body.message).toBe(
        missing("Projects:Read"),
      );
    });

    it("permissions: a Viewer cannot write, a Member cannot configure, an Owner can do both", async () => {
      await project({ key: "PRM" });
      await issue("PRM");
      const writes: [Parameters<typeof call>[0], string, object | undefined, string][] = [
        ["post", "", { key: "PRM9", name: "x" }, "Projects:Create"],
        ["patch", "/PRM", { name: "x" }, "Projects:Update"],
        ["post", "/PRM/archive", undefined, "Projects:Update"],
        ["post", "/PRM/status-updates", { status: "ON_TRACK" }, "Projects:Update"],
        ["post", "/PRM/issues", { title: "x" }, "Projects:Create"],
        ["post", "/PRM/issues/quick", { title: "x" }, "Projects:Create"],
        ["patch", "/PRM/issues/PRM-1", { title: "x" }, "Projects:Update"],
        ["post", "/PRM/issues/PRM-1/reorder", { position: 1 }, "Projects:Update"],
        ["delete", "/PRM/issues/PRM-1", undefined, "Projects:Update"],
        ["post", "/PRM/issues/PRM-1/comments", { body: "x" }, "Projects:Update"],
        ["post", "/PRM/milestones", { name: "x" }, "Projects:Update"],
      ];
      for (const [method, path, body, need] of writes) {
        const res = await call(method, path, "viewer", body);
        expect([method, path, res.status, res.body.message]).toEqual([
          method,
          path,
          403,
          missing(need),
        ]);
      }
      // the viewer reads everything
      for (const path of [
        "",
        "/meta",
        "/PRM",
        "/PRM/issues",
        "/PRM/issues/PRM-1",
        "/PRM/activity",
        "/PRM/milestones",
      ]) {
        expect([path, (await call("get", path, "viewer")).status]).toEqual([path, 200]);
      }
      // the member writes, but configures nothing
      expect(
        (await call("post", "/PRM/issues/quick", "member", { title: "Member's" })).status,
      ).toBe(201);
      for (const [method, path, body] of [
        ["get", "/admin/issue-types"],
        ["post", "/admin/issue-types", { name: "Idea" }],
        ["get", "/admin/issue-statuses"],
        ["post", "/admin/labels", { name: "x" }],
        ["patch", `/admin/issue-statuses/${statusId["New"]}`, { colour: "#112233" }],
        ["delete", `/admin/labels/${randomUUID()}`],
      ] as [Parameters<typeof call>[0], string, object?][]) {
        const res = await call(method, path, "member", body);
        expect([method, path, res.status, res.body.message]).toEqual([
          method,
          path,
          403,
          missing("Projects:Configure"),
        ]);
      }
      // the owner does both
      expect(
        (await call("post", "/PRM/issues/quick", "owner", { title: "Owner's" })).status,
      ).toBe(201);
      expect((await call("get", "/admin/issue-types", "owner")).status).toBe(200);
    });

    it("another firm's project is a 404 whatever is asked, and lists show only the firm's own", async () => {
      await project({ key: "TEN" });
      const i = await issue("TEN");
      for (const [method, path, body] of [
        ["get", "/TEN"],
        ["patch", "/TEN", { name: "x" }],
        ["post", "/TEN/archive"],
        ["get", "/TEN/issues"],
        ["get", `/TEN/issues/${i.key}`],
        ["patch", `/TEN/issues/${i.key}`, { title: "x" }],
        ["delete", `/TEN/issues/${i.key}`],
        ["post", `/TEN/issues/${i.key}/comments`, { body: "x" }],
        ["get", "/TEN/milestones"],
        ["post", "/TEN/milestones", { name: "x" }],
        ["get", "/TEN/activity"],
        ["post", "/TEN/status-updates", { status: "ON_TRACK" }],
        ["get", `/issue-keys/${i.key}`],
      ] as [Parameters<typeof call>[0], string, object?][]) {
        const res = await call(method, path, "sa2", body);
        expect([method, path, res.status]).toEqual([method, path, 404]);
      }
      expect((await call("get", "", "sa2")).body).toEqual([]);
      // the same key may be used by another firm, and its numbers are its own
      const theirs = await call("post", "", "sa2", { key: "TEN", name: "Their TEN" });
      expect(theirs.status).toBe(201);
      expect(
        (await call("post", "/TEN/issues/quick", "sa2", { title: "Theirs" })).body.key,
      ).toBe("TEN-1");
      expect((await call("get", "/TEN", "sa")).body.project.name).toBe("Project TEN");
      // their meta is their own firm's lists
      const theirIds = (await call("get", "/meta", "sa2")).body.issueStatuses.map(
        (s: Json) => s.id,
      );
      expect(theirIds.some((id: string) => Object.values(statusId).includes(id))).toBe(
        false,
      );
      // an issue type of the other firm cannot be used here
      const x = await call("post", "/TEN/issues", "sa", {
        title: "x",
        typeId: (await call("get", "/meta", "sa2")).body.issueTypes[0].id,
      });
      expect([x.status, x.body.message]).toEqual([404, "Issue type not found."]);
    });
  });

  // ======================================================================================
  describe("T5 · portfolio, overview, lists", () => {
    it("the portfolio: status, progress, counts, next milestone, last activity; archived only when asked", async () => {
      await project({ key: "PFO", clientId });
      const mk = (title: string, extra: Json = {}) => issue("PFO", { title, ...extra });
      await mk("todo 1");
      await mk("todo 2");
      await mk("wip 1", { statusId: statusId["In progress"] });
      await mk("wip 2", { statusId: statusId["Blocked"] });
      await mk("done 1", { statusId: statusId["Done"] });
      await mk("open bug", { typeId: typeId["Bug"] });
      await mk("wip bug", { typeId: typeId["Bug"], statusId: statusId["In review"] });
      await mk("done bug", { typeId: typeId["Bug"], statusId: statusId["Won't do"] });
      await mk("late", { dueDate: "2020-01-01" });
      await mk("late but done", { dueDate: "2020-01-01", statusId: statusId["Done"] });
      const m1 = (
        await call("post", "/PFO/milestones", "sa", {
          name: "Later",
          dueDate: "2999-12-31",
        })
      ).body;
      const m2 = (
        await call("post", "/PFO/milestones", "sa", {
          name: "Sooner",
          dueDate: "2999-06-30",
        })
      ).body;
      await call("post", "/PFO/milestones", "sa", {
        name: "Closed one",
        dueDate: "2999-01-01",
      }).then((r) =>
        call("patch", `/PFO/milestones/${r.body.id}`, "sa", { state: "CLOSED" }),
      );
      await call("patch", "/PFO/issues/PFO-1", "sa", { milestoneId: m2.id });
      await call("patch", "/PFO/issues/PFO-5", "sa", { milestoneId: m2.id });
      await call("patch", "/PFO/issues/PFO-2", "sa", { milestoneId: m1.id });
      expect(
        (await call("get", "", "sa")).body.find((p: Json) => p.key === "PFO").status,
      ).toBe("NOT_STARTED");
      await call("post", "/PFO/status-updates", "sa", {
        status: "AT_RISK",
        note: "Behind",
      });
      await call("post", "/PFO/status-updates", "sa", {
        status: "ON_TRACK",
        note: "Back on",
      });

      const row = (await call("get", "", "sa")).body.find((p: Json) => p.key === "PFO");
      expect(row).toMatchObject({
        key: "PFO",
        archived: false,
        client: { id: clientId },
        status: "ON_TRACK",
        statusNote: "Back on",
        progress: { done: 3, total: 10, percent: 30 },
        counts: { todo: 4, inProgress: 3, done: 3, overdue: 1, openBugs: 2 },
      });
      // by hand: to do = todo 1, todo 2, open bug, late; in progress = wip 1, wip 2, wip bug; done = done 1, done bug, late but done
      expect(row.counts.todo + row.counts.inProgress + row.counts.done).toBe(10);
      expect(row.nextMilestone).toMatchObject({
        name: "Sooner",
        dueDate: "2999-06-30",
        progress: { done: 1, total: 2, percent: 50 },
      });
      expect(row.lastActivityAt).not.toBeNull();
      expect(Object.keys(row).sort()).toEqual(
        [
          "archived",
          "client",
          "counts",
          "createdAt",
          "deployAppName",
          "description",
          "id",
          "key",
          "lastActivityAt",
          "liveUrl",
          "name",
          "nextMilestone",
          "parent",
          "progress",
          "repoUrl",
          "security",
          "status",
          "statusNote",
          "statusUpdatedAt",
          "updatedAt",
        ].sort(),
      );
      // archive: gone from the portfolio, back when asked
      expect((await call("post", "/PFO/archive", "sa")).body.archived).toBe(true);
      expect((await call("get", "", "sa")).body.map((p: Json) => p.key)).not.toContain(
        "PFO",
      );
      expect(
        (await call("get", "?includeArchived=true", "sa")).body.map((p: Json) => p.key),
      ).toContain("PFO");
      expect((await call("post", "/PFO/unarchive", "sa")).body.archived).toBe(false);
    });

    it("the overview: status history newest first, open milestones, issues in progress, counts by status and type, recent activity", async () => {
      await project({ key: "OVW" });
      await issue("OVW", { title: "wip", statusId: statusId["In progress"] });
      await issue("OVW", { title: "bug", typeId: typeId["Bug"] });
      await call("post", "/OVW/status-updates", "sa", {
        status: "ON_HOLD",
        note: "first",
      });
      await call("post", "/OVW/status-updates", "sa", {
        status: "FINISHED",
        note: "second",
      });
      await call("post", "/OVW/milestones", "sa", {
        name: "Open M",
        dueDate: "2999-01-01",
      });
      const o = (await call("get", "/OVW", "sa")).body;
      expect(Object.keys(o).sort()).toEqual(
        [
          "countsByStatus",
          "countsByType",
          "counts",
          "inProgress",
          "lastActivityAt",
          "openMilestones",
          "progress",
          "project",
          "recentActivity",
          "security",
          "status",
          "statusUpdates",
        ].sort(),
      );
      expect(o.project.key).toBe("OVW");
      expect(o.status).toMatchObject({ value: "FINISHED", note: "second" });
      expect(o.statusUpdates.map((u: Json) => u.status)).toEqual(["FINISHED", "ON_HOLD"]);
      expect(o.statusUpdates[0].actor.fullName).toBe(`${TAG} sa`);
      expect(o.openMilestones.map((m: Json) => m.name)).toEqual(["Open M"]);
      expect(o.inProgress.map((i: Json) => i.title)).toEqual(["wip"]);
      expect(
        o.countsByStatus.find((c: Json) => c.status.name === "In progress").count,
      ).toBe(1);
      expect(o.countsByStatus.find((c: Json) => c.status.name === "New").count).toBe(1);
      expect(o.countsByType.find((c: Json) => c.type.name === "Bug").count).toBe(1);
      expect(o.countsByType.find((c: Json) => c.type.name === "Epic").count).toBe(0);
      expect(o.recentActivity.length).toBeGreaterThan(3);
      expect(o.recentActivity[0].action).toBe("milestone.created"); // newest first
    });

    describe("filters, sorts and views", () => {
      const ids: Record<string, string> = {};
      let label = "";
      let ms = "";
      beforeAll(async () => {
        await project({ key: "FLT" });
        label = (await call("post", "/admin/labels", "sa", { name: `${TAG} flt` })).body
          .id;
        ms = (await call("post", "/FLT/milestones", "sa", { name: "FLT M" })).body.id;
        const mk = async (name: string, b: Json) => {
          const r = await issue("FLT", { title: name, ...b });
          ids[name] = r.key;
        };
        await mk("alpha", {
          priority: "LOW",
          dueDate: "2026-03-01",
          assigneeId: uid["member"],
        });
        await mk("bravo", {
          priority: "URGENT",
          typeId: typeId["Bug"],
          dueDate: "2026-01-01",
          labelIds: [label],
        });
        await mk("charlie", {
          priority: "HIGH",
          milestoneId: ms,
          statusId: statusId["In progress"],
          assigneeId: uid["sa"],
        });
        await mk("delta", {
          priority: "NORMAL",
          statusId: statusId["Done"],
          typeId: typeId["Bug"],
          assigneeId: uid["sa"],
        });
        await mk("echo needle", { priority: "NORMAL", description: "hay needle stack" });
      });
      const keys = async (qs: string, who = "sa") =>
        (await call("get", `/FLT/issues${qs}`, who)).body.items.map((i: Json) => i.title);

      it("filters: text, state, status, type, assignee (user, none, me), milestone (id, none), label, priority", async () => {
        expect((await keys("?q=needle")).sort()).toEqual(["echo needle"]);
        expect(await keys(`?q=${ids["alpha"]}`)).toEqual(["alpha"]); // the key is searched too
        expect((await keys("?q=NEEDLE")).length).toBe(1); // case does not matter
        expect((await keys("?state=open")).sort()).toEqual([
          "alpha",
          "bravo",
          "charlie",
          "echo needle",
        ]);
        expect(await keys("?state=closed")).toEqual(["delta"]);
        expect((await keys("?state=all")).length).toBe(5);
        expect(await keys(`?statusId=${statusId["In progress"]}`)).toEqual(["charlie"]);
        expect((await keys(`?typeId=${typeId["Bug"]}`)).sort()).toEqual([
          "bravo",
          "delta",
        ]);
        expect(await keys(`?assigneeId=${uid["member"]}`)).toEqual(["alpha"]);
        expect((await keys("?assigneeId=none")).sort()).toEqual(["bravo", "echo needle"]);
        expect((await keys("?assigneeId=me", "sa")).sort()).toEqual(["charlie", "delta"]);
        expect(await keys(`?milestoneId=${ms}`)).toEqual(["charlie"]);
        expect((await keys("?milestoneId=none")).length).toBe(4);
        expect(await keys(`?labelId=${label}`)).toEqual(["bravo"]);
        expect(await keys("?priority=URGENT")).toEqual(["bravo"]);
        expect(await keys(`?typeId=${typeId["Bug"]}&state=open`)).toEqual(["bravo"]); // filters combine
        const bad = await call("get", "/FLT/issues?priority=SOON", "sa");
        expect(bad.status).toBe(400);
      });

      it("sorts: recently updated, priority (urgent first), due date (none last), newest, key", async () => {
        await call("patch", `/FLT/issues/${ids["alpha"]}`, "sa", { title: "alpha" }); // no change: not touched
        await call("post", `/FLT/issues/${ids["alpha"]}/comments`, "sa", {
          body: "touch",
        }); // touched now
        expect((await keys("?sort=updated"))[0]).toBe("alpha");
        // urgent, high, then the two normal ones (the newer first), then low
        expect(await keys("?sort=priority")).toEqual([
          "bravo",
          "charlie",
          "echo needle",
          "delta",
          "alpha",
        ]);
        expect((await keys("?sort=priority")).slice(0, 2)).toEqual(["bravo", "charlie"]);
        expect((await keys("?sort=priority")).slice(-1)).toEqual(["alpha"]);
        expect(await keys("?sort=due")).toEqual([
          "bravo",
          "alpha",
          "charlie",
          "delta",
          "echo needle",
        ]);
        expect(await keys("?sort=created")).toEqual([
          "echo needle",
          "delta",
          "charlie",
          "bravo",
          "alpha",
        ]);
        expect(await keys("?sort=key")).toEqual([
          "alpha",
          "bravo",
          "charlie",
          "delta",
          "echo needle",
        ]);
      });

      it("built-in views: open, assigned to me, open bugs, overdue, closed, all", async () => {
        const spy = jest
          .spyOn(Date, "now")
          .mockReturnValue(Date.parse("2026-06-01T00:00:00.000Z"));
        try {
          const svc = app.get(IssuesService);
          const as = (who: string) => webActor(authUser(who));
          const v = async (
            view: "open" | "mine" | "bugs" | "overdue" | "closed" | "all",
            who = "sa",
          ) =>
            (await svc.list(as(who), "FLT", { view, limit: 100, offset: 0 })).items
              .map((i) => i.title)
              .sort();
          expect(await v("open")).toEqual(["alpha", "bravo", "charlie", "echo needle"]);
          expect(await v("mine", "sa")).toEqual(["charlie"]); // delta is mine too but closed
          expect(await v("mine", "member")).toEqual(["alpha"]);
          expect(await v("bugs")).toEqual(["bravo"]);
          expect(await v("overdue")).toEqual(["alpha", "bravo"]); // due in January and March
          expect(await v("closed")).toEqual(["delta"]);
          expect(await v("all")).toEqual([
            "alpha",
            "bravo",
            "charlie",
            "delta",
            "echo needle",
          ]);
        } finally {
          spy.mockRestore();
        }
      });

      it("a list is paged (limit, offset) and says its total; items carry what a row needs", async () => {
        const page = (await call("get", "/FLT/issues?sort=key&limit=2&offset=1", "sa"))
          .body;
        expect([
          page.total,
          page.limit,
          page.offset,
          page.items.map((i: Json) => i.title),
        ]).toEqual([5, 2, 1, ["bravo", "charlie"]]);
        const item = page.items[1];
        expect(Object.keys(item).sort()).toEqual(
          [
            "assignee",
            "closedAt",
            "createdAt",
            "dueDate",
            "id",
            "key",
            "labels",
            "milestone",
            "number",
            "overdue",
            "parentKey",
            "position",
            "priority",
            "project",
            "startDate",
            "status",
            "title",
            "type",
            "updatedAt",
          ].sort(),
        );
        expect(item.status).toEqual({
          id: statusId["In progress"],
          name: "In progress",
          colour: "#bf8700",
          category: "IN_PROGRESS",
        });
        expect(item.milestone).toEqual({ id: ms, name: "FLT M" });
        expect(item.assignee).toEqual({ id: uid["sa"], fullName: `${TAG} sa` });
      });
    });

    it("quick create gives the defaults; a full create can set everything; the author is the creator", async () => {
      await project({ key: "QCK" });
      const q = await call("post", "/QCK/issues/quick", "member", {
        title: "  Just a title  ",
      });
      expect(q.status).toBe(201);
      expect(q.body).toMatchObject({
        key: "QCK-1",
        title: "Just a title",
        priority: "NORMAL",
        type: { name: "Task" },
        status: { name: "New", category: "TODO" },
        assignee: null,
        milestone: null,
        closedAt: null,
        description: "",
        author: { id: uid["member"] },
        children: [],
        commentCount: 0,
      });
      const extra = await call("post", "/QCK/issues/quick", "member", {
        title: "x",
        priority: "HIGH",
      });
      expect(extra.status).toBe(400); // quick create takes the title only
      const blank = await call("post", "/QCK/issues/quick", "member", { title: "" });
      expect(blank.status).toBe(400);
      const blank2 = await call("post", "/QCK/issues", "member", { title: "   " });
      expect([blank2.status, blank2.body.message]).toEqual([
        400,
        "The title is required.",
      ]);
      const full = await call("post", "/QCK/issues", "member", {
        title: "Full",
        description: "# Heading",
        typeId: typeId["Feature"],
        priority: "URGENT",
        assigneeId: uid["owner"],
        parentKey: "QCK-1",
        startDate: "2026-01-01",
        dueDate: "2026-02-01",
      });
      expect(full.body).toMatchObject({
        key: "QCK-2",
        type: { name: "Feature" },
        priority: "URGENT",
        assignee: { id: uid["owner"] },
        parent: { key: "QCK-1", title: "Just a title" },
        startDate: "2026-01-01",
        dueDate: "2026-02-01",
      });
      // the assignee must be an active member of this firm
      const outsider = await call("post", "/QCK/issues", "member", {
        title: "x",
        assigneeId: uid["sa2"],
      });
      expect([outsider.status, outsider.body.message]).toEqual([
        400,
        "The assignee must be an active member of the firm.",
      ]);
      const clientAssignee = await call("post", "/QCK/issues", "member", {
        title: "x",
        assigneeId: uid["clientUser"],
      });
      expect(clientAssignee.status).toBe(400);
      // a parent must be an issue of the same project, never itself or a descendant
      await project({ key: "QCK2" });
      const other = await issue("QCK2");
      const wrongParent = await call("post", "/QCK/issues", "member", {
        title: "x",
        parentKey: other.key,
      });
      expect([wrongParent.status, wrongParent.body.message]).toEqual([
        404,
        "The parent issue must be an issue of the same project.",
      ]);
      const self = await call("patch", "/QCK/issues/QCK-1", "member", {
        parentKey: "QCK-1",
      });
      expect([self.status, self.body.message]).toEqual([
        400,
        "An issue cannot be its own parent.",
      ]);
      const loop = await call("patch", "/QCK/issues/QCK-1", "member", {
        parentKey: "QCK-2",
      });
      expect([loop.status, loop.body.message]).toEqual([
        400,
        "That parent would make the issue its own ancestor.",
      ]);
    });

    it("reorder sets the position within a status (and can move the status); the board order follows position", async () => {
      await project({ key: "RDR" });
      for (const t of ["one", "two", "three"]) await issue("RDR", { title: t });
      const order = async () =>
        (await call("get", "/RDR/issues?sort=updated", "sa")).body.items
          .map((i: Json) => [i.title, i.position] as const)
          .sort(
            (a: readonly [string, number], b: readonly [string, number]) => a[1] - b[1],
          )
          .map((x: readonly [string, number]) => x[0]);
      expect(await order()).toEqual(["one", "two", "three"]);
      const r = await call("post", "/RDR/issues/RDR-3/reorder", "sa", { position: 0.5 });
      expect([r.status, r.body.position]).toEqual([200, 0.5]);
      expect(await order()).toEqual(["three", "one", "two"]);
      const moved = await call("post", "/RDR/issues/RDR-1/reorder", "sa", {
        position: 10,
        statusId: statusId["In progress"],
      });
      expect(moved.body.status.name).toBe("In progress");
      // a position alone is not an event worth a line in the activity
      const before = (
        await activityRows({
          projectId: moved.body.project
            ? (await db.project.findFirstOrThrow({ where: { firmId, key: "RDR" } })).id
            : "",
        })
      ).length;
      await call("post", "/RDR/issues/RDR-2/reorder", "sa", { position: 99 });
      expect(
        (
          await activityRows({
            projectId: (
              await db.project.findFirstOrThrow({ where: { firmId, key: "RDR" } })
            ).id,
          })
        ).length,
      ).toBe(before);
    });
  });

  // ======================================================================================
  describe("T6 · admin lists, milestones, comments, status updates, activity", () => {
    it("issue types and labels: create, update, refuse a used name, refuse deleting a type in use", async () => {
      const t = await call("post", "/admin/issue-types", "owner", {
        name: `${TAG} Idea`,
        colour: "#112233",
      });
      expect([t.status, t.body.colour]).toEqual([201, "#112233"]);
      const dup = await call("post", "/admin/issue-types", "owner", {
        name: `${TAG} Idea`,
      });
      expect([dup.status, dup.body.message]).toEqual([409, "That name is already used."]);
      expect(
        (
          await call("patch", `/admin/issue-types/${t.body.id}`, "owner", {
            name: `${TAG} Idea 2`,
            order: 9,
          })
        ).body,
      ).toMatchObject({ name: `${TAG} Idea 2`, order: 9 });
      expect(
        (await call("post", "/admin/issue-types", "owner", { name: "x", colour: "red" }))
          .status,
      ).toBe(400);
      await project({ key: "ADM" });
      await issue("ADM", { title: "Uses Bug", typeId: typeId["Bug"] });
      await issue("ADM", { title: "Uses Bug too", typeId: typeId["Bug"] });
      const inUse = await call("delete", `/admin/issue-types/${typeId["Bug"]}`, "owner");
      expect([inUse.status, inUse.body.message]).toEqual([
        409,
        `This issue type is used by ${await db.issue.count({ where: { typeId: typeId["Bug"] } })} issues. Change the type of them first.`,
      ]);
      const free = await call("delete", `/admin/issue-types/${t.body.id}`, "owner");
      expect([free.status, free.body]).toEqual([200, { deleted: true, id: t.body.id }]);
      expect(
        (await call("delete", `/admin/issue-types/${t.body.id}`, "owner")).status,
      ).toBe(404);
      const list = (await call("get", "/admin/issue-types", "owner")).body;
      expect(list.find((x: Json) => x.name === "Bug").issueCount).toBeGreaterThanOrEqual(
        2,
      );
    });

    it("issue statuses: the default is one and to do; a used status cannot be deleted; a category move sets closedAt", async () => {
      const mk = await call("post", "/admin/issue-statuses", "owner", {
        name: `${TAG} Parked`,
        category: "TODO",
        colour: "#abcdef",
      });
      expect([mk.status, mk.body.category, mk.body.isDefault]).toEqual([
        201,
        "TODO",
        false,
      ]);
      const wrong = await call("post", "/admin/issue-statuses", "owner", {
        name: `${TAG} Bad default`,
        category: "DONE",
        isDefault: true,
      });
      expect([wrong.status, wrong.body.message]).toEqual([
        400,
        "The default status must be a to do status.",
      ]);
      // making another status the default clears the old one (one default per firm)
      const nd = await call("patch", `/admin/issue-statuses/${mk.body.id}`, "owner", {
        isDefault: true,
      });
      expect(nd.body.isDefault).toBe(true);
      const list = (await call("get", "/admin/issue-statuses", "owner")).body;
      expect(list.filter((s: Json) => s.isDefault).map((s: Json) => s.name)).toEqual([
        `${TAG} Parked`,
      ]);
      const unset = await call("patch", `/admin/issue-statuses/${mk.body.id}`, "owner", {
        isDefault: false,
      });
      expect([unset.status, unset.body.message]).toEqual([
        400,
        "A firm needs one default status. Make another status the default instead.",
      ]);
      const delDefault = await call(
        "delete",
        `/admin/issue-statuses/${mk.body.id}`,
        "owner",
      );
      expect([delDefault.status, delDefault.body.message]).toEqual([
        409,
        "The default status cannot be deleted. Make another status the default first.",
      ]);
      // put New back as the default; a new issue gets it
      await call("patch", `/admin/issue-statuses/${statusId["New"]}`, "owner", {
        isDefault: true,
      });
      await project({ key: "STS" });
      expect((await issue("STS")).status.name).toBe("New");
      // a status in use
      await issue("STS", { title: "In blocked", statusId: statusId["Blocked"] });
      const inUse = await call(
        "delete",
        `/admin/issue-statuses/${statusId["Blocked"]}`,
        "owner",
      );
      expect([inUse.status, inUse.body.message]).toEqual([
        409,
        `This status is used by ${await db.issue.count({ where: { statusId: statusId["Blocked"] } })} issues. Move them to another status first.`,
      ]);
      // an unused one goes
      expect(
        (await call("delete", `/admin/issue-statuses/${mk.body.id}`, "owner")).status,
      ).toBe(200);
      // a category move across DONE closes or reopens its issues, each logged
      const ip = await call("patch", "/STS/issues/STS-2", "sa", {
        statusId: statusId["In review"],
      });
      expect(ip.body.closedAt).toBeNull();
      await call("patch", `/admin/issue-statuses/${statusId["In review"]}`, "owner", {
        category: "DONE",
      });
      const closed = (await call("get", "/STS/issues/STS-2", "sa")).body;
      expect([closed.status.category, closed.closedAt === null]).toEqual(["DONE", false]);
      const row = (await activityRows({ issueId: closed.id })).pop()!;
      expect(row.changes).toEqual([
        { field: "statusCategory", old: "IN_PROGRESS", new: "DONE" },
      ]);
      await call("patch", `/admin/issue-statuses/${statusId["In review"]}`, "owner", {
        category: "IN_PROGRESS",
      });
      expect((await call("get", "/STS/issues/STS-2", "sa")).body.closedAt).toBeNull();
    });

    it("labels: a deleted label comes off its issues, each logged; a renamed label is logged on them", async () => {
      await project({ key: "LBL" });
      const l = (await call("post", "/admin/labels", "owner", { name: `${TAG} lbl` }))
        .body;
      expect(
        (await call("post", "/admin/labels", "owner", { name: `${TAG} lbl` })).status,
      ).toBe(409);
      const a = await issue("LBL", { title: "a", labelIds: [l.id] });
      await issue("LBL", { title: "b", labelIds: [l.id] });
      expect(a.labels.map((x: Json) => x.name)).toEqual([`${TAG} lbl`]);
      await call("patch", `/admin/labels/${l.id}`, "owner", {
        name: `${TAG} lbl renamed`,
        colour: "#00ff00",
      });
      expect((await activityRows({ issueId: a.id })).pop()!.changes).toEqual([
        { field: "label", old: `${TAG} lbl`, new: `${TAG} lbl renamed` },
      ]);
      expect((await call("delete", `/admin/labels/${l.id}`, "owner")).status).toBe(200);
      expect((await call("get", "/LBL/issues/LBL-1", "sa")).body.labels).toEqual([]);
      expect((await activityRows({ issueId: a.id })).pop()!.changes).toEqual([
        { field: "label", old: `${TAG} lbl renamed`, new: null },
      ]);
      const bad = await call("post", "/LBL/issues", "sa", {
        title: "x",
        labelIds: [randomUUID()],
      });
      expect([bad.status, bad.body.message]).toEqual([404, "Label not found."]);
    });

    it("milestones: progress done over total, state changes, only this project's", async () => {
      await project({ key: "MIL" });
      await project({ key: "MIL2" });
      const m = (
        await call("post", "/MIL/milestones", "member", {
          name: "v1",
          dueDate: "2026-12-31",
          startDate: "2026-12-01",
        })
      ).body;
      expect(m).toMatchObject({
        name: "v1",
        state: "OPEN",
        dueDate: "2026-12-31",
        progress: { done: 0, total: 0, percent: 0 },
      });
      await issue("MIL", { title: "a", milestoneId: m.id });
      await issue("MIL", { title: "b", milestoneId: m.id, statusId: statusId["Done"] });
      await issue("MIL", {
        title: "c",
        milestoneId: m.id,
        statusId: statusId["Won't do"],
      });
      const del = await issue("MIL", { title: "deleted", milestoneId: m.id });
      await call("delete", `/MIL/issues/${del.key}`);
      const list = (await call("get", "/MIL/milestones", "viewer")).body;
      expect(list[0].progress).toEqual({ done: 2, total: 3, percent: 67 });
      const locked = await call("patch", `/MIL/milestones/${m.id}`, "member", {
        state: "LOCKED",
      });
      expect(locked.body.state).toBe("LOCKED");
      await call("patch", `/MIL/milestones/${m.id}`, "member", {
        state: "CLOSED",
        dueDate: "2026-12-30",
      });
      expect((await call("get", "/MIL/milestones", "viewer")).body[0]).toMatchObject({
        state: "CLOSED",
        dueDate: "2026-12-30",
      });
      expect(
        (
          await activityRows({
            projectId: (
              await db.project.findFirstOrThrow({ where: { firmId, key: "MIL" } })
            ).id,
            action: "milestone.updated",
          })
        ).pop()!.changes,
      ).toEqual([
        { field: "dueDate", old: "2026-12-31", new: "2026-12-30" },
        { field: "state", old: "LOCKED", new: "CLOSED" },
      ]);
      // a milestone of another project cannot be used, and its id cannot be reached through another project
      const other = (await call("post", "/MIL2/milestones", "sa", { name: "other" }))
        .body;
      const wrong = await call("patch", "/MIL/issues/MIL-1", "sa", {
        milestoneId: other.id,
      });
      expect([wrong.status, wrong.body.message]).toEqual([404, "Milestone not found."]);
      expect(
        (await call("patch", `/MIL/milestones/${other.id}`, "sa", { state: "CLOSED" }))
          .status,
      ).toBe(404);
      expect(
        (await call("patch", "/MIL/milestones/not-an-id", "sa", { state: "CLOSED" }))
          .status,
      ).toBe(404);
    });

    it("comments: added in order, empty refused, the issue's updated time moves", async () => {
      await project({ key: "CMT" });
      const i = await issue("CMT");
      const c1 = await call("post", "/CMT/issues/CMT-1/comments", "member", {
        body: "  First  ",
      });
      expect([c1.status, c1.body.body, c1.body.author.id]).toEqual([
        201,
        "First",
        uid["member"],
      ]);
      await call("post", "/CMT/issues/CMT-1/comments", "sa", { body: "Second" });
      expect(
        (await call("get", "/CMT/issues/CMT-1/comments", "viewer")).body.map(
          (c: Json) => c.body,
        ),
      ).toEqual(["First", "Second"]);
      const empty = await call("post", "/CMT/issues/CMT-1/comments", "member", {
        body: "   ",
      });
      expect([empty.status, empty.body.message]).toEqual([400, "The comment is empty."]);
      const after = (await call("get", "/CMT/issues/CMT-1", "sa")).body;
      expect(after.commentCount).toBe(2);
      expect(new Date(after.updatedAt).getTime()).toBeGreaterThanOrEqual(
        new Date(i.updatedAt).getTime(),
      );
      expect((await call("get", "/CMT/issues/CMT-99/comments", "sa")).status).toBe(404);
    });

    it("status updates: newest first, the latest is the current status, an unknown status is refused", async () => {
      await project({ key: "STU" });
      expect((await call("get", "/STU/status-updates", "viewer")).body).toEqual([]);
      await call("post", "/STU/status-updates", "member", {
        status: "ON_TRACK",
        note: "Going well",
      });
      const second = await call("post", "/STU/status-updates", "member", {
        status: "AT_RISK",
      });
      expect([
        second.status,
        second.body.status,
        second.body.note,
        second.body.actor.id,
      ]).toEqual([201, "AT_RISK", "", uid["member"]]);
      expect(
        (await call("get", "/STU/status-updates", "viewer")).body.map(
          (u: Json) => u.status,
        ),
      ).toEqual(["AT_RISK", "ON_TRACK"]);
      expect((await call("get", "/STU", "viewer")).body.status.value).toBe("AT_RISK");
      expect(
        (await call("post", "/STU/status-updates", "member", { status: "WONDERFUL" }))
          .status,
      ).toBe(400);
      const change = (
        await activityRows({
          projectId: (
            await db.project.findFirstOrThrow({ where: { firmId, key: "STU" } })
          ).id,
          action: "project.status",
        })
      ).pop()!;
      expect(change.changes).toEqual([
        { field: "status", old: "ON_TRACK", new: "AT_RISK" },
      ]);
    });

    it("activity: newest first, paged, filtered by actor type; the lookup by key turns a key into a link", async () => {
      const p = await project({ key: "ACV" });
      await issue("ACV", { title: "One" });
      await issue("ACV", { title: "Two" });
      // Distinct, explicit times: rows made one after another can share a millisecond, and then
      // "newest first" would fall to the order of their random ids.
      const later = Date.now() + 60_000;
      for (const [i, actorType] of ["CLAUDE", "GITHUB", "SYSTEM"].entries()) {
        await db.projectActivity.create({
          data: {
            firmId,
            projectId: p.id,
            actorType,
            createdAt: new Date(later + i * 1000),
            channel:
              actorType === "CLAUDE"
                ? "mcp"
                : actorType === "GITHUB"
                  ? "github"
                  : "system",
            action: `test.${actorType.toLowerCase()}`,
            changes: [],
          },
        });
      }
      const all = (await call("get", "/ACV/activity", "viewer")).body;
      expect([all.page, all.pageSize, all.total]).toEqual([1, 25, 6]);
      expect(all.items[0].action).toBe("test.system"); // newest first
      expect(all.items.map((a: Json) => a.actorType)).toEqual([
        "SYSTEM",
        "GITHUB",
        "CLAUDE",
        "USER",
        "USER",
        "USER",
      ]);
      const paged = (await call("get", "/ACV/activity?pageSize=2&page=2", "viewer")).body;
      expect(paged.items.map((a: Json) => a.action)).toEqual([
        "test.claude",
        "issue.created",
      ]);
      expect(paged.total).toBe(6);
      const claude = (await call("get", "/ACV/activity?actorType=CLAUDE", "viewer")).body;
      expect([claude.total, claude.items[0].channel, claude.items[0].actor]).toEqual([
        1,
        "mcp",
        null,
      ]);
      const user = (await call("get", "/ACV/activity?actorType=USER", "viewer")).body;
      expect(user.items[0]).toMatchObject({
        actorType: "USER",
        channel: "web",
        actor: { fullName: `${TAG} sa` },
      });
      expect((await call("get", "/ACV/activity?actorType=ROBOT", "viewer")).status).toBe(
        400,
      );
      expect(user.items.find((a: Json) => a.issueKey === "ACV-2")).toMatchObject({
        issueTitle: "Two",
        action: "issue.created",
      });
      // the lookup
      const hit = await call("get", "/issue-keys/acv-2", "viewer");
      expect(hit.body).toMatchObject({
        key: "ACV-2",
        title: "Two",
        status: { name: "New" },
        project: { key: "ACV" },
      });
      const bad = await call("get", "/issue-keys/nonsense", "viewer");
      expect([bad.status, bad.body.message]).toEqual([
        400,
        '"nonsense" is not an issue key like PAY-12.',
      ]);
      expect((await call("get", "/issue-keys/ACV-77", "viewer")).status).toBe(404);
    });

    it("a project can have a parent project and a client; a loop is refused; the key is the handle", async () => {
      await project({ key: "PAR" });
      await project({ key: "CHD", parentKey: "PAR" });
      expect((await call("get", "/CHD", "sa")).body.project.parent).toEqual({
        key: "PAR",
        name: "Project PAR",
      });
      const own = await call("patch", "/PAR", "sa", { parentKey: "PAR" });
      expect([own.status, own.body.message]).toEqual([
        400,
        "A project cannot be its own parent.",
      ]);
      const loop = await call("patch", "/PAR", "sa", { parentKey: "CHD" });
      expect([loop.status, loop.body.message]).toEqual([
        400,
        "That parent project would make the project its own ancestor.",
      ]);
      const none = await call("post", "", "sa", {
        key: "ORP",
        name: "x",
        parentKey: "NOPE",
      });
      expect([none.status, none.body.message]).toEqual([
        404,
        "The parent project was not found.",
      ]);
      expect((await call("get", "/NOSUCH", "sa")).body.message).toBe(
        "Project not found.",
      );
      expect((await call("get", "/no-such-key!", "sa")).status).toBe(404);
    });
  });
});
