/**
 * track-a-projects-audits.db-spec.ts — PA4 (D68): security audits, the security status, the
 * release gate and the two MCP tools, over HTTP against the real Nest app and the local
 * PostgreSQL. Every firm, user, finding and title is invented.
 *
 * S1  Each state a finding can be in, the priority mapping, the audit record.
 * S2  The same fingerprint updates the same issue; a closed one reported again is reopened.
 * S3  Comments on open findings a complete whole-repo run did not report.
 * S4  History, status, portfolio and overview.
 * S5  The release gate.
 * S6  Validation, permissions, tokens, one transaction.
 * S7  The MCP tools.
 */
import { randomUUID } from "node:crypto";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { truncateOncePerFile } from "./helpers/truncate";
import { AppModule } from "../../src/app.module";
import { TokenService } from "../../src/auth/token.service";
import { PrismaService } from "../../src/prisma/prisma.service";
import { applyProjectsBodyReaders } from "../../src/projects-mcp/body-limit";
import { ProjectsActivity } from "../../src/projects/projects-activity.service";

truncateOncePerFile({ firmRoles: ["Super Admin"] });

const TAG = `track-a-aud-${randomUUID().slice(0, 8)}`;
const API = "/api/v1";
const ACCEPT = "application/json, text/event-stream";
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the tests read JSON
type Json = Record<string, any>;
const missing = (...p: string[]) => `Missing permission(s): ${p.join(", ")}`;
const READ_ONLY = "This token is read-only.";
const gate = (keys: string) =>
  `This milestone cannot be closed while security issues are open: ${keys}.`;

const confirmed = (fp: string, sev: string, o: Json = {}) => ({
  verdict: "confirmed",
  fingerprint: fp,
  title: `Confirmed ${fp}`,
  description: `Described ${fp}`,
  root_cause: `Cause of ${fp}`,
  intended_behavior: `Intended for ${fp}`,
  severity: { overall_severity: sev },
  ...o,
});
const lead = (fp: string, o: Json = {}) => ({
  verdict: "needs_validation",
  fingerprint: fp,
  title: `Lead ${fp}`,
  description: `Possible ${fp}`,
  claimed_root_cause: `Claimed for ${fp}`,
  ...o,
});
const rejected = (fp: string, o: Json = {}) => ({
  verdict: "rejected",
  fingerprint: fp,
  title: `Rejected ${fp}`,
  description: `Not real ${fp}`,
  claimed_root_cause: `Claimed for ${fp}`,
  reason: "Not reachable from outside.",
  ...o,
});
const run = (id: string, o: Json = {}) => ({
  run_id: id,
  source_ref: "abcdef0123456789abcdef0123456789abcdef01",
  profile: "standard",
  scope_paths: [],
  run_status: "complete",
  ...o,
});

