/**
 * track-a-projects-github.db-spec.ts — PA4 (D68): the GitHub webhook, over HTTP against the real
 * Nest app and the local PostgreSQL. Every firm, user, repository and title is invented.
 *
 * W1  The signature is checked on the raw body; nothing is written without a good one.
 * W2  ping, other events, bad JSON.
 * W3  push: keys in commit messages become links, once.
 * W4  pull_request: keys in the title, body and branch; later events update, never duplicate.
 * W5  A merged pull request that says "fixes KEY" moves the issue to the first done status.
 * W6  Which keys count: the project's repository, other firms, unknown keys, lower case.
 */
import { createHmac, randomUUID } from "node:crypto";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { truncateOncePerFile } from "./helpers/truncate";
import { AppModule } from "../../src/app.module";
import { TokenService } from "../../src/auth/token.service";
import { PrismaService } from "../../src/prisma/prisma.service";
import { applyProjectsBodyReaders } from "../../src/projects-mcp/body-limit";

truncateOncePerFile({ firmRoles: ["Super Admin"] });

const TAG = `track-a-gh-${randomUUID().slice(0, 8)}`;
const API = "/api/v1";
const SECRET = `${TAG}-webhook-secret-0123456789`;
const REPO = "example-org/portal-app";
const REPO_URL = `https://github.com/${REPO}`;
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the tests read JSON
type Json = Record<string, any>;
const UNAUTHORIZED = { statusCode: 401, message: "Unauthorized" };

