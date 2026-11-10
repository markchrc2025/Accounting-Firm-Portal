// security-audits.service.ts — PA4 (D68): results of the security-audit skill become issues.
//
// findings.json, the run metadata and the coverage ledger are read with projects-core
// (parseFindings, mapFindings, summariseAudit). confirmed findings become Bugs labelled security
// and sev-<severity>; leads that need validation become Tasks labelled security and
// needs-validation; rejected findings are kept on the audit record. A finding is known by its
// fingerprint: a later run that reports it updates the same issue, and reopens it if it was
// closed. A complete whole-repo run comments on each open finding it did not report (it never
// closes one). One transaction: all of it or none.
import { BadRequestException, Injectable } from "@nestjs/common";
import {
  AuditImportError,
  mapFindings,
  parseFindings,
  SECURITY_LABEL_COLORS,
  summariseAudit,
  type AuditRunMetadata,
  type AuditSummary,
  type MappedIssue,
} from "@portal/projects-core";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { IssueWrites } from "./issue-writes";
import { ProjectsAccess, type ProjectsActor } from "./projects.access";
import { ProjectsActivity } from "./projects-activity.service";
import { MESSAGES, PROJECTS_PERMISSION as P, type Change } from "./projects.constants";
import { SecurityQueries } from "./security-queries";

export interface AuditImportInput {
  findings: unknown;
  run?: AuditRunMetadata;
  ledger?: unknown;
  coverage?: Record<string, unknown>;
}

interface Outcome {
  created: string[];
  updated: string[];
  reopened: string[];
  notReported: string[];
  rejectedNoted: string[];
}

const TX_OPTIONS = { timeout: 120_000, maxWait: 15_000 };
/** The labels the audit manages on an issue; any other label on it is the owner's and stays. */
const managed = (name: string) => {
  const n = name.toLowerCase();
  return n === "security" || n === "needs-validation" || n.startsWith("sev-");
};
const runLabelOf = (s: AuditSummary) =>
  `${s.runId || "audit"}${s.commit ? ` @ ${s.commit.slice(0, 12)}` : ""}`;

type AuditRow = Prisma.SecurityAuditGetPayload<{
  include: { importedBy: { select: { id: true; fullName: true } } };
}>;

export function auditDto(a: AuditRow) {
  const o = (a.outcome ?? {}) as Partial<Outcome>;
  return {
    id: a.id,
    runId: a.runId,
    commit: a.commit,
    profile: a.profile,
    scope: a.scope,
    complete: a.complete,
    incompleteReason: a.incompleteReason,
    partial: !a.complete || a.profile === "quick" || a.scope.length > 0,
    coverage: a.coverage as Record<string, number>,
    findings: a.counts as AuditSummary["findings"],
    created: o.created ?? [],
    updated: o.updated ?? [],
    reopened: o.reopened ?? [],
    notReported: o.notReported ?? [],
    rejectedNoted: o.rejectedNoted ?? [],
    rejected: a.rejected as { fingerprint: string; title: string; reason: string }[],
    importedBy: a.importedBy
      ? { id: a.importedBy.id, fullName: a.importedBy.fullName }
      : null,
    actorType: a.actorType,
    channel: a.channel,
    createdAt: a.createdAt.toISOString(),
  };
}

