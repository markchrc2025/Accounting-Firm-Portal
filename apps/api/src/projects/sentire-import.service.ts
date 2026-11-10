// sentire-import.service.ts — PA5 (D69): the Sentire Projects importer.
//
// Takes an export of the owner's Sentire Projects database, has projects-core turn it into a plan
// (mapSentireExport) and check it (validateImportPlan), then writes the plan in the plan's own
// apply order, in ONE transaction: all of it or none. Project keys, issue numbers and issue keys
// are kept exactly, and each project's issue counter is set from the plan, so the next issue is
// numbered after the highest imported one.
//
// An import never merges into live data: if any project key of the export already exists in the
// firm, nothing is written. People are matched to ACTIVE firm users by e-mail (any letter case);
// a row that names someone with no account keeps no user, and the e-mail is reported.
//
// Imported activity is written as the system (actorType SYSTEM, channel "system", no user), and the
// original actor is kept as an `importedFrom` entry in the row's changes (see sentire-import.map).
// No notification, no webhook and no MCP event is raised: createMany writes rows, nothing else.
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
} from "@nestjs/common";
import {
  IMPORT_APPLY_ORDER,
  mapSentireExport,
  SentireExportError,
  validateImportPlan,
  type ImportPlan,
  type PlanPerson,
} from "@portal/projects-core";
import { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { AuditService } from "../audit/audit.service";
import type { AuthUser } from "../common/auth/auth-user";
import { PrismaService } from "../prisma/prisma.service";
import { SUPER_ADMIN_ROLE } from "../rbac/permissions.constants";
import { DEFAULT_ISSUE_STATUSES, DEFAULT_ISSUE_TYPES } from "./projects.constants";
import { classifySecurityIssue } from "./security";
import {
  auditCounts,
  channelOf,
  importedChanges,
  portalAction,
} from "./sentire-import.map";

export const IMPORT_SUPER_ADMIN_ONLY =
  "Only a Super Admin can import from Sentire Projects.";
export const IMPORT_NOT_OBJECT = "The export must be a JSON object.";
export const IMPORT_INVALID = "The export cannot be imported.";
export const importExists = (keys: string[]) =>
  `These projects already exist in the firm: ${keys.join(", ")}. An import never merges into live data; remove them from the export or rename them there.`;

/** A large export is one long transaction. */
const TX_OPTIONS = { timeout: 600_000, maxWait: 15_000 };
const CHUNK = 500;

type Tx = Prisma.TransactionClient;
type Db = Tx | PrismaService;

export interface ImportReport {
  dryRun: boolean;
  /** The project keys of the export, sorted. */
  projects: string[];
  /** What was (or, in a dry run, would be) written. */
  counts: {
    projects: number;
    issueTypes: number;
    statuses: number;
    labels: number;
    milestones: number;
    issues: number;
    comments: number;
    statusUpdates: number;
    sessions: number;
    activities: number;
    githubLinks: number;
    securityAudits: number;
    securityFindings: number;
  };
  /** Types, statuses and labels the firm already had under the same name (case does not matter). */
  reused: { issueTypes: number; statuses: number; labels: number };
  /** People of the export with no active firm account; the rows that named them keep no user. */
  unmatchedEmails: string[];
  warnings: string[];
  unmapped: ImportPlan["unmapped"];
}

interface Ctx {
  tx: Tx;
  firmId: string;
  plan: ImportPlan;
  people: Map<string, PlanPerson>;
  /** lower-case e-mail -> user id, for the matched people only */
  users: Map<string, string>;
  projectIds: Map<string, string>;
  typeIds: Map<string, string>;
  statusIds: Map<string, string>;
  labelIds: Map<string, string>;
  milestoneIds: Map<string, string>;
  issueIds: Map<string, string>;
  issueProjects: Map<string, string>;
  sessionIds: Map<string, string>;
  created: { issueTypes: number; statuses: number; labels: number };
}

const lower = (s: string) => s.toLowerCase();
const day = (d: string | null) => (d ? new Date(`${d}T00:00:00.000Z`) : null);
const when = (s: string | null) => (s ? new Date(s) : undefined);
async function inChunks<T>(rows: T[], write: (chunk: T[]) => Promise<unknown>) {
  for (let i = 0; i < rows.length; i += CHUNK) await write(rows.slice(i, i + CHUNK));
}

@Injectable()
export class SentireImportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Import (or, with dryRun, only answer). A Super Admin of the firm only. */
  async import(user: AuthUser, body: unknown): Promise<ImportReport> {
    if (!(await this.isSuperAdmin(user))) {
      throw new ForbiddenException(IMPORT_SUPER_ADMIN_ONLY);
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw new BadRequestException(IMPORT_NOT_OBJECT);
    }
    const { dryRun: flag, ...exported } = body as Record<string, unknown>;
    const dryRun = flag === true;

    let plan: ImportPlan;
    try {
      plan = mapSentireExport(exported);
    } catch (e) {
      if (e instanceof SentireExportError) throw new BadRequestException(e.message);
      throw e;
    }
    const problems = validateImportPlan(plan);
    if (problems.length) {
      throw new BadRequestException({
        statusCode: 400,
        message: IMPORT_INVALID,
        problems,
      });
    }

    const firmId = user.firmId;
    await this.refuseExisting(this.prisma, firmId, plan);
    const { users, unmatched } = await this.matchPeople(this.prisma, firmId, plan);
    if (dryRun) {
      const reused = await this.previewReuse(plan, firmId);
      return this.report(plan, true, unmatched, reused, plan.projects.length);
    }

    const report = await this.prisma.$transaction(async (tx) => {
      // the keys are checked again inside the transaction: a project made a moment ago refuses too
      await this.refuseExisting(tx, firmId, plan);
      await this.seedDefaults(tx, firmId);
      const ctx: Ctx = {
        tx,
        firmId,
        plan,
        people: new Map(plan.people.map((p) => [lower(p.email), p])),
        users,
        projectIds: new Map(),
        typeIds: new Map(),
        statusIds: new Map(),
        labelIds: new Map(),
        milestoneIds: new Map(),
        issueIds: new Map(),
        issueProjects: new Map(),
        sessionIds: new Map(),
        created: { issueTypes: 0, statuses: 0, labels: 0 },
      };
      // the plan says the order; each step only refers to the steps before it
      for (const step of IMPORT_APPLY_ORDER) await this.step(step, ctx);
      const reused = {
        issueTypes: plan.issueTypes.length - ctx.created.issueTypes,
        statuses: plan.statuses.length - ctx.created.statuses,
        labels: plan.labels.length - ctx.created.labels,
      };
      return this.report(plan, false, unmatched, reused, plan.projects.length);
    }, TX_OPTIONS);

    await this.audit.record({
      userId: user.id,
      action: "projects.import.sentire",
      entityType: "Firm",
      entityId: firmId,
      metadata: {
        counts: report.counts,
        reused: report.reused,
        unmatchedEmails: report.unmatchedEmails,
        projects: report.projects,
      } as unknown as Prisma.InputJsonValue,
    });
    return report;
  }

  // -------------------------------------------------------------------------------------------
  // The checks

  private async isSuperAdmin(user: AuthUser): Promise<boolean> {
    if (user.userType !== "FIRM") return false;
    const n = await this.prisma.user.count({
      where: {
        id: user.id,
        firmId: user.firmId,
        status: "ACTIVE",
        userRoles: {
          some: { clientScopeId: null, role: { name: SUPER_ADMIN_ROLE, scope: "FIRM" } },
        },
      },
    });
    return n > 0;
  }

  /** 409 when any project key of the plan is already a project of the firm. */
  private async refuseExisting(db: Db, firmId: string, plan: ImportPlan): Promise<void> {
    const have = await db.project.findMany({
      where: { firmId, key: { in: plan.projects.map((p) => p.key) } },
      select: { key: true },
    });
    if (have.length) {
      throw new ConflictException(importExists(have.map((h) => h.key).sort()));
    }
  }

  /** The people of the export who have an active firm account, matched by e-mail in any case. */
  private async matchPeople(db: Db, firmId: string, plan: ImportPlan) {
    const emails = [...new Set(plan.people.map((p) => lower(p.email)))];
    const rows = emails.length
      ? await db.user.findMany({
          where: {
            firmId,
            userType: "FIRM",
            status: "ACTIVE",
            OR: emails.map((e) => ({
              email: { equals: e, mode: "insensitive" as const },
            })),
          },
          select: { id: true, email: true },
          orderBy: { createdAt: "asc" },
        })
      : [];
    const users = new Map<string, string>();
    for (const r of rows) if (!users.has(lower(r.email))) users.set(lower(r.email), r.id);
    const unmatched = emails.filter((e) => !users.has(e)).sort();
    return { users, unmatched };
  }

  /** What a real import would reuse, without writing: a firm with no list yet gets the starting one. */
  private async previewReuse(plan: ImportPlan, firmId: string) {
    const [types, statuses, labels] = await Promise.all([
      this.prisma.issueType.findMany({ where: { firmId }, select: { name: true } }),
      this.prisma.issueStatus.findMany({ where: { firmId }, select: { name: true } }),
      this.prisma.label.findMany({ where: { firmId }, select: { name: true } }),
    ]);
    const names = (rows: { name: string }[], fallback: readonly { name: string }[]) =>
      new Set((rows.length ? rows : fallback).map((r) => lower(r.name)));
    const inSet = (set: Set<string>, rows: { name: string }[]) =>
      rows.filter((r) => set.has(lower(r.name))).length;
    return {
      issueTypes: inSet(names(types, DEFAULT_ISSUE_TYPES), plan.issueTypes),
      statuses: inSet(names(statuses, DEFAULT_ISSUE_STATUSES), plan.statuses),
      labels: inSet(names(labels, []), plan.labels),
    };
  }

  /** The firm's starting types and statuses, when it has none (inside the transaction, so a rollback takes them too). */
  private async seedDefaults(tx: Tx, firmId: string): Promise<void> {
    if ((await tx.issueType.count({ where: { firmId } })) === 0) {
      await tx.issueType.createMany({
        data: DEFAULT_ISSUE_TYPES.map((t) => ({ firmId, ...t })),
        skipDuplicates: true,
      });
    }
    if ((await tx.issueStatus.count({ where: { firmId } })) === 0) {
      await tx.issueStatus.createMany({
        data: DEFAULT_ISSUE_STATUSES.map((s) => ({ firmId, ...s })),
        skipDuplicates: true,
      });
    }
  }

  private report(
    plan: ImportPlan,
    dryRun: boolean,
    unmatchedEmails: string[],
    reused: ImportReport["reused"],
    projects: number,
  ): ImportReport {
    return {
      dryRun,
      projects: plan.projects.map((p) => p.key).sort(),
      counts: {
        projects,
        issueTypes: plan.issueTypes.length - reused.issueTypes,
        statuses: plan.statuses.length - reused.statuses,
        labels: plan.labels.length - reused.labels,
        milestones: plan.milestones.length,
        issues: plan.issues.length,
        comments: plan.comments.length,
        statusUpdates: plan.statusUpdates.length,
        sessions: plan.sessions.filter((s) => s.projectKey).length,
        activities: plan.activities.length,
        githubLinks: plan.githubLinks.length,
        securityAudits: plan.securityAudits.length,
        securityFindings: plan.issues.filter((i) => i.fingerprint).length,
      },
      reused,
      unmatchedEmails,
      warnings: plan.warnings,
      unmapped: plan.unmapped,
    };
  }

  // -------------------------------------------------------------------------------------------
  // The steps, in the plan's apply order

  private step(name: (typeof IMPORT_APPLY_ORDER)[number], ctx: Ctx): Promise<void> {
    switch (name) {
      case "projects":
        return this.applyProjects(ctx);
      case "issueTypes":
        return this.applyTypes(ctx);
      case "statuses":
        return this.applyStatuses(ctx);
      case "labels":
        return this.applyLabels(ctx);
      case "milestones":
        return this.applyMilestones(ctx);
      case "issues":
        return this.applyIssues(ctx);
      case "comments":
        return this.applyComments(ctx);
      case "statusUpdates":
        return this.applyStatusUpdates(ctx);
      case "sessions":
        return this.applySessions(ctx);
      case "activities":
        return this.applyActivities(ctx);
      case "githubLinks":
        return this.applyGithubLinks(ctx);
      case "securityAudits":
        return this.applySecurity(ctx);
    }
  }

  private userOf(ctx: Ctx, email: string | null): string | null {
    return email ? (ctx.users.get(lower(email)) ?? null) : null;
  }

  private async applyProjects(ctx: Ctx): Promise<void> {
    const { tx, firmId, plan } = ctx;
    for (const p of plan.projects) ctx.projectIds.set(p.key, randomUUID());
    // one statement: a parent and its child may come in either order
    await inChunks(plan.projects, (rows) =>
      tx.project.createMany({
        data: rows.map((p) => ({
          id: ctx.projectIds.get(p.key)!,
          firmId,
          key: p.key,
          name: p.name,
          description: p.description,
          repoUrl: p.repoUrl,
          liveUrl: p.liveUrl,
          deployAppName: p.deployAppName,
          parentProjectId: p.parentKey ? (ctx.projectIds.get(p.parentKey) ?? null) : null,
          archived: p.archived,
          issueCounter: p.issueCounter,
          createdAt: when(p.createdAt),
          updatedAt: when(p.updatedAt),
        })),
      }),
    );
  }

  /** Reuse a type of the same name; else add it after the firm's own. */
  private async applyTypes(ctx: Ctx): Promise<void> {
    const { tx, firmId, plan } = ctx;
    const have = await tx.issueType.findMany({ where: { firmId } });
    for (const h of have) ctx.typeIds.set(lower(h.name), h.id);
    let order = Math.max(-1, ...have.map((h) => h.order));
    for (const t of [...plan.issueTypes].sort((a, b) => a.order - b.order)) {
      if (ctx.typeIds.has(lower(t.name))) continue;
      const made = await tx.issueType.create({
        data: { firmId, name: t.name, colour: t.colour, order: ++order },
      });
      ctx.typeIds.set(lower(t.name), made.id);
      ctx.created.issueTypes++;
    }
  }

  /** Reuse a status of the same name; a new one is the default only if the firm has none. */
  private async applyStatuses(ctx: Ctx): Promise<void> {
    const { tx, firmId, plan } = ctx;
    const have = await tx.issueStatus.findMany({ where: { firmId } });
    for (const h of have) ctx.statusIds.set(lower(h.name), h.id);
    let hasDefault = have.some((h) => h.isDefault);
    let order = Math.max(-1, ...have.map((h) => h.order));
    for (const s of [...plan.statuses].sort((a, b) => a.order - b.order)) {
      if (ctx.statusIds.has(lower(s.name))) continue;
      const makeDefault = s.isDefault && !hasDefault;
      const made = await tx.issueStatus.create({
        data: {
          firmId,
          name: s.name,
          colour: s.colour,
          order: ++order,
          category: s.category,
          isDefault: makeDefault,
        },
      });
      hasDefault = hasDefault || makeDefault;
      ctx.statusIds.set(lower(s.name), made.id);
      ctx.created.statuses++;
    }
  }

  /** Reuse a label of the same name and keep its colour. */
  private async applyLabels(ctx: Ctx): Promise<void> {
    const { tx, firmId, plan } = ctx;
    const have = await tx.label.findMany({ where: { firmId } });
    for (const h of have) ctx.labelIds.set(lower(h.name), h.id);
    for (const l of plan.labels) {
      if (ctx.labelIds.has(lower(l.name))) continue;
      const made = await tx.label.create({
        data: { firmId, name: l.name, colour: l.colour },
      });
      ctx.labelIds.set(lower(l.name), made.id);
      ctx.created.labels++;
    }
  }

  private async applyMilestones(ctx: Ctx): Promise<void> {
    const { tx, firmId, plan } = ctx;
    const rows = plan.milestones.map((m) => {
      const id = randomUUID();
      ctx.milestoneIds.set(`${m.projectKey}\u0000${m.name}`, id);
      return {
        id,
        firmId,
        projectId: ctx.projectIds.get(m.projectKey)!,
        name: m.name,
        description: m.description,
        startDate: day(m.startDate),
        dueDate: day(m.dueDate),
        state: m.state,
        createdAt: when(m.createdAt),
        updatedAt: when(m.closedAt ?? m.createdAt),
      };
    });
    await inChunks(rows, (chunk) => tx.milestone.createMany({ data: chunk }));
  }

  private async applyIssues(ctx: Ctx): Promise<void> {
    const { tx, firmId, plan } = ctx;
    for (const i of plan.issues) {
      ctx.issueIds.set(i.key, randomUUID());
      ctx.issueProjects.set(i.key, ctx.projectIds.get(i.projectKey)!);
    }
    // the plan lists a parent before its children, and each chunk is a statement of its own
    await inChunks(plan.issues, (rows) =>
      tx.issue.createMany({
        data: rows.map((i) => ({
          id: ctx.issueIds.get(i.key)!,
          firmId,
          projectId: ctx.projectIds.get(i.projectKey)!,
          number: i.number,
          key: i.key,
          title: i.title,
          description: i.description,
          typeId: ctx.typeIds.get(lower(i.type))!,
          statusId: ctx.statusIds.get(lower(i.status))!,
          priority: i.priority,
          assigneeId: this.userOf(ctx, i.assigneeEmail),
          authorId: this.userOf(ctx, i.authorEmail),
          milestoneId: i.milestone
            ? (ctx.milestoneIds.get(`${i.projectKey}\u0000${i.milestone}`) ?? null)
            : null,
          parentIssueId: i.parentKey ? (ctx.issueIds.get(i.parentKey) ?? null) : null,
          startDate: day(i.startDate),
          dueDate: day(i.dueDate),
          position: i.position,
          closedAt: when(i.closedAt) ?? null,
          deleted: i.deletedAt !== null,
          createdAt: when(i.createdAt),
          updatedAt: when(i.updatedAt),
        })),
      }),
    );
    const links = plan.issues.flatMap((i) =>
      [...new Set(i.labels.map(lower))].map((l) => ({
        issueId: ctx.issueIds.get(i.key)!,
        labelId: ctx.labelIds.get(l)!,
        firmId,
      })),
    );
    await inChunks(links, (chunk) => tx.issueLabel.createMany({ data: chunk }));
  }

  private async applyComments(ctx: Ctx): Promise<void> {
    const { tx, firmId, plan } = ctx;
    await inChunks(plan.comments, (rows) =>
      tx.issueComment.createMany({
        data: rows.map((c) => ({
          firmId,
          issueId: ctx.issueIds.get(c.issueKey)!,
          authorId: this.userOf(ctx, c.authorEmail),
          body: c.body,
          createdAt: when(c.createdAt),
          updatedAt: when(c.editedAt ?? c.createdAt),
        })),
      }),
    );
  }

  private async applyStatusUpdates(ctx: Ctx): Promise<void> {
    const { tx, firmId, plan } = ctx;
    await inChunks(plan.statusUpdates, (rows) =>
      tx.projectStatusUpdate.createMany({
        data: rows.map((u) => ({
          firmId,
          projectId: ctx.projectIds.get(u.projectKey)!,
          status: u.status,
          note: u.note,
          actorType: u.actorType,
          actorUserId: this.userOf(ctx, u.actorEmail),
          createdAt: when(u.createdAt),
        })),
      }),
    );
  }

  /** A session of a person with no account keeps no user (the column allows it since migration 45). */
  private async applySessions(ctx: Ctx): Promise<void> {
    const { tx, firmId, plan } = ctx;
    const rows = plan.sessions
      .filter((s) => s.projectKey)
      .map((s) => {
        const id = randomUUID();
        ctx.sessionIds.set(s.ref, id);
        return {
          id,
          firmId,
          projectId: ctx.projectIds.get(s.projectKey!)!,
          userId: this.userOf(ctx, s.userEmail),
          tokenId: null,
          client: s.client.slice(0, 40),
          title: s.title,
          startedAt: when(s.startedAt),
          endedAt: when(s.endedAt) ?? null,
          summary: s.summary,
          nextSteps: s.nextSteps,
          issueKeys: s.issuesTouched,
        };
      });
    await inChunks(rows, (chunk) => tx.projectWorkSession.createMany({ data: chunk }));
  }

  /**
   * Written as the system, with the original actor in the changes (`importedFrom`): the Portal's
   * rule is that a SYSTEM row has no user, and a person of Sentire Projects may have no account.
   */
  private async applyActivities(ctx: Ctx): Promise<void> {
    const { tx, firmId, plan } = ctx;
    const sessions = new Map(plan.sessions.map((s) => [s.ref, s]));
    await inChunks(plan.activities, (rows) =>
      tx.projectActivity.createMany({
        data: rows.map((a) => ({
          firmId,
          projectId: ctx.projectIds.get(a.projectKey)!,
          issueId: a.issueKey ? (ctx.issueIds.get(a.issueKey) ?? null) : null,
          actorType: "SYSTEM",
          actorUserId: null,
          channel: "system",
          sessionId: a.sessionRef ? (ctx.sessionIds.get(a.sessionRef) ?? null) : null,
          action: portalAction(a, a.sessionRef ? sessions.get(a.sessionRef) : null),
          changes: importedChanges(a, ctx.people) as unknown as Prisma.InputJsonValue,
          createdAt: when(a.createdAt),
        })),
      }),
    );
  }

  private async applyGithubLinks(ctx: Ctx): Promise<void> {
    const { tx, firmId, plan } = ctx;
    await inChunks(plan.githubLinks, (rows) =>
      tx.githubLink.createMany({
        data: rows.map((l) => ({
          firmId,
          projectId: ctx.issueProjects.get(l.issueKey)!,
          issueId: ctx.issueIds.get(l.issueKey)!,
          kind: l.kind,
          repo: l.repo,
          number: l.number,
          sha: l.sha,
          url: l.url,
          title: l.title,
          state: l.state,
          merged: l.merged,
          createdAt: when(l.updatedAt),
          updatedAt: when(l.updatedAt),
        })),
        skipDuplicates: true,
      }),
    );
  }

  /** Audits as they were, then one finding per fingerprinted issue, seen by the latest audit that named it. */
  private async applySecurity(ctx: Ctx): Promise<void> {
    const { tx, firmId, plan } = ctx;
    const lastAudit = new Map<string, string>();
    for (const a of plan.securityAudits) {
      const made = await tx.securityAudit.create({
        data: {
          firmId,
          projectId: ctx.projectIds.get(a.projectKey)!,
          runId: a.runId,
          commit: a.sourceRef,
          profile: a.profile,
          scope: a.scope,
          complete: a.runStatus === "complete",
          incompleteReason: a.incompleteReason,
          coverage: a.coverage,
          counts: auditCounts(a.counts, a.rejected.length),
          outcome: {
            created: [],
            updated: a.issueKeys,
            reopened: [],
            notReported: [],
            rejectedNoted: [],
          },
          rejected: a.rejected,
          importedById: this.userOf(ctx, a.importedByEmail),
          actorType: a.actorType,
          channel: channelOf(a.actorType),
          createdAt: when(a.createdAt),
        },
      });
      for (const k of a.issueKeys) lastAudit.set(k, made.id);
    }
    const findings = plan.issues
      .filter((i) => i.fingerprint)
      .map((i) => {
        const c = classifySecurityIssue(i.labels);
        return {
          firmId,
          projectId: ctx.projectIds.get(i.projectKey)!,
          fingerprint: i.fingerprint!,
          issueId: ctx.issueIds.get(i.key)!,
          lastSeenAuditId: lastAudit.get(i.key) ?? null,
          state: c?.needsValidation ? "needs_validation" : "confirmed",
          severity: c?.severity ?? null,
          createdAt: when(i.createdAt),
          updatedAt: when(i.updatedAt),
        };
      });
    await inChunks(findings, (chunk) =>
      tx.securityFinding.createMany({ data: chunk, skipDuplicates: true }),
    );
  }
}
