/**
 * track-a-projects-import.db-spec.ts — PA4 (D68): the markdown checklist import, over HTTP against
 * the real Nest app and the local PostgreSQL. Every firm, user and title is invented.
 *
 * I1  What an import makes: milestones (reused by name), issues, closed items, labels.
 * I2  Labels and the Configure permission; nothing is made when it is refused.
 * I3  The limit of 500, a dry run, headings off, an empty list.
 * I4  One transaction: a failure part way leaves nothing.
 * I5  Permissions, tokens, visibility, validation.
 */
import { randomUUID } from "node:crypto";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { truncateOncePerFile } from "./helpers/truncate";
import { AppModule } from "../../src/app.module";
import { TokenService } from "../../src/auth/token.service";
import { PrismaService } from "../../src/prisma/prisma.service";
import { ProjectsActivity } from "../../src/projects/projects-activity.service";

truncateOncePerFile({ firmRoles: ["Super Admin"] });

const TAG = `track-a-imp-${randomUUID().slice(0, 8)}`;
const API = "/api/v1";
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the tests read JSON
type Json = Record<string, any>;
const missing = (...p: string[]) => `Missing permission(s): ${p.join(", ")}`;
const READ_ONLY = "This token is read-only.";
const TOO_MANY = "That is more than 500 items. Split the import into smaller lists.";
const noLabels = (names: string) =>
  `The import uses labels that do not exist: ${names}. Creating a label needs Projects:Configure, so nothing was imported.`;