describe("PA4 · GitHub webhook (real app over HTTP, db)", () => {
  let app: INestApplication;
  let db: PrismaService;
  let firmId = "";
  let otherFirmId = "";
  const jwt: Record<string, string> = {};
  const uid: Record<string, string> = {};
  let prevSecret: string | undefined;

  const http = () => request(app.getHttpServer());
  const as = (
    method: "get" | "post" | "patch",
    path: string,
    who = "sa",
    body?: object,
    firmToken = jwt,
  ) => {
    const r = http()
      [method](`${API}${path}`)
      .set("Authorization", `Bearer ${firmToken[who]}`);
    return body === undefined ? r : r.send(body);
  };
  const sign = (raw: string, secret = SECRET) =>
    `sha256=${createHmac("sha256", secret).update(raw).digest("hex")}`;
  /** One delivery, signed like GitHub signs it, over the exact bytes sent. */
  function deliver(
    event: string,
    payload: object | string,
    opts: { signature?: string | null; raw?: string } = {},
  ) {
    const raw =
      opts.raw ?? (typeof payload === "string" ? payload : JSON.stringify(payload));
    let r = http()
      .post(`${API}/projects/github/webhook`)
      .set("Content-Type", "application/json")
      .set("X-GitHub-Event", event)
      .set("X-GitHub-Delivery", randomUUID());
    const sig = opts.signature === undefined ? sign(raw) : opts.signature;
    if (sig !== null) r = r.set("X-Hub-Signature-256", sig);
    return r.send(raw);
  }
  const repository = { full_name: REPO, default_branch: "main" };
  const pr = (o: {
    number: number;
    action?: string;
    title?: string;
    body?: string | null;
    head?: string;
    base?: string;
    state?: string;
    merged?: boolean;
    repository?: Json;
  }) => ({
    action: o.action ?? "opened",
    number: o.number,
    pull_request: {
      number: o.number,
      title: o.title ?? "A change",
      body: o.body ?? "",
      html_url: `https://github.com/${REPO}/pull/${o.number}`,
      state: o.state ?? "open",
      merged: o.merged ?? false,
      merged_at: o.merged ? "2026-11-10T01:00:00Z" : null,
      head: { ref: o.head ?? "feature/plain" },
      base: { ref: o.base ?? "main" },
    },
    repository: o.repository ?? repository,
  });
  const push = (commits: { id: string; message: string }[], repo: Json = repository) => ({
    ref: "refs/heads/main",
    commits: commits.map((c) => ({
      id: c.id,
      message: c.message,
      url: `https://github.com/${REPO}/commit/${c.id}`,
    })),
    repository: repo,
  });

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
  async function makeUser(label: string, roleId?: string, firm?: string) {
    const fid = firm ?? firmId;
    const u = await db.user.create({
      data: {
        firmId: fid,
        userType: "FIRM",
        fullName: `${TAG} ${label}`,
        email: `${TAG}-${label}@example.com`,
        status: "ACTIVE",
        firmProfile: { create: { title: "Test" } },
        ...(roleId ? { userRoles: { create: { roleId } } } : {}),
      },
    });
    uid[label] = u.id;
    jwt[label] = app.get(TokenService).signAccess({
      id: u.id,
      firmId: fid,
      userType: "FIRM",
      email: u.email,
    });
  }
  async function project(key: string, repoUrl: string | null, who = "sa") {
    const res = await as("post", "/projects", who, {
      key,
      name: `Project ${key}`,
      ...(repoUrl ? { repoUrl } : {}),
    });
    expect(res.status).toBe(201);
  }
  /** An issue authored by `author` and assigned to `assignee`. */
  async function issue(pk: string, title = "An issue") {
    const res = await as("post", `/projects/${pk}/issues`, "author", {
      title,
      assigneeId: uid["assignee"],
    });
    expect(res.status).toBe(201);
    return res.body.key as string;
  }
  const row = (key: string) =>
    db.issue.findFirstOrThrow({ where: { key, firmId }, include: { status: true } });
  const links = (key: string) =>
    db.githubLink.findMany({
      where: { issue: { key, firmId } },
      orderBy: { createdAt: "asc" },
    });
  const counts = async () => ({
    links: await db.githubLink.count(),
    activity: await db.projectActivity.count(),
    notes: await db.notification.count(),
  });

  beforeAll(async () => {
    prevSecret = process.env.GITHUB_WEBHOOK_SECRET;
    process.env.GITHUB_WEBHOOK_SECRET = SECRET;
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix("api/v1");
    applyProjectsBodyReaders(app, "/api/v1");
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
    const member = await makeRole(`${TAG} GH Member`, [
      "Projects:Read",
      "Projects:Create",
      "Projects:Update",
    ]);
    await makeUser("sa", sa);
    await makeUser("sa2", sa, otherFirmId);
    await makeUser("author", member);
    await makeUser("assignee", member);
    await makeUser("watcher", member);
    await makeUser("outsider");
    await project("WEB", REPO_URL);
    await project("OTH", "https://github.com/example-org/other-repo");
    await project("NOR", null);
    // another firm: a WEB of its own on another repository, and an FB
    await project("WEB", "https://github.com/their-org/their-app", "sa2");
    await project("FB", "https://github.com/their-org/fb-app", "sa2");
    const theirs = await as("post", "/projects/WEB/issues", "sa2", {
      title: "Their WEB-1",
    });
    expect(theirs.status).toBe(201);
    await as("post", "/projects/FB/issues", "sa2", { title: "Their FB-1" });
  });
  afterAll(async () => {
    if (prevSecret === undefined) delete process.env.GITHUB_WEBHOOK_SECRET;
    else process.env.GITHUB_WEBHOOK_SECRET = prevSecret;
    await app.close();
  });

  // ======================================================================================
  describe("W1 · the signature", () => {
    it("a good signature on the raw body is accepted; no session or token is needed", async () => {
      const res = await deliver("ping", {
        zen: "Keep it logically awesome.",
        repository,
      });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ok: true, pong: true });
      // a bad Authorization header is simply not looked at
      const raw = JSON.stringify({ zen: "x", repository });
      const withBadBearer = await http()
        .post(`${API}/projects/github/webhook`)
        .set("Authorization", "Bearer not-a-token")
        .set("Content-Type", "application/json")
        .set("X-GitHub-Event", "ping")
        .set("X-Hub-Signature-256", sign(raw))
        .send(raw);
      expect(withBadBearer.status).toBe(200);
    });

    it("a wrong or missing signature is a plain 401 and nothing is written", async () => {
      await project("SIG", REPO_URL);
      const key = await issue("SIG", "Not touched");
      const before = await counts();
      const payload = push([{ id: "a".repeat(40), message: `Fix ${key}` }]);
      const raw = JSON.stringify(payload);
      const good = sign(raw);
      const flipped = good.slice(0, -1) + (good.endsWith("0") ? "1" : "0");
      for (const signature of [
        flipped,
        null,
        "",
        "sha256=",
        "sha1=" + good.slice(7, 47),
        sign(raw, "another secret"),
      ]) {
        const res = await deliver("push", payload, { signature });
        expect(res.status).toBe(401);
        expect(res.body).toEqual(UNAUTHORIZED);
      }
      expect(await counts()).toEqual(before);
      expect(await links(key)).toHaveLength(0);
    });

    it("the signature is over the raw bytes: a body signed in one spelling and sent in another is refused", async () => {
      await project("RAW", REPO_URL);
      const key = await issue("RAW", "Raw bytes");
      const payload = push([{ id: "b".repeat(40), message: `Work on ${key}` }]);
      const compact = JSON.stringify(payload);
      const spaced = JSON.stringify(payload, null, 2);
      const refused = await deliver("push", payload, {
        raw: spaced,
        signature: sign(compact),
      });
      expect(refused.status).toBe(401);
      expect(await links(key)).toHaveLength(0);
      const accepted = await deliver("push", payload, {
        raw: spaced,
        signature: sign(spaced),
      });
      expect(accepted.status).toBe(200);
      expect(await links(key)).toHaveLength(1);
    });

    it("with no secret configured every delivery is refused the same way", async () => {
      delete process.env.GITHUB_WEBHOOK_SECRET;
      try {
        const raw = JSON.stringify({ zen: "x", repository });
        const res = await deliver(
          "ping",
          { zen: "x", repository },
          { raw, signature: sign(raw, "") },
        );
        expect(res.status).toBe(401);
        expect(res.body).toEqual(UNAUTHORIZED);
        const res2 = await deliver("ping", { zen: "x", repository });
        expect(res2.status).toBe(401);
      } finally {
        process.env.GITHUB_WEBHOOK_SECRET = SECRET;
      }
    });
  });

  // ======================================================================================
  describe("W2 · ping, other events, bad JSON", () => {
    it("ping answers 200, another event 202 ignored, a body that is not JSON 400", async () => {
      const before = await counts();
      const other = await deliver("issues", { action: "opened", repository });
      expect(other.status).toBe(202);
      expect(other.body).toEqual({ ok: true, ignored: "issues" });
      const none = await http()
        .post(`${API}/projects/github/webhook`)
        .set("Content-Type", "application/json")
        .set("X-Hub-Signature-256", sign("{}"))
        .send("{}");
      expect(none.status).toBe(202); // no event header at all: nothing to do
      const raw = "{ this is not json";
      const bad = await deliver("push", raw, { raw });
      expect(bad.status).toBe(400);
      expect(bad.body.message).toBe("The body is not valid JSON.");
      expect(await counts()).toEqual(before);
    });

    it("a repository no project is linked to is accepted and does nothing", async () => {
      const before = await counts();
      const res = await deliver(
        "push",
        push([{ id: "c".repeat(40), message: "Fix WEB-1" }], {
          full_name: "nobody/nothing",
          default_branch: "main",
        }),
      );
      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        ok: true,
        repo: "nobody/nothing",
        linked: [],
        closed: [],
        ignored: [],
      });
      expect(await counts()).toEqual(before);
    });
  });

  // ======================================================================================
  describe("W3 · push", () => {
    it("keys in commit messages become links: one row per issue and commit, with the commit's first line, never twice", async () => {
      await project("PSH", REPO_URL);
      const k1 = await issue("PSH", "First");
      const k2 = await issue("PSH", "Second");
      const sha1 = "1".repeat(40);
      const sha2 = "2".repeat(40);
      const sha3 = "3".repeat(40);
      const payload = push([
        { id: sha1, message: `${k1}: start\n\nmore words about it` },
        { id: sha2, message: `Refs ${k1} and ${k2}` },
        { id: sha3, message: "No key in this one" },
      ]);
      const res = await deliver("push", payload);
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.repo).toBe(REPO);
      expect(res.body.closed).toEqual([]);
      expect(res.body.ignored).toEqual([]);
      expect(res.body.linked).toEqual([
        { key: k1, kind: "commit", ref: sha1, created: true },
        { key: k1, kind: "commit", ref: sha2, created: true },
        { key: k2, kind: "commit", ref: sha2, created: true },
      ]);
      const l1 = await links(k1);
      expect(l1).toHaveLength(2);
      expect(l1[0]).toMatchObject({
        kind: "commit",
        repo: REPO,
        sha: sha1,
        number: null,
        url: `https://github.com/${REPO}/commit/${sha1}`,
        title: `${k1}: start`,
        state: "pushed",
        merged: false,
      });
      expect(await links(k2)).toHaveLength(1);
      // the issue's activity says so, as GitHub
      const acts = await db.projectActivity.findMany({
        where: { issue: { key: k1 }, action: "github.linked" },
      });
      expect(acts).toHaveLength(2);
      for (const a of acts) {
        expect(a).toMatchObject({
          actorType: "GITHUB",
          channel: "github",
          actorUserId: null,
          sessionId: null,
        });
      }
      // delivered again (GitHub retries): nothing new
      const before = await counts();
      const again = await deliver("push", payload);
      expect(again.status).toBe(200);
      expect(again.body.linked.every((l: Json) => l.created === false)).toBe(true);
      expect(await counts()).toEqual(before);
      // the same commit with its message reworded updates the row
      const reworded = push([{ id: sha1, message: `${k1}: start, reworded` }]);
      await deliver("push", reworded);
      expect((await links(k1))[0]!.title).toBe(`${k1}: start, reworded`);
      expect(await links(k1)).toHaveLength(2);
    });

    it("the issue shows its links", async () => {
      await project("SHW", REPO_URL);
      const k = await issue("SHW", "Shows links");
      await deliver("push", push([{ id: "d".repeat(40), message: `Do ${k}` }]));
      await deliver("pull_request", pr({ number: 31, title: `Add ${k}` }));
      const detail = (await as("get", `/projects/SHW/issues/${k}`)).body;
      expect(detail.githubLinks).toHaveLength(2);
      expect(detail.githubLinks[0]).toMatchObject({
        kind: "pr",
        repo: REPO,
        number: 31,
        state: "open",
        merged: false,
      });
      expect(Object.keys(detail.githubLinks[0]).sort()).toEqual([
        "kind",
        "merged",
        "number",
        "repo",
        "sha",
        "state",
        "title",
        "updatedAt",
        "url",
      ]);
      expect(detail.githubLinks[1]).toMatchObject({
        kind: "commit",
        sha: "d".repeat(40),
        state: "pushed",
      });
    });
  });

  // ======================================================================================
  describe("W4 · pull_request", () => {
    it("keys in the title, the body and the branch name link the pull request; later events update the row, never duplicate it", async () => {
      await project("PRS", REPO_URL);
      const kTitle = await issue("PRS", "In the title");
      const kBody = await issue("PRS", "In the body");
      const kBranch = await issue("PRS", "In the branch");
      const opened = pr({
        number: 7,
        title: `Add export (${kTitle})`,
        body: `Related to ${kBody}.`,
        head: `feature/${kBranch}-export`,
      });
      const res = await deliver("pull_request", opened);
      expect(res.status).toBe(200);
      expect(res.body.linked.map((l: Json) => l.key).sort()).toEqual(
        [kBody, kBranch, kTitle].sort(),
      );
      expect(
        res.body.linked.every((l: Json) => l.kind === "pr" && l.ref === "7" && l.created),
      ).toBe(true);
      for (const k of [kTitle, kBody, kBranch]) {
        const l = await links(k);
        expect(l).toHaveLength(1);
        expect(l[0]).toMatchObject({
          kind: "pr",
          repo: REPO,
          number: 7,
          sha: null,
          url: `https://github.com/${REPO}/pull/7`,
          state: "open",
          merged: false,
        });
      }
      // edited title, then closed without merging
      await deliver(
        "pull_request",
        pr({
          number: 7,
          action: "edited",
          title: `Add the export (${kTitle})`,
          body: `Related to ${kBody}. Fixes ${kBody}`,
          head: `feature/${kBranch}-export`,
        }),
      );
      expect((await links(kTitle))[0]!.title).toBe(`Add the export (${kTitle})`);
      const closed = await deliver(
        "pull_request",
        pr({
          number: 7,
          action: "closed",
          state: "closed",
          merged: false,
          title: `Add the export (${kTitle})`,
          body: `Related to ${kBody}. Fixes ${kBody}`,
          head: `feature/${kBranch}-export`,
        }),
      );
      expect(closed.body.closed).toEqual([]);
      for (const k of [kTitle, kBody, kBranch]) {
        const l = await links(k);
        expect(l).toHaveLength(1);
        expect(l[0]).toMatchObject({ state: "closed", merged: false });
        expect((await row(k)).status.category).not.toBe("DONE"); // closed, not merged: nothing moves
      }
    });
  });

  // ======================================================================================
  describe("W5 · a merged pull request that says fixes", () => {
    it("moves each such issue to the first done status, as GitHub, and tells the assignee and the author; once", async () => {
      await project("FIX", REPO_URL);
      const k = await issue("FIX", "Will be fixed");
      const mention = await issue("FIX", "Only mentioned");
      // a person who commented is involved too (PA2's rule)
      await as("post", `/projects/FIX/issues/${k}/comments`, "watcher", {
        body: "I am watching",
      });
      await db.notification.deleteMany({ where: { firmId } });
      const firstDone = (
        await db.issueStatus.findMany({
          where: { firmId, category: "DONE" },
          orderBy: [{ order: "asc" }, { name: "asc" }],
        })
      )[0]!;
      const merged = pr({
        number: 12,
        action: "closed",
        state: "closed",
        merged: true,
        title: `Export the file (${mention})`,
        body: `Fixes ${k}\n\nAlso mentions ${mention}.`,
        head: "feature/export",
      });
      const res = await deliver("pull_request", merged);
      expect(res.status).toBe(200);
      expect(res.body.closed).toEqual([k]);
      expect(res.body.linked.map((l: Json) => l.key).sort()).toEqual([k, mention].sort());

      const fixed = await row(k);
      expect(fixed.status.id).toBe(firstDone.id);
      expect(fixed.closedAt).not.toBeNull();
      expect((await row(mention)).status.category).not.toBe("DONE"); // named, but no closing word
      expect((await links(k))[0]).toMatchObject({
        kind: "pr",
        number: 12,
        state: "merged",
        merged: true,
      });

      const act = await db.projectActivity.findFirstOrThrow({
        where: { issue: { key: k }, action: "issue.updated" },
      });
      expect(act).toMatchObject({
        actorType: "GITHUB",
        channel: "github",
        actorUserId: null,
      });
      expect(act.changes).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ field: "status", new: firstDone.name }),
          expect.objectContaining({ field: "closedBy", new: `${REPO}#12` }),
        ]),
      );
      // the assignee, the author and the person who commented, once each, nobody else
      const notes = await db.notification.findMany({ where: { entityId: fixed.id } });
      expect(notes.map((n) => n.userId).sort()).toEqual(
        [uid["assignee"], uid["author"], uid["watcher"]].sort(),
      );
      expect(
        notes.every(
          (n) => n.kind === "project.issue.closed" && n.title === `${k} was closed`,
        ),
      ).toBe(true);
      expect(notes[0]!.body).toContain("GitHub");
      expect(await db.notification.count({ where: { userId: uid["sa"] } })).toBe(0);

      // GitHub delivers it again: no second move, no second notification, no second activity
      const before = await counts();
      const again = await deliver("pull_request", merged);
      expect(again.status).toBe(200);
      expect(again.body.closed).toEqual([]);
      expect(await counts()).toEqual(before);
    });

    it("only a merged pull request closes: not an open one, not one closed unmerged, not one merged into a branch that is not the default", async () => {
      await project("NOC", REPO_URL);
      const open = await issue("NOC", "Open PR");
      const unmerged = await issue("NOC", "Unmerged");
      const elsewhere = await issue("NOC", "Merged elsewhere");
      await deliver(
        "pull_request",
        pr({ number: 21, title: "Work", body: `Closes ${open}` }),
      );
      await deliver(
        "pull_request",
        pr({
          number: 22,
          action: "closed",
          state: "closed",
          merged: false,
          title: "Work",
          body: `Resolves ${unmerged}`,
        }),
      );
      const res = await deliver(
        "pull_request",
        pr({
          number: 23,
          action: "closed",
          state: "closed",
          merged: true,
          base: "release/1.0",
          title: "Backport",
          body: `Fixes ${elsewhere}`,
        }),
      );
      expect(res.body.closed).toEqual([]);
      for (const k of [open, unmerged, elsewhere]) {
        expect((await row(k)).status.category).not.toBe("DONE");
        expect(await links(k)).toHaveLength(1); // still linked
      }
      expect((await links(elsewhere))[0]).toMatchObject({
        state: "merged",
        merged: true,
      });
    });

    it("all nine closing words work, a list shares one word, and an issue already done is left alone", async () => {
      await project("CLS", REPO_URL);
      const a = await issue("CLS", "a");
      const b = await issue("CLS", "b");
      const c = await issue("CLS", "c");
      const done = await issue("CLS", "already done");
      await as("patch", `/projects/CLS/issues/${done}`, "sa", {
        statusId: (
          await db.issueStatus.findFirstOrThrow({ where: { firmId, name: "Done" } })
        ).id,
      });
      await db.projectActivity.deleteMany({ where: { issue: { key: done } } });
      const res = await deliver(
        "pull_request",
        pr({
          number: 41,
          action: "closed",
          state: "closed",
          merged: true,
          title: "Many",
          body: `resolved ${a}, ${b} and ${done}\nfix: ${c}`,
        }),
      );
      expect(res.body.closed.sort()).toEqual([a, b, c].sort());
      expect(
        await db.projectActivity.count({
          where: { issue: { key: done }, action: "issue.updated" },
        }),
      ).toBe(0);
    });
  });

  // ======================================================================================
  describe("W6 · which keys count", () => {
    it("the key's project must be linked to this repository: another repository's project, a project with no repository, unknown keys and another firm's keys are ignored", async () => {
      await project("MIX", REPO_URL);
      const own = await issue("MIX", "Own");
      const oth = await issue("OTH", "Other repo");
      const nor = await issue("NOR", "No repo");
      const before = await counts();
      const body = `Fixes ${own}, ${oth}, ${nor}, MIX-9999, FB-1 and ZZZ-5`;
      const res = await deliver(
        "pull_request",
        pr({
          number: 51,
          action: "closed",
          state: "closed",
          merged: true,
          title: "Mixed",
          body,
        }),
      );
      expect(res.status).toBe(200);
      expect(res.body.closed).toEqual([own]);
      expect(res.body.linked.map((l: Json) => l.key)).toEqual([own]);
      const reasons = Object.fromEntries(
        res.body.ignored.map((i: Json) => [i.key, i.reason]),
      );
      expect(reasons[oth]).toBe("Project OTH is linked to another repository.");
      expect(reasons[nor]).toBe("Project NOR is not linked to a repository.");
      const unknown = "No issue with this key in a project linked to this repository.";
      expect(reasons["MIX-9999"]).toBe(unknown);
      expect(reasons["FB-1"]).toBe(unknown); // another firm's: not told apart from an unknown key
      expect(reasons["ZZZ-5"]).toBe(unknown);
      expect(await links(oth)).toHaveLength(0);
      expect(await links(nor)).toHaveLength(0);
      expect((await row(oth)).status.category).not.toBe("DONE");
      expect((await row(nor)).status.category).not.toBe("DONE");
      // another firm's issues are untouched, including its own WEB-1 (same key as ours)
      expect(await db.githubLink.count({ where: { firmId: otherFirmId } })).toBe(0);
      expect(
        await db.projectActivity.count({
          where: { firmId: otherFirmId, actorType: "GITHUB" },
        }),
      ).toBe(0);
      expect(await db.githubLink.count()).toBe(before.links + 1);
    });

    it("the same key in another firm is that firm's issue and is not touched by this firm's repository", async () => {
      await project("TWN", REPO_URL);
      const own = await issue("TWN", "Own");
      const theirs = await db.issue.findFirstOrThrow({
        where: { key: "WEB-1", firmId: otherFirmId },
      });
      await deliver(
        "push",
        push([{ id: "e".repeat(40), message: `Touch WEB-1 and ${own}` }]),
      );
      expect(await db.githubLink.count({ where: { issueId: theirs.id } })).toBe(0);
      expect(await links(own)).toHaveLength(1);
    });

    it("keys are capital letters only, as projects-core reads them; the repository name is case-insensitive", async () => {
      await project("CAP", REPO_URL);
      const k = await issue("CAP", "Cap");
      const lower = k.toLowerCase();
      const none = await deliver(
        "push",
        push([{ id: "f".repeat(40), message: `work on ${lower}` }]),
      );
      expect(none.body.linked).toEqual([]);
      const mixedCaseRepo = {
        full_name: "Example-Org/Portal-App",
        default_branch: "main",
      };
      const ok = await deliver(
        "push",
        push([{ id: "9".repeat(40), message: `work on ${k}` }], mixedCaseRepo),
      );
      expect(ok.body.linked.map((l: Json) => l.key)).toEqual([k]);
      expect(ok.body.repo).toBe("example-org/portal-app");
    });

    it("a deleted issue is not linked", async () => {
      await project("DEL", REPO_URL);
      const k = await issue("DEL", "Deleted");
      await db.issue.update({
        where: { firmId_key: { firmId, key: k } },
        data: { deleted: true },
      });
      const res = await deliver(
        "push",
        push([{ id: "8".repeat(40), message: `Fix ${k}` }]),
      );
      expect(res.body.linked).toEqual([]);
      expect(res.body.ignored).toEqual([
        {
          key: k,
          reason: "No issue with this key in a project linked to this repository.",
        },
      ]);
    });
  });
});
