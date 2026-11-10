/**
 * track-a-projects-sessions.db-spec.ts — PA5 (D69): the list of a project's Claude work sessions,
 * the last five on the overview, and the session on every activity item, over HTTP against the real
 * Nest app and the local PostgreSQL. Every firm, user and title is invented.
 *
 * L1  GET /projects/:key/sessions: order, paging, shape, a session with no user.
 * L2  Who may read it.
 * L3  recentSessions on the overview.
 * L4  session on the activity items: the project's feed, the overview, My Work.
 */
import { randomUUID } from "node:crypto";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { truncateOncePerFile } from "./helpers/truncate";
import { AppModule } from "../../src/app.module";
import { TokenService } from "../../src/auth/token.service";
import { PrismaService } from "../../src/prisma/prisma.service";

truncateOncePerFile({ firmRoles: ["Super Admin"] });

const TAG = `track-a-ses-${randomUUID().slice(0, 8)}`;
const API = "/api/v1";
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the tests read JSON
type Json = Record<string, any>;
const missing = (...p: string[]) => `Missing permission(s): ${p.join(", ")}`;

describe("PA5 · sessions list and the session on activity (real app over HTTP, db)", () => {
  let app: INestApplication;
  let db: PrismaService;
  let firmId = "";
  let otherFirmId = "";
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
  async function project(extra: Json = {}, who = "sa") {
    seq += 1;
    const key = extra.key ?? `S${String(seq).padStart(3, "0")}`;
    const res = await as("post", "/projects", who, {
      name: `Project ${key}`,
      ...extra,
      key,
    });
    expect(res.status).toBe(201);
    return key as string;
  }
  async function mint(who: string, scope = "read_write") {
    const res = await as("post", "/tokens", who, { name: `${who} ${scope}`, scope });
    expect(res.status).toBe(201);
    return res.body.token as string;
  }
  /** A session started through a token, so changes can name it. */
  async function startSession(token: string, key: string, title: string) {
    const res = await http()
      .post(`${API}/projects/${key}/sessions`)
      .set("Authorization", `Bearer ${token}`)
      .send({ title });
    expect(res.status).toBe(201);
    return res.body.session as Json;
  }

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
    roleId?: string,
    firm?: string,
    assign?: string[],
  ) {
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
      .signAccess({ id: u.id, firmId: fid, userType: "FIRM", email: u.email });
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
    const member = await makeRole(`${TAG} SES Member`, [
      "Projects:Read",
      "Projects:Create",
      "Projects:Update",
    ]);
    const viewer = await makeRole(`${TAG} SES Viewer`, ["Projects:Read"]);
    clientId = (
      await db.client.create({
        data: { firmId, businessName: `${TAG} Halimbawa Client`, tin: "000555501" },
      })
    ).id;
    await makeUser("sa", sa);
    await makeUser("sa2", sa, otherFirmId);
    await makeUser("member", member);
    await makeUser("member2", member);
    await makeUser("viewer", viewer);
    await makeUser("norole");
    await makeUser("memberAssigned", member, undefined, [clientId]);
  });
  afterAll(async () => {
    await app.close();
  });

  // ======================================================================================
  describe("L1 · the list", () => {
    it("newest first, paged, with who, client, title, times, summary, next steps and issue keys", async () => {
      const key = await project({ key: "LST1" });
      const t = await mint("member");
      const made: Json[] = [];
      for (let n = 1; n <= 7; n++) made.push(await startSession(t, key, `Session ${n}`));
      // fix their start times so the order is not a matter of milliseconds
      for (const [n, s] of made.entries()) {
        await db.projectWorkSession.update({
          where: { id: s.id },
          data: { startedAt: new Date(Date.UTC(2026, 10, 1 + n, 1, 0, 0)) },
        });
      }
      const i1 = (
        await as("post", `/projects/${key}/issues`, "member", { title: "Touched" })
      ).body.key;
      const ended = await http()
        .post(`${API}/projects/sessions/${made[6]!.id}/end`)
        .set("Authorization", `Bearer ${t}`)
        .send({ summary: `Did ${i1}.`, nextSteps: "Carry on." });
      expect(ended.status).toBe(200);

      const page1 = await as("get", `/projects/${key}/sessions?pageSize=3`, "viewer");
      expect(page1.status).toBe(200);
      expect(Object.keys(page1.body).sort()).toEqual([
        "items",
        "page",
        "pageSize",
        "total",
      ]);
      expect(page1.body).toMatchObject({ page: 1, pageSize: 3, total: 7 });
      expect(page1.body.items.map((s: Json) => s.title)).toEqual([
        "Session 7",
        "Session 6",
        "Session 5",
      ]);
      const first = page1.body.items[0];
      expect(Object.keys(first).sort()).toEqual([
        "client",
        "endedAt",
        "id",
        "issueKeys",
        "nextSteps",
        "projectKey",
        "startedAt",
        "summary",
        "title",
        "user",
      ]);
      expect(first).toMatchObject({
        projectKey: key,
        client: "rest",
        summary: `Did ${i1}.`,
        nextSteps: "Carry on.",
        issueKeys: [i1],
        user: { id: uid["member"], fullName: `${TAG} member` },
      });
      expect(first.endedAt).not.toBeNull();
      expect(page1.body.items[1]).toMatchObject({
        endedAt: null,
        summary: "",
        nextSteps: "",
        issueKeys: [],
      });
      const page2 = await as(
        "get",
        `/projects/${key}/sessions?pageSize=3&page=2`,
        "viewer",
      );
      expect(page2.body.items.map((s: Json) => s.title)).toEqual([
        "Session 4",
        "Session 3",
        "Session 2",
      ]);
      const page3 = await as(
        "get",
        `/projects/${key}/sessions?pageSize=3&page=3`,
        "viewer",
      );
      expect(page3.body.items.map((s: Json) => s.title)).toEqual(["Session 1"]);
      expect(
        (await as("get", `/projects/${key}/sessions?page=9`, "viewer")).body.items,
      ).toEqual([]);
      // the default page is 25, the largest 100
      const all = await as("get", `/projects/${key}/sessions`, "viewer");
      expect(all.body).toMatchObject({ page: 1, pageSize: 25, total: 7 });
      expect(
        (await as("get", `/projects/${key}/sessions?pageSize=500`, "viewer")).body
          .pageSize,
      ).toBe(100);
    });

    it("a session with no user is listed with user null, and the briefing still reads", async () => {
      const key = await project({ key: "LST2" });
      const p = await db.project.findFirstOrThrow({ where: { key, firmId } });
      await db.projectWorkSession.create({
        data: {
          firmId,
          projectId: p.id,
          userId: null,
          client: "claude-code",
          title: "Detached",
          summary: "No user.",
          issueKeys: [],
        },
      });
      const list = await as("get", `/projects/${key}/sessions`, "viewer");
      expect(list.body.items[0]).toMatchObject({ title: "Detached", user: null });
      const brief = await as("get", `/projects/${key}/context`, "viewer");
      expect(brief.status).toBe(200);
      expect(brief.text).toContain("Detached: No user.");
    });

    it("an empty project has an empty list", async () => {
      const key = await project({ key: "LST3" });
      expect((await as("get", `/projects/${key}/sessions`, "viewer")).body).toEqual({
        items: [],
        page: 1,
        pageSize: 25,
        total: 0,
      });
    });
  });

  // ======================================================================================
  describe("L2 · who may read it", () => {
    it("Projects:Read, a token of any scope, visibility and tenants", async () => {
      const key = await project({ key: "PRM1" });
      await startSession(await mint("member"), key, "Mine");
      expect((await as("get", `/projects/${key}/sessions`, "viewer")).body.total).toBe(1);
      const noRole = await as("get", `/projects/${key}/sessions`, "norole");
      expect(noRole.status).toBe(403);
      expect(noRole.body.message).toBe(missing("Projects:Read"));
      const ro = await mint("viewer", "read");
      const viaToken = await http()
        .get(`${API}/projects/${key}/sessions`)
        .set("Authorization", `Bearer ${ro}`);
      expect(viaToken.status).toBe(200);
      expect(viaToken.body.total).toBe(1);
      expect((await as("get", `/projects/${key}/sessions`, "sa2")).status).toBe(404);
      const hidden = await project({ key: "PRM2", clientId });
      expect((await as("get", `/projects/${hidden}/sessions`, "member")).status).toBe(
        404,
      );
      expect(
        (await as("get", `/projects/${hidden}/sessions`, "memberAssigned")).status,
      ).toBe(200);
      expect((await as("get", `/projects/NOPE/sessions`, "sa")).status).toBe(404);
    });
  });

  // ======================================================================================
  describe("L3 · recentSessions on the overview", () => {
    it("the last five, newest first, in the list's shape; none is an empty list", async () => {
      const key = await project({ key: "OVW1" });
      expect((await as("get", `/projects/${key}`, "viewer")).body.recentSessions).toEqual(
        [],
      );
      const t = await mint("member");
      const made: Json[] = [];
      for (let n = 1; n <= 7; n++) made.push(await startSession(t, key, `Run ${n}`));
      for (const [n, s] of made.entries()) {
        await db.projectWorkSession.update({
          where: { id: s.id },
          data: { startedAt: new Date(Date.UTC(2026, 10, 1 + n, 1, 0, 0)) },
        });
      }
      const ov = (await as("get", `/projects/${key}`, "viewer")).body;
      expect(ov.recentSessions.map((s: Json) => s.title)).toEqual([
        "Run 7",
        "Run 6",
        "Run 5",
        "Run 4",
        "Run 3",
      ]);
      const list = (await as("get", `/projects/${key}/sessions?pageSize=5`, "viewer"))
        .body.items;
      expect(ov.recentSessions).toEqual(list);
    });
  });

  // ======================================================================================
  describe("L4 · the session on activity items", () => {
    it("every activity item carries session { id, title } or null: the project's feed, the overview and My Work", async () => {
      const key = await project({ key: "ACT1" });
      const t = await mint("member");
      const s = await startSession(t, key, "Tagged work");
      const hdr = { "x-portal-session": s.id };
      const tagged = await http()
        .post(`${API}/projects/${key}/issues`)
        .set("Authorization", `Bearer ${t}`)
        .set(hdr)
        .send({ title: "With a session" });
      expect(tagged.status).toBe(201);
      const plain = await as("post", `/projects/${key}/issues`, "member", {
        title: "Without",
      });
      expect(plain.status).toBe(201);

      const feed = (await as("get", `/projects/${key}/activity?pageSize=50`, "member"))
        .body.items as Json[];
      const forTagged = feed.filter((a) => a.issueKey === tagged.body.key);
      expect(forTagged.length).toBeGreaterThan(0);
      for (const a of forTagged)
        expect(a.session).toEqual({ id: s.id, title: "Tagged work" });
      for (const a of feed.filter((a) => a.issueKey === plain.body.key))
        expect(a.session).toBeNull();
      // the session's own start is on it too
      expect(feed.find((a) => a.action === "session.started")?.session).toEqual({
        id: s.id,
        title: "Tagged work",
      });
      // and every item has the field
      for (const a of feed) expect(a).toHaveProperty("session");

      const ov = (await as("get", `/projects/${key}`, "member")).body
        .recentActivity as Json[];
      expect(ov.length).toBeGreaterThan(0);
      for (const a of ov) expect(a).toHaveProperty("session");
      expect(ov.find((a) => a.issueKey === tagged.body.key)?.session).toEqual({
        id: s.id,
        title: "Tagged work",
      });

      const mine = (await as("get", "/projects/my-work", "member")).body
        .recentActivity as Json[];
      const row = mine.find((a) => a.issueKey === tagged.body.key);
      expect(row?.session).toEqual({ id: s.id, title: "Tagged work" });
      for (const a of mine) expect(a).toHaveProperty("session");
    });

    it("a session whose title is empty is still { id, title: '' }", async () => {
      const key = await project({ key: "ACT2" });
      const t = await mint("member");
      const res = await http()
        .post(`${API}/projects/${key}/sessions`)
        .set("Authorization", `Bearer ${t}`)
        .send({});
      const feed = (await as("get", `/projects/${key}/activity`, "member")).body
        .items as Json[];
      expect(feed.find((a) => a.action === "session.started")?.session).toEqual({
        id: res.body.session.id,
        title: "",
      });
    });
  });
});
