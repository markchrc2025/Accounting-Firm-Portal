// projects-context.service.ts — PA3 (D67): the briefing of a project as markdown, for the
// SessionStart hook and the get_project_context / start_session tools. Visibility and the
// Projects:Read permission are the same as for the project's own screen.
import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import {
  byPriorityThenDue,
  describeActivity,
  renderBriefing,
  type BriefIssue,
} from "./briefing";
import {
  dayOf,
  isOverdue,
  manilaToday,
  PROJECTS_PERMISSION as P,
} from "./projects.constants";
import { ISSUE_INCLUDE, issueItem } from "./projects.mappers";
import { ProjectsAccess, type ProjectsActor } from "./projects.access";
import { ProjectsService } from "./projects.service";

const LIST_LIMIT = 25;
const SESSIONS = 3;
const ACTIVITY = 15;

@Injectable()
export class ProjectsContextService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ProjectsAccess,
    private readonly projects: ProjectsService,
  ) {}

  async briefing(actor: ProjectsActor, key: string): Promise<string> {
    await this.access.need(actor, P.read);
    const base = await this.access.project(actor.user, key);
    const firmId = actor.user.firmId;
    const today = manilaToday();
    const p = await this.prisma.project.findUniqueOrThrow({ where: { id: base.id } });
    const [counts, update, milestones, inProgress, todo, sessions, activity] =
      await Promise.all([
        this.projects.counts(firmId, [p.id], today),
        this.prisma.projectStatusUpdate.findFirst({
          where: { projectId: p.id },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        }),
        this.prisma.milestone.findMany({
          where: { projectId: p.id, state: { not: "CLOSED" } },
          orderBy: [{ dueDate: { sort: "asc", nulls: "last" } }, { createdAt: "asc" }],
        }),
        this.prisma.issue.findMany({
          where: { projectId: p.id, deleted: false, status: { category: "IN_PROGRESS" } },
          include: ISSUE_INCLUDE,
          orderBy: [{ updatedAt: "desc" }],
          take: 100,
        }),
        this.prisma.issue.findMany({
          where: { projectId: p.id, deleted: false, status: { category: "TODO" } },
          include: ISSUE_INCLUDE,
          orderBy: [{ number: "asc" }],
          take: 500,
        }),
        this.prisma.projectWorkSession.findMany({
          where: { projectId: p.id },
          orderBy: [{ startedAt: "desc" }, { id: "desc" }],
          take: SESSIONS,
          include: { user: { select: { fullName: true } } },
        }),
        this.prisma.projectActivity.findMany({
          where: { projectId: p.id },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          take: ACTIVITY,
          include: {
            actorUser: { select: { fullName: true } },
            issue: { select: { key: true } },
          },
        }),
      ]);
    const progress = await this.projects.milestoneProgress(
      firmId,
      milestones.map((m) => m.id),
      today,
    );
    const c = counts.get(p.id);
    const brief = (rows: typeof inProgress): BriefIssue[] =>
      rows.map((r) => {
        const i = issueItem(r, today);
        return {
          key: i.key,
          status: i.status.name,
          type: i.type.name,
          priority: i.priority,
          title: i.title,
          assignee: i.assignee?.fullName ?? null,
          milestone: i.milestone?.name ?? null,
          dueDate: i.dueDate,
          overdue: i.overdue,
          labels: i.labels.map((l) => l.name),
        };
      });
    return renderBriefing({
      project: {
        key: p.key,
        name: p.name,
        description: p.description,
        status: update?.status ?? "NOT_STARTED",
        statusNote: update?.note || null,
        statusUpdatedAt: update?.createdAt ?? null,
        repoUrl: p.repoUrl,
        liveUrl: p.liveUrl,
        deployAppName: p.deployAppName,
      },
      counts: {
        todo: c?.todo ?? 0,
        inProgress: c?.inProgress ?? 0,
        done: c?.done ?? 0,
        overdue: c?.overdue ?? 0,
        bugsOpen: c?.openBugs ?? 0,
      },
      milestones: milestones.map((m) => {
        const pr = progress.get(m.id) ?? { done: 0, total: 0, overdue: 0 };
        const due = dayOf(m.dueDate);
        return {
          name: m.name,
          dueDate: due,
          done: pr.done,
          total: pr.total,
          state: m.state,
          overdue: isOverdue(due, "TODO", today),
        };
      }),
      inProgress: brief(inProgress).sort(byPriorityThenDue).slice(0, LIST_LIMIT),
      todo: brief(todo).sort(byPriorityThenDue).slice(0, LIST_LIMIT),
      sessions: sessions.map((s) => ({
        startedAt: s.startedAt,
        client: s.client,
        userName: s.user.fullName,
        title: s.title,
        summary: s.summary,
        endedAt: s.endedAt,
        nextSteps: s.nextSteps,
      })),
      activity: activity.map((a) => ({
        at: a.createdAt,
        actor: actorLabel(a.actorType, a.actorUser?.fullName ?? null),
        text: describeActivity({
          action: a.action,
          issueKey: a.issue?.key ?? null,
          changes: a.changes as unknown as {
            field: string;
            old: unknown;
            new: unknown;
          }[],
        }),
      })),
    });
  }
}

export function actorLabel(actorType: string, name: string | null): string {
  if (actorType === "CLAUDE") return name ? `Claude (for ${name})` : "Claude";
  if (actorType === "GITHUB") return "GitHub";
  if (actorType === "SYSTEM") return "System";
  return name ?? "someone";
}
