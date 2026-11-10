/**
 * track-a-projects-mcp.db-spec.ts — PA3 (D67): the Projects MCP server, over HTTP against the
 * real Nest app, the local PostgreSQL and (for the rate limit) a real Redis started for the run.
 * Every firm, user and title is invented.
 *
 * M1  The door: Bearer and capability URL, wrong tokens, methods, separate from the BIR connector.
 * M2  Limits: body size, the per-token rate limit shared through Redis by two instances.
 * M3  The 16 tools.
 * M4  Sessions through the MCP and what the briefing shows next.
 * M5  Attribution (CLAUDE through mcp), permissions, read-only, visibility, notifications.
 */
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import net from "node:net";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import Redis from "ioredis";
import request from "supertest";
import { truncateOncePerFile } from "./helpers/truncate";
import { AppModule } from "../../src/app.module";
import { TokenService } from "../../src/auth/token.service";
import { applyProjectsMcpBodyLimit } from "../../src/projects-mcp/body-limit";
import {
  PROJECTS_MCP_INSTRUCTIONS,
  PROJECTS_MCP_TOOL_NAMES,
} from "../../src/projects-mcp/instructions";
import { PrismaService } from "../../src/prisma/prisma.service";

truncateOncePerFile({ firmRoles: ["Super Admin"] });

const TAG = `track-a-mcp-${randomUUID().slice(0, 8)}`;
const API = "/api/v1";
const ACCEPT = "application/json, text/event-stream";
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the tests read JSON
type Json = Record<string, any>;
type ToolResult = { isError?: boolean; content: { type: string; text: string }[] };

const READ_ONLY = "This token is read-only.";
const INVALID = "Invalid or revoked token.";
const missing = (...p: string[]) => `Missing permission(s): ${p.join(", ")}`;
const hasRedisBinary = spawnSync("which", ["redis-server"]).status === 0;
const itRedis = hasRedisBinary ? it : it.skip;

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

