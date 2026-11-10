/**
 * track-a-projects-tokens.db-spec.ts — PA3 (D67): personal API tokens, the Projects REST routes
 * with a token, work sessions, the REST briefing and the repo kit, over HTTP against the real
 * Nest app and the local PostgreSQL. Every firm, user and title is invented.
 *
 * T1  Tokens: made once, hash only, listed, revoked, the firm's Super Admin, audit.
 * T2  Using a token: who may, read-only rules, last used, routes that refuse tokens.
 * T3  REST with a token: tagging (USER, api), the session header, visibility and permissions.
 * T4  Work sessions: start (both paths), tagged changes, end, the next briefing.
 * T5  The briefing as markdown, and the repo kit.
 */
import { createHash, randomUUID } from "node:crypto";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { truncateOncePerFile } from "./helpers/truncate";
import { AppModule } from "../../src/app.module";
import { TokenService } from "../../src/auth/token.service";
import { PrismaService } from "../../src/prisma/prisma.service";

truncateOncePerFile({ firmRoles: ["Super Admin"] });

const TAG = `track-a-tok-${randomUUID().slice(0, 8)}`;
const API = "/api/v1";
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the tests read JSON
type Json = Record<string, any>;

const READ_ONLY = "This token is read-only.";
const INVALID = "Invalid or revoked token.";
const NOT_HERE = "Personal tokens cannot be used on this route.";
const TOKEN_NF = "Token not found.";
const SESSION_NF = "Session not found.";
const SA_ONLY = "Only a Super Admin can list every token of the firm.";
const NAME_MSG = "Give the token a name, for example 'Claude Code laptop'.";
const SUMMARY_MSG = "A short summary of what was done is required.";
const missing = (...p: string[]) => `Missing permission(s): ${p.join(", ")}`;
const sha = (s: string) => createHash("sha256").update(s).digest("hex");

