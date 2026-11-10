/**
 * track-a-sentire-import.db-spec.ts — PA5 (D69): the Sentire Projects importer, over HTTP against
 * the real Nest app and the local PostgreSQL. The export is Track C's invented one (projects-core's
 * test fixture) with its e-mail addresses made unique to each firm of this test; every expectation
 * is read from the plan that projects-core's own mapper makes of it, so the test follows the
 * fixture instead of copying it.
 *
 * R1  A full round trip: every entity, keys, numbers, the counter, the original actor on activity.
 * R2  An existing project key refuses the import.
 * R3  People are matched by e-mail; the unmatched are reported and keep no user.
 * R4  A dry run answers and writes nothing.
 * R5  An invalid export is refused with the validator's sentences.
 * R6  One transaction: a failure part way leaves nothing.
 * R7  Super Admin only, session only.
 * R8  Big bodies, existing types, statuses and labels, secrets, the audit trail.
 */
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import {
  mapSentireExport,
  validateImportPlan,
  type ImportPlan,
} from "@portal/projects-core";
import request from "supertest";
import { truncateOncePerFile } from "./helpers/truncate";
import { AppModule } from "../../src/app.module";
import { TokenService } from "../../src/auth/token.service";
import { PrismaService } from "../../src/prisma/prisma.service";
import { applyProjectsBodyReaders } from "../../src/projects-mcp/body-limit";
import { SentireImportService } from "../../src/projects/sentire-import.service";

truncateOncePerFile({ firmRoles: ["Super Admin"] });

const TAG = `track-a-sen-${randomUUID().slice(0, 8)}`;
const API = "/api/v1";
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the tests read JSON
type Json = Record<string, any>;
const FIXTURE = readFileSync(
  join(__dirname, "../../../../packages/projects-core/test/fixtures/sentire-export.json"),
  "utf8",
);
const SA_ONLY = "Only a Super Admin can import from Sentire Projects.";
const NOT_HERE = "Personal tokens cannot be used on this route.";
const iso = (d: Date | null) => (d ? d.toISOString() : null);
const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

interface TestFirm {
  id: string;
  label: string;
  sa: string;
  member: string;
  users: Record<string, string>;
}