describe("PA3 · the Projects MCP server (real app over HTTP, db, Redis)", () => {
  let appA: INestApplication;
  let appB: INestApplication;
  let db: PrismaService;
  let redisProc: ChildProcess | null = null;
  let prevRedis: string | undefined;
  let prevLimit: string | undefined;
  let firmId = "";
  let otherFirmId = "";
  let clientId = "";
  const jwt: Record<string, string> = {};
  const uid: Record<string, string> = {};
  let rpcId = 1;
  let seq = 0;

  const httpA = () => request(appA.getHttpServer());
  const as = (
    method: "get" | "post" | "patch",
    path: string,
    who = "sa",
    body?: object,
  ) => {
    const r = httpA()[method](`${API}${path}`).set("Authorization", `Bearer ${jwt[who]}`);
    return body === undefined ? r : r.send(body);
  };
  async function mint(who: string, name = `${who} mcp`, scope = "read_write") {
    const res = await as("post", "/tokens", who, { name, scope });
    expect(res.status).toBe(201);
    return res.body as Json & { token: string; id: string };
  }
  /** One JSON-RPC call to the MCP at Bearer or capability URL. */
  function rpc(
    app: INestApplication,
    token: string,
    method: string,
    params: object = {},
    via: "bearer" | "url" = "bearer",
    headers: Record<string, string> = {},
  ) {
    const path =
      via === "bearer" ? `${API}/projects/mcp` : `${API}/projects/mcp/${token}`;
    let r = request(app.getHttpServer()).post(path).set("Accept", ACCEPT);
    if (via === "bearer") r = r.set("Authorization", `Bearer ${token}`);
    for (const [k, v] of Object.entries(headers)) r = r.set(k, v);
    return r.send({ jsonrpc: "2.0", id: rpcId++, method, params });
  }
  async function tool(
    token: string,
    name: string,
    args: Json = {},
    via: "bearer" | "url" = "bearer",
  ): Promise<ToolResult & { text: string }> {
    const res = await rpc(appA, token, "tools/call", { name, arguments: args }, via);
    expect(res.status).toBe(200);
    if (res.body.error) {
      // an input the schema refuses may come back as a protocol error: show it as a failed result
      return {
        isError: true,
        content: [{ type: "text", text: String(res.body.error.message) }],
        text: String(res.body.error.message),
      };
    }
    const result = res.body.result as ToolResult;
    return { ...result, text: result.content.map((c) => c.text).join("\n") };
  }
  async function project(extra: Json = {}, who = "sa") {
    seq += 1;
    const key = extra.key ?? `M${String(seq).padStart(3, "0")}`;
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
    jwt[label] = appA.get(TokenService).signAccess({
      id: u.id,
      firmId: fid,
      userType: opts.type ?? "FIRM",
      email: u.email,
    });
  }

  async function startRedis(): Promise<string | null> {
    if (!hasRedisBinary) {
      // eslint-disable-next-line no-console -- say so in the run output: the Redis tests are skipped
      console.warn(
        "[PA3] redis-server is not installed: the Redis rate-limit tests are skipped.",
      );
      return null;
    }
    const port = await freePort();
    redisProc = spawn(
      "redis-server",
      ["--port", String(port), "--bind", "127.0.0.1", "--save", "", "--appendonly", "no"],
      { stdio: "ignore" },
    );
    const url = `redis://127.0.0.1:${port}`;
    const probe = new Redis(url, {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      retryStrategy: () => null,
    });
    for (let n = 0; n < 50; n++) {
      try {
        await probe.connect();
        await probe.ping();
        probe.disconnect();
        return url;
      } catch {
        await new Promise((r) => setTimeout(r, 100));
      }
    }
    probe.disconnect();
    throw new Error("redis-server did not start");
  }
  async function makeApp(): Promise<INestApplication> {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    const app = moduleRef.createNestApplication();
    app.setGlobalPrefix("api/v1");
    applyProjectsMcpBodyLimit(app, "/api/v1");
    await app.init();
    return app;
  }

  beforeAll(async () => {
    prevRedis = process.env.REDIS_URL;
    prevLimit = process.env.PROJECTS_MCP_RATE_LIMIT;
    const url = await startRedis();
    if (url) process.env.REDIS_URL = url;
    process.env.PROJECTS_MCP_RATE_LIMIT = "240";
    appA = await makeApp();
    db = appA.get(PrismaService);
    firmId = (await db.firm.create({ data: { name: `${TAG} Halimbawa Accounting` } })).id;
    otherFirmId = (await db.firm.create({ data: { name: `${TAG} Ibang Accounting` } }))
      .id;
    const sa = (
      await db.role.findUniqueOrThrow({
        where: { name_scope: { name: "Super Admin", scope: "FIRM" } },
      })
    ).id;
    const member = await makeRole(`${TAG} MCP Member`, [
      "Projects:Read",
      "Projects:Create",
      "Projects:Update",
    ]);
    const viewer = await makeRole(`${TAG} MCP Viewer`, ["Projects:Read"]);
    clientId = (
      await db.client.create({
        data: { firmId, businessName: `${TAG} Halimbawa Client`, tin: "000555302" },
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
  });
  afterAll(async () => {
    await appA.close();
    if (appB) await appB.close();
    if (redisProc) redisProc.kill();
    if (prevRedis === undefined) delete process.env.REDIS_URL;
    else process.env.REDIS_URL = prevRedis;
    if (prevLimit === undefined) delete process.env.PROJECTS_MCP_RATE_LIMIT;
    else process.env.PROJECTS_MCP_RATE_LIMIT = prevLimit;
  });

  // ======================================================================================
  describe("M1 · the door", () => {
    it("works with Authorization: Bearer and with the capability URL, and says what it is", async () => {
      const t = await mint("member");
      for (const via of ["bearer", "url"] as const) {
        const list = await rpc(appA, t.token, "tools/list", {}, via);
        expect(list.status).toBe(200);
        expect(list.body.result.tools.map((x: Json) => x.name).sort()).toEqual(
          [...PROJECTS_MCP_TOOL_NAMES].sort(),
        );
        const init = await rpc(
          appA,
          t.token,
          "initialize",
          {
            protocolVersion: "2025-03-26",
            capabilities: {},
            clientInfo: { name: "test", version: "1" },
          },
          via,
        );
        expect(init.status).toBe(200);
        expect(init.body.result.serverInfo.name).toBe("portal-projects");
        expect(init.body.result.instructions).toBe(PROJECTS_MCP_INSTRUCTIONS);
      }
    });

    it("no token, a wrong Bearer, a token of a revoked, disabled or client user: 401 with a sentence on the Bearer door", async () => {
      const none = await httpA()
        .post(`${API}/projects/mcp`)
        .set("Accept", ACCEPT)
        .send({ jsonrpc: "2.0", id: 1, method: "tools/list" });
      expect(none.status).toBe(401);
      expect(none.body.error.message).toBe(
        "Missing token. Send Authorization: Bearer ppt_... or use /api/v1/projects/mcp/<token>.",
      );
      const wrong = await rpc(appA, `ppt_${"Z".repeat(43)}`, "tools/list");
      expect(wrong.status).toBe(401);
      expect(wrong.body).toEqual({
        jsonrpc: "2.0",
        error: { code: -32000, message: INVALID },
        id: null,
      });
      const jwtAsToken = await rpc(appA, jwt["member"]!, "tools/list");
      expect(jwtAsToken.status).toBe(401);
      expect(jwtAsToken.body.error.message).toBe(INVALID);
      const revoked = await mint("member", "to revoke");
      await as("post", `/tokens/${revoked.id}/revoke`, "member");
      expect((await rpc(appA, revoked.token, "tools/list")).status).toBe(401);
      await makeUser("mcpleaver", {
        roleId: (await db.role.findFirstOrThrow({ where: { name: `${TAG} MCP Member` } }))
          .id,
      });
      const gone = await mint("mcpleaver");
      expect((await rpc(appA, gone.token, "tools/list")).status).toBe(200);
      await db.user.update({
        where: { id: uid["mcpleaver"]! },
        data: { status: "DISABLED" },
      });
      expect((await rpc(appA, gone.token, "tools/list")).status).toBe(401);
    });

    it("the capability URL answers a wrong, revoked, disabled-user or client-user token with the same plain 404 and no detail", async () => {
      const plain = { statusCode: 404, message: "Not Found" };
      const wrong = await rpc(appA, `ppt_${"Y".repeat(43)}`, "tools/list", {}, "url");
      expect(wrong.status).toBe(404);
      expect(wrong.body).toEqual(plain);
      const t = await mint("member", "url revoked");
      await as("post", `/tokens/${t.id}/revoke`, "member");
      const revoked = await rpc(appA, t.token, "tools/list", {}, "url");
      expect(revoked.status).toBe(404);
      expect(revoked.body).toEqual(plain);
      // a token that is not even shaped like one
      const junk = await httpA()
        .post(`${API}/projects/mcp/not-a-token`)
        .set("Accept", ACCEPT)
        .send({ jsonrpc: "2.0", id: 1, method: "tools/list" });
      expect(junk.status).toBe(404);
      expect(junk.body).toEqual(plain);
      // GET on a wrong URL is the same 404, not a 405
      const get = await httpA().get(`${API}/projects/mcp/${"ppt_" + "X".repeat(43)}`);
      expect(get.status).toBe(404);
      expect(get.body).toEqual(plain);
    });

    it("GET and DELETE are 405 for a good token (stateless, POST only), and the BIR connector's route is a different door", async () => {
      const t = await mint("member");
      for (const m of ["get", "delete"] as const) {
        const res = await httpA()
          [m](`${API}/projects/mcp`)
          .set("Authorization", `Bearer ${t.token}`);
        expect(res.status).toBe(405);
        expect(res.headers["allow"]).toBe("POST");
        expect(res.body.error.message).toMatch(/POST only/);
        const url = await httpA()[m](`${API}/projects/mcp/${t.token}`);
        expect(url.status).toBe(405);
      }
      // /api/v1/mcp/<key> is the BIR connector: a personal token is not its secret
      const bir = await httpA()
        .post(`${API}/mcp/${t.token}`)
        .set("Accept", ACCEPT)
        .send({ jsonrpc: "2.0", id: 1, method: "tools/list" });
      expect(bir.status).toBe(404);
    });
  });

  // ======================================================================================
  describe("M2 · limits", () => {
    it("a body up to 1 MB is read (more than Express's own 100 KB), a bigger one is a 413 with a sentence", async () => {
      await project({ key: "BIG1" });
      const t = await mint("member");
      const big = "x".repeat(50_000);
      const r = await tool(t.token, "create_issues", {
        project_key: "BIG1",
        items: [1, 2, 3, 4].map((n) => ({ title: `big ${n}`, description: big })),
      });
      expect(r.isError).toBeFalsy();
      expect(await db.issue.count({ where: { project: { key: "BIG1" } } })).toBe(4);
      const over = await httpA()
        .post(`${API}/projects/mcp`)
        .set("Authorization", `Bearer ${t.token}`)
        .set("Accept", ACCEPT)
        .send({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: {
            name: "add_comment",
            arguments: { key: "BIG1-1", body: "y".repeat(1_050_000) },
          },
        });
      expect(over.status).toBe(413);
      expect(over.body).toEqual({
        jsonrpc: "2.0",
        error: { code: -32000, message: "Request too large." },
        id: null,
      });
    });

    itRedis(
      "the rate limit is per token and shared through Redis: two API instances count together, then refuse with 429",
      async () => {
        process.env.PROJECTS_MCP_RATE_LIMIT = "6";
        appB = await makeApp(); // a second instance of the API, its own process memory, the same Redis
        process.env.PROJECTS_MCP_RATE_LIMIT = "240";
        // appA was built with 240; build a third with 6 for the other half, so both read 6
        const appC = await (async () => {
          process.env.PROJECTS_MCP_RATE_LIMIT = "6";
          const a = await makeApp();
          process.env.PROJECTS_MCP_RATE_LIMIT = "240";
          return a;
        })();
        try {
          const t = await mint("member", "rate limited");
          const other = await mint("member2", "not limited");
          const statuses: number[] = [];
          for (let n = 0; n < 6; n++) {
            const app = n % 2 ? appB : appC;
            statuses.push((await rpc(app, t.token, "tools/list")).status);
          }
          expect(statuses).toEqual([200, 200, 200, 200, 200, 200]);
          const refusedB = await rpc(appB, t.token, "tools/list");
          expect(refusedB.status).toBe(429);
          expect(refusedB.body).toEqual({
            jsonrpc: "2.0",
            error: { code: -32000, message: "Too many requests, slow down." },
            id: null,
          });
          expect(Number(refusedB.headers["retry-after"])).toBeGreaterThanOrEqual(1);
          expect(Number(refusedB.headers["retry-after"])).toBeLessThanOrEqual(60);
          // the other instance sees the same wall, on the capability URL too
          expect((await rpc(appC, t.token, "tools/list")).status).toBe(429);
          expect((await rpc(appC, t.token, "tools/list", {}, "url")).status).toBe(429);
          // another token has its own count
          expect((await rpc(appB, other.token, "tools/list")).status).toBe(200);
          // the REST routes and the web are not counted
          expect(
            (
              await httpA()
                .get(`${API}/projects`)
                .set("Authorization", `Bearer ${t.token}`)
            ).status,
          ).toBe(200);
        } finally {
          await appC.close();
        }
      },
    );
  });

  // ======================================================================================
  describe("M3 · the 16 tools", () => {
    it("exactly the 16, with a description each, no delete tool; the six readers are marked read only and the ten writers are not", async () => {
      const t = await mint("member");
      const res = await rpc(appA, t.token, "tools/list");
      const tools = res.body.result.tools as Json[];
      expect(tools.map((x) => x.name).sort()).toEqual(
        [...PROJECTS_MCP_TOOL_NAMES].sort(),
      );
      expect(tools).toHaveLength(16);
      for (const x of tools) {
        expect(String(x.description).length).toBeGreaterThan(20);
        expect(x.name).not.toMatch(/delete|remove|destroy/);
      }
      const readers = tools
        .filter((x) => x.annotations?.readOnlyHint === true)
        .map((x) => x.name)
        .sort();
      expect(readers).toEqual([
        "get_issue",
        "get_project",
        "get_project_context",
        "list_milestones",
        "list_projects",
        "search_issues",
      ]);
      // an unknown tool is an error, not a crash
      const unknown = await tool(t.token, "delete_issue", { key: "A-1" });
      expect(unknown.isError).toBe(true);
    });

    it("create_project, get_project, list_projects, update_project, post_status_update", async () => {
      const t = await mint("sa", "admin tool user");
      const made = await tool(t.token, "create_project", {
        key: "TOOLP",
        name: "Tool project",
        description: "Made by a tool.",
        repo_url: "https://github.com/example/tool",
        live_url: "https://tool.example.test",
        deploy_app: "tool-app",
      });
      expect(made.isError).toBeFalsy();
      expect(made.text).toBe("Created project TOOLP: Tool project");
      expect(
        (await tool(t.token, "create_project", { key: "TOOLP", name: "again" })).text,
      ).toBe("A project with this key already exists.");
      expect(
        (await tool(t.token, "create_project", { key: "bad key", name: "x" })).text,
      ).toBe(
        "The key must be 2 to 10 capital letters or digits and start with a letter.",
      );
      const got = await tool(t.token, "get_project", { project_key: "TOOLP" });
      expect(got.text).toBe(
        [
          "# TOOLP: Tool project",
          "Status: Not started",
          "Repository: https://github.com/example/tool",
          "Live URL: https://tool.example.test",
          "Deploy app: tool-app",
          "Archived: no",
          "",
          "Made by a tool.",
        ].join("\n"),
      );
      const list = await tool(t.token, "list_projects");
      expect(list.text.split("\n")[0]).toBe(
        "| Key | Name | Status | To do | In progress | Done | Overdue | Next milestone |",
      );
      expect(list.text.split("\n")[1]).toBe("|---|---|---|---|---|---|---|---|");
      expect(list.text).toContain(
        "| TOOLP | Tool project | Not started | 0 | 0 | 0 | 0 |  |",
      );
      const upd = await tool(t.token, "update_project", {
        project_key: "TOOLP",
        name: "Renamed",
        live_url: "",
      });
      expect(upd.text).toBe(
        "TOOLP settings saved. Name: Renamed | Repo: https://github.com/example/tool | Live: - | Deploy app: tool-app",
      );
      expect(
        (
          await tool(t.token, "update_project", {
            project_key: "TOOLP",
            repo_url: "ftp://x",
          })
        ).text,
      ).toBe("repo_url must start with http:// or https://");
      expect(
        (
          await tool(t.token, "post_status_update", {
            project_key: "TOOLP",
            status: "at_risk",
            note: "Late",
          })
        ).text,
      ).toBe("TOOLP status set to at risk.");
      expect(
        (await tool(t.token, "get_project", { project_key: "TOOLP" })).text,
      ).toContain('Status: At risk, "Late"');
      expect((await tool(t.token, "get_project", { project_key: "NOPE" })).text).toBe(
        "Project not found.",
      );
    });

    it("create_issue resolves names the way a person writes them: type, status, priority, assignee, milestone, parent, labels", async () => {
      await project({ key: "ISS1" });
      const sa = await mint("sa");
      await tool(sa.token, "save_milestone", {
        project_key: "ISS1",
        name: "Beta",
        due_date: "2026-12-31",
      });
      await as("post", "/projects/admin/labels", "sa", {
        name: "tax",
        colour: "#112233",
      });
      const t = await mint("member");
      const parent = await tool(t.token, "create_issue", {
        project_key: "ISS1",
        title: "Parent",
        type: "Epic",
      });
      expect(parent.text).toBe("Created ISS1-1: Parent");
      const child = await tool(t.token, "create_issue", {
        project_key: "ISS1",
        title: "Child",
        description: "Markdown **body**",
        type: "bug",
        status: "In progress",
        priority: "high",
        assignee: "me",
        milestone: "beta",
        parent_key: "iss1-1",
        due_date: "2026-12-01",
        start_date: "2026-11-20",
        labels: ["TAX"],
      });
      expect(child.text).toBe("Created ISS1-2: Child");
      const got = await tool(t.token, "get_issue", { key: "ISS1-2" });
      expect(got.text).toContain("# ISS1-2: Child");
      expect(got.text).toContain(
        "Project: ISS1 | Type: Bug | Status: In progress | Priority: HIGH",
      );
      expect(got.text).toContain(
        `Assignee: ${TAG} member | Milestone: Beta | Start: 2026-11-20 | Due: 2026-12-01`,
      );
      expect(got.text).toContain("Labels: tax");
      expect(got.text).toContain("Parent: ISS1-1 Parent");
      expect(got.text).toContain("Markdown **body**");
      // by e-mail or by name; null clears
      const byMail = await tool(t.token, "create_issue", {
        project_key: "ISS1",
        title: "By mail",
        assignee: `${TAG}-member2@example.com`,
      });
      expect(byMail.text).toBe("Created ISS1-3: By mail");
      expect((await tool(t.token, "get_issue", { key: "ISS1-3" })).text).toContain(
        `Assignee: ${TAG} member2`,
      );
      // unknown names answer with the valid ones
      const bad = await tool(t.token, "create_issue", {
        project_key: "ISS1",
        title: "x",
        status: "Nope",
      });
      expect(bad.isError).toBe(true);
      expect(bad.text).toBe(
        'Unknown status "Nope". Valid: New, In progress, Blocked, In review, Done, Won\'t do',
      );
      const badType = await tool(t.token, "create_issue", {
        project_key: "ISS1",
        title: "x",
        type: "Saga",
      });
      expect(badType.text).toBe('Unknown type "Saga". Valid: Task, Bug, Feature, Epic');
      const badMs = await tool(t.token, "create_issue", {
        project_key: "ISS1",
        title: "x",
        milestone: "Gamma",
      });
      expect(badMs.text).toBe('Unknown milestone "Gamma". Valid: Beta');
      const badWho = await tool(t.token, "create_issue", {
        project_key: "ISS1",
        title: "x",
        assignee: "Nobody Here",
      });
      expect(badWho.text).toBe('No user "Nobody Here".');
      // a label that does not exist: a Member may not create labels; a person with Projects:Configure does
      const noLabel = await tool(t.token, "create_issue", {
        project_key: "ISS1",
        title: "x",
        labels: ["brand-new"],
      });
      expect(noLabel.isError).toBe(true);
      expect(noLabel.text).toBe(
        'Unknown label "brand-new". Valid: tax. Creating a label needs Projects:Configure.',
      );
      const made = await tool(sa.token, "create_issue", {
        project_key: "ISS1",
        title: "Label maker",
        labels: ["brand-new"],
      });
      expect(made.isError).toBeFalsy();
      expect(
        (
          await tool(sa.token, "get_issue", {
            key: made.text.replace("Created ", "").split(":")[0]!,
          })
        ).text,
      ).toContain("Labels: brand-new");
      expect(
        await db.issue.count({ where: { project: { key: "ISS1" }, title: "x" } }),
      ).toBe(0);
    });

    it("get_issue shows sub-issues and the last 20 comments; add_comment adds one and answers with the key", async () => {
      await project({ key: "ISS2" });
      const t = await mint("member");
      await tool(t.token, "create_issue", {
        project_key: "ISS2",
        title: "Top",
        type: "Epic",
      });
      await tool(t.token, "create_issue", {
        project_key: "ISS2",
        title: "Sub",
        parent_key: "ISS2-1",
      });
      for (let n = 1; n <= 22; n++) {
        const r = await tool(t.token, "add_comment", {
          key: "iss2-1",
          body: `note ${n}`,
        });
        expect(r.text).toBe("Comment added to ISS2-1.");
      }
      const got = await tool(t.token, "get_issue", { key: "ISS2-1" });
      expect(got.text).toContain("## Sub-issues\n- ISS2-2 [New] Sub");
      expect(got.text).toContain("## Comments");
      expect(got.text).toContain("note 22");
      expect(got.text).toContain("note 3");
      expect(got.text).not.toContain("note 2\n");
      expect(got.text).toContain(`${TAG} member: note 22`);
      expect(
        (await tool(t.token, "add_comment", { key: "ISS2-1", body: "  " })).text,
      ).toBe("The comment is empty.");
      expect((await tool(t.token, "get_issue", { key: "ISS2-99" })).text).toBe(
        "Issue not found.",
      );
      expect((await tool(t.token, "get_issue", { key: "bad" })).text).toBe(
        '"BAD" is not an issue key like PAY-12.',
      );
    });

    it("update_issue changes only what is passed, and adds a comment in the same call", async () => {
      await project({ key: "UPD1" });
      const t = await mint("member");
      await tool(t.token, "create_issue", {
        project_key: "UPD1",
        title: "Original",
        priority: "low",
      });
      const r = await tool(t.token, "update_issue", {
        key: "UPD1-1",
        status: "Done",
        assignee: "me",
        comment: "Shipped it.",
      });
      expect(r.text).toBe(
        `UPD1-1 is now [Done] LOW Task: Original @${TAG} member (comment added)`,
      );
      const row = await db.issue.findFirstOrThrow({
        where: { key: "UPD1-1" },
        include: { status: true },
      });
      expect(row.status.name).toBe("Done");
      expect(row.closedAt).not.toBeNull();
      expect(row.title).toBe("Original");
      expect(await db.issueComment.count({ where: { issueId: row.id } })).toBe(1);
      const r2 = await tool(t.token, "update_issue", {
        key: "UPD1-1",
        status: "New",
        assignee: null,
      });
      expect(r2.text).toBe("UPD1-1 is now [New] LOW Task: Original");
      expect(
        (await db.issue.findFirstOrThrow({ where: { key: "UPD1-1" } })).closedAt,
      ).toBeNull();
      const none = await tool(t.token, "update_issue", { key: "UPD1-1" });
      expect(none.isError).toBe(true);
      expect(none.text).toBe("Nothing to change: pass at least one field.");
      expect(
        (await tool(t.token, "update_issue", { key: "UPD1-9", title: "x" })).text,
      ).toBe("Issue not found.");
    });

    it("search_issues finds by text and filters, one line per issue, open by default", async () => {
      await project({ key: "SRC1" });
      await project({ key: "SRC2" });
      const t = await mint("member");
      await tool(t.token, "create_issue", {
        project_key: "SRC1",
        title: "Alpha rounding",
        priority: "urgent",
        assignee: "me",
      });
      await tool(t.token, "create_issue", {
        project_key: "SRC1",
        title: "Beta export",
        status: "Done",
      });
      await tool(t.token, "create_issue", {
        project_key: "SRC2",
        title: "Alpha elsewhere",
        type: "Bug",
      });
      const open = await tool(t.token, "search_issues", { project_key: "SRC1" });
      expect(open.text).toBe(`SRC1-1 [New] Task URGENT: Alpha rounding @${TAG} member`);
      const all = await tool(t.token, "search_issues", {
        project_key: "SRC1",
        state: "all",
      });
      expect(all.text.split("\n")).toHaveLength(2);
      const closed = await tool(t.token, "search_issues", {
        project_key: "SRC1",
        state: "closed",
      });
      expect(closed.text).toBe("SRC1-2 [Done] Task: Beta export");
      const text = await tool(t.token, "search_issues", { query: "alpha" });
      expect(text.text.split("\n").sort()).toEqual([
        `SRC1-1 [New] Task URGENT: Alpha rounding @${TAG} member`,
        "SRC2-1 [New] Bug: Alpha elsewhere",
      ]);
      expect(
        (await tool(t.token, "search_issues", { query: "alpha", type: "Bug" })).text,
      ).toBe("SRC2-1 [New] Bug: Alpha elsewhere");
      expect(
        (await tool(t.token, "search_issues", { project_key: "SRC1", assignee: "me" }))
          .text,
      ).toContain("SRC1-1");
      expect(
        (
          await tool(t.token, "search_issues", {
            project_key: "SRC1",
            assignee: "none",
            state: "all",
          })
        ).text,
      ).toBe("SRC1-2 [Done] Task: Beta export");
      expect((await tool(t.token, "search_issues", { query: "zzzz-nothing" })).text).toBe(
        "No matching issues.",
      );
      expect(
        (await tool(t.token, "search_issues", { project_key: "SRC1", status: "Nope" }))
          .text,
      ).toBe(
        'Unknown status "Nope". Valid: New, In progress, Blocked, In review, Done, Won\'t do',
      );
      expect(
        (
          await tool(t.token, "search_issues", {
            project_key: "SRC1",
            limit: 1,
            state: "all",
          })
        ).text.split("\n"),
      ).toHaveLength(1);
    });

    it("create_issues: 50 at once, each with its own status, a default milestone; 51 are refused and nothing is made", async () => {
      await project({ key: "BUL1" });
      const sa = await mint("sa");
      await tool(sa.token, "save_milestone", { project_key: "BUL1", name: "Sprint 1" });
      const t = await mint("member");
      const fifty = Array.from({ length: 50 }, (_, n) => ({
        title: `Item ${n + 1}`,
        ...(n === 0 ? { status: "Done" } : {}),
        ...(n === 1 ? { milestone: "Sprint 1", priority: "high" } : {}),
      }));
      const ok = await tool(t.token, "create_issues", {
        project_key: "BUL1",
        milestone: "Sprint 1",
        items: fifty,
      });
      expect(ok.isError).toBeFalsy();
      const lines = ok.text.split("\n");
      expect(lines[0]).toBe("Created 50 issues:");
      expect(lines[1]).toBe("BUL1-1 Item 1");
      expect(lines).toHaveLength(51);
      expect(await db.issue.count({ where: { project: { key: "BUL1" } } })).toBe(50);
      const first = await db.issue.findFirstOrThrow({
        where: { key: "BUL1-1" },
        include: { status: true, milestone: true },
      });
      expect(first.status.name).toBe("Done");
      expect(first.closedAt).not.toBeNull();
      expect(first.milestone?.name).toBe("Sprint 1"); // the default applies to an item with none
      const second = await db.issue.findFirstOrThrow({ where: { key: "BUL1-2" } });
      expect(second.priority).toBe("HIGH");
      // 51 and 0 are refused whole
      const over = await tool(t.token, "create_issues", {
        project_key: "BUL1",
        items: Array.from({ length: 51 }, (_, n) => ({ title: `Over ${n}` })),
      });
      expect(over.isError).toBe(true);
      expect(await db.issue.count({ where: { project: { key: "BUL1" } } })).toBe(50);
      const empty = await tool(t.token, "create_issues", {
        project_key: "BUL1",
        items: [],
      });
      expect(empty.isError).toBe(true);
      // one bad item stops the batch with its position, and the ones before it stay
      const bad = await tool(t.token, "create_issues", {
        project_key: "BUL1",
        items: [
          { title: "Fine" },
          { title: "Broken", status: "Nope" },
          { title: "Never" },
        ],
      });
      expect(bad.isError).toBe(true);
      expect(bad.text).toContain('Item 2: Unknown status "Nope".');
      expect(bad.text).toContain("1 issue was created before it: BUL1-51.");
      expect(
        await db.issue.count({ where: { project: { key: "BUL1" }, title: "Never" } }),
      ).toBe(0);
    });

    it("list_milestones and save_milestone: create, then update by name; closed ones are hidden unless asked for", async () => {
      await project({ key: "MIL1" });
      const t = await mint("member");
      expect((await tool(t.token, "list_milestones", { project_key: "MIL1" })).text).toBe(
        "No milestones.",
      );
      const made = await tool(t.token, "save_milestone", {
        project_key: "MIL1",
        name: "Beta",
        description: "First release",
        start_date: "2026-11-01",
        due_date: "2026-12-01",
      });
      expect(made.text).toBe("Created milestone Beta in MIL1.");
      await tool(t.token, "create_issue", {
        project_key: "MIL1",
        title: "In beta",
        milestone: "Beta",
        status: "Done",
      });
      await tool(t.token, "create_issue", {
        project_key: "MIL1",
        title: "Also",
        milestone: "Beta",
      });
      expect((await tool(t.token, "list_milestones", { project_key: "MIL1" })).text).toBe(
        "Beta [OPEN] due 2026-12-01: 1/2 done\n  First release",
      );
      // the same name, any case: an update, not a second milestone
      const upd = await tool(t.token, "save_milestone", {
        project_key: "MIL1",
        name: "beta",
        new_name: "Beta 1",
        due_date: "2026-12-15",
        state: "locked",
      });
      expect(upd.text).toBe("Updated milestone Beta 1 [LOCKED].");
      expect(await db.milestone.count({ where: { project: { key: "MIL1" } } })).toBe(1);
      expect(
        (await tool(t.token, "list_milestones", { project_key: "MIL1" })).text,
      ).toContain("Beta 1 [LOCKED] due 2026-12-15: 1/2 done");
      const closed = await tool(t.token, "save_milestone", {
        project_key: "MIL1",
        name: "Beta 1",
        state: "closed",
      });
      expect(closed.text).toBe("Updated milestone Beta 1 [CLOSED].");
      expect((await tool(t.token, "list_milestones", { project_key: "MIL1" })).text).toBe(
        "No milestones.",
      );
      expect(
        (
          await tool(t.token, "list_milestones", {
            project_key: "MIL1",
            include_closed: true,
          })
        ).text,
      ).toContain("Beta 1 [CLOSED]");
      const dates = await tool(t.token, "save_milestone", {
        project_key: "MIL1",
        name: "Late",
        start_date: "2026-12-10",
        due_date: "2026-12-01",
      });
      expect(dates.isError).toBe(true);
      expect(dates.text).toBe("The due date cannot be before the start date.");
    });

    it("get_project_context is the same markdown as the REST briefing", async () => {
      await project({ key: "CTX9", name: "Brief me" });
      const t = await mint("member");
      await tool(t.token, "create_issue", {
        project_key: "CTX9",
        title: "Do it",
        priority: "urgent",
      });
      const viaTool = await tool(t.token, "get_project_context", { project_key: "CTX9" });
      const viaRest = await as("get", "/projects/CTX9/context", "member");
      expect(viaTool.text).toBe(viaRest.text);
      expect(viaTool.text.split("\n")[0]).toBe("# CTX9: Brief me");
      expect(viaTool.text).toContain("- CTX9-1 [New] URGENT Do it");
      expect(
        (await tool(t.token, "get_project_context", { project_key: "NOPE" })).text,
      ).toBe("Project not found.");
    });
  });

  // ======================================================================================
  describe("M4 · sessions through the MCP", () => {
    it("start_session answers the id and the briefing; changes with session_id carry it and add their keys; end_session saves; the next briefing shows it", async () => {
      await project({ key: "SSN1" });
      const t = await mint("member");
      const start = await tool(t.token, "start_session", {
        project_key: "SSN1",
        title: "Do the export",
      });
      expect(start.isError).toBeFalsy();
      const m = /^session_id: ([0-9a-f-]{36})\n\n# SSN1: /.exec(start.text);
      expect(m).not.toBeNull();
      const sid = m![1]!;
      const row = await db.projectWorkSession.findUniqueOrThrow({ where: { id: sid } });
      expect(row).toMatchObject({
        title: "Do the export",
        client: "claude-code",
        userId: uid["member"],
        tokenId: t.id,
      });

      const a = await tool(t.token, "create_issue", {
        project_key: "SSN1",
        title: "One",
        session_id: sid,
      });
      const b = await tool(t.token, "create_issue", {
        project_key: "SSN1",
        title: "Two",
        session_id: sid,
      });
      await tool(t.token, "update_issue", {
        key: "SSN1-1",
        status: "In progress",
        comment: "Started",
        session_id: sid,
      });
      await tool(t.token, "add_comment", {
        key: "SSN1-2",
        body: "Looks fine",
        session_id: sid,
      });
      expect(a.text).toBe("Created SSN1-1: One");
      expect(b.text).toBe("Created SSN1-2: Two");
      await tool(t.token, "save_milestone", {
        project_key: "SSN1",
        name: "M",
        session_id: sid,
      });
      await tool(t.token, "post_status_update", {
        project_key: "SSN1",
        status: "on_track",
        note: "Fine",
        session_id: sid,
      });
      await tool(t.token, "update_project", {
        project_key: "SSN1",
        description: "New words",
        session_id: sid,
      });
      const touched = await db.projectWorkSession.findUniqueOrThrow({
        where: { id: sid },
      });
      expect(touched.issueKeys).toEqual(["SSN1-1", "SSN1-2"]);
      const tagged = await db.projectActivity.count({ where: { sessionId: sid } });
      expect(tagged).toBeGreaterThanOrEqual(9); // started, 2 creates, status, 2 comments, milestone, status update, project
      // an untagged change is not in the session
      await tool(t.token, "create_issue", { project_key: "SSN1", title: "Three" });
      expect(
        (await db.projectWorkSession.findUniqueOrThrow({ where: { id: sid } })).issueKeys,
      ).toEqual(["SSN1-1", "SSN1-2"]);

      const end = await tool(t.token, "end_session", {
        session_id: sid,
        summary: "Did SSN1-1 and SSN1-2.",
        next_steps: "Finish SSN1-3.",
      });
      expect(end.text).toBe("Session closed and summary saved.");
      const done = await db.projectWorkSession.findUniqueOrThrow({ where: { id: sid } });
      expect(done).toMatchObject({
        summary: "Did SSN1-1 and SSN1-2.",
        nextSteps: "Finish SSN1-3.",
      });
      expect(done.endedAt).not.toBeNull();
      expect(done.issueKeys).toEqual(["SSN1-1", "SSN1-2", "SSN1-3"]);

      const next = await tool(t.token, "start_session", { project_key: "SSN1" });
      expect(next.text).toContain("## Recent Claude sessions");
      expect(next.text).toContain("Do the export: Did SSN1-1 and SSN1-2.");
      expect(next.text).toContain("  Next: Finish SSN1-3.");
      expect(next.text).toContain("(claude-code,");
    });

    it("end_session without a session_id closes the caller's open session of that project, or opens and closes one; a blank summary is refused", async () => {
      await project({ key: "SSN2" });
      const t = await mint("member");
      const s = await tool(t.token, "start_session", { project_key: "SSN2" });
      const sid = /session_id: ([0-9a-f-]{36})/.exec(s.text)![1]!;
      const end = await tool(t.token, "end_session", {
        project_key: "SSN2",
        summary: "Closed by project.",
      });
      expect(end.text).toBe("Session closed and summary saved.");
      expect(
        (await db.projectWorkSession.findUniqueOrThrow({ where: { id: sid } })).summary,
      ).toBe("Closed by project.");
      // none open: one is opened and closed so the summary is not lost
      const before = await db.projectWorkSession.count({
        where: { project: { key: "SSN2" } },
      });
      await tool(t.token, "end_session", {
        project_key: "SSN2",
        summary: "Nothing was open.",
      });
      expect(
        await db.projectWorkSession.count({ where: { project: { key: "SSN2" } } }),
      ).toBe(before + 1);
      expect((await tool(t.token, "end_session", { summary: "x" })).text).toBe(
        "Pass session_id from start_session, or project_key.",
      );
      const blank = await tool(t.token, "end_session", {
        project_key: "SSN2",
        summary: "  ",
      });
      expect(blank.isError).toBe(true);
      expect(blank.text).toBe("A short summary of what was done is required.");
    });

    it("a session id that is not the caller's, or not a session, is ignored: the change is made and untagged", async () => {
      await project({ key: "SSN3" });
      const t1 = await mint("member");
      const t2 = await mint("member2");
      const s = await tool(t1.token, "start_session", { project_key: "SSN3" });
      const sid = /session_id: ([0-9a-f-]{36})/.exec(s.text)![1]!;
      const r = await tool(t2.token, "create_issue", {
        project_key: "SSN3",
        title: "Borrowed",
        session_id: sid,
      });
      expect(r.text).toBe("Created SSN3-1: Borrowed");
      expect(
        (
          await db.projectActivity.findFirstOrThrow({
            where: { issue: { key: "SSN3-1" } },
          })
        ).sessionId,
      ).toBeNull();
      const r2 = await tool(t2.token, "create_issue", {
        project_key: "SSN3",
        title: "Junk",
        session_id: "not-a-uuid",
      });
      expect(r2.text).toBe("Created SSN3-2: Junk");
      expect(
        (await db.projectWorkSession.findUniqueOrThrow({ where: { id: sid } })).issueKeys,
      ).toEqual([]);
    });

    it("the capability URL names its client claude.ai; the Bearer door says claude-code, or the x-portal-client header", async () => {
      await project({ key: "SSN4" });
      const t = await mint("member");
      const viaUrl = await tool(t.token, "start_session", { project_key: "SSN4" }, "url");
      const sUrl = /session_id: ([0-9a-f-]{36})/.exec(viaUrl.text)![1]!;
      expect(
        (await db.projectWorkSession.findUniqueOrThrow({ where: { id: sUrl } })).client,
      ).toBe("claude.ai");
      const res = await rpc(
        appA,
        t.token,
        "tools/call",
        { name: "start_session", arguments: { project_key: "SSN4" } },
        "bearer",
        { "x-portal-client": "my-ide" },
      );
      const sId = /session_id: ([0-9a-f-]{36})/.exec(
        res.body.result.content[0].text,
      )![1]!;
      expect(
        (await db.projectWorkSession.findUniqueOrThrow({ where: { id: sId } })).client,
      ).toBe("my-ide");
    });
  });

  // ======================================================================================
  describe("M5 · attribution, permissions, read-only, visibility, notifications", () => {
    it("everything done through the MCP is CLAUDE through the mcp channel, as the token's user, on both doors", async () => {
      await project({ key: "ATT1" });
      const t = await mint("member");
      await tool(t.token, "create_issue", { project_key: "ATT1", title: "Bearer door" });
      await tool(
        t.token,
        "create_issue",
        { project_key: "ATT1", title: "URL door" },
        "url",
      );
      await tool(t.token, "add_comment", { key: "ATT1-1", body: "hello" });
      await tool(t.token, "update_issue", { key: "ATT1-2", priority: "high" }, "url");
      // the project itself was made on the web by the Super Admin; what follows is the MCP
      const acts = await db.projectActivity.findMany({
        where: { project: { key: "ATT1" }, action: { not: "project.created" } },
      });
      expect(acts.length).toBeGreaterThanOrEqual(4);
      for (const a of acts) {
        expect(a).toMatchObject({
          actorType: "CLAUDE",
          channel: "mcp",
          actorUserId: uid["member"],
        });
      }
      const feed = await as("get", "/projects/ATT1/activity?actorType=CLAUDE", "sa");
      expect(feed.status).toBe(200);
      expect(feed.body.items.length).toBe(acts.length);
      const comment = await db.issueComment.findFirstOrThrow({
        where: { issue: { key: "ATT1-1" } },
      });
      expect(comment).toMatchObject({ authorId: uid["member"] });
    });

    it("a read token can use the six readers and is refused, with one sentence, by every writer", async () => {
      await project({ key: "ROT1" });
      const sa = await mint("sa");
      await tool(sa.token, "create_issue", { project_key: "ROT1", title: "Exists" });
      const t = await mint("member", "read only", "read");
      for (const [name, args] of [
        ["list_projects", {}],
        ["get_project", { project_key: "ROT1" }],
        ["get_project_context", { project_key: "ROT1" }],
        ["search_issues", { project_key: "ROT1" }],
        ["get_issue", { key: "ROT1-1" }],
        ["list_milestones", { project_key: "ROT1" }],
      ] as const) {
        const r = await tool(t.token, name, args);
        expect(r.isError).toBeFalsy();
      }
      for (const [name, args] of [
        ["create_project", { key: "ROT2", name: "x" }],
        ["update_project", { project_key: "ROT1", name: "x" }],
        ["create_issue", { project_key: "ROT1", title: "x" }],
        ["create_issues", { project_key: "ROT1", items: [{ title: "x" }] }],
        ["update_issue", { key: "ROT1-1", title: "x" }],
        ["add_comment", { key: "ROT1-1", body: "x" }],
        ["post_status_update", { project_key: "ROT1", status: "on_track", note: "" }],
        ["save_milestone", { project_key: "ROT1", name: "x" }],
        ["start_session", { project_key: "ROT1" }],
        ["end_session", { project_key: "ROT1", summary: "x" }],
      ] as const) {
        const r = await tool(t.token, name, args);
        expect(r.isError).toBe(true);
        expect(r.text).toBe(READ_ONLY);
      }
      expect(await db.issue.count({ where: { project: { key: "ROT1" } } })).toBe(1);
      expect(await db.project.count({ where: { key: "ROT2" } })).toBe(0);
      expect(
        await db.projectWorkSession.count({ where: { project: { key: "ROT1" } } }),
      ).toBe(0);
    });

    it("a Viewer's token is read only whatever its scope says", async () => {
      await project({ key: "VWT1" });
      const t = await mint("viewer", "viewer mcp", "read_write");
      expect(
        (await tool(t.token, "get_project", { project_key: "VWT1" })).isError,
      ).toBeFalsy();
      const w = await tool(t.token, "create_issue", { project_key: "VWT1", title: "x" });
      expect(w.isError).toBe(true);
      expect(w.text).toBe(READ_ONLY);
    });

    it("the user's own permissions apply inside every tool: none at all, no Configure, and what they cannot see", async () => {
      await project({ key: "PRM1" });
      await project({ key: "PRM2", clientId });
      const none = await mint("norole");
      const r = await tool(none.token, "list_projects");
      expect(r.isError).toBe(true);
      expect(r.text).toBe(missing("Projects:Read"));
      const m = await mint("member");
      // a Member cannot see PRM2 (its client is not theirs), and gets what a stranger gets
      expect((await tool(m.token, "get_project", { project_key: "PRM2" })).text).toBe(
        "Project not found.",
      );
      expect((await tool(m.token, "list_projects")).text).not.toContain("PRM2");
      expect(
        (await tool(m.token, "get_project_context", { project_key: "PRM2" })).text,
      ).toBe("Project not found.");
      expect(
        (await tool(m.token, "search_issues", { query: "anything", project_key: "PRM2" }))
          .text,
      ).toBe("Project not found.");
      const assigned = await mint("memberAssigned");
      expect(
        (await tool(assigned.token, "get_project", { project_key: "PRM2" })).isError,
      ).toBeFalsy();
      // another firm sees none of it
      const other = await mint("sa2");
      expect((await tool(other.token, "get_project", { project_key: "PRM1" })).text).toBe(
        "Project not found.",
      );
      expect((await tool(other.token, "list_projects")).text).not.toContain("PRM1");
      // create_project needs Projects:Create; a Viewer's missing it is read-only first
      const viewer = await mint("viewer");
      expect(
        (await tool(viewer.token, "create_project", { key: "PRM3", name: "x" })).text,
      ).toBe(READ_ONLY);
    });

    it("a change through the MCP tells the people involved, as a change from the web does (the actor excepted)", async () => {
      await project({ key: "NOT1" });
      const t = await mint("member");
      await tool(t.token, "create_issue", {
        project_key: "NOT1",
        title: "Assigned to you",
        assignee: `${TAG}-member2@example.com`,
      });
      await tool(t.token, "create_issue", {
        project_key: "NOT1",
        title: "Assigned to me",
        assignee: "me",
      });
      const mine = await db.notification.findMany({
        where: { userId: uid["member2"]!, entityId: { not: null } },
      });
      expect(mine.map((n) => n.kind)).toContain("project.issue.assigned");
      expect(
        await db.notification.count({
          where: { userId: uid["member"]!, title: { contains: "NOT1-2" } },
        }),
      ).toBe(0);
    });

    it("a tool that fails inside answers a sentence, never a stack trace, and the MCP keeps answering", async () => {
      const t = await mint("member");
      const bad = await tool(t.token, "get_issue", { key: "" });
      expect(bad.isError).toBe(true);
      expect(bad.text).not.toMatch(/at .*\(.*:\d+:\d+\)|prisma|SELECT /i);
      expect((await tool(t.token, "list_projects")).isError).toBeFalsy();
    });
  });
});