describe("PA3 · personal tokens, REST with tokens, work sessions, briefing, repo kit (real app over HTTP, db)", () => {
  let app: INestApplication;
  let db: PrismaService;
  let firmId = "";
  let otherFirmId = "";
  let clientId = "";
  const jwt: Record<string, string> = {};
  const uid: Record<string, string> = {};
  let st: Record<string, string> = {};
  let seq = 0;
  let prevApiUrl: string | undefined;

  const http = () => request(app.getHttpServer());
  /** A call with the Portal's own sign-in (JWT). */
  const as = (
    method: "get" | "post" | "patch" | "delete",
    path: string,
    who = "sa",
    body?: object,
  ) => {
    const r = http()[method](`${API}${path}`).set("Authorization", `Bearer ${jwt[who]}`);
    return body === undefined ? r : r.send(body);
  };
  /** A call with a personal token. */
  const withToken = (
    method: "get" | "post" | "patch" | "delete",
    path: string,
    token: string,
    body?: object,
    headers: Record<string, string> = {},
  ) => {
    let r = http()[method](`${API}${path}`).set("Authorization", `Bearer ${token}`);
    for (const [k, v] of Object.entries(headers)) r = r.set(k, v);
    return body === undefined ? r : r.send(body);
  };
  async function mint(who: string, name = `${who} token`, scope = "read_write") {
    const res = await as("post", "/tokens", who, { name, scope });
    expect(res.status).toBe(201);
    return res.body as Json & { token: string; id: string };
  }
  async function project(extra: Json = {}, who = "sa") {
    seq += 1;
    const key = extra.key ?? `K${String(seq).padStart(3, "0")}`;
    const res = await as("post", "/projects", who, {
      name: `Project ${key}`,
      ...extra,
      key,
    });
    expect(res.status).toBe(201);
    return res.body as Json;
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
    jwt[label] = app.get(TokenService).signAccess({
      id: u.id,
      firmId: fid,
      userType: opts.type ?? "FIRM",
      email: u.email,
    });
  }

  beforeAll(async () => {
    prevApiUrl = process.env.API_PUBLIC_URL;
    process.env.API_PUBLIC_URL = "https://portal.example.test";
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
    const member = await makeRole(`${TAG} PA3 Member`, [
      "Projects:Read",
      "Projects:Create",
      "Projects:Update",
    ]);
    const viewer = await makeRole(`${TAG} PA3 Viewer`, ["Projects:Read"]);
    clientId = (
      await db.client.create({
        data: { firmId, businessName: `${TAG} Halimbawa Client`, tin: "000555301" },
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
    const meta = (await as("get", "/projects/meta")).body;
    st = Object.fromEntries(meta.issueStatuses.map((s: Json) => [s.name, s.id]));
  });
  afterAll(async () => {
    if (prevApiUrl === undefined) delete process.env.API_PUBLIC_URL;
    else process.env.API_PUBLIC_URL = prevApiUrl;
    await app.close();
  });

  // ======================================================================================
  describe("T1 · making, listing and revoking tokens", () => {
    it("a token is answered once, in the response that makes it; the database holds its SHA-256 and a short prefix, never the token", async () => {
      const res = await as("post", "/tokens", "member", {
        name: "Claude Code laptop",
        scope: "read_write",
      });
      expect(res.status).toBe(201);
      expect(res.headers["cache-control"]).toBe("no-store");
      expect(Object.keys(res.body).sort()).toEqual([
        "createdAt",
        "id",
        "lastUsedAt",
        "name",
        "prefix",
        "revokedAt",
        "scope",
        "token",
      ]);
      const token = res.body.token as string;
      expect(token).toMatch(/^ppt_[A-Za-z0-9_-]{43}$/);
      expect(res.body).toMatchObject({
        name: "Claude Code laptop",
        scope: "read_write",
        prefix: token.slice(0, 10),
        lastUsedAt: null,
        revokedAt: null,
      });

      const row = await db.apiToken.findUniqueOrThrow({ where: { id: res.body.id } });
      expect(row.tokenHash).toBe(sha(token));
      expect(row.prefix).toBe(token.slice(0, 10));
      expect(row.userId).toBe(uid["member"]);
      expect(row.firmId).toBe(firmId);
      expect(JSON.stringify(row)).not.toContain(token);
      // the plain token is not in the audit trail either, nor in any table's text
      const audits = await db.$queryRaw<{ n: bigint }[]>`
        SELECT count(*) AS n FROM audit_logs WHERE metadata::text LIKE ${"%" + token + "%"}`;
      expect(Number(audits[0]!.n)).toBe(0);
      const rows = await db.$queryRaw<{ n: bigint }[]>`
        SELECT count(*) AS n FROM api_tokens t WHERE row_to_json(t)::text LIKE ${"%" + token + "%"}`;
      expect(Number(rows[0]!.n)).toBe(0);

      // never again: the list has no token and no hash
      const list = await as("get", "/tokens", "member");
      expect(list.status).toBe(200);
      const mine = list.body.items.find((t: Json) => t.id === res.body.id);
      expect(Object.keys(mine).sort()).toEqual([
        "createdAt",
        "id",
        "lastUsedAt",
        "name",
        "prefix",
        "revokedAt",
        "scope",
      ]);
      expect(JSON.stringify(list.body)).not.toContain(token);
      expect(JSON.stringify(list.body)).not.toContain(sha(token));
    });

    it("the list is the signed-in person's own tokens, newest first, revoked ones included and marked", async () => {
      const a = await mint("member2", "first");
      const b = await mint("member2", "second", "read");
      await as("post", `/tokens/${a.id}/revoke`, "member2");
      await mint("viewer", "not member2's");
      const list = (await as("get", "/tokens", "member2")).body.items as Json[];
      expect(list.map((t) => t.name)).toEqual(["second", "first"]);
      expect(list[0]!.scope).toBe("read");
      expect(list[0]!.revokedAt).toBeNull();
      expect(list[1]!.revokedAt).not.toBeNull();
      expect(list.some((t) => t.id === b.id)).toBe(true);
    });

    it("a blank name, a name over 100 characters and a scope that is not read or read_write are 400s in the Portal's shape", async () => {
      const blank = await as("post", "/tokens", "member", { name: "   ", scope: "read" });
      expect(blank.status).toBe(400);
      expect(blank.body.message).toBe("Validation failed");
      expect(blank.body.errors).toEqual([{ path: "name", message: NAME_MSG }]);
      const long = await as("post", "/tokens", "member", {
        name: "x".repeat(101),
        scope: "read",
      });
      expect(long.status).toBe(400);
      expect(long.body.errors[0].path).toBe("name");
      const bad = await as("post", "/tokens", "member", { name: "ok", scope: "write" });
      expect(bad.status).toBe(400);
      expect(bad.body.errors[0].path).toBe("scope");
      const none = await as("post", "/tokens", "member", { name: "ok" });
      expect(none.status).toBe(400);
      expect(await db.apiToken.count({ where: { name: { in: ["ok", "   "] } } })).toBe(0);
    });

    it("making and revoking write audit events with who, what and the prefix, never the token", async () => {
      const t = await mint("member", "audited");
      await as("post", `/tokens/${t.id}/revoke`, "member");
      const rows = await db.auditLog.findMany({
        where: { entityType: "ApiToken", entityId: t.id },
        orderBy: { timestamp: "asc" },
      });
      expect(rows.map((r) => r.action)).toEqual([
        "api-token.created",
        "api-token.revoked",
      ]);
      expect(rows.every((r) => r.userId === uid["member"])).toBe(true);
      expect(rows[0]!.metadata).toMatchObject({
        name: "audited",
        scope: "read_write",
        prefix: t.prefix,
      });
      expect(rows[1]!.metadata).toMatchObject({
        ownerId: uid["member"],
        prefix: t.prefix,
      });
      expect(JSON.stringify(rows)).not.toContain(t.token);
    });

    it("revoking: the owner may; a revoked token stops working at once; revoking again changes nothing; someone else's token is a 404", async () => {
      const t = await mint("member", "to revoke");
      expect((await withToken("get", "/projects", t.token)).status).toBe(200);
      const res = await as("post", `/tokens/${t.id}/revoke`, "member");
      expect(res.status).toBe(200);
      expect(res.body.id).toBe(t.id);
      expect(res.body.revokedAt).not.toBeNull();
      expect(res.body.token).toBeUndefined();
      const gone = await withToken("get", "/projects", t.token);
      expect(gone.status).toBe(401);
      expect(gone.body.message).toBe(INVALID);
      const again = await as("post", `/tokens/${t.id}/revoke`, "member");
      expect(again.status).toBe(200);
      expect(again.body.revokedAt).toBe(res.body.revokedAt);
      // not yours: the same sentence as a token that does not exist
      const other = await mint("member2", "member2's");
      const nope = await as("post", `/tokens/${other.id}/revoke`, "member");
      expect(nope.status).toBe(404);
      expect(nope.body.message).toBe(TOKEN_NF);
      expect((await withToken("get", "/projects", other.token)).status).toBe(200);
      const none = await as("post", `/tokens/${randomUUID()}/revoke`, "member");
      expect(none.status).toBe(404);
      expect(none.body.message).toBe(TOKEN_NF);
    });

    it("a Super Admin lists every token of the firm (who owns it, never the token) and revokes any of them; another firm's Super Admin cannot", async () => {
      const t = await mint("member", "firm-visible");
      const list = await as("get", "/tokens/firm", "sa");
      expect(list.status).toBe(200);
      const hit = list.body.items.find((x: Json) => x.id === t.id);
      expect(hit).toMatchObject({
        name: "firm-visible",
        prefix: t.prefix,
        owner: {
          id: uid["member"],
          fullName: `${TAG} member`,
          email: `${TAG}-member@example.com`,
        },
      });
      expect(Object.keys(hit).sort()).toEqual([
        "createdAt",
        "id",
        "lastUsedAt",
        "name",
        "owner",
        "prefix",
        "revokedAt",
        "scope",
      ]);
      expect(JSON.stringify(list.body)).not.toContain(t.token);
      expect(JSON.stringify(list.body)).not.toContain(sha(t.token));
      // the other firm sees nothing of this firm's
      const theirs = await mint("sa2", "other firm");
      const seen = (await as("get", "/tokens/firm", "sa2")).body.items as Json[];
      expect(seen.map((x) => x.id)).toContain(theirs.id);
      expect(seen.map((x) => x.id)).not.toContain(t.id);
      expect(
        (await as("get", "/tokens/firm", "sa")).body.items.map((x: Json) => x.id),
      ).not.toContain(theirs.id);
      // revoke any token of the firm
      const revoked = await as("post", `/tokens/${t.id}/revoke`, "sa");
      expect(revoked.status).toBe(200);
      expect((await withToken("get", "/projects", t.token)).status).toBe(401);
      const audit = await db.auditLog.findMany({
        where: { entityId: t.id, action: "api-token.revoked" },
      });
      expect(audit[0]!.userId).toBe(uid["sa"]);
      expect(audit[0]!.metadata).toMatchObject({ ownerId: uid["member"] });
      // another firm's Super Admin cannot revoke it
      const t2 = await mint("member", "firm-visible 2");
      const foreign = await as("post", `/tokens/${t2.id}/revoke`, "sa2");
      expect(foreign.status).toBe(404);
      expect(foreign.body.message).toBe(TOKEN_NF);
    });

    it("anyone who is not a Super Admin is refused the firm list, in a sentence", async () => {
      for (const who of ["member", "viewer", "norole"]) {
        const res = await as("get", "/tokens/firm", who);
        expect(res.status).toBe(403);
        expect(res.body.message).toBe(SA_ONLY);
      }
    });

    it("a client user cannot make or list tokens, and nobody without a sign-in can", async () => {
      const make = await as("post", "/tokens", "clientUser", {
        name: "x",
        scope: "read",
      });
      expect(make.status).toBe(403);
      expect(make.body.message).toBe("This resource is available to firm staff only.");
      expect((await as("get", "/tokens", "clientUser")).status).toBe(403);
      expect((await http().get(`${API}/tokens`)).status).toBe(401);
      expect(
        (await http().post(`${API}/tokens`).send({ name: "x", scope: "read" })).status,
      ).toBe(401);
    });
  });

  // ======================================================================================
  describe("T2 · using a token", () => {
    it("a token acts as its user, with that user's permissions: Projects data is theirs to see, other data is not reachable at all", async () => {
      const t = await mint("member");
      const me = await withToken("get", "/projects", t.token);
      expect(me.status).toBe(200);
      const none = await mint("norole", "no permissions");
      const res = await withToken("get", "/projects", none.token);
      expect(res.status).toBe(403);
      expect(res.body.message).toBe(missing("Projects:Read"));
      // Projects:Configure is not held by a Member: the token does not gain it
      const cfg = await withToken("post", "/projects/admin/labels", t.token, {
        name: "nope",
        colour: "#112233",
      });
      expect(cfg.status).toBe(403);
      expect(cfg.body.message).toBe(missing("Projects:Configure"));
    });

    it("a read token reads and is refused on every write with one sentence", async () => {
      await project({ key: "RO1" });
      const t = await mint("member", "read only", "read");
      expect((await withToken("get", "/projects/RO1", t.token)).status).toBe(200);
      expect((await withToken("get", "/projects/RO1/issues", t.token)).status).toBe(200);
      for (const [m, path, body] of [
        ["post", "/projects/RO1/issues", { title: "x" }],
        ["patch", "/projects/RO1", { name: "x" }],
        ["post", "/projects/RO1/status-updates", { status: "ON_TRACK", note: "" }],
        ["post", "/projects/RO1/sessions", {}],
        ["post", "/projects", { key: "RO2", name: "x" }],
      ] as const) {
        const res = await withToken(m, path, t.token, body);
        expect(res.status).toBe(403);
        expect(res.body.message).toBe(READ_ONLY);
      }
      expect(await db.issue.count({ where: { project: { key: "RO1" } } })).toBe(0);
    });

    it("a user who holds only Projects:Read is read only whatever the token says", async () => {
      await project({ key: "VW1" });
      const t = await mint("viewer", "viewer asks for more", "read_write");
      expect(t.scope).toBe("read_write"); // the token says so; the user's permissions win
      expect((await withToken("get", "/projects/VW1", t.token)).status).toBe(200);
      const res = await withToken("post", "/projects/VW1/issues", t.token, {
        title: "x",
      });
      expect(res.status).toBe(403);
      expect(res.body.message).toBe(READ_ONLY);
      // a role that is changed later takes effect with the next call
      const role = await makeRole(`${TAG} promoted`, [
        "Projects:Read",
        "Projects:Create",
        "Projects:Update",
      ]);
      await db.userRole.create({ data: { userId: uid["viewer"]!, roleId: role } });
      const ok = await withToken("post", "/projects/VW1/issues", t.token, {
        title: "now",
      });
      expect(ok.status).toBe(201);
      await db.userRole.deleteMany({ where: { userId: uid["viewer"]!, roleId: role } });
      const again = await withToken("post", "/projects/VW1/issues", t.token, {
        title: "x",
      });
      expect(again.status).toBe(403);
      expect(again.body.message).toBe(READ_ONLY);
    });

    it("a client user, a disabled user and an unknown or malformed token are all refused with the same sentence", async () => {
      // a client user cannot make a token, but a row could exist: it is still refused
      const forged = `ppt_${"A".repeat(43)}`;
      await db.apiToken.create({
        data: {
          firmId,
          userId: uid["clientUser"]!,
          name: "forged",
          scope: "read_write",
          tokenHash: sha(forged),
          prefix: forged.slice(0, 10),
        },
      });
      for (const bad of [
        forged,
        `ppt_${"B".repeat(43)}`,
        "ppt_short",
        "spk_" + "C".repeat(43),
        "not-a-token",
      ]) {
        const res = await withToken("get", "/projects", bad);
        expect(res.status).toBe(401);
        expect(res.body.message).toBe(
          bad.startsWith("ppt_") ? INVALID : "Invalid or expired token",
        );
      }
      // a disabled user
      await makeUser("leaver", {
        roleId: (await db.role.findFirstOrThrow({ where: { name: `${TAG} PA3 Member` } }))
          .id,
      });
      const t = await mint("leaver");
      expect((await withToken("get", "/projects", t.token)).status).toBe(200);
      await db.user.update({
        where: { id: uid["leaver"]! },
        data: { status: "DISABLED" },
      });
      const res = await withToken("get", "/projects", t.token);
      expect(res.status).toBe(401);
      expect(res.body.message).toBe(INVALID);
    });

    it("lastUsedAt is set on use, and is not rewritten again within a minute", async () => {
      const t = await mint("member", "used");
      const before = await db.apiToken.findUniqueOrThrow({ where: { id: t.id } });
      expect(before.lastUsedAt).toBeNull();
      await withToken("get", "/projects", t.token);
      const first = (await db.apiToken.findUniqueOrThrow({ where: { id: t.id } }))
        .lastUsedAt;
      expect(first).not.toBeNull();
      await withToken("get", "/projects", t.token);
      const second = (await db.apiToken.findUniqueOrThrow({ where: { id: t.id } }))
        .lastUsedAt;
      expect(second!.getTime()).toBe(first!.getTime());
      // two minutes later it moves
      await db.apiToken.update({
        where: { id: t.id },
        data: { lastUsedAt: new Date(Date.now() - 120_000) },
      });
      await withToken("get", "/projects", t.token);
      const third = (await db.apiToken.findUniqueOrThrow({ where: { id: t.id } }))
        .lastUsedAt;
      expect(third!.getTime()).toBeGreaterThan(Date.now() - 20_000);
    });

    it("a token works on the Projects routes only: it cannot reach the token routes, notifications, clients or anything else", async () => {
      const t = await mint("sa", "super admin's");
      for (const [m, path] of [
        ["get", "/tokens"],
        ["get", "/tokens/firm"],
        ["post", "/tokens"],
        ["get", "/notifications"],
        ["get", "/clients"],
        ["get", "/users"],
        ["get", "/mcp-connector"],
      ] as const) {
        const res = await withToken(
          m,
          path,
          t.token,
          m === "post" ? { name: "x", scope: "read" } : undefined,
        );
        expect(res.status).toBe(403);
        expect(res.body.message).toBe(NOT_HERE);
      }
      expect(await db.apiToken.count({ where: { name: "x" } })).toBe(0);
    });

    it("the Portal's own sign-in keeps working on the Projects routes, tagged as the web", async () => {
      await project({ key: "WEB1" });
      const res = await as("post", "/projects/WEB1/issues", "member", {
        title: "from the web",
      });
      expect(res.status).toBe(201);
      const act = await db.projectActivity.findFirstOrThrow({
        where: { issue: { key: res.body.key } },
      });
      expect(act).toMatchObject({ actorType: "USER", channel: "web", sessionId: null });
    });
  });

  // ======================================================================================
  describe("T3 · REST with a token", () => {
    it("changes made with a token are written as USER through the api channel, as the token's user", async () => {
      await project({ key: "API1" });
      const t = await mint("member");
      const res = await withToken("post", "/projects/API1/issues", t.token, {
        title: "from a script",
      });
      expect(res.status).toBe(201);
      const comment = await withToken(
        "post",
        `/projects/API1/issues/${res.body.key}/comments`,
        t.token,
        { body: "a note" },
      );
      expect(comment.status).toBe(201);
      const acts = await db.projectActivity.findMany({
        where: { issue: { key: res.body.key } },
      });
      expect(acts.length).toBeGreaterThanOrEqual(2);
      for (const a of acts) {
        expect(a).toMatchObject({
          actorType: "USER",
          channel: "api",
          actorUserId: uid["member"],
          sessionId: null,
        });
      }
      // the web's activity route says the same
      const feed = await as("get", "/projects/API1/activity", "sa");
      expect(feed.body.items[0]).toMatchObject({ actorType: "USER", channel: "api" });
    });

    it("client visibility and tenants hold: a token never sees what its user cannot", async () => {
      await project({ key: "HID1", clientId });
      const t = await mint("member");
      const res = await withToken("get", "/projects/HID1", t.token);
      expect(res.status).toBe(404);
      const seen = await withToken("get", "/projects", t.token);
      expect((seen.body as Json[]).map((p) => p.key)).not.toContain("HID1");
      const ok = await mint("memberAssigned");
      expect((await withToken("get", "/projects/HID1", ok.token)).status).toBe(200);
      const foreign = await mint("sa2");
      expect((await withToken("get", "/projects/HID1", foreign.token)).status).toBe(404);
    });

    it("the PA1 and PA2 routes answer the same with a token as with the sign-in (board, roadmap, my-work, search)", async () => {
      await project({ key: "SAM1" });
      const issue = (await as("post", "/projects/SAM1/issues", "sa", { title: "Same" }))
        .body;
      const t = await mint("sa", "same answers");
      for (const path of [
        "/projects/SAM1",
        "/projects/SAM1/issues",
        `/projects/SAM1/issues/${issue.key}`,
        "/projects/SAM1/board",
        "/projects/SAM1/roadmap",
        "/projects/my-work",
        `/projects/search?q=${issue.key}`,
        "/projects/meta",
      ]) {
        const viaJwt = await as("get", path, "sa");
        const viaToken = await withToken("get", path, t.token);
        expect(viaToken.status).toBe(viaJwt.status);
        expect(JSON.stringify(viaToken.body)).toBe(JSON.stringify(viaJwt.body));
      }
    });
  });

  // ======================================================================================
  describe("T4 · work sessions", () => {
    it("start: POST /projects/:key/sessions answers the session and the briefing; the changes after it carry the session", async () => {
      await project({ key: "SES1" });
      const t = await mint("member", "session maker");
      const start = await withToken("post", "/projects/SES1/sessions", t.token, {
        title: "Wire the export",
      });
      expect(start.status).toBe(201);
      expect(Object.keys(start.body).sort()).toEqual(["briefing", "session"]);
      const s = start.body.session as Json;
      expect(Object.keys(s).sort()).toEqual([
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
      expect(s).toMatchObject({
        projectKey: "SES1",
        title: "Wire the export",
        client: "rest",
        endedAt: null,
        summary: "",
        nextSteps: "",
        issueKeys: [],
        user: { id: uid["member"], fullName: `${TAG} member` },
      });
      expect(start.body.briefing).toContain("# SES1: Project SES1");
      const row = await db.projectWorkSession.findUniqueOrThrow({ where: { id: s.id } });
      expect(row).toMatchObject({ userId: uid["member"], tokenId: t.id, firmId });
      // a started activity row, tagged with the session
      const started = await db.projectActivity.findFirstOrThrow({
        where: { sessionId: s.id, action: "session.started" },
      });
      expect(started).toMatchObject({ actorType: "USER", channel: "api" });

      // changes made with the session id are tagged and add their key, once
      const hdr = { "x-portal-session": s.id };
      const a = await withToken(
        "post",
        "/projects/SES1/issues",
        t.token,
        { title: "One" },
        hdr,
      );
      const b = await withToken(
        "post",
        "/projects/SES1/issues",
        t.token,
        { title: "Two" },
        hdr,
      );
      await withToken(
        "post",
        `/projects/SES1/issues/${a.body.key}/comments`,
        t.token,
        { body: "n" },
        hdr,
      );
      await withToken(
        "patch",
        `/projects/SES1/issues/${b.body.key}`,
        t.token,
        { priority: "HIGH" },
        hdr,
      );
      await withToken(
        "patch",
        `/projects/SES1/issues/${a.body.key}`,
        t.token,
        { priority: "LOW" },
        hdr,
      );
      const after = await db.projectWorkSession.findUniqueOrThrow({
        where: { id: s.id },
      });
      expect(after.issueKeys).toEqual([a.body.key, b.body.key]);
      const tagged = await db.projectActivity.findMany({
        where: { sessionId: s.id, issueId: { not: null } },
      });
      expect(tagged.length).toBeGreaterThanOrEqual(5);
      // a change without the header is not tagged
      const plain = await withToken("post", "/projects/SES1/issues", t.token, {
        title: "No session",
      });
      const untagged = await db.projectActivity.findFirstOrThrow({
        where: { issue: { key: plain.body.key } },
      });
      expect(untagged.sessionId).toBeNull();
      expect(
        (await db.projectWorkSession.findUniqueOrThrow({ where: { id: s.id } }))
          .issueKeys,
      ).toEqual([a.body.key, b.body.key]);
    });

    it("start for the repo kit's hook: POST /projects/sessions/start { project_key } with ?briefing=1 answers the briefing, without it does not", async () => {
      await project({ key: "SES2" });
      const t = await mint("member");
      const withBrief = await withToken(
        "post",
        "/projects/sessions/start?briefing=1",
        t.token,
        { project_key: "SES2" },
        { "x-portal-client": "claude-code" },
      );
      expect(withBrief.status).toBe(201);
      expect(withBrief.body.session.client).toBe("claude-code");
      expect(withBrief.body.session.projectKey).toBe("SES2");
      expect(typeof withBrief.body.session.id).toBe("string");
      expect(withBrief.body.briefing).toContain("# SES2:");
      const plain = await withToken("post", "/projects/sessions/start", t.token, {
        project_key: "SES2",
        title: "no briefing",
      });
      expect(plain.status).toBe(201);
      expect(plain.body.briefing).toBeUndefined();
      expect(plain.body.session.title).toBe("no briefing");
      // a project that does not exist, a key that is not a key, and a missing key
      const nope = await withToken("post", "/projects/sessions/start", t.token, {
        project_key: "NOPE",
      });
      expect(nope.status).toBe(404);
      const none = await withToken("post", "/projects/sessions/start", t.token, {});
      expect(none.status).toBe(400);
      expect(none.body.message).toBe("Validation failed");
    });

    it("end saves the summary and next steps and adds the issue keys named in them; the next briefing shows them", async () => {
      await project({ key: "SES3" });
      const t = await mint("member");
      const i1 = (
        await withToken("post", "/projects/SES3/issues", t.token, { title: "Mentioned" })
      ).body;
      const i2 = (
        await withToken("post", "/projects/SES3/issues", t.token, { title: "Later" })
      ).body;
      const s = (await withToken("post", "/projects/SES3/sessions", t.token, {})).body
        .session;
      const end = await withToken("post", `/projects/sessions/${s.id}/end`, t.token, {
        summary: `Finished ${i1.key}.`,
        nextSteps: `Start ${i2.key} and ask about NOPE-99.`,
      });
      expect(end.status).toBe(200);
      expect(end.body.session).toMatchObject({
        id: s.id,
        summary: `Finished ${i1.key}.`,
        nextSteps: `Start ${i2.key} and ask about NOPE-99.`,
        issueKeys: [i1.key, i2.key], // NOPE-99 is not an issue of this firm
      });
      expect(end.body.session.endedAt).not.toBeNull();
      const ended = await db.projectActivity.findFirstOrThrow({
        where: { sessionId: s.id, action: "session.ended" },
      });
      expect(ended.changes).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ field: "summary", new: `Finished ${i1.key}.` }),
        ]),
      );
      const brief = await withToken("get", "/projects/SES3/context", t.token);
      expect(brief.status).toBe(200);
      expect(brief.text).toContain("## Recent Claude sessions");
      expect(brief.text).toContain(`Finished ${i1.key}.`);
      expect(brief.text).toContain(`  Next: Start ${i2.key} and ask about NOPE-99.`);
      // ending again overwrites, as in Sentire Projects
      const again = await withToken("post", `/projects/sessions/${s.id}/end`, t.token, {
        summary: "Second thoughts.",
      });
      expect(again.status).toBe(200);
      expect(again.body.session.summary).toBe("Second thoughts.");
      expect(again.body.session.nextSteps).toBe("");
    });

    it("end refuses a blank summary, and a session that is not yours or does not exist is a 404", async () => {
      await project({ key: "SES4" });
      const t = await mint("member");
      const s = (await withToken("post", "/projects/SES4/sessions", t.token, {})).body
        .session;
      const blank = await withToken("post", `/projects/sessions/${s.id}/end`, t.token, {
        summary: "  ",
      });
      expect(blank.status).toBe(400);
      expect(blank.body.errors).toEqual([{ path: "summary", message: SUMMARY_MSG }]);
      const t2 = await mint("member2");
      const theirs = await withToken("post", `/projects/sessions/${s.id}/end`, t2.token, {
        summary: "mine now",
      });
      expect(theirs.status).toBe(404);
      expect(theirs.body.message).toBe(SESSION_NF);
      const t3 = await mint("sa2");
      const foreign = await withToken(
        "post",
        `/projects/sessions/${s.id}/end`,
        t3.token,
        { summary: "x" },
      );
      expect(foreign.status).toBe(404);
      const lost = await withToken(
        "post",
        `/projects/sessions/${randomUUID()}/end`,
        t.token,
        { summary: "x" },
      );
      expect(lost.status).toBe(404);
      expect(lost.body.message).toBe(SESSION_NF);
      const notUuid = await withToken("post", "/projects/sessions/nope/end", t.token, {
        summary: "x",
      });
      expect(notUuid.status).toBe(404);
      expect(notUuid.body.message).toBe(SESSION_NF);
      expect(
        (await db.projectWorkSession.findUniqueOrThrow({ where: { id: s.id } })).endedAt,
      ).toBeNull();
    });

    it("a session id that is not the caller's is ignored: the change is made, untagged, and the session does not move", async () => {
      await project({ key: "SES5" });
      const t = await mint("member");
      const t2 = await mint("member2");
      const s = (await withToken("post", "/projects/SES5/sessions", t.token, {})).body
        .session;
      const res = await withToken(
        "post",
        "/projects/SES5/issues",
        t2.token,
        { title: "Borrowed" },
        { "x-portal-session": s.id },
      );
      expect(res.status).toBe(201);
      const act = await db.projectActivity.findFirstOrThrow({
        where: { issue: { key: res.body.key } },
      });
      expect(act.sessionId).toBeNull();
      const junk = await withToken(
        "post",
        "/projects/SES5/issues",
        t.token,
        { title: "Junk id" },
        { "x-portal-session": "not-a-uuid" },
      );
      expect(junk.status).toBe(201);
      expect(
        (await db.projectWorkSession.findUniqueOrThrow({ where: { id: s.id } }))
          .issueKeys,
      ).toEqual([]);
    });

    it("a read token, a Viewer and a user without Projects:Update cannot start or end a session", async () => {
      await project({ key: "SES6" });
      const ro = await mint("member", "ro", "read");
      const r1 = await withToken("post", "/projects/SES6/sessions", ro.token, {});
      expect(r1.status).toBe(403);
      expect(r1.body.message).toBe(READ_ONLY);
      const r2 = await withToken("post", "/projects/sessions/start", ro.token, {
        project_key: "SES6",
      });
      expect(r2.status).toBe(403);
      expect(r2.body.message).toBe(READ_ONLY);
      const own = (
        await withToken(
          "post",
          "/projects/SES6/sessions",
          (await mint("member")).token,
          {},
        )
      ).body.session;
      const r3 = await withToken("post", `/projects/sessions/${own.id}/end`, ro.token, {
        summary: "x",
      });
      expect(r3.status).toBe(403);
      expect(r3.body.message).toBe(READ_ONLY);
      const vw = await mint("viewer");
      const r4 = await withToken("post", "/projects/SES6/sessions", vw.token, {});
      expect(r4.status).toBe(403);
      expect(r4.body.message).toBe(READ_ONLY);
      // the web's own sign-in may start one, tagged as the web
      const web = await as("post", "/projects/SES6/sessions", "member", {});
      expect(web.status).toBe(201);
      expect(web.body.session.client).toBe("web");
      expect(
        await db.projectActivity.count({
          where: { sessionId: web.body.session.id, channel: "web" },
        }),
      ).toBe(1);
      // a hidden client project: a 404 for someone who cannot see it
      await project({ key: "SES7", clientId });
      const hidden = await withToken(
        "post",
        "/projects/SES7/sessions",
        (await mint("member")).token,
        {},
      );
      expect(hidden.status).toBe(404);
    });
  });

  // ======================================================================================
  describe("T5 · the briefing and the repo kit", () => {
    it("GET /projects/:key/context is markdown: the project, milestones with progress, in progress, to do, sessions, activity", async () => {
      await project({ key: "CTX1", name: "Context project", description: "About it." });
      const ms = (
        await as("post", "/projects/CTX1/milestones", "sa", {
          name: "Beta",
          dueDate: "2026-12-31",
        })
      ).body;
      const a = (
        await as("post", "/projects/CTX1/issues", "sa", {
          title: "Done one",
          milestoneId: ms.id,
          statusId: st["Done"],
        })
      ).body;
      const b = (
        await as("post", "/projects/CTX1/issues", "sa", {
          title: "Going",
          milestoneId: ms.id,
          statusId: st["In progress"],
          priority: "HIGH",
        })
      ).body;
      const c = (
        await as("post", "/projects/CTX1/issues", "sa", {
          title: "Waiting",
          priority: "URGENT",
        })
      ).body;
      await as("post", "/projects/CTX1/status-updates", "sa", {
        status: "AT_RISK",
        note: "Late data",
      });
      const res = await as("get", "/projects/CTX1/context", "viewer");
      expect(res.status).toBe(200);
      expect(res.headers["content-type"]).toMatch(/^text\/markdown; charset=utf-8/);
      const md = res.text;
      expect(md.split("\n")[0]).toBe("# CTX1: Context project");
      expect(md).toContain("About it.");
      expect(md).toContain('Status: At risk, "Late data"');
      expect(md).toContain("- Beta due 2026-12-31: 1/2 done (50%)");
      expect(md).toContain(`- ${b.key} [In progress] HIGH Going (ms: Beta)`);
      expect(md).toContain(`- ${c.key} [New] URGENT Waiting`);
      expect(md).not.toContain(`${a.key} [Done]`); // finished work is not a to-do
      expect(md).toContain("## Recent activity");
      expect(md).toMatch(/- \d{4}-\d{2}-\d{2} \d{2}:\d{2} .+: /);
      expect(md).not.toContain("## Recent Claude sessions"); // none yet
    });

    it("the briefing needs Projects:Read, hides a client project from someone who cannot see it, and is a 404 across firms", async () => {
      await project({ key: "CTX2", clientId });
      const nop = await as("get", "/projects/CTX2/context", "norole");
      expect(nop.status).toBe(403);
      expect(nop.body.message).toBe(missing("Projects:Read"));
      expect((await as("get", "/projects/CTX2/context", "member")).status).toBe(404);
      expect((await as("get", "/projects/CTX2/context", "memberAssigned")).status).toBe(
        200,
      );
      expect((await as("get", "/projects/CTX2/context", "sa2")).status).toBe(404);
      expect((await as("get", "/projects/NOPE/context", "sa")).status).toBe(404);
    });

    it("the repo kit is the five files of Track C's helper for this project and this Portal's address, and holds no secret", async () => {
      await project({ key: "KIT1" });
      const res = await as("get", "/projects/KIT1/repo-kit", "member");
      expect(res.status).toBe(200);
      expect(Object.keys(res.body).sort()).toEqual([
        "files",
        "projectKey",
        "serverUrl",
        "tokenEnvVar",
      ]);
      expect(res.body).toMatchObject({
        projectKey: "KIT1",
        serverUrl: "https://portal.example.test",
        tokenEnvVar: "PORTAL_PROJECTS_TOKEN",
      });
      const files = Object.fromEntries(
        res.body.files.map((f: Json) => [f.path, f.content]),
      );
      expect(Object.keys(files).sort()).toEqual([
        ".claude/hooks/portal-projects-session-start.mjs",
        ".claude/settings.json",
        ".mcp.json",
        ".sentire-projects.json",
        "CLAUDE.md",
      ]);
      expect(JSON.parse(files[".sentire-projects.json"])).toEqual({
        project: "KIT1",
        server: "https://portal.example.test",
      });
      expect(JSON.parse(files[".mcp.json"]).mcpServers["portal-projects"]).toEqual({
        type: "http",
        url: "https://portal.example.test/api/v1/projects/mcp",
        headers: { Authorization: "Bearer ${PORTAL_PROJECTS_TOKEN}" },
      });
      expect(files[".claude/hooks/portal-projects-session-start.mjs"]).toContain(
        "/api/v1/projects/sessions/start",
      );
      // no token, no hash, no secret of any kind
      const all = JSON.stringify(res.body);
      expect(all).not.toMatch(/ppt_[A-Za-z0-9_-]{20}/);
      expect(all).not.toMatch(/[0-9a-f]{64}/);
      expect(all).not.toMatch(/MCP_SHARED_SECRET|JWT_|password/i);
    });

    it("without API_PUBLIC_URL the address is taken from the request's forwarded headers; a plain http address is refused in a sentence", async () => {
      await project({ key: "KIT2" });
      delete process.env.API_PUBLIC_URL;
      try {
        const fwd = await as("get", "/projects/KIT2/repo-kit", "member").set({
          "x-forwarded-proto": "https",
          "x-forwarded-host": "api.example.test",
        });
        expect(fwd.status).toBe(200);
        expect(fwd.body.serverUrl).toBe("https://api.example.test");
        const plain = await as("get", "/projects/KIT2/repo-kit", "member").set({
          "x-forwarded-proto": "http",
          "x-forwarded-host": "api.example.test",
        });
        expect(plain.status).toBe(409);
        expect(plain.body.message).toBe(
          "The server address must start with https:// (http:// is allowed only for localhost).",
        );
      } finally {
        process.env.API_PUBLIC_URL = "https://portal.example.test";
      }
    });

    it("the repo kit needs Projects:Read and follows visibility", async () => {
      await project({ key: "KIT3", clientId });
      expect((await as("get", "/projects/KIT3/repo-kit", "norole")).status).toBe(403);
      expect((await as("get", "/projects/KIT3/repo-kit", "member")).status).toBe(404);
      expect((await as("get", "/projects/KIT3/repo-kit", "memberAssigned")).status).toBe(
        200,
      );
      const t = await mint("memberAssigned", "kit via token", "read");
      expect((await withToken("get", "/projects/KIT3/repo-kit", t.token)).status).toBe(
        200,
      );
    });
  });
});