describe("PA4 · security audits, status and the release gate (real app over HTTP, db)", () => {
  let app: INestApplication;
  let db: PrismaService;
  let firmId = "";
  let clientId = "";
  const jwt: Record<string, string> = {};
  const uid: Record<string, string> = {};
  let st: Record<string, string> = {};
  let seq = 0;
  let rpcId = 1;

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
    const key = extra.key ?? `A${String(seq).padStart(3, "0")}`;
    const res = await as("post", "/projects", who, {
      name: `Project ${key}`,
      ...extra,
      key,
    });
    expect(res.status).toBe(201);
    return key as string;
  }
  const audit = (key: string, body: Json, who = "member") =>
    as("post", `/projects/${key}/audits`, who, body);
  const issueOf = (fp: string, pk: string) =>
    db.securityFinding
      .findFirstOrThrow({ where: { fingerprint: fp, project: { key: pk } } })
      .then((f) =>
        db.issue.findUniqueOrThrow({
          where: { id: f.issueId! },
          include: { type: true, status: true, labels: { include: { label: true } } },
        }),
      );
  const labelsOf = (i: { labels: { label: { name: string } }[] }) =>
    i.labels.map((l) => l.label.name).sort();
  const done = async (key: string) => {
    const res = await as("patch", `/projects/${key.split("-")[0]}/issues/${key}`, "sa", {
      statusId: st["Done"],
    });
    expect(res.status).toBe(200);
  };
  const comments = (key: string) =>
    db.issueComment.findMany({
      where: { issue: { key, firmId } },
      orderBy: { createdAt: "asc" },
    });

  async function mint(who: string, scope = "read_write") {
    const res = await as("post", "/tokens", who, { name: `${who} ${scope}`, scope });
    expect(res.status).toBe(201);
    return res.body.token as string;
  }
  async function tool(token: string, name: string, args: Json = {}) {
    const res = await http()
      .post(`${API}/projects/mcp`)
      .set("Authorization", `Bearer ${token}`)
      .set("Accept", ACCEPT)
      .send({
        jsonrpc: "2.0",
        id: rpcId++,
        method: "tools/call",
        params: { name, arguments: args },
      });
    expect(res.status).toBe(200);
    if (res.body.error) {
      return { isError: true, text: String(res.body.error.message) };
    }
    const r = res.body.result as { isError?: boolean; content: { text: string }[] };
    return { isError: r.isError, text: r.content.map((c) => c.text).join("\n") };
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
    applyProjectsBodyReaders(app, "/api/v1");
    await app.init();
    db = app.get(PrismaService);
    firmId = (await db.firm.create({ data: { name: `${TAG} Halimbawa Accounting` } })).id;
    const sa = (
      await db.role.findUniqueOrThrow({
        where: { name_scope: { name: "Super Admin", scope: "FIRM" } },
      })
    ).id;
    const member = await makeRole(`${TAG} AUD Member`, [
      "Projects:Read",
      "Projects:Create",
      "Projects:Update",
    ]);
    const viewer = await makeRole(`${TAG} AUD Viewer`, ["Projects:Read"]);
    clientId = (
      await db.client.create({
        data: { firmId, businessName: `${TAG} Halimbawa Client`, tin: "000555402" },
      })
    ).id;
    await makeUser("sa", sa);
    await makeUser("member", member);
    await makeUser("viewer", viewer);
    await makeUser("memberAssigned", member, [clientId]);
    const meta = (await as("get", "/projects/meta")).body;
    st = Object.fromEntries(meta.issueStatuses.map((s: Json) => [s.name, s.id]));
  });
  afterAll(async () => {
    jest.restoreAllMocks();
    await app.close();
  });

  // ======================================================================================
  describe("S1 · each state, the mapping, the audit record", () => {
    it("confirmed findings become Bugs with security and sev- labels and a priority from the severity; a lead a Task; a rejection no issue", async () => {
      const key = await project({ key: "AUD1" });
      const findings = [
        confirmed("fp-critical", "critical"),
        confirmed("fp-high", "high"),
        confirmed("fp-medium", "medium"),
        confirmed("fp-low", "low"),
        confirmed("fp-info", "informational"),
        lead("fp-lead"),
        rejected("fp-rejected"),
      ];
      const ledger = [
        { status: "covered" },
        { status: "covered" },
        { status: "candidate" },
        { status: "deferred" },
      ];
      const res = await audit(key, { findings, run: run("run-1"), ledger });
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({
        runId: "run-1",
        commit: "abcdef0123456789abcdef0123456789abcdef01",
        profile: "standard",
        scope: [],
        complete: true,
        incompleteReason: "",
        partial: false,
        coverage: { covered: 2, candidate: 1, deferred: 1 },
        findings: {
          total: 7,
          confirmed: 5,
          needsValidation: 1,
          rejected: 1,
          bySeverity: { critical: 1, high: 1, medium: 1, low: 1, informational: 1 },
        },
        created: ["AUD1-1", "AUD1-2", "AUD1-3", "AUD1-4", "AUD1-5", "AUD1-6"],
        updated: [],
        reopened: [],
        notReported: [],
        rejectedNoted: [],
        rejected: [
          {
            fingerprint: "fp-rejected",
            title: "Rejected fp-rejected",
            reason: "Not reachable from outside.",
          },
        ],
        importedBy: { id: uid["member"], fullName: `${TAG} member` },
        actorType: "USER",
        channel: "web",
      });
      expect(Object.keys(res.body).sort()).toEqual([
        "actorType",
        "channel",
        "commit",
        "complete",
        "coverage",
        "created",
        "createdAt",
        "findings",
        "id",
        "importedBy",
        "incompleteReason",
        "notReported",
        "partial",
        "profile",
        "rejected",
        "rejectedNoted",
        "reopened",
        "runId",
        "scope",
        "updated",
      ]);
      const expected: [string, string, string, string[], string][] = [
        ["fp-critical", "Bug", "URGENT", ["security", "sev-critical"], "critical"],
        ["fp-high", "Bug", "HIGH", ["security", "sev-high"], "high"],
        ["fp-medium", "Bug", "NORMAL", ["security", "sev-medium"], "medium"],
        ["fp-low", "Bug", "LOW", ["security", "sev-low"], "low"],
        ["fp-info", "Bug", "LOW", ["security", "sev-informational"], "informational"],
        ["fp-lead", "Task", "NORMAL", ["needs-validation", "security"], ""],
      ];
      for (const [fp, type, priority, labels, severity] of expected) {
        const i = await issueOf(fp, key);
        expect(i.type.name).toBe(type);
        expect(i.priority).toBe(priority);
        expect(labelsOf(i)).toEqual([...labels].sort());
        expect(i.status.name).toBe("New");
        expect(i.title).toBe(fp === "fp-lead" ? "Lead fp-lead" : `Confirmed ${fp}`);
        expect(i.description).toContain(
          fp === "fp-lead" ? "Possible fp-lead" : `Described ${fp}`,
        );
        const f = await db.securityFinding.findFirstOrThrow({
          where: { fingerprint: fp, project: { key } },
        });
        expect(f).toMatchObject({
          state: fp === "fp-lead" ? "needs_validation" : "confirmed",
          severity: severity || null,
          issueId: i.id,
        });
      }
      // the rejection is on the audit only
      expect(
        await db.securityFinding.count({ where: { fingerprint: "fp-rejected" } }),
      ).toBe(0);
      expect(await db.issue.count({ where: { project: { key } } })).toBe(6);
      // the labels exist with the skill's colours, though a Member may not create labels
      const sev = await db.label.findFirstOrThrow({
        where: { firmId, name: "sev-critical" },
      });
      expect(sev.colour).toBe("#82071e");
      // the record and the activity
      const row = await db.securityAudit.findFirstOrThrow({
        where: { project: { key } },
      });
      expect(row).toMatchObject({
        runId: "run-1",
        complete: true,
        profile: "standard",
        actorType: "USER",
        channel: "web",
      });
      const act = await db.projectActivity.findFirstOrThrow({
        where: { project: { key }, action: "security.audit" },
      });
      expect(act).toMatchObject({
        actorType: "USER",
        channel: "web",
        actorUserId: uid["member"],
        issueId: null,
      });
    });

    it("the coverage can come as counts when there is no ledger; findings can come as the text of findings.json", async () => {
      const key = await project({ key: "AUD2" });
      const res = await audit(key, {
        findings: JSON.stringify([confirmed("fp-a", "high")]),
        run: run("run-text", { profile: "deep" }),
        coverage: { covered: 40, candidate: 3, "Bad Key": 9, blocked: -2 },
      });
      expect(res.status).toBe(201);
      expect(res.body.profile).toBe("deep");
      expect(res.body.coverage).toEqual({ covered: 40, candidate: 3, blocked: 0 });
      expect(res.body.created).toEqual(["AUD2-1"]);
    });

    it("an audit with no run information is an incomplete standard run of the whole repository", async () => {
      const key = await project({ key: "AUD3" });
      const res = await audit(key, { findings: [] });
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({
        runId: "",
        commit: "",
        profile: "standard",
        complete: false,
        partial: true,
      });
      expect(res.body.findings.total).toBe(0);
    });
  });

  // ======================================================================================
  describe("S2 · the same fingerprint, the same issue", () => {
    it("a later run updates title, description, labels and priority (and a hand-added label stays); a lead that is confirmed becomes a Bug", async () => {
      const key = await project({ key: "UPD1" });
      await audit(key, {
        findings: [confirmed("fp-x", "high"), lead("fp-y")],
        run: run("run-a"),
      });
      const x = await issueOf("fp-x", key);
      const y = await issueOf("fp-y", key);
      await as("post", "/projects/admin/labels", "sa", {
        name: "custom",
        colour: "#445566",
      });
      const customId = (
        await db.label.findFirstOrThrow({ where: { firmId, name: "custom" } })
      ).id;
      await as("patch", `/projects/${key}/issues/${x.key}`, "sa", {
        labelIds: [...x.labels.map((l) => l.labelId), customId],
      });
      const res = await audit(key, {
        findings: [
          confirmed("fp-x", "critical", {
            title: "Renamed x",
            description: "New words x",
          }),
          confirmed("fp-y", "medium"),
        ],
        run: run("run-b"),
      });
      expect(res.status).toBe(201);
      expect(res.body.created).toEqual([]);
      expect(res.body.updated).toEqual([x.key, y.key]);
      expect(await db.issue.count({ where: { project: { key } } })).toBe(2);
      const nx = await issueOf("fp-x", key);
      expect(nx.id).toBe(x.id);
      expect(nx.title).toBe("Renamed x");
      expect(nx.description).toContain("New words x");
      expect(nx.priority).toBe("URGENT");
      expect(labelsOf(nx)).toEqual(["custom", "security", "sev-critical"]);
      const ny = await issueOf("fp-y", key);
      expect(ny.id).toBe(y.id);
      expect(ny.type.name).toBe("Bug");
      expect(labelsOf(ny)).toEqual(["security", "sev-medium"]);
      expect(ny.priority).toBe("NORMAL");
      const f = await db.securityFinding.findFirstOrThrow({
        where: { fingerprint: "fp-y", project: { key } },
      });
      expect(f).toMatchObject({ state: "confirmed", severity: "medium" });
      const second = await db.securityAudit.findFirstOrThrow({
        where: { runId: "run-b" },
      });
      expect(f.lastSeenAuditId).toBe(second.id);
      // the issue's own activity records the change
      expect(
        await db.projectActivity.count({
          where: { issueId: x.id, action: "issue.updated" },
        }),
      ).toBeGreaterThan(0);
    });

    it("the same fingerprint in another project is another finding", async () => {
      const a = await project({ key: "UPD2" });
      const b = await project({ key: "UPD3" });
      await audit(a, { findings: [confirmed("fp-shared", "low")], run: run("r") });
      const res = await audit(b, {
        findings: [confirmed("fp-shared", "low")],
        run: run("r"),
      });
      expect(res.body.created).toEqual(["UPD3-1"]);
    });

    it("a closed issue that is reported again is reopened to the default status, with a comment and a line in the activity; one not reported stays closed", async () => {
      const key = await project({ key: "REO1" });
      await audit(key, {
        findings: [confirmed("fp-back", "high"), confirmed("fp-gone", "medium")],
        run: run("run-a"),
      });
      const back = await issueOf("fp-back", key);
      const gone = await issueOf("fp-gone", key);
      await done(back.key);
      await done(gone.key);
      expect((await issueOf("fp-back", key)).closedAt).not.toBeNull();
      const res = await audit(key, {
        findings: [confirmed("fp-back", "high")],
        run: run("run-b", { run_status: "incomplete" }),
      });
      expect(res.body.reopened).toEqual([back.key]);
      expect(res.body.updated).toEqual([]);
      const reopened = await issueOf("fp-back", key);
      expect(reopened.status.name).toBe("New");
      expect(reopened.closedAt).toBeNull();
      expect((await comments(back.key)).map((c) => c.body)).toEqual([
        "Reopened: security audit run-b @ abcdef012345 reported this again as high.",
      ]);
      const act = await db.projectActivity.findMany({
        where: { issueId: back.id, action: "issue.updated" },
      });
      expect(JSON.stringify(act.map((a) => a.changes))).toContain("New");
      expect((await issueOf("fp-gone", key)).status.name).toBe("Done");
      // a lead reported again is reopened too, and says so
      await audit(key, { findings: [lead("fp-lead2")], run: run("run-c") });
      const l = await issueOf("fp-lead2", key);
      await done(l.key);
      const again = await audit(key, { findings: [lead("fp-lead2")], run: run("run-d") });
      expect(again.body.reopened).toEqual([l.key]);
      expect((await comments(l.key))[0]!.body).toBe(
        "Reopened: security audit run-d @ abcdef012345 reported this again (needs validation).",
      );
    });
  });

  // ======================================================================================
  describe("S3 · open findings a run did not report", () => {
    async function setup(prefix: string) {
      const key = await project({ key: prefix });
      await audit(key, {
        findings: [
          confirmed("fp-1", "high"),
          confirmed("fp-2", "medium"),
          lead("fp-3"),
          confirmed("fp-4", "low"),
        ],
        run: run("setup"),
      });
      await done((await issueOf("fp-4", key)).key); // closed: never commented
      // a security issue made by hand has no fingerprint: nothing to compare
      const hand = (
        await as("post", `/projects/${key}/issues`, "sa", { title: "By hand" })
      ).body;
      const sec = await db.label.findFirstOrThrow({
        where: { firmId, name: "security" },
      });
      await as("patch", `/projects/${key}/issues/${hand.key}`, "sa", {
        labelIds: [sec.id],
      });
      const plain = (
        await as("post", `/projects/${key}/issues`, "sa", { title: "Not security" })
      ).body;
      return { key, hand: hand.key as string, plain: plain.key as string };
    }

    it("a COMPLETE whole-repo run comments on each open security issue it did not report, and closes nothing", async () => {
      const { key, hand, plain } = await setup("NRP1");
      const [i2, i3, i4] = [
        await issueOf("fp-2", key),
        await issueOf("fp-3", key),
        await issueOf("fp-4", key),
      ];
      const res = await audit(key, {
        findings: [confirmed("fp-1", "high")],
        run: run("run-full"),
      });
      expect(res.body.notReported).toEqual([i2.key, i3.key]);
      for (const i of [i2, i3]) {
        expect((await comments(i.key)).map((c) => c.body)).toEqual([
          "Not reported by security audit run-full @ abcdef012345. If the fix is merged, verify it and close this issue.",
        ]);
        expect(
          (
            await db.issue.findUniqueOrThrow({
              where: { id: i.id },
              include: { status: true },
            })
          ).status.name,
        ).toBe("New");
      }
      expect(await comments(i4.key)).toHaveLength(0); // closed
      expect(await comments(hand)).toHaveLength(0); // no fingerprint
      expect(await comments(plain)).toHaveLength(0); // not a security issue
      expect((await issueOf("fp-1", key)).key).toBeTruthy();
      expect(await comments((await issueOf("fp-1", key)).key)).toHaveLength(0); // it was reported
    });

    it.each([
      [
        "an incomplete run",
        { run_status: "incomplete", incomplete_reason: "ran out of time" },
      ],
      ["a run still in progress", { run_status: "in_progress" }],
      ["a run limited to some paths", { scope_paths: ["src/auth"] }],
      ["a quick run", { profile: "quick" }],
    ])("%s comments on nothing", async (_name, meta) => {
      const { key } = await setup(`NRP${(seq += 1)}`);
      const res = await audit(key, {
        findings: [confirmed("fp-1", "high")],
        run: run("run-partial", meta as Json),
      });
      expect(res.status).toBe(201);
      expect(res.body.notReported).toEqual([]);
      expect(res.body.partial).toBe(true);
      expect(
        await db.issueComment.count({ where: { issue: { project: { key } } } }),
      ).toBe(0);
    });

    it("a run with no metadata at all comments on nothing either", async () => {
      const { key } = await setup(`NRP${(seq += 1)}`);
      const res = await audit(key, { findings: [confirmed("fp-1", "high")] });
      expect(res.body.notReported).toEqual([]);
      expect(
        await db.issueComment.count({ where: { issue: { project: { key } } } }),
      ).toBe(0);
    });

    it("a rejection of a lead that is an open issue leaves a comment on it; a rejection with no issue leaves nothing", async () => {
      const key = await project({ key: "REJ1" });
      await audit(key, { findings: [lead("fp-l")], run: run("a") });
      const l = await issueOf("fp-l", key);
      const res = await audit(key, {
        findings: [rejected("fp-l", { reason: "Dead code." }), rejected("fp-unknown")],
        run: run("b", { scope_paths: ["x"] }),
      });
      expect(res.body.rejectedNoted).toEqual([l.key]);
      expect(res.body.created).toEqual([]);
      expect(res.body.rejected.map((r: Json) => r.fingerprint)).toEqual([
        "fp-l",
        "fp-unknown",
      ]);
      expect((await comments(l.key)).map((c) => c.body)).toEqual([
        "Security audit b @ abcdef012345 rejected this lead: Dead code.\n\nReview and close it if you agree.",
      ]);
      expect(
        (
          await db.issue.findUniqueOrThrow({
            where: { id: l.id },
            include: { status: true },
          })
        ).status.name,
      ).toBe("New");
    });
  });

  // ======================================================================================
  describe("S4 · history, status, portfolio and overview", () => {
    it("the history is newest first; the status counts open findings by severity, leads and unrated, and names who blocks", async () => {
      const key = await project({ key: "STA1" });
      expect((await as("get", `/projects/${key}/audits`, "viewer")).body).toEqual({
        items: [],
      });
      const never = (await as("get", `/projects/${key}/security`, "viewer")).body;
      expect(never).toEqual({
        projectKey: key,
        state: "clear",
        blockedBy: [],
        counts: {
          open: 0,
          critical: 0,
          high: 0,
          medium: 0,
          low: 0,
          informational: 0,
          needsValidation: 0,
          unrated: 0,
        },
        open: [],
        lastAudit: null,
      });
      await audit(key, { findings: [confirmed("a", "low")], run: run("r1") });
      await audit(key, {
        findings: [
          confirmed("a", "low"),
          confirmed("b", "critical"),
          confirmed("c", "high"),
          confirmed("d", "medium"),
          confirmed("e", "informational"),
          lead("f"),
        ],
        run: run("r2"),
      });
      const sec = await db.label.findFirstOrThrow({
        where: { firmId, name: "security" },
      });
      const hand = (
        await as("post", `/projects/${key}/issues`, "sa", { title: "Unrated by hand" })
      ).body;
      await as("patch", `/projects/${key}/issues/${hand.key}`, "sa", {
        labelIds: [sec.id],
      });

      const hist = (await as("get", `/projects/${key}/audits`, "viewer")).body;
      expect(hist.items.map((a: Json) => a.runId)).toEqual(["r2", "r1"]);
      expect(
        (await as("get", `/projects/${key}/audits?limit=1`, "viewer")).body.items,
      ).toHaveLength(1);

      const s = (await as("get", `/projects/${key}/security`, "viewer")).body;
      expect(s.state).toBe("blocked");
      expect(s.blockedBy).toEqual([
        (await issueOf("b", key)).key,
        (await issueOf("c", key)).key,
      ]);
      expect(s.counts).toEqual({
        open: 7,
        critical: 1,
        high: 1,
        medium: 1,
        low: 1,
        informational: 1,
        needsValidation: 1,
        unrated: 1,
      });
      expect(s.lastAudit.runId).toBe("r2");
      expect(Object.keys(s.open[0]).sort()).toEqual([
        "fingerprint",
        "key",
        "needsValidation",
        "severity",
        "title",
      ]);
      const byKey = Object.fromEntries(s.open.map((o: Json) => [o.key, o]));
      expect(byKey[hand.key]).toMatchObject({
        severity: null,
        needsValidation: false,
        fingerprint: null,
      });
      expect(byKey[(await issueOf("f", key)).key]).toMatchObject({
        severity: null,
        needsValidation: true,
        fingerprint: "f",
      });
      expect(byKey[(await issueOf("b", key)).key]).toMatchObject({
        severity: "critical",
        fingerprint: "b",
      });

      // closing the two that block: findings remain, the gate opens; closing all: clear
      await done((await issueOf("b", key)).key);
      await done((await issueOf("c", key)).key);
      const open = (await as("get", `/projects/${key}/security`, "viewer")).body;
      expect(open.state).toBe("open");
      expect(open.blockedBy).toEqual([]);
      expect(open.counts.open).toBe(5);
      for (const fp of ["a", "d", "e", "f"]) await done((await issueOf(fp, key)).key);
      await done(hand.key);
      expect((await as("get", `/projects/${key}/security`, "viewer")).body.state).toBe(
        "clear",
      );
    });

    it("the portfolio and the overview each carry a security state, additive to their shapes", async () => {
      const blocked = await project({ key: "PRT1" });
      const open = await project({ key: "PRT2" });
      const clear = await project({ key: "PRT3" });
      await audit(blocked, {
        findings: [
          confirmed("a", "critical"),
          confirmed("b", "high"),
          confirmed("c", "low"),
        ],
        run: run("r"),
      });
      await audit(open, { findings: [confirmed("a", "low"), lead("b")], run: run("r") });
      const list = (await as("get", "/projects", "viewer")).body as Json[];
      const by = Object.fromEntries(list.map((p) => [p.key, p.security]));
      expect(by["PRT1"]).toEqual({ state: "blocked", open: 3, critical: 1, high: 1 });
      expect(by["PRT2"]).toEqual({ state: "open", open: 2, critical: 0, high: 0 });
      expect(by["PRT3"]).toEqual({ state: "clear", open: 0, critical: 0, high: 0 });
      const ov = (await as("get", `/projects/${blocked}`, "viewer")).body;
      expect(ov.security).toEqual({ state: "blocked", open: 3, critical: 1, high: 1 });
      expect((await as("get", `/projects/${clear}`, "viewer")).body.security.state).toBe(
        "clear",
      );
      // everything that was there is still there
      for (const k of [
        "project",
        "status",
        "counts",
        "openMilestones",
        "inProgress",
        "recentActivity",
      ]) {
        expect(ov[k]).toBeDefined();
      }
      expect(list[0]!.counts).toBeDefined();
    });

    it("history and status need Projects:Read and follow visibility", async () => {
      const key = await project({ key: "VIS1", clientId });
      expect((await as("get", `/projects/${key}/audits`, "member")).status).toBe(404);
      expect((await as("get", `/projects/${key}/security`, "member")).status).toBe(404);
      expect(
        (await as("get", `/projects/${key}/security`, "memberAssigned")).status,
      ).toBe(200);
      expect((await as("get", `/projects/NOPE/audits`)).status).toBe(404);
    });
  });

  // ======================================================================================
  describe("S5 · the release gate", () => {
    it("a milestone cannot be closed while critical or high security issues are open; the sentence names the keys; closing them opens the gate", async () => {
      const key = await project({ key: "GAT1" });
      const ms = (
        await as("post", `/projects/${key}/milestones`, "sa", { name: "Release" })
      ).body;
      await audit(key, {
        findings: [
          confirmed("a", "high"),
          confirmed("b", "medium"),
          confirmed("c", "critical"),
          lead("d"),
        ],
        run: run("r"),
      });
      const [a, c] = [(await issueOf("a", key)).key, (await issueOf("c", key)).key];
      const refused = await as("patch", `/projects/${key}/milestones/${ms.id}`, "sa", {
        state: "CLOSED",
      });
      expect(refused.status).toBe(409);
      expect(refused.body.message).toBe(gate(`${a}, ${c}`));
      expect((await db.milestone.findUniqueOrThrow({ where: { id: ms.id } })).state).toBe(
        "OPEN",
      );
      // locking is not closing; other changes to the milestone are fine
      expect(
        (
          await as("patch", `/projects/${key}/milestones/${ms.id}`, "sa", {
            state: "LOCKED",
          })
        ).status,
      ).toBe(200);
      expect(
        (
          await as("patch", `/projects/${key}/milestones/${ms.id}`, "sa", {
            name: "Release 1",
          })
        ).status,
      ).toBe(200);
      // a locked milestone is refused too
      expect(
        (
          await as("patch", `/projects/${key}/milestones/${ms.id}`, "sa", {
            state: "CLOSED",
          })
        ).status,
      ).toBe(409);
      // one fixed, one still open: the sentence shrinks
      await done(a);
      const one = await as("patch", `/projects/${key}/milestones/${ms.id}`, "sa", {
        state: "CLOSED",
      });
      expect(one.body.message).toBe(gate(c));
      await done(c);
      const closed = await as("patch", `/projects/${key}/milestones/${ms.id}`, "sa", {
        state: "CLOSED",
      });
      expect(closed.status).toBe(200);
      expect(closed.body.state).toBe("CLOSED");
      // medium, a lead and unrated never blocked
      expect((await issueOf("b", key)).status.name).toBe("New");
    });

    it("issues labelled security by hand without a sev label are unrated and do not block; a hand-made sev-high does", async () => {
      const key = await project({ key: "GAT2" });
      const ms = (await as("post", `/projects/${key}/milestones`, "sa", { name: "R" }))
        .body;
      await audit(key, { findings: [confirmed("seed", "low")], run: run("r") }); // creates the labels
      const sec = await db.label.findFirstOrThrow({
        where: { firmId, name: "security" },
      });
      const high = await db.label.findFirstOrThrow({
        where: { firmId, name: "sev-high" },
      });
      const unrated = (
        await as("post", `/projects/${key}/issues`, "sa", {
          title: "Unrated",
          labelIds: [sec.id],
        })
      ).body;
      expect(
        (
          await as("patch", `/projects/${key}/milestones/${ms.id}`, "sa", {
            state: "CLOSED",
          })
        ).status,
      ).toBe(200);
      await as("patch", `/projects/${key}/milestones/${ms.id}`, "sa", { state: "OPEN" });
      await as("patch", `/projects/${key}/issues/${unrated.key}`, "sa", {
        labelIds: [sec.id, high.id],
      });
      const refused = await as("patch", `/projects/${key}/milestones/${ms.id}`, "sa", {
        state: "CLOSED",
      });
      expect(refused.status).toBe(409);
      expect(refused.body.message).toBe(gate(unrated.key));
      // a high that is not labelled security is just an issue
      await as("patch", `/projects/${key}/issues/${unrated.key}`, "sa", {
        labelIds: [high.id],
      });
      expect(
        (
          await as("patch", `/projects/${key}/milestones/${ms.id}`, "sa", {
            state: "CLOSED",
          })
        ).status,
      ).toBe(200);
    });

    it("the gate is per project and says the same through the MCP", async () => {
      const a = await project({ key: "GAT3" });
      const b = await project({ key: "GAT4" });
      await audit(a, { findings: [confirmed("x", "critical")], run: run("r") });
      const msB = (
        await as("post", `/projects/${b}/milestones`, "sa", { name: "B release" })
      ).body;
      expect(
        (
          await as("patch", `/projects/${b}/milestones/${msB.id}`, "sa", {
            state: "CLOSED",
          })
        ).status,
      ).toBe(200);
      const msA = (
        await as("post", `/projects/${a}/milestones`, "sa", { name: "A release" })
      ).body;
      const token = await mint("member");
      const r = await tool(token, "save_milestone", {
        project_key: a,
        name: "A release",
        state: "closed",
      });
      expect(r.isError).toBe(true);
      expect(r.text).toBe(gate((await issueOf("x", a)).key));
      expect(
        (await db.milestone.findUniqueOrThrow({ where: { id: msA.id } })).state,
      ).toBe("OPEN");
    });
  });

  // ======================================================================================
  describe("S6 · validation, permissions, tokens, one transaction", () => {
    it("findings that cannot be read are a 400 with the helper's sentence and nothing is made", async () => {
      const key = await project({ key: "VAL1" });
      const none = await audit(key, {});
      expect(none.status).toBe(400);
      expect(none.body.message).toBe("Validation failed");
      const notArray = await audit(key, { findings: { verdict: "confirmed" } });
      expect(notArray.status).toBe(400);
      const dup = await audit(key, {
        findings: [confirmed("same", "low"), lead("same")],
      });
      expect(dup.status).toBe(400);
      expect(dup.body.message).toContain("same");
      const noSeverity = await audit(key, {
        findings: [{ ...confirmed("nosev", "low"), severity: {} }],
      });
      expect(noSeverity.status).toBe(400);
      expect(noSeverity.body.message).toContain("nosev");
      const badText = await audit(key, { findings: "[not json" });
      expect(badText.status).toBe(400);
      expect(await db.securityAudit.count({ where: { project: { key } } })).toBe(0);
      expect(await db.issue.count({ where: { project: { key } } })).toBe(0);
    });

    it("a findings file of more than 100 KB is read (up to 5 MB); a bigger one is a 413 and nothing is made", async () => {
      const key = await project({ key: "BIG1" });
      const long = "x".repeat(10_000);
      const findings = Array.from({ length: 20 }, (_, n) =>
        confirmed(`big-${n}`, "low", { description: long }),
      );
      const ok = await audit(key, { findings, run: run("big") });
      expect(ok.status).toBe(201);
      expect(ok.body.created).toHaveLength(20);
      const huge = await http()
        .post(`${API}/projects/${key}/audits`)
        .set("Authorization", `Bearer ${jwt["member"]}`)
        .set("Content-Type", "application/json")
        .send(JSON.stringify({ findings: [], pad: "y".repeat(5_100_000) }));
      expect(huge.status).toBe(413);
      expect(huge.body).toEqual({ statusCode: 413, message: "Request too large." });
      expect(await db.securityAudit.count({ where: { project: { key } } })).toBe(1);
    });

    it("a Viewer is refused, a project the caller cannot see is a 404", async () => {
      const key = await project({ key: "PER1" });
      const v = await audit(key, { findings: [] }, "viewer");
      expect(v.status).toBe(403);
      expect(v.body.message).toBe(missing("Projects:Create", "Projects:Update"));
      const hidden = await project({ key: "PER2", clientId });
      expect((await audit(hidden, { findings: [] }, "member")).status).toBe(404);
      expect((await audit(hidden, { findings: [] }, "memberAssigned")).status).toBe(201);
    });

    it("a personal token may import: read_write does it as the api channel, a read token is refused", async () => {
      const key = await project({ key: "TOK1" });
      const rw = await mint("member");
      const ro = await mint("member", "read");
      const refused = await http()
        .post(`${API}/projects/${key}/audits`)
        .set("Authorization", `Bearer ${ro}`)
        .send({ findings: [confirmed("a", "low")] });
      expect(refused.status).toBe(403);
      expect(refused.body.message).toBe(READ_ONLY);
      const ok = await http()
        .post(`${API}/projects/${key}/audits`)
        .set("Authorization", `Bearer ${rw}`)
        .send({ findings: [confirmed("a", "low")], run: run("t") });
      expect(ok.status).toBe(201);
      expect(ok.body).toMatchObject({ actorType: "USER", channel: "api" });
      expect(
        (
          await http()
            .get(`${API}/projects/${key}/security`)
            .set("Authorization", `Bearer ${ro}`)
        ).status,
      ).toBe(200);
    });

    it("one transaction: a failure part way leaves no issue, no finding, no audit, no label, no comment", async () => {
      const key = await project({ key: "ROL1" });
      await audit(key, { findings: [confirmed("old", "high")], run: run("first") });
      const before = {
        issues: await db.issue.count({ where: { project: { key } } }),
        audits: await db.securityAudit.count({ where: { project: { key } } }),
        findings: await db.securityFinding.count({ where: { project: { key } } }),
        comments: await db.issueComment.count({ where: { issue: { project: { key } } } }),
        activity: await db.projectActivity.count({ where: { project: { key } } }),
      };
      const activity = app.get(ProjectsActivity);
      const original = activity.log.bind(activity);
      let calls = 0;
      const spy = jest.spyOn(activity, "log").mockImplementation(async (...args) => {
        calls += 1;
        if (calls === 3) throw new Error("the database went away");
        return original(...args);
      });
      try {
        const res = await audit(key, {
          findings: [
            confirmed("new1", "low"),
            confirmed("new2", "low"),
            confirmed("new3", "low"),
          ],
          run: run("second"), // complete: the old finding would also be commented on
        });
        expect(res.status).toBe(500);
      } finally {
        spy.mockRestore();
      }
      expect({
        issues: await db.issue.count({ where: { project: { key } } }),
        audits: await db.securityAudit.count({ where: { project: { key } } }),
        findings: await db.securityFinding.count({ where: { project: { key } } }),
        comments: await db.issueComment.count({ where: { issue: { project: { key } } } }),
        activity: await db.projectActivity.count({ where: { project: { key } } }),
      }).toEqual(before);
    });
  });

  // ======================================================================================
  describe("S7 · the MCP tools", () => {
    it("import_security_audit answers the counts and the keys; get_security_status answers the gate and the open issues", async () => {
      const key = await project({ key: "MCP1" });
      const token = await mint("member");
      const never = await tool(token, "get_security_status", { project_key: key });
      expect(never.text).toBe(
        [
          `# ${key} security`,
          "Never audited.",
          "Release gate: clear (no open critical or high security issues)",
          "",
          "## Open security issues",
          "- none",
        ].join("\n"),
      );
      const r = await tool(token, "import_security_audit", {
        project_key: key,
        findings: [
          confirmed("a", "critical"),
          confirmed("b", "high"),
          lead("c"),
          rejected("d"),
        ],
        run: {
          run_id: "mcp-run",
          source_ref: "1234567890abcdef",
          profile: "standard",
          scope_paths: [],
          run_status: "complete",
        },
        coverage: { covered: 3 },
      });
      expect(r.isError).toBeFalsy();
      const audit1 = await db.securityAudit.findFirstOrThrow({
        where: { project: { key } },
      });
      expect(audit1).toMatchObject({
        actorType: "CLAUDE",
        channel: "mcp",
        importedById: uid["member"],
      });
      expect(r.text.split("\n")).toEqual([
        `Imported audit ${audit1.id} into ${key}.`,
        "Confirmed: 1 critical, 1 high. Needs validation: 1. Rejected: 1.",
        `Created: ${key}-1, ${key}-2, ${key}-3`,
      ]);
      const s = await tool(token, "get_security_status", { project_key: key });
      expect(s.text).toContain(`# ${key} security`);
      expect(s.text).toMatch(
        /Last audit: \d{4}-\d{2}-\d{2} \d{2}:\d{2}, standard, whole repo, commit 1234567890ab/,
      );
      expect(s.text).toContain(`Release gate: BLOCKED by ${key}-1, ${key}-2`);
      expect(s.text).toContain(`- ${key}-1 [critical] Confirmed a`);
      expect(s.text).toContain(`- ${key}-3 [needs validation] Lead c`);
      // a second run: updated, reopened, not reported, and the history line
      await done(`${key}-2`);
      const r2 = await tool(token, "import_security_audit", {
        project_key: key,
        findings: JSON.stringify([confirmed("b", "high"), rejected("c")]),
        run: {
          run_id: "mcp-run-2",
          source_ref: "fedcba0987654321",
          run_status: "complete",
        },
      });
      expect(r2.text).toContain("Reopened: " + `${key}-2`);
      expect(r2.text).toContain(
        `Open but not reported this run (check if fixed): ${key}-1`,
      );
      expect(r2.text).toContain(
        `Open issues this run rejected (comment added): ${key}-3`,
      );
      const s2 = await tool(token, "get_security_status", { project_key: key });
      expect(s2.text).toContain("## Recent audits");
      expect(s2.text).toMatch(
        /- \d{4}-\d{2}-\d{2} standard @ fedcba098765: 1 high, 0 needs validation/,
      );
    });

    it("the tools are listed (18 in all), refuse a read token and a Viewer, and tag the audit CLAUDE through mcp", async () => {
      const key = await project({ key: "MCP2" });
      const list = await http()
        .post(`${API}/projects/mcp`)
        .set("Authorization", `Bearer ${await mint("member")}`)
        .set("Accept", ACCEPT)
        .send({ jsonrpc: "2.0", id: rpcId++, method: "tools/list" });
      const names = list.body.result.tools.map((t: Json) => t.name);
      expect(names).toHaveLength(18);
      expect(names).toEqual(
        expect.arrayContaining(["import_security_audit", "get_security_status"]),
      );
      const tools = Object.fromEntries(
        list.body.result.tools.map((t: Json) => [t.name, t]),
      );
      expect(tools["get_security_status"].annotations.readOnlyHint).toBe(true);
      expect(tools["import_security_audit"].annotations.readOnlyHint).toBe(false);
      for (const who of ["member", "viewer"]) {
        const scope = who === "member" ? "read" : "read_write";
        const t = await mint(who, scope);
        const r = await tool(t, "import_security_audit", {
          project_key: key,
          findings: [],
        });
        expect(r.isError).toBe(true);
        expect(r.text).toBe(READ_ONLY);
        expect(
          (await tool(t, "get_security_status", { project_key: key })).isError,
        ).toBeFalsy();
      }
      expect(await db.securityAudit.count({ where: { project: { key } } })).toBe(0);
      const bad = await tool(await mint("member"), "import_security_audit", {
        project_key: key,
        findings: [{ verdict: "maybe" }],
      });
      expect(bad.isError).toBe(true);
      expect(bad.text).toContain("verdict");
      expect(
        (await tool(await mint("member"), "get_security_status", { project_key: "NOPE" }))
          .text,
      ).toBe("Project not found.");
    });
  });
});
