// my-work.service.ts — PA2 (D66): what one person should look at, across every project they can see.
//
// Respects client visibility: a project linked to a client this person cannot see is not here,
// nor are its issues, milestones or activity. Archived projects are left out.
import { Injectable } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { ProjectsAccess, type ProjectsActor } from "./projects.access";
import { activityDto } from "./projects-activity.service";
import { ProjectsService } from "./projects.service";
import {
  addDays,
  dayToDate,
  manilaToday,
  PRIORITY_RANK,
  PROJECTS_PERMISSION as P,
} from "./projects.constants";
import { ISSUE_INCLUDE, issueItem, milestoneDto } from "./projects.mappers";

const LIMIT = 100;

@Injectable()
export class MyWorkService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ProjectsAccess,
    private readonly projects: ProjectsService,
  ) {}

  async myWork(actor: ProjectsActor) {
    await this.access.need(actor, P.read);
    const user = actor.user;
    const today = manilaToday();
    const todayDate = dayToDate(today)!;
    const visible: Prisma.ProjectWhereInput = {
      ...(await this.access.visibleWhere(user)),
      archived: false,
    };
    const open: Prisma.IssueWhereInput = {
      firmId: user.firmId,
      deleted: false,
      project: visible,
      status: { category: { not: "DONE" } },
    };
    const mine: Prisma.IssueWhereInput = { ...open, assigneeId: user.id };
    const weekEnd = dayToDate(addDays(today, 6))!;
    const soon = dayToDate(addDays(today, 30))!;

    const [
      assigned,
      overdue,
      assignedCount,
      overdueCount,
      weekCount,
      milestones,
      activity,
    ] = await Promise.all([
      this.prisma.issue.findMany({ where: mine, include: ISSUE_INCLUDE, take: 500 }),
      this.prisma.issue.findMany({
        where: { ...open, dueDate: { lt: todayDate } },
        include: ISSUE_INCLUDE,
        orderBy: [{ dueDate: "asc" }, { number: "asc" }],
        take: LIMIT,
      }),
      this.prisma.issue.count({ where: mine }),
      this.prisma.issue.count({ where: { ...open, dueDate: { lt: todayDate } } }),
      this.prisma.issue.count({
        where: { ...mine, dueDate: { gte: todayDate, lte: weekEnd } },
      }),
      this.prisma.milestone.findMany({
        where: {
          firmId: user.firmId,
          state: "OPEN",
          dueDate: { gte: todayDate, lte: soon },
          project: visible,
        },
        orderBy: [{ dueDate: "asc" }, { createdAt: "asc" }],
        include: { project: { select: { key: true, name: true } } },
        take: LIMIT,
      }),
      this.prisma.projectActivity.findMany({
        where: { firmId: user.firmId, project: visible },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 20,
        include: {
          actorUser: { select: { id: true, fullName: true } },
          issue: { select: { key: true, title: true } },
          project: { select: { key: true, name: true } },
        },
      }),
    ]);
    // priority first (urgent on top), then the nearest due date, issues without one last
    assigned.sort(
      (a, b) =>
        (PRIORITY_RANK[a.priority] ?? 9) - (PRIORITY_RANK[b.priority] ?? 9) ||
        (a.dueDate && b.dueDate
          ? a.dueDate.getTime() - b.dueDate.getTime()
          : a.dueDate
            ? -1
            : b.dueDate
              ? 1
              : 0) ||
        a.number - b.number,
    );
    const progress = await this.projects.milestoneProgress(
      user.firmId,
      milestones.map((m) => m.id),
      today,
    );
    return {
      today,
      totals: {
        assignedOpen: assignedCount,
        overdue: overdueCount,
        dueThisWeek: weekCount,
      },
      assigned: assigned.slice(0, LIMIT).map((i) => issueItem(i, today)),
      overdue: overdue.map((i) => issueItem(i, today)),
      upcomingMilestones: milestones.map((m) => ({
        ...milestoneDto(m, progress.get(m.id) ?? { done: 0, total: 0, overdue: 0 }),
        project: { key: m.project.key, name: m.project.name },
      })),
      recentActivity: activity.map((a) => ({
        ...activityDto(a),
        project: { key: a.project.key, name: a.project.name },
      })),
    };
  }
}