@Injectable()
export class SecurityAuditsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ProjectsAccess,
    private readonly writes: IssueWrites,
    private readonly activity: ProjectsActivity,
    private readonly security: SecurityQueries,
  ) {}

  /** Import one run. Needs Projects:Create and Projects:Update. */
  async import(actor: ProjectsActor, projectKey: string, input: AuditImportInput) {
    await this.access.need(actor, P.create, P.update);
    const project = await this.access.project(actor.user, projectKey);
    const firmId = actor.user.firmId;

    let summary: AuditSummary;
    let mapped: ReturnType<typeof mapFindings>;
    let seen: Set<string>;
    try {
      const findings = parseFindings(input.findings);
      summary = summariseAudit(findings, {
        run: input.run,
        ledger: input.ledger,
        coverage: input.coverage,
      });
      mapped = mapFindings(findings, { runId: summary.runId, commit: summary.commit });
      seen = new Set(findings.map((f) => f.fingerprint));
    } catch (e) {
      if (e instanceof AuditImportError) throw new BadRequestException(e.message);
      throw e;
    }
    const runLabel = runLabelOf(summary);

    const row = await this.prisma.$transaction(async (tx) => {
      // the labels the audit uses, made once for the firm with the skill's colours
      const have = new Map(
        (await tx.label.findMany({ where: { firmId } })).map((l) => [
          l.name.toLowerCase(),
          l,
        ]),
      );
      for (const [name, colour] of Object.entries(SECURITY_LABEL_COLORS)) {
        if (!have.has(name))
          have.set(name, await tx.label.create({ data: { firmId, name, colour } }));
      }
      const types = await tx.issueType.findMany({
        where: { firmId },
        orderBy: { order: "asc" },
      });
      const typeNamed = (n: string) =>
        types.find((t) => t.name.toLowerCase() === n.toLowerCase()) ?? types[0]!;
      const open = await tx.issueStatus.findFirst({ where: { firmId, isDefault: true } });
      if (!open) throw new BadRequestException(MESSAGES.statusNotFound);

      const known = await tx.securityFinding.findMany({
        where: { projectId: project.id },
        include: {
          issue: {
            include: { status: true, type: true, labels: { include: { label: true } } },
          },
        },
      });
      const byFp = new Map(known.map((f) => [f.fingerprint, f]));

      const auditRow = await tx.securityAudit.create({
        data: {
          firmId,
          projectId: project.id,
          runId: summary.runId,
          commit: summary.commit,
          profile: summary.profile,
          scope: summary.scope,
          complete: summary.status === "complete",
          incompleteReason: summary.incompleteReason,
          coverage: summary.coverage,
          counts: summary.findings as unknown as Prisma.InputJsonValue,
          rejected: mapped.rejected.map((r) => ({
            fingerprint: r.fingerprint,
            title: r.title,
            reason: r.reason,
          })),
          importedById:
            actor.actorType === "USER" || actor.actorType === "CLAUDE"
              ? actor.user.id
              : null,
          actorType: actor.actorType,
          channel: actor.channel,
        },
      });

      const out: Outcome = {
        created: [],
        updated: [],
        reopened: [],
        notReported: [],
        rejectedNoted: [],
      };

      for (const m of mapped.issues) {
        const ex = byFp.get(m.fingerprint);
        const issue = ex?.issue && !ex.issue.deleted ? ex.issue : null;
        const labelRows = m.labels.map((n) => have.get(n.toLowerCase())!);
        const state = m.type === "Bug" ? "confirmed" : "needs_validation";
        if (!issue) {
          const made = await this.writes.insert(tx, actor, project, {
            title: m.title,
            description: m.description,
            type: typeNamed(m.type),
            status: open,
            priority: m.priority,
            labels: labelRows,
          });
          out.created.push(made.key);
          await this.saveFinding(tx, ex?.id, {
            firmId,
            projectId: project.id,
            fingerprint: m.fingerprint,
            issueId: made.id,
            auditId: auditRow.id,
            state,
            severity: m.severity,
          });
          continue;
        }
        const reopened = issue.status.category === "DONE";
        await this.refresh(
          tx,
          actor,
          project,
          issue,
          m,
          labelRows,
          typeNamed(m.type),
          reopened ? open : null,
        );
        if (reopened) {
          await this.writes.comment(
            tx,
            actor,
            project.id,
            issue.id,
            `Reopened: security audit ${runLabel} reported this again${m.severity ? ` as ${m.severity}` : " (needs validation)"}.`,
          );
          out.reopened.push(issue.key);
        } else {
          out.updated.push(issue.key);
        }
        await this.saveFinding(tx, ex!.id, {
          firmId,
          projectId: project.id,
          fingerprint: m.fingerprint,
          issueId: issue.id,
          auditId: auditRow.id,
          state,
          severity: m.severity,
        });
      }

      // a rejected lead that is still an open issue is told so, for its owner to review
      for (const r of mapped.rejected) {
        const issue = byFp.get(r.fingerprint)?.issue;
        if (issue && !issue.deleted && issue.status.category !== "DONE") {
          await this.writes.comment(
            tx,
            actor,
            project.id,
            issue.id,
            `Security audit ${runLabel} rejected this lead: ${r.reason}\n\nReview and close it if you agree.`,
          );
          out.rejectedNoted.push(issue.key);
        }
      }

      // a complete whole-repo run that no longer reports an open finding says so; it closes nothing
      if (!summary.partial) {
        const unreported = known
          .filter(
            (f) => f.issue && !f.issue.deleted && f.issue.status.category !== "DONE",
          )
          .filter((f) => !seen.has(f.fingerprint))
          .sort((a, b) => a.issue!.number - b.issue!.number);
        for (const f of unreported) {
          await this.writes.comment(
            tx,
            actor,
            project.id,
            f.issue!.id,
            `Not reported by security audit ${runLabel}. If the fix is merged, verify it and close this issue.`,
          );
          out.notReported.push(f.issue!.key);
        }
      }

      const sev = (["critical", "high", "medium", "low", "informational"] as const)
        .filter((s) => summary.findings.bySeverity[s])
        .map((s) => `${summary.findings.bySeverity[s]} ${s}`);
      if (summary.findings.needsValidation)
        sev.push(`${summary.findings.needsValidation} needs validation`);
      await this.activity.log(tx, actor, {
        projectId: project.id,
        action: "security.audit",
        changes: [
          { field: "run", old: null, new: runLabel },
          { field: "findings", old: null, new: sev.length ? sev.join(", ") : "none" },
          ...(out.created.length
            ? [{ field: "created", old: null, new: out.created.join(", ") }]
            : []),
          ...(out.reopened.length
            ? [{ field: "reopened", old: null, new: out.reopened.join(", ") }]
            : []),
        ],
      });
      return tx.securityAudit.update({
        where: { id: auditRow.id },
        data: { outcome: out as unknown as Prisma.InputJsonValue },
        include: { importedBy: { select: { id: true, fullName: true } } },
      });
    }, TX_OPTIONS);
    return auditDto(row);
  }

  /** Bring an existing issue in line with the finding: title, text, type, priority, labels, status. */
  private async refresh(
    tx: Prisma.TransactionClient,
    actor: ProjectsActor,
    project: { id: string },
    issue: {
      id: string;
      title: string;
      description: string;
      priority: string;
      typeId: string;
      type: { name: string };
      status: { name: string };
      labels: { labelId: string; label: { name: string } }[];
    },
    m: MappedIssue,
    labelRows: { id: string; name: string }[],
    type: { id: string; name: string },
    reopenTo: { id: string; name: string } | null,
  ) {
    const data: Prisma.IssueUncheckedUpdateInput = {};
    const changes: Change[] = [];
    if (m.title !== issue.title) {
      data.title = m.title;
      changes.push({ field: "title", old: issue.title, new: m.title });
    }
    if (m.description !== issue.description) {
      data.description = m.description;
      changes.push({ field: "description", old: "(previous text)", new: "(new text)" });
    }
    if (type.id !== issue.typeId) {
      data.typeId = type.id;
      changes.push({ field: "type", old: issue.type.name, new: type.name });
    }
    if (m.priority !== issue.priority) {
      data.priority = m.priority;
      changes.push({ field: "priority", old: issue.priority, new: m.priority });
    }
    // the owner's own labels stay; the audit's replace the audit's
    const kept = issue.labels.filter((l) => !managed(l.label.name));
    const next = [
      ...kept.map((l) => ({ id: l.labelId, name: l.label.name })),
      ...labelRows,
    ];
    const was = issue.labels
      .map((l) => l.label.name)
      .sort()
      .join(", ");
    const will = next
      .map((l) => l.name)
      .sort()
      .join(", ");
    if (was !== will) {
      data.labels = {
        deleteMany: {},
        create: next.map((l) => ({ labelId: l.id, firmId: actor.user.firmId })),
      };
      changes.push({ field: "labels", old: was, new: will });
    }
    if (reopenTo) {
      data.statusId = reopenTo.id;
      data.closedAt = null;
      changes.push({ field: "status", old: issue.status.name, new: reopenTo.name });
    }
    if (changes.length === 0) return;
    await tx.issue.update({ where: { id: issue.id }, data });
    await this.activity.log(tx, actor, {
      projectId: project.id,
      issueId: issue.id,
      action: "issue.updated",
      changes,
    });
  }

  private async saveFinding(
    tx: Prisma.TransactionClient,
    id: string | undefined,
    f: {
      firmId: string;
      projectId: string;
      fingerprint: string;
      issueId: string;
      auditId: string;
      state: string;
      severity: string | null;
    },
  ) {
    const data = {
      issueId: f.issueId,
      lastSeenAuditId: f.auditId,
      state: f.state,
      severity: f.severity,
      updatedAt: new Date(),
    };
    if (id) await tx.securityFinding.update({ where: { id }, data });
    else {
      await tx.securityFinding.create({
        data: {
          firmId: f.firmId,
          projectId: f.projectId,
          fingerprint: f.fingerprint,
          ...data,
        },
      });
    }
  }

  /** The audit history of a project, newest first. */
  async list(actor: ProjectsActor, projectKey: string, limit: number) {
    await this.access.need(actor, P.read);
    const project = await this.access.project(actor.user, projectKey);
    const rows = await this.prisma.securityAudit.findMany({
      where: { projectId: project.id },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit,
      include: { importedBy: { select: { id: true, fullName: true } } },
    });
    return { items: rows.map(auditDto) };
  }

  /** The security state of a project: the gate, the open findings by severity, the last audit. */
  async status(actor: ProjectsActor, projectKey: string) {
    await this.access.need(actor, P.read);
    const project = await this.access.project(actor.user, projectKey);
    const [s, last] = await Promise.all([
      this.security.summary(actor.user.firmId, project.id),
      this.prisma.securityAudit.findFirst({
        where: { projectId: project.id },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        include: { importedBy: { select: { id: true, fullName: true } } },
      }),
    ]);
    return {
      projectKey: project.key,
      state: s.state,
      blockedBy: s.blockedBy,
      counts: s.counts,
      open: s.open.map((i) => ({
        key: i.key,
        title: i.title,
        severity: i.severity,
        needsValidation: i.needsValidation,
        fingerprint: i.fingerprint,
      })),
      lastAudit: last ? auditDto(last) : null,
    };
  }
}