describe("PA4 · checklist import (real app over HTTP, db)", () => {
  let app: INestApplication;
  let db: PrismaService;
  let firmId = "";
  let clientId = "";
  const jwt: Record<string, string> = {};
  const uid: Record<string, string> = {};
  let seq = 0;

  const http = () => request(app.getHttpServer());
  const as = (
    method: "get" | "post" | "patch",
    path: string,
    who = "sa",
    body?: object,
  ) => {
    const r = http()[method](`${API}${path}`).set("Authorization", `Bearer ${jwt[who]}`);
    return body === undefined ? r : r.send(body);
  };
  const withToken = (path: string, token: string, body: object) =>
    http().post(`${API}${path}`).set("Authorization", `Bearer ${token}`).send(body);
  async function project(extra: Json = {}, who = "sa") {
    seq += 1;
    const key = extra.key ?? `I${String(seq).padStart(3, "0")}`;
    const res = await as("post", "/projects", who, {
      name: `Project ${key}`,
      ...extra,
      key,
    });
    expect(res.status).toBe(201);
    return key as string;
  }
  const doImport = (key: string, body: Json, who = "sa") =>
    as("post", `/projects/${key}/import`, who, body);
  const snapshot = async (key: string) => {
    const p = await db.project.findFirstOrThrow({ where: { key, firmId } });
    return {
      issues: await db.issue.count({ where: { projectId: p.id } }),
      milestones: await db.milestone.count({ where: { projectId: p.id } }),
      labels: await db.label.count({ where: { firmId } }),
      counter: p.issueCounter,
      activity: await db.projectActivity.count({ where: { projectId: p.id } }),
    };
  };

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
  async function makeUser(label: string, roleId?: string, assign?: string[]) {
    const u = await db.user.create({
      data: {
        firmId,
        userType: "FIRM",
        fullName: `${TAG} ${label}`,
        email: `${TAG}-${label}@example.com`,
        status: "ACTIVE",
        firmProfile: {
          create: {
            title: "Test",
            ...(assign?.length
              ? { clientAssignments: { create: assign.map((c) => ({ clientId: c })) } }
              : {}),
          },
        },
        ...(roleId ? { userRoles: { create: { roleId } } } : {}),
      },
    });
    uid[label] = u.id;
    jwt[label] = app
      .get(TokenService)
      .signAccess({ id: u.id, firmId, userType: "FIRM", email: u.email });
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix("api/v1");
    await app.init();
    db = app.get(PrismaService);
    firmId = (await db.firm.create({ data: { name: `${TAG} Halimbawa Accounting` } })).id;
    const sa = (
      await db.role.findUniqueOrThrow({
        where: { name_scope: { name: "Super Admin", scope: "FIRM" } },
      })
    ).id;
    const member = await makeRole(`${TAG} IMP Member`, [
      "Projects:Read",
      "Projects:Create",
      "Projects:Update",
    ]);
    const viewer = await makeRole(`${TAG} IMP Viewer`, ["Projects:Read"]);
    clientId = (
      await db.client.create({
        data: { firmId, businessName: `${TAG} Halimbawa Client`, tin: "000555401" },
      })
    ).id;
    await makeUser("sa", sa);
    await makeUser("member", member);
    await makeUser("viewer", viewer);
    await makeUser("memberAssigned", member, [clientId]);
    await as("post", "/projects/admin/labels", "sa", { name: "UI", colour: "#112233" });
    await as("post", "/projects/admin/labels", "sa", {
      name: "backend",
      colour: "#223344",
    });
  });
  afterAll(async () => {
    jest.restoreAllMocks();
    await app.close();
  });

  // ======================================================================================
  describe("I1 · what an import makes", () => {
    it("milestones by name (an existing one is reused), issues, closed items in the first done status, labels by name, one answer", async () => {
      const key = await project({ key: "IMP1" });
      const existing = (
        await as("post", "/projects/IMP1/milestones", "sa", { name: "beta" })
      ).body;
      const markdown = [
        "# Beta",
        "- [ ] First task #ui",
        "  - details for the first task",
        "- [x] Done thing #backend #ui",
        "",
        "## Gamma",
        "- [ ] Gamma item #brandnew",
        "- [ ] Plain item",
      ].join("\n");
      const res = await doImport(key, { markdown, headingsAsMilestones: true });
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({
        dryRun: false,
        items: { total: 4, open: 3, closed: 1 },
        milestones: [
          { name: "Beta", created: false },
          { name: "Gamma", created: true },
        ],
        warnings: [],
        keys: ["IMP1-1", "IMP1-2", "IMP1-3", "IMP1-4"],
      });
      expect(res.body.plan).toBeUndefined();
      expect(res.body.labels).toEqual([
        { name: "ui", created: false },
        { name: "backend", created: false },
        { name: "brandnew", created: true },
      ]);
      // the existing milestone was reused, in its own spelling; one new
      const ms = await db.milestone.findMany({
        where: { project: { key } },
        orderBy: { createdAt: "asc" },
      });
      expect(ms.map((m) => m.name)).toEqual(["beta", "Gamma"]);
      expect(ms[0]!.id).toBe(existing.id);
      const issues = await db.issue.findMany({
        where: { project: { key } },
        orderBy: { number: "asc" },
        include: {
          status: true,
          type: true,
          labels: { include: { label: true } },
          milestone: true,
        },
      });
      expect(issues.map((i) => i.title)).toEqual([
        "First task",
        "Done thing",
        "Gamma item",
        "Plain item",
      ]);
      expect(issues[0]!.description).toContain("details for the first task");
      expect(issues.map((i) => i.milestone?.name ?? null)).toEqual([
        "beta",
        "beta",
        "Gamma",
        "Gamma",
      ]);
      expect(
        issues.every((i) => i.type.name === "Task" && i.authorId === uid["sa"]),
      ).toBe(true);
      const firstDone = (
        await db.issueStatus.findMany({
          where: { firmId, category: "DONE" },
          orderBy: [{ order: "asc" }, { name: "asc" }],
        })
      )[0]!;
      expect(issues[1]!.statusId).toBe(firstDone.id);
      expect(issues[1]!.closedAt).not.toBeNull();
      expect(issues[0]!.status.name).toBe("New");
      expect(issues[0]!.closedAt).toBeNull();
      // labels: matched in the label's own spelling, one created
      expect(issues[0]!.labels.map((l) => l.label.name)).toEqual(["UI"]);
      expect(issues[1]!.labels.map((l) => l.label.name).sort()).toEqual([
        "UI",
        "backend",
      ]);
      expect(issues[2]!.labels.map((l) => l.label.name)).toEqual(["brandnew"]);
      expect(
        await db.label.count({
          where: { firmId, name: { equals: "ui", mode: "insensitive" } },
        }),
      ).toBe(1);
      // the activity says what was made, as the web
      const acts = await db.projectActivity.findMany({ where: { project: { key } } });
      expect(acts.filter((a) => a.action === "issue.created")).toHaveLength(4);
      expect(acts.filter((a) => a.action === "milestone.created")).toHaveLength(2); // beta by hand, Gamma by the import
      expect(acts.every((a) => ["USER"].includes(a.actorType))).toBe(true);
    });

    it("the numbers continue after the issues already there", async () => {
      const key = await project({ key: "IMP2" });
      await as("post", "/projects/IMP2/issues", "sa", { title: "By hand" });
      const res = await doImport(key, { markdown: "- [ ] One\n- [ ] Two" });
      expect(res.body.keys).toEqual(["IMP2-2", "IMP2-3"]);
    });

    it("headings are ignored unless asked for; an existing milestone is matched in any case", async () => {
      const key = await project({ key: "IMP3" });
      await as("post", "/projects/IMP3/milestones", "sa", { name: "Sprint" });
      const md = "# SPRINT\n- [ ] Under a heading\n";
      const off = await doImport(key, { markdown: md });
      expect(off.body.milestones).toEqual([]);
      expect(
        (await db.issue.findFirstOrThrow({ where: { key: "IMP3-1" } })).milestoneId,
      ).toBeNull();
      const on = await doImport(key, { markdown: md, headingsAsMilestones: true });
      expect(on.body.milestones).toEqual([{ name: "SPRINT", created: false }]);
      expect(await db.milestone.count({ where: { project: { key } } })).toBe(1);
      expect(
        (
          await db.issue.findFirstOrThrow({
            where: { key: "IMP3-2" },
            include: { milestone: true },
          })
        ).milestone?.name,
      ).toBe("Sprint");
    });
  });

  // ======================================================================================
  describe("I2 · labels and the Configure permission", () => {
    it("without Projects:Configure an unknown label refuses the whole import, naming the labels, and nothing is made", async () => {
      const key = await project({ key: "LAB1" });
      const before = await snapshot(key);
      const md =
        "# Phase\n- [ ] One #ui #zeta-new\n- [ ] Two #another-new\n- [x] Three #zeta-new";
      const res = await doImport(
        key,
        { markdown: md, headingsAsMilestones: true },
        "member",
      );
      expect(res.status).toBe(403);
      expect(res.body.message).toBe(noLabels("zeta-new, another-new"));
      expect(await snapshot(key)).toEqual(before);
      // existing labels are fine without it
      const ok = await doImport(
        key,
        { markdown: "- [ ] One #ui\n- [ ] Two #backend" },
        "member",
      );
      expect(ok.status).toBe(201);
      expect(ok.body.labels).toEqual([
        { name: "ui", created: false },
        { name: "backend", created: false },
      ]);
    });

    it("with Projects:Configure the unknown labels are made", async () => {
      const key = await project({ key: "LAB2" });
      const res = await doImport(key, { markdown: "- [ ] One #fresh-label" }, "sa");
      expect(res.status).toBe(201);
      expect(res.body.labels).toEqual([{ name: "fresh-label", created: true }]);
      expect(await db.label.count({ where: { firmId, name: "fresh-label" } })).toBe(1);
    });
  });

  // ======================================================================================
  describe("I3 · the limit, a dry run, an empty list", () => {
    const items = (n: number) =>
      Array.from({ length: n }, (_, i) => `- [ ] Item ${i + 1}`).join("\n");

    it("500 items are imported; 501 are refused whole with the sentence", async () => {
      const key = await project({ key: "LIM1" });
      const ok = await doImport(key, { markdown: items(500) });
      expect(ok.status).toBe(201);
      expect(ok.body.items.total).toBe(500);
      expect(ok.body.keys).toHaveLength(500);
      expect(await db.issue.count({ where: { project: { key } } })).toBe(500);
      const key2 = await project({ key: "LIM2" });
      const before = await snapshot(key2);
      const over = await doImport(key2, { markdown: items(501) });
      expect(over.status).toBe(400);
      expect(over.body.message).toBe(TOO_MANY);
      expect(await snapshot(key2)).toEqual(before);
    });

    it("a dry run answers the plan and writes nothing, not even a number", async () => {
      const key = await project({ key: "DRY1" });
      const before = await snapshot(key);
      const md = "# One\n- [ ] A #ui\n- [x] B #plan-only\n## Two\n- [ ] C";
      const res = await doImport(key, {
        markdown: md,
        headingsAsMilestones: true,
        dryRun: true,
      });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        dryRun: true,
        items: { total: 3, open: 2, closed: 1 },
        milestones: [
          { name: "One", created: true },
          { name: "Two", created: true },
        ],
        labels: [
          { name: "ui", created: false },
          { name: "plan-only", created: true },
        ],
        keys: [],
      });
      expect(res.body.plan).toEqual([
        { title: "A", closed: false, labels: ["ui"], milestone: "One", description: "" },
        {
          title: "B",
          closed: true,
          labels: ["plan-only"],
          milestone: "One",
          description: "",
        },
        { title: "C", closed: false, labels: [], milestone: "Two", description: "" },
      ]);
      expect(await snapshot(key)).toEqual(before);
      expect(await db.label.count({ where: { firmId, name: "plan-only" } })).toBe(0);
      // a dry run is subject to the same refusals
      const refused = await doImport(
        key,
        { markdown: md, headingsAsMilestones: true, dryRun: true },
        "member",
      );
      expect(refused.status).toBe(403);
      expect(refused.body.message).toBe(noLabels("plan-only"));
    });

    it("a list with no items is not an error: nothing is made and the warning is passed on", async () => {
      const key = await project({ key: "EMP1" });
      const before = await snapshot(key);
      const res = await doImport(key, { markdown: "Just some prose.\n\nNo boxes here." });
      expect(res.status).toBe(201);
      expect(res.body.items).toEqual({ total: 0, open: 0, closed: 0 });
      expect(res.body.keys).toEqual([]);
      expect(res.body.warnings.length).toBeGreaterThan(0);
      expect(await snapshot(key)).toEqual(before);
    });
  });

  // ======================================================================================
  describe("I4 · one transaction", () => {
    it("a failure part way leaves no issue, no milestone, no label, no number used, no activity", async () => {
      const key = await project({ key: "ROL1" });
      const before = await snapshot(key);
      const activity = app.get(ProjectsActivity);
      const original = activity.log.bind(activity);
      let calls = 0;
      const spy = jest.spyOn(activity, "log").mockImplementation(async (...args) => {
        calls += 1;
        if (calls === 5) throw new Error("the database went away");
        return original(...args);
      });
      try {
        const md =
          "# Alpha\n- [ ] A #ui #freshly-made\n- [ ] B\n## Beta\n- [ ] C\n- [x] D";
        const res = await doImport(key, { markdown: md, headingsAsMilestones: true });
        expect(res.status).toBe(500);
      } finally {
        spy.mockRestore();
      }
      expect(calls).toBeGreaterThanOrEqual(5);
      expect(await snapshot(key)).toEqual(before);
      expect(await db.label.count({ where: { firmId, name: "freshly-made" } })).toBe(0);
      // and the same import works afterwards, starting at the first number
      const again = await doImport(key, { markdown: "- [ ] A\n- [ ] B" });
      expect(again.body.keys).toEqual(["ROL1-1", "ROL1-2"]);
    });
  });

  // ======================================================================================
  describe("I5 · permissions, tokens, visibility, validation", () => {
    it("needs Projects:Create; a Viewer is refused and nothing is made", async () => {
      const key = await project({ key: "PRM1" });
      const before = await snapshot(key);
      const res = await doImport(key, { markdown: "- [ ] A" }, "viewer");
      expect(res.status).toBe(403);
      expect(res.body.message).toBe(missing("Projects:Create"));
      expect(await snapshot(key)).toEqual(before);
    });

    it("a personal token may import: a read_write token does it as the api channel, a read token is refused", async () => {
      const key = await project({ key: "TOK1" });
      const rw = (
        await as("post", "/tokens", "member", { name: "rw", scope: "read_write" })
      ).body.token;
      const ro = (await as("post", "/tokens", "member", { name: "ro", scope: "read" }))
        .body.token;
      const refused = await withToken("/projects/TOK1/import", ro, {
        markdown: "- [ ] A",
      });
      expect(refused.status).toBe(403);
      expect(refused.body.message).toBe(READ_ONLY);
      expect(await db.issue.count({ where: { project: { key } } })).toBe(0);
      const ok = await withToken("/projects/TOK1/import", rw, {
        markdown: "- [ ] A\n- [x] B",
      });
      expect(ok.status).toBe(201);
      const acts = await db.projectActivity.findMany({
        where: { project: { key }, action: { not: "project.created" } },
      });
      expect(acts.length).toBe(2);
      expect(
        acts.every(
          (a) =>
            a.actorType === "USER" &&
            a.channel === "api" &&
            a.actorUserId === uid["member"],
        ),
      ).toBe(true);
    });

    it("a project the caller cannot see is a 404, and so is one that does not exist", async () => {
      const key = await project({ key: "HID1", clientId });
      expect((await doImport(key, { markdown: "- [ ] A" }, "member")).status).toBe(404);
      expect(
        (await doImport(key, { markdown: "- [ ] A" }, "memberAssigned")).status,
      ).toBe(201);
      expect((await doImport("NOPE", { markdown: "- [ ] A" })).status).toBe(404);
    });

    it("markdown is required; the flags are booleans", async () => {
      const key = await project({ key: "VAL1" });
      const none = await doImport(key, {});
      expect(none.status).toBe(400);
      expect(none.body.message).toBe("Validation failed");
      expect(none.body.errors[0].path).toBe("markdown");
      const bad = await doImport(key, {
        markdown: "- [ ] A",
        headingsAsMilestones: "yes",
      });
      expect(bad.status).toBe(400);
      expect(bad.body.errors[0].path).toBe("headingsAsMilestones");
    });
  });
});