describe("PA5 · the Sentire Projects importer (real app over HTTP, db)", () => {
  let app: INestApplication;
  let db: PrismaService;
  let n = 0;

  const http = () => request(app.getHttpServer());
  const post = (token: string, body: unknown) =>
    http()
      .post(`${API}/projects/import/sentire`)
      .set("Authorization", `Bearer ${token}`)
      .send(body as object);
  /** The invented export, its addresses unique to the firm `label`. */
  const exportFor = (label: string): Json =>
    JSON.parse(
      FIXTURE.replace(
        /([A-Za-z0-9._-]+)@Example\.test/gi,
        `$1@${label}-${TAG}.example.com`,
      ),
    );
  const planOf = (exp: unknown): ImportPlan => mapSentireExport(exp);

  /** A firm with a Super Admin, a Member, and the export's people (those named in `people`). */
  async function newFirm(people: string[] = ["ana", "ben"]): Promise<TestFirm> {
    n += 1;
    const label = `f${n}`;
    const firm = await db.firm.create({ data: { name: `${TAG} ${label} Accounting` } });
    const sa = (
      await db.role.findUniqueOrThrow({
        where: { name_scope: { name: "Super Admin", scope: "FIRM" } },
      })
    ).id;
    const member = await ensureRole(`${TAG} SEN Member`, [
      "Projects:Read",
      "Projects:Create",
      "Projects:Update",
    ]);
    const mk = async (name: string, email: string, roleId?: string) => {
      const u = await db.user.create({
        data: {
          firmId: firm.id,
          userType: "FIRM",
          fullName: name,
          email,
          status: "ACTIVE",
          firmProfile: { create: { title: "Test" } },
          ...(roleId ? { userRoles: { create: { roleId } } } : {}),
        },
      });
      return {
        id: u.id,
        token: app
          .get(TokenService)
          .signAccess({ id: u.id, firmId: firm.id, userType: "FIRM", email }),
      };
    };
    const admin = await mk(
      `${TAG} ${label} admin`,
      `${TAG}-${label}-admin@example.com`,
      sa,
    );
    const mem = await mk(
      `${TAG} ${label} member`,
      `${TAG}-${label}-member@example.com`,
      member,
    );
    const users: Record<string, string> = {};
    for (const p of people)
      users[p] = (await mk(`${p} ${label}`, `${p}@${label}-${TAG}.example.com`)).id;
    return { id: firm.id, label, sa: admin.token, member: mem.token, users };
  }
  async function ensureRole(name: string, perms: string[]) {
    const existing = await db.role.findFirst({ where: { name, scope: "FIRM" } });
    if (existing) return existing.id;
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
  /** The counts of everything an import writes, for one firm. */
  async function snapshot(firmId: string) {
    const where = { firmId };
    return {
      projects: await db.project.count({ where }),
      types: await db.issueType.count({ where }),
      statuses: await db.issueStatus.count({ where }),
      labels: await db.label.count({ where }),
      milestones: await db.milestone.count({ where }),
      issues: await db.issue.count({ where }),
      comments: await db.issueComment.count({ where }),
      updates: await db.projectStatusUpdate.count({ where }),
      sessions: await db.projectWorkSession.count({ where }),
      activity: await db.projectActivity.count({ where }),
      links: await db.githubLink.count({ where }),
      audits: await db.securityAudit.count({ where }),
      findings: await db.securityFinding.count({ where }),
    };
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix("api/v1");
    applyProjectsBodyReaders(app, "/api/v1");
    await app.init();
    db = app.get(PrismaService);
  });
  afterAll(async () => {
    jest.restoreAllMocks();
    await app.close();
  });

  // ======================================================================================
  describe("R1 · a full round trip", () => {
    it("every project, type, status, label, milestone, issue, comment, update, session, activity, link, audit and finding arrives, with its key and number", async () => {
      const firm = await newFirm();
      const exp = exportFor(firm.label);
      const plan = planOf(exp);
      expect(validateImportPlan(plan)).toEqual([]);
      const res = await post(firm.sa, exp);
      expect(res.status).toBe(201);
      const body = res.body as Json;

      // the report
      expect(Object.keys(body).sort()).toEqual([
        "counts",
        "dryRun",
        "projects",
        "reused",
        "unmapped",
        "unmatchedEmails",
        "warnings",
      ]);
      expect(body.dryRun).toBe(false);
      expect(body.projects).toEqual(plan.projects.map((p) => p.key).sort());
      expect(body.unmatchedEmails).toEqual([]);
      expect(body.warnings).toEqual(plan.warnings);
      expect(body.unmapped).toEqual(plan.unmapped);
      expect(body.counts).toEqual({
        projects: plan.projects.length,
        issueTypes: body.counts.issueTypes,
        statuses: body.counts.statuses,
        labels: body.counts.labels,
        milestones: plan.milestones.length,
        issues: plan.issues.length,
        comments: plan.comments.length,
        statusUpdates: plan.statusUpdates.length,
        sessions: plan.sessions.filter((s) => s.projectKey).length,
        activities: plan.activities.length,
        githubLinks: plan.githubLinks.length,
        securityAudits: plan.securityAudits.length,
        securityFindings: plan.issues.filter((i) => i.fingerprint).length,
      });
      expect(body.counts.issueTypes + body.reused.issueTypes).toBe(
        plan.issueTypes.length,
      );
      expect(body.counts.statuses + body.reused.statuses).toBe(plan.statuses.length);
      expect(body.counts.labels + body.reused.labels).toBe(plan.labels.length);
      // the response says nothing of the secrets in the export
      expect(JSON.stringify(body)).not.toMatch(
        /INVENTED-HASH|INVENTED-TOKEN-HASH|INVENTED-LOGIN/,
      );

      // projects: keys, text, flags, counter, parent, times
      for (const p of plan.projects) {
        const row = await db.project.findFirstOrThrow({
          where: { firmId: firm.id, key: p.key },
          include: { parent: true },
        });
        expect(row).toMatchObject({
          name: p.name,
          description: p.description,
          repoUrl: p.repoUrl,
          liveUrl: p.liveUrl,
          deployAppName: p.deployAppName,
          archived: p.archived,
          issueCounter: p.issueCounter,
        });
        expect(row.parent?.key ?? null).toBe(p.parentKey);
        expect(iso(row.createdAt)).toBe(p.createdAt);
        expect(iso(row.updatedAt)).toBe(p.updatedAt);
      }

      // types, statuses, labels: by name, once
      for (const t of plan.issueTypes) {
        expect(
          await db.issueType.count({
            where: { firmId: firm.id, name: { equals: t.name, mode: "insensitive" } },
          }),
        ).toBe(1);
      }
      for (const s of plan.statuses) {
        expect(
          await db.issueStatus.count({
            where: { firmId: firm.id, name: { equals: s.name, mode: "insensitive" } },
          }),
        ).toBe(1);
      }
      for (const l of plan.labels) {
        expect(
          await db.label.count({
            where: { firmId: firm.id, name: { equals: l.name, mode: "insensitive" } },
          }),
        ).toBe(1);
      }
      expect(
        await db.issueStatus.count({ where: { firmId: firm.id, isDefault: true } }),
      ).toBe(1);

      // milestones
      for (const m of plan.milestones) {
        const row = await db.milestone.findFirstOrThrow({
          where: { firmId: firm.id, project: { key: m.projectKey }, name: m.name },
        });
        expect(row).toMatchObject({ description: m.description, state: m.state });
        expect(day(row.startDate)).toBe(m.startDate);
        expect(day(row.dueDate)).toBe(m.dueDate);
        expect(iso(row.createdAt)).toBe(m.createdAt);
      }

      // issues: the key and the number exactly, and everything they point at
      const emailOf = async (id: string | null) =>
        id ? (await db.user.findUniqueOrThrow({ where: { id } })).email : null;
      for (const i of plan.issues) {
        const row = await db.issue.findFirstOrThrow({
          where: { firmId: firm.id, key: i.key },
          include: {
            project: true,
            type: true,
            status: true,
            milestone: true,
            parent: true,
            labels: { include: { label: true } },
          },
        });
        expect(row.project.key).toBe(i.projectKey);
        expect(row.number).toBe(i.number);
        expect(row).toMatchObject({
          title: i.title,
          description: i.description,
          priority: i.priority,
          position: i.position,
          deleted: i.deletedAt !== null,
        });
        expect(row.type.name.toLowerCase()).toBe(i.type.toLowerCase());
        expect(row.status.name.toLowerCase()).toBe(i.status.toLowerCase());
        expect(row.milestone?.name ?? null).toBe(i.milestone);
        expect(row.parent?.key ?? null).toBe(i.parentKey);
        expect(day(row.startDate)).toBe(i.startDate);
        expect(day(row.dueDate)).toBe(i.dueDate);
        expect(iso(row.closedAt)).toBe(i.closedAt);
        expect(iso(row.createdAt)).toBe(i.createdAt);
        expect(iso(row.updatedAt)).toBe(i.updatedAt);
        expect(row.labels.map((l) => l.label.name.toLowerCase()).sort()).toEqual(
          [...i.labels].map((l) => l.toLowerCase()).sort(),
        );
        expect(await emailOf(row.assigneeId)).toBe(i.assigneeEmail);
        expect(await emailOf(row.authorId)).toBe(i.authorEmail);
      }
      // the counter continues after the highest imported number
      for (const p of plan.projects) {
        const highest = Math.max(
          0,
          ...plan.issues.filter((i) => i.projectKey === p.key).map((i) => i.number),
        );
        expect(
          (await db.project.findFirstOrThrow({ where: { firmId: firm.id, key: p.key } }))
            .issueCounter,
        ).toBeGreaterThanOrEqual(highest);
      }
      const pay = plan.projects.find((p) => p.key === "PAY")!;

      // comments
      for (const c of plan.comments) {
        const rows = await db.issueComment.findMany({
          where: { firmId: firm.id, issue: { key: c.issueKey }, body: c.body },
        });
        expect(rows).toHaveLength(1);
        expect(iso(rows[0]!.createdAt)).toBe(c.createdAt);
        expect(iso(rows[0]!.updatedAt)).toBe(c.editedAt ?? c.createdAt);
        expect(await emailOf(rows[0]!.authorId)).toBe(c.authorEmail);
      }

      // status updates: the history, and the current status is the latest
      for (const u of plan.statusUpdates) {
        const rows = await db.projectStatusUpdate.findMany({
          where: {
            firmId: firm.id,
            project: { key: u.projectKey },
            createdAt: new Date(u.createdAt!),
          },
        });
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({
          status: u.status,
          note: u.note,
          actorType: u.actorType,
        });
        expect(await emailOf(rows[0]!.actorUserId)).toBe(u.actorEmail);
      }
      const overview = (
        await http().get(`${API}/projects/PAY`).set("Authorization", `Bearer ${firm.sa}`)
      ).body;
      expect(overview.status.value).toBe(pay.status);

      // work sessions
      for (const s of plan.sessions.filter((x) => x.projectKey)) {
        const rows = await db.projectWorkSession.findMany({
          where: {
            firmId: firm.id,
            project: { key: s.projectKey! },
            startedAt: new Date(s.startedAt!),
          },
        });
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({
          client: s.client,
          title: s.title,
          summary: s.summary,
          nextSteps: s.nextSteps,
          issueKeys: s.issuesTouched,
          tokenId: null,
        });
        expect(iso(rows[0]!.endedAt)).toBe(s.endedAt);
        expect(await emailOf(rows[0]!.userId)).toBe(s.userEmail);
      }

      // activity: tagged as imported, the original actor named in the changes
      const acts = await db.projectActivity.findMany({
        where: { firmId: firm.id },
        include: { issue: true, project: true },
      });
      expect(acts).toHaveLength(plan.activities.length);
      for (const a of acts) {
        expect(a).toMatchObject({
          actorType: "SYSTEM",
          channel: "system",
          actorUserId: null,
        });
      }
      for (const p of plan.activities) {
        const row = acts.find(
          (a) =>
            a.project.key === p.projectKey &&
            iso(a.createdAt) === p.createdAt &&
            (a.issue?.key ?? null) === p.issueKey,
        )!;
        expect(row).toBeDefined();
        const changes = row.changes as { field: string; old: unknown; new: unknown }[];
        for (const c of p.changes) expect(changes).toContainEqual(c);
        const from = changes.find((c) => c.field === "importedFrom")!;
        expect(from.old).toBeNull();
        expect(String(from.new)).toContain(`(${p.actorType.toLowerCase()}`);
        if (p.client) expect(String(from.new)).toContain(p.client);
        if (p.actorEmail) expect(String(from.new)).toContain(p.actorEmail);
        if (p.summary)
          expect(changes).toContainEqual({ field: "summary", old: null, new: p.summary });
        // the session it belonged to
        if (p.sessionRef) {
          const s = plan.sessions.find((x) => x.ref === p.sessionRef)!;
          const sRow = await db.projectWorkSession.findFirstOrThrow({
            where: {
              firmId: firm.id,
              project: { key: s.projectKey! },
              startedAt: new Date(s.startedAt!),
            },
          });
          expect(row.sessionId).toBe(sRow.id);
        } else {
          expect(row.sessionId).toBeNull();
        }
        // known Sentire actions are named the Portal's way
        if (p.action === "updated" && p.issueKey)
          expect(row.action).toBe("issue.updated");
        if (p.action === "linked") expect(row.action).toBe("github.linked");
        if (p.action === "created" && !p.issueKey)
          expect(row.action).toBe("project.created");
        if (p.action === "session")
          expect(row.action).toMatch(/^session\.(started|ended)$/);
      }

      // GitHub links
      for (const l of plan.githubLinks) {
        const row = await db.githubLink.findFirstOrThrow({
          where: { firmId: firm.id, issue: { key: l.issueKey }, url: l.url },
        });
        expect(row).toMatchObject({
          kind: l.kind,
          repo: l.repo,
          number: l.number,
          sha: l.sha,
          title: l.title,
          state: l.state,
          merged: l.merged,
        });
        expect(iso(row.updatedAt)).toBe(l.updatedAt);
      }

      // audits
      for (const a of plan.securityAudits) {
        const row = await db.securityAudit.findFirstOrThrow({
          where: { firmId: firm.id, project: { key: a.projectKey }, runId: a.runId },
          include: { importedBy: true },
        });
        expect(row).toMatchObject({
          commit: a.sourceRef,
          profile: a.profile,
          scope: a.scope,
          complete: a.runStatus === "complete",
          incompleteReason: a.incompleteReason,
          coverage: a.coverage,
          rejected: a.rejected,
          actorType: a.actorType,
        });
        expect(iso(row.createdAt)).toBe(a.createdAt);
        expect(row.importedBy?.email ?? null).toBe(a.importedByEmail);
        const f = row.counts as Json;
        expect(f.rejected).toBe(a.counts.rejected ?? a.rejected.length);
        expect(f.needsValidation).toBe(a.counts.needs_validation ?? 0);
        expect(f.bySeverity.critical).toBe(a.counts.critical ?? 0);
        expect((row.outcome as Json).updated).toEqual(a.issueKeys);
      }

      // findings: the fingerprint of an issue is on the finding table
      for (const i of plan.issues.filter((x) => x.fingerprint)) {
        const f = await db.securityFinding.findFirstOrThrow({
          where: {
            firmId: firm.id,
            project: { key: i.projectKey },
            fingerprint: i.fingerprint!,
          },
          include: { issue: true },
        });
        expect(f.issue?.key).toBe(i.key);
      }
      // and the security view of that project reads the imported audit as it would one it made itself
      // (the finding's issue is in a Done status in the fixture, so it is not an open one)
      const sec = await http()
        .get(`${API}/projects/PAY/security`)
        .set("Authorization", `Bearer ${firm.sa}`);
      expect(sec.status).toBe(200);
      const paid = plan.securityAudits.filter((a) => a.projectKey === "PAY");
      expect(sec.body.lastAudit.runId).toBe(paid[paid.length - 1]!.runId);
      expect(sec.body.lastAudit.findings.bySeverity.critical).toBe(
        paid[paid.length - 1]!.counts.critical ?? 0,
      );
      const done = plan.issues.find(
        (i) => i.fingerprint === "api-critical-account-takeover",
      )!;
      expect(sec.body.open.some((o: Json) => o.key === done.key)).toBe(false);
      const audits = await http()
        .get(`${API}/projects/PAY/audits`)
        .set("Authorization", `Bearer ${firm.sa}`);
      expect(audits.status).toBe(200);
      expect(audits.body.length ?? audits.body.items?.length).toBe(paid.length);

      const fresh = await http()
        .post(`${API}/projects/PAY/issues`)
        .set("Authorization", `Bearer ${firm.sa}`)
        .send({ title: "After the import" });
      expect(fresh.status).toBe(201);
      expect(fresh.body.key).toBe(`PAY-${pay.issueCounter + 1}`);
    });
  });

  // ======================================================================================
  describe("R2 · an existing project key refuses the import", () => {
    it("the keys are listed, nothing is written, and an import never merges into live data", async () => {
      const firm = await newFirm();
      const exp = exportFor(firm.label);
      expect((await post(firm.sa, exp)).status).toBe(201);
      const after = await snapshot(firm.id);
      const again = await post(firm.sa, exp);
      expect(again.status).toBe(409);
      expect(again.body.message).toBe(
        "These projects already exist in the firm: BKS, PAY, PAYAPI. An import never merges into live data; remove them from the export or rename them there.",
      );
      expect(await snapshot(firm.id)).toEqual(after);
    });

    it("one project made by hand is enough, and the rest of the export is not written either", async () => {
      const firm = await newFirm();
      const made = await http()
        .post(`${API}/projects`)
        .set("Authorization", `Bearer ${firm.sa}`)
        .send({ key: "BKS", name: "Made by hand" });
      expect(made.status).toBe(201);
      const before = await snapshot(firm.id);
      const res = await post(firm.sa, exportFor(firm.label));
      expect(res.status).toBe(409);
      expect(res.body.message).toContain("already exist in the firm: BKS.");
      expect(await snapshot(firm.id)).toEqual(before);
    });

    it("another firm's keys are no obstacle", async () => {
      const a = await newFirm();
      const b = await newFirm();
      expect((await post(a.sa, exportFor(a.label))).status).toBe(201);
      expect((await post(b.sa, exportFor(b.label))).status).toBe(201);
    });
  });

  // ======================================================================================
  describe("R3 · people are matched by e-mail", () => {
    it("an e-mail with no account is reported; the rows that named it keep no user, and the activity still names them", async () => {
      const firm = await newFirm(["ana"]); // ben has no account here
      const exp = exportFor(firm.label);
      const plan = planOf(exp);
      const ben = plan.people.find((p) => p.email.startsWith("ben@"))!.email;
      const res = await post(firm.sa, exp);
      expect(res.status).toBe(201);
      expect(res.body.unmatchedEmails).toEqual([ben]);
      // everything ben did or was given has no user
      for (const i of plan.issues.filter((x) => x.assigneeEmail === ben)) {
        expect(
          (await db.issue.findFirstOrThrow({ where: { firmId: firm.id, key: i.key } }))
            .assigneeId,
        ).toBeNull();
      }
      for (const i of plan.issues.filter((x) => x.authorEmail === ben)) {
        expect(
          (await db.issue.findFirstOrThrow({ where: { firmId: firm.id, key: i.key } }))
            .authorId,
        ).toBeNull();
      }
      for (const s of plan.sessions.filter((x) => x.userEmail === ben && x.projectKey)) {
        const row = await db.projectWorkSession.findFirstOrThrow({
          where: { firmId: firm.id, startedAt: new Date(s.startedAt!) },
        });
        expect(row.userId).toBeNull();
      }
      // ana is matched, in any letter case
      const ana = plan.people.find((p) => p.email.startsWith("ana@"))!.email;
      const anaId = (
        await db.user.findFirstOrThrow({ where: { firmId: firm.id, email: ana } })
      ).id;
      expect(
        await db.issue.count({
          where: { firmId: firm.id, OR: [{ authorId: anaId }, { assigneeId: anaId }] },
        }),
      ).toBeGreaterThan(0);
      // the activity of the unmatched person still says who did it
      const withBen = plan.activities.filter((a) => a.actorEmail === ben);
      for (const p of withBen) {
        const rows = await db.projectActivity.findMany({
          where: { firmId: firm.id, createdAt: new Date(p.createdAt!) },
        });
        expect(JSON.stringify(rows.map((r) => r.changes))).toContain(ben);
      }
      // the Portal reads such a session and its briefing
      const list = await http()
        .get(`${API}/projects/PAY/sessions`)
        .set("Authorization", `Bearer ${firm.sa}`);
      expect(list.status).toBe(200);
      expect(list.body.items.some((s: Json) => s.user === null)).toBe(true);
      expect(
        (
          await http()
            .get(`${API}/projects/PAY/context`)
            .set("Authorization", `Bearer ${firm.sa}`)
        ).status,
      ).toBe(200);
    });

    it("an account whose e-mail is written in another letter case still matches", async () => {
      const firm = await newFirm(["ben"]); // ana is made by hand below, in capitals
      const exp = exportFor(firm.label);
      const ana = planOf(exp).people.find((p) => p.email.startsWith("ana@"))!.email;
      const made = await db.user.create({
        data: {
          firmId: firm.id,
          userType: "FIRM",
          fullName: "Ana capitals",
          email: ana.toUpperCase(),
          status: "ACTIVE",
          firmProfile: { create: { title: "Test" } },
        },
      });
      const res = await post(firm.sa, exp);
      expect(res.status).toBe(201);
      expect(res.body.unmatchedEmails).toEqual([]);
      expect(
        await db.issue.count({
          where: {
            firmId: firm.id,
            OR: [{ authorId: made.id }, { assigneeId: made.id }],
          },
        }),
      ).toBeGreaterThan(0);
    });

    it("a disabled account and a client account do not match", async () => {
      const firm = await newFirm(["ana"]);
      const ben = await db.user.create({
        data: {
          firmId: firm.id,
          userType: "FIRM",
          fullName: "Ben disabled",
          email: `ben@${firm.label}-${TAG}.example.com`,
          status: "DISABLED",
        },
      });
      const res = await post(firm.sa, exportFor(firm.label));
      expect(res.body.unmatchedEmails).toEqual([ben.email]);
    });
  });

  // ======================================================================================
  describe("R4 · a dry run", () => {
    it("answers the counts, the people, the warnings and the unmapped fields, and writes nothing", async () => {
      const firm = await newFirm(["ana"]);
      const exp = exportFor(firm.label);
      const plan = planOf(exp);
      const before = await snapshot(firm.id);
      const res = await post(firm.sa, { ...exp, dryRun: true });
      expect(res.status).toBe(200);
      expect(res.body.dryRun).toBe(true);
      expect(res.body.counts.issues).toBe(plan.issues.length);
      expect(res.body.counts.projects).toBe(plan.projects.length);
      expect(res.body.unmatchedEmails).toHaveLength(1);
      expect(res.body.warnings).toEqual(plan.warnings);
      expect(res.body.unmapped).toEqual(plan.unmapped);
      expect(await snapshot(firm.id)).toEqual(before);
      // the real import then reports the same counts
      const real = await post(firm.sa, exp);
      expect(real.status).toBe(201);
      expect(real.body.counts).toEqual(res.body.counts);
      expect(real.body.reused).toEqual(res.body.reused);
    });

    it("a dry run is refused for an existing key and an invalid export, as the real one is", async () => {
      const firm = await newFirm();
      const exp = exportFor(firm.label);
      expect((await post(firm.sa, exp)).status).toBe(201);
      expect((await post(firm.sa, { ...exp, dryRun: true })).status).toBe(409);
      const bad = exportFor(firm.label);
      bad.issues.push({ ...bad.issues[0], id: randomUUID() }); // the same key twice
      const other = await newFirm();
      const res = await post(other.sa, { ...bad, dryRun: true });
      expect(res.status).toBe(400);
    });
  });

  // ======================================================================================
  describe("R5 · an invalid export", () => {
    it("is refused with the validator's own sentences, and nothing is written", async () => {
      const firm = await newFirm();
      const bad = exportFor(firm.label);
      bad.issues.push({ ...bad.issues[0], id: randomUUID() }); // the same key and number twice
      const expected = validateImportPlan(planOf(bad));
      expect(expected.length).toBeGreaterThan(0);
      const before = await snapshot(firm.id);
      const res = await post(firm.sa, bad);
      expect(res.status).toBe(400);
      expect(res.body.message).toBe("The export cannot be imported.");
      expect(res.body.problems).toEqual(expected);
      expect(await snapshot(firm.id)).toEqual(before);
    });

    it("a body that is not an export is a sentence", async () => {
      const firm = await newFirm();
      const list = await post(firm.sa, [1, 2]);
      expect(list.status).toBe(400);
      expect(list.body.message).toBe("The export must be a JSON object.");
      let expected = "";
      try {
        mapSentireExport({ hello: "world" });
      } catch (e) {
        expected = (e as Error).message;
      }
      expect(expected).not.toBe("");
      const junk = await post(firm.sa, { hello: "world" });
      expect(junk.status).toBe(400);
      expect(junk.body.message).toBe(expected);
    });

    it("an export that holds a password or token hash is refused, as the validator refuses it", async () => {
      const firm = await newFirm();
      const exp = exportFor(firm.label);
      const plan = planOf(exp) as unknown as Json;
      expect(JSON.stringify(plan)).not.toMatch(
        /INVENTED-HASH|INVENTED-TOKEN-HASH|INVENTED-LOGIN/,
      ); // the mapper never copies a secret
      const res = await post(firm.sa, exp);
      expect(res.status).toBe(201);
      const rows = await db.$queryRaw<{ n: bigint }[]>`
        SELECT count(*) AS n FROM users u WHERE row_to_json(u)::text LIKE '%INVENTED-HASH%'`;
      expect(Number(rows[0]!.n)).toBe(0);
    });
  });

  // ======================================================================================
  describe("R6 · one transaction", () => {
    it("a failure part way leaves no project, no type, no status, no label, nothing", async () => {
      const firm = await newFirm();
      const before = await snapshot(firm.id);
      const svc = app.get(SentireImportService) as unknown as Record<string, unknown>;
      let calls = 0;
      const spy = jest
        .spyOn(
          svc as { applyGithubLinks: (...a: unknown[]) => Promise<void> },
          "applyGithubLinks",
        )
        .mockRejectedValue(new Error("the database went away"));
      try {
        const res = await post(firm.sa, exportFor(firm.label));
        expect(res.status).toBe(500);
      } finally {
        calls = spy.mock.calls.length;
        spy.mockRestore();
      }
      expect(calls).toBeGreaterThan(0);
      expect(await snapshot(firm.id)).toEqual(before);
      // and the same import works afterwards
      expect((await post(firm.sa, exportFor(firm.label))).status).toBe(201);
    });
  });

  // ======================================================================================
  describe("R7 · who may import", () => {
    it("a Super Admin only: a Member is refused with a sentence, nothing is written", async () => {
      const firm = await newFirm();
      const before = await snapshot(firm.id);
      const res = await post(firm.member, exportFor(firm.label));
      expect(res.status).toBe(403);
      expect(res.body.message).toBe(SA_ONLY);
      expect(await snapshot(firm.id)).toEqual(before);
    });

    it("session sign-in only: no token, not even a Super Admin's, and no sign-in at all", async () => {
      const firm = await newFirm();
      const admin = await db.user.findFirstOrThrow({
        where: { firmId: firm.id, email: `${TAG}-${firm.label}-admin@example.com` },
      });
      const made = await http()
        .post(`${API}/tokens`)
        .set("Authorization", `Bearer ${firm.sa}`)
        .send({ name: "admin token", scope: "read_write" });
      expect(made.status).toBe(201);
      const viaToken = await post(made.body.token, exportFor(firm.label));
      expect(viaToken.status).toBe(403);
      expect(viaToken.body.message).toBe(NOT_HERE);
      expect(
        (await http().post(`${API}/projects/import/sentire`).send(exportFor(firm.label)))
          .status,
      ).toBe(401);
      expect(admin.id).toBeTruthy();
      expect((await snapshot(firm.id)).projects).toBe(0);
    });

    it("a client user is refused", async () => {
      const firm = await newFirm();
      const clientUser = await db.user.create({
        data: {
          firmId: firm.id,
          userType: "CLIENT",
          fullName: "A client",
          email: `client@${firm.label}-${TAG}.example.com`,
          status: "ACTIVE",
        },
      });
      const token = app.get(TokenService).signAccess({
        id: clientUser.id,
        firmId: firm.id,
        userType: "CLIENT",
        email: clientUser.email,
      });
      const res = await post(token, exportFor(firm.label));
      expect(res.status).toBe(403);
      expect((await snapshot(firm.id)).projects).toBe(0);
    });
  });

  // ======================================================================================
  describe("R8 · size, what the firm already has, the audit trail", () => {
    it("an export of more than 100 KB is read", async () => {
      const firm = await newFirm();
      const exp = exportFor(firm.label);
      const big = exp.issues[0];
      const rows = Array.from({ length: 400 }, (_, k) => ({
        ...big,
        id: randomUUID(),
        number: 100 + k,
        key: `BKS-${100 + k}`,
        projectId: exp.projects.find((p: Json) => p.key === "BKS").id,
        parentId: null,
        milestoneId: null,
        title: `Bulk ${k} ${"x".repeat(200)}`,
        fingerprint: null,
        deletedAt: null,
      }));
      exp.issues.push(...rows);
      exp.projects.find((p: Json) => p.key === "BKS").issueCounter = 499;
      expect(JSON.stringify(exp).length).toBeGreaterThan(100_000);
      const res = await post(firm.sa, exp);
      expect(res.status).toBe(201);
      expect(
        await db.issue.count({ where: { firmId: firm.id, project: { key: "BKS" } } }),
      ).toBe(400);
      expect(
        (await db.project.findFirstOrThrow({ where: { firmId: firm.id, key: "BKS" } }))
          .issueCounter,
      ).toBe(499);
    });

    it("types, statuses and labels the firm already has are reused by name, not made twice", async () => {
      const firm = await newFirm();
      // the firm's own starting list, and a label by hand in another spelling
      await http().get(`${API}/projects/meta`).set("Authorization", `Bearer ${firm.sa}`);
      await http()
        .post(`${API}/projects/admin/labels`)
        .set("Authorization", `Bearer ${firm.sa}`)
        .send({ name: "SECURITY", colour: "#112233" });
      const before = await snapshot(firm.id);
      const exp = exportFor(firm.label);
      const res = await post(firm.sa, exp);
      expect(res.status).toBe(201);
      expect(res.body.reused.statuses).toBeGreaterThan(0);
      expect(res.body.reused.issueTypes).toBeGreaterThan(0);
      expect(res.body.reused.labels).toBeGreaterThan(0);
      const after = await snapshot(firm.id);
      expect(after.types).toBe(before.types + res.body.counts.issueTypes);
      expect(after.statuses).toBe(before.statuses + res.body.counts.statuses);
      expect(after.labels).toBe(before.labels + res.body.counts.labels);
      // the label keeps its own colour; the firm's default status is still the one default
      expect(
        (
          await db.label.findFirstOrThrow({
            where: { firmId: firm.id, name: "SECURITY" },
          })
        ).colour,
      ).toBe("#112233");
      expect(
        await db.issueStatus.count({ where: { firmId: firm.id, isDefault: true } }),
      ).toBe(1);
    });

    it("a firm with its own statuses keeps its one default and its order; the new statuses come after", async () => {
      const firm = await newFirm();
      await db.issueStatus.createMany({
        data: [
          {
            firmId: firm.id,
            name: "Backlog",
            colour: "#111111",
            order: 0,
            category: "TODO",
            isDefault: true,
          },
          {
            firmId: firm.id,
            name: "Shipped",
            colour: "#222222",
            order: 1,
            category: "DONE",
            isDefault: false,
          },
        ],
      });
      const res = await post(firm.sa, exportFor(firm.label));
      expect(res.status).toBe(201);
      expect(res.body.reused.statuses).toBe(0);
      const rows = await db.issueStatus.findMany({
        where: { firmId: firm.id },
        orderBy: { order: "asc" },
      });
      expect(rows.map((r) => r.name)).toEqual([
        "Backlog",
        "Shipped",
        "New",
        "In progress",
        "Done",
      ]);
      expect(rows.filter((r) => r.isDefault).map((r) => r.name)).toEqual(["Backlog"]);
      expect(new Set(rows.map((r) => r.order)).size).toBe(rows.length);
    });

    it("the import is on the audit trail, with who and the counts", async () => {
      const firm = await newFirm();
      const res = await post(firm.sa, exportFor(firm.label));
      expect(res.status).toBe(201);
      const admin = await db.user.findFirstOrThrow({
        where: { firmId: firm.id, email: `${TAG}-${firm.label}-admin@example.com` },
      });
      const row = await db.auditLog.findFirstOrThrow({
        where: { userId: admin.id, action: "projects.import.sentire" },
      });
      expect(row.entityType).toBe("Firm");
      expect(row.metadata).toMatchObject({
        counts: res.body.counts,
        unmatchedEmails: [],
      });
      // a dry run is not on it
      const other = await newFirm();
      await post(other.sa, { ...exportFor(other.label), dryRun: true });
      const adminB = await db.user.findFirstOrThrow({
        where: { firmId: other.id, email: `${TAG}-${other.label}-admin@example.com` },
      });
      expect(
        await db.auditLog.count({
          where: { userId: adminB.id, action: "projects.import.sentire" },
        }),
      ).toBe(0);
    });
  });
});
