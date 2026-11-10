// projects.service.ts — PA1 (D65): projects, their status updates, the portfolio and the overview.
// Every change runs in one transaction together with its ProjectActivity rows.
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import type {
  CreateProjectInput,
  PostStatusInput,
  UpdateProjectInput,
} from "./dto/projects.schemas";
import { SecurityQueries } from "./security-queries";
import { ProjectsAccess, type ProjectsActor } from "./projects.access";
import { ProjectsActivity } from "./projects-activity.service";
import { projectSessions } from "./work-sessions.service";
import {
  diffFields,
  manilaToday,
  MESSAGES,
  percent,
  PROJECT_KEY_RE,
  PROJECTS_PERMISSION as P,
  type ActorType,
  type Change,
} from "./projects.constants";
import {
  ISSUE_INCLUDE,
  issueItem,
  milestoneDto,
  PROJECT_INCLUDE,
  projectDto,
  statusUpdateDto,
} from "./projects.mappers";

/** Counts of a project's issues, by category, plus the overdue and open-bug ones. */
export interface ProjectCounts {
  todo: number;
  inProgress: number;
  done: number;
  total: number;
  overdue: number;
  openBugs: number;
}
const NO_COUNTS: ProjectCounts = {
  todo: 0,
  inProgress: 0,
  done: 0,
  total: 0,
  overdue: 0,
  openBugs: 0,
};

@Injectable()
export class ProjectsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ProjectsAccess,
    private readonly activity: ProjectsActivity,
    private readonly security: SecurityQueries,
  ) {}

  // ---------------------------------------------------------------------------------------
  // The numbers every list and overview shows
  // ---------------------------------------------------------------------------------------

  /** Counts per project, in one query: by category, overdue (Manila date) and open bugs. */
  async counts(
    firmId: string,
    projectIds: string[],
    today: string,
  ): Promise<Map<string, ProjectCounts>> {
    const out = new Map<string, ProjectCounts>();
    if (projectIds.length === 0) return out;
    const rows = await this.prisma.$queryRaw<
      {
        projectId: string;
        todo: number;
        in_progress: number;
        done: number;
        total: number;
        overdue: number;
        bugs: number;
      }[]
    >(Prisma.sql`
      SELECT i."projectId",
        (count(*) FILTER (WHERE s."category" = 'TODO'))::int AS todo,
        (count(*) FILTER (WHERE s."category" = 'IN_PROGRESS'))::int AS in_progress,
        (count(*) FILTER (WHERE s."category" = 'DONE'))::int AS done,
        count(*)::int AS total,
        (count(*) FILTER (WHERE s."category" <> 'DONE' AND i."dueDate" < ${today}::date))::int AS overdue,
        (count(*) FILTER (WHERE s."category" <> 'DONE' AND lower(t."name") = 'bug'))::int AS bugs
      FROM "issues" i
      JOIN "issue_statuses" s ON s."id" = i."statusId"
      JOIN "issue_types" t ON t."id" = i."typeId"
      WHERE i."firmId" = ${firmId}::uuid AND NOT i."deleted" AND i."projectId" = ANY(${projectIds}::uuid[])
      GROUP BY i."projectId"`);
    for (const r of rows) {
      out.set(r.projectId, {
        todo: r.todo,
        inProgress: r.in_progress,
        done: r.done,
        total: r.total,
        overdue: r.overdue,
        openBugs: r.bugs,
      });
    }
    return out;
  }

  /** Milestones of the projects with done / total / overdue issue counts. */
  async milestoneProgress(firmId: string, milestoneIds: string[], today: string) {
    const out = new Map<string, { done: number; total: number; overdue: number }>();
    if (milestoneIds.length === 0) return out;
    const rows = await this.prisma.$queryRaw<
      { milestoneId: string; done: number; total: number; overdue: number }[]
    >(Prisma.sql`
      SELECT i."milestoneId",
        (count(*) FILTER (WHERE s."category" = 'DONE'))::int AS done,
        count(*)::int AS total,
        (count(*) FILTER (WHERE s."category" <> 'DONE' AND i."dueDate" < ${today}::date))::int AS overdue
      FROM "issues" i
      JOIN "issue_statuses" s ON s."id" = i."statusId"
      WHERE i."firmId" = ${firmId}::uuid AND NOT i."deleted" AND i."milestoneId" = ANY(${milestoneIds}::uuid[])
      GROUP BY i."milestoneId"`);
    for (const r of rows)
      out.set(r.milestoneId, { done: r.done, total: r.total, overdue: r.overdue });
    return out;
  }

  // ---------------------------------------------------------------------------------------
  // The portfolio
  // ---------------------------------------------------------------------------------------

  async list(actor: ProjectsActor, opts: { includeArchived: boolean }) {
    await this.access.need(actor, P.read);
    const user = actor.user;
    const visible = await this.access.visibleWhere(user);
    const rows = await this.prisma.project.findMany({
      where: { ...visible, ...(opts.includeArchived ? {} : { archived: false }) },
      include: PROJECT_INCLUDE,
      orderBy: { key: "asc" },
    });
    const ids = rows.map((r) => r.id);
    const today = manilaToday();
    const [counts, latest, activity, milestones, badges] = await Promise.all([
      this.counts(user.firmId, ids, today),
      this.prisma.projectStatusUpdate.findMany({
        where: { projectId: { in: ids } },
        orderBy: [{ projectId: "asc" }, { createdAt: "desc" }, { id: "desc" }],
        distinct: ["projectId"],
      }),
      this.prisma.projectActivity.groupBy({
        by: ["projectId"],
        where: { projectId: { in: ids } },
        _max: { createdAt: true },
      }),
      this.prisma.milestone.findMany({
        where: { projectId: { in: ids }, state: { not: "CLOSED" } },
        orderBy: [{ dueDate: { sort: "asc", nulls: "last" } }, { createdAt: "asc" }],
      }),
      this.security.badges(user.firmId, ids),
    ]);
    const progress = await this.milestoneProgress(
      user.firmId,
      milestones.map((m) => m.id),
      today,
    );
    const statusOf = new Map(latest.map((u) => [u.projectId, u]));
    const lastAt = new Map(activity.map((a) => [a.projectId, a._max.createdAt]));
    const nextOf = new Map<string, (typeof milestones)[number]>();
    for (const m of milestones) if (!nextOf.has(m.projectId)) nextOf.set(m.projectId, m);

    return rows.map((p) => {
      const c = counts.get(p.id) ?? NO_COUNTS;
      const s = statusOf.get(p.id);
      const next = nextOf.get(p.id);
      const np = next
        ? (progress.get(next.id) ?? { done: 0, total: 0, overdue: 0 })
        : null;
      return {
        ...projectDto(p),
        status: s?.status ?? "NOT_STARTED",
        statusNote: s?.note ?? "",
        statusUpdatedAt: s ? s.createdAt.toISOString() : null,
        progress: { done: c.done, total: c.total, percent: percent(c.done, c.total) },
        counts: {
          todo: c.todo,
          inProgress: c.inProgress,
          done: c.done,
          overdue: c.overdue,
          openBugs: c.openBugs,
        },
        nextMilestone: next && np ? milestoneDto(next, np) : null,
        lastActivityAt: lastAt.get(p.id)?.toISOString() ?? null,
        // PA4: the project's security state, additive
        security: badges.get(p.id) ?? { state: "clear", open: 0, critical: 0, high: 0 },
      };
    });
  }

  // ---------------------------------------------------------------------------------------
  // One project: the overview
  // ---------------------------------------------------------------------------------------

  async overview(actor: ProjectsActor, key: string) {
    await this.access.need(actor, P.read);
    const user = actor.user;
    const base = await this.access.project(user, key);
    const p = await this.prisma.project.findUniqueOrThrow({
      where: { id: base.id },
      include: PROJECT_INCLUDE,
    });
    const today = manilaToday();
    const [counts, updates, milestones, inProgress, byStatus, byType, recent, lastAct] =
      await Promise.all([
        this.counts(user.firmId, [p.id], today),
        this.prisma.projectStatusUpdate.findMany({
          where: { projectId: p.id },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          take: 20,
          include: { actorUser: { select: { id: true, fullName: true } } },
        }),
        this.prisma.milestone.findMany({
          where: { projectId: p.id, state: { not: "CLOSED" } },
          orderBy: [{ dueDate: { sort: "asc", nulls: "last" } }, { createdAt: "asc" }],
        }),
        this.prisma.issue.findMany({
          where: { projectId: p.id, deleted: false, status: { category: "IN_PROGRESS" } },
          include: ISSUE_INCLUDE,
          orderBy: [{ updatedAt: "desc" }],
          take: 50,
        }),
        this.prisma.issue.groupBy({
          by: ["statusId"],
          where: { projectId: p.id, deleted: false },
          _count: { _all: true },
        }),
        this.prisma.issue.groupBy({
          by: ["typeId"],
          where: { projectId: p.id, deleted: false },
          _count: { _all: true },
        }),
        this.activity.list(user.firmId, p.id, { page: 1, pageSize: 10 }),
        this.prisma.projectActivity.aggregate({
          where: { projectId: p.id },
          _max: { createdAt: true },
        }),
      ]);
    // PA5: the last five Claude work sessions
    const recentSessions = (
      await projectSessions(this.prisma, user.firmId, p.id, { skip: 0, take: 5 })
    ).items;
    const [statuses, types] = await Promise.all([
      this.prisma.issueStatus.findMany({
        where: { firmId: user.firmId },
        orderBy: { order: "asc" },
      }),
      this.prisma.issueType.findMany({
        where: { firmId: user.firmId },
        orderBy: { order: "asc" },
      }),
    ]);
    const progress = await this.milestoneProgress(
      user.firmId,
      milestones.map((m) => m.id),
      today,
    );
    const c = counts.get(p.id) ?? NO_COUNTS;
    const current = updates[0];
    const countOf = (rows: { _count: { _all: number } }[], i: number) =>
      rows[i]!._count._all;
    return {
      project: projectDto(p),
      status: {
        value: current?.status ?? "NOT_STARTED",
        note: current?.note ?? "",
        updatedAt: current ? current.createdAt.toISOString() : null,
      },
      statusUpdates: updates.map(statusUpdateDto),
      progress: { done: c.done, total: c.total, percent: percent(c.done, c.total) },
      counts: {
        todo: c.todo,
        inProgress: c.inProgress,
        done: c.done,
        overdue: c.overdue,
        openBugs: c.openBugs,
      },
      countsByStatus: statuses.map((s) => {
        const i = byStatus.findIndex((r) => r.statusId === s.id);
        return {
          status: { id: s.id, name: s.name, colour: s.colour, category: s.category },
          count: i < 0 ? 0 : countOf(byStatus, i),
        };
      }),
      countsByType: types.map((t) => {
        const i = byType.findIndex((r) => r.typeId === t.id);
        return {
          type: { id: t.id, name: t.name, colour: t.colour },
          count: i < 0 ? 0 : countOf(byType, i),
        };
      }),
      openMilestones: milestones.map((m) =>
        milestoneDto(m, progress.get(m.id) ?? { done: 0, total: 0, overdue: 0 }),
      ),
      inProgress: inProgress.map((i) => issueItem(i, today)),
      recentActivity: recent.items,
      recentSessions,
      lastActivityAt: lastAct._max.createdAt?.toISOString() ?? null,
      // PA4: the project's security state, additive
      security: (await this.security.badges(user.firmId, [p.id])).get(p.id) ?? {
        state: "clear",
        open: 0,
        critical: 0,
        high: 0,
      },
    };
  }

  // ---------------------------------------------------------------------------------------
  // Create and change
  // ---------------------------------------------------------------------------------------

  /** The client a project may be linked to: of this firm, and visible to the caller. */
  private async linkableClient(actor: ProjectsActor, clientId: string) {
    const client = await this.prisma.client.findFirst({
      where: { id: clientId, firmId: actor.user.firmId },
      select: { id: true, businessName: true },
    });
    if (!client || !(await this.access.canSeeClient(actor.user, client.id))) {
      throw new NotFoundException(MESSAGES.clientNotFound);
    }
    return client;
  }

  /** The parent project: a visible project of the firm that is not (below) this one. */
  private async parentProject(actor: ProjectsActor, key: string, self?: { id: string }) {
    const k = key.trim().toUpperCase();
    const parent = PROJECT_KEY_RE.test(k)
      ? await this.prisma.project.findFirst({
          where: { firmId: actor.user.firmId, key: k },
        })
      : null;
    if (
      !parent ||
      (parent.clientId && !(await this.access.canSeeClient(actor.user, parent.clientId)))
    ) {
      throw new NotFoundException(MESSAGES.parentProjectNotFound);
    }
    if (self) {
      if (parent.id === self.id) throw new BadRequestException(MESSAGES.ownParentProject);
      let up = parent.parentProjectId;
      for (let hops = 0; up && hops < 50; hops++) {
        if (up === self.id) throw new BadRequestException(MESSAGES.parentProjectLoop);
        up =
          (
            await this.prisma.project.findUnique({
              where: { id: up },
              select: { parentProjectId: true },
            })
          )?.parentProjectId ?? null;
      }
    }
    return parent;
  }

  async create(actor: ProjectsActor, input: CreateProjectInput) {
    await this.access.need(actor, P.create);
    const user = actor.user;
    const key = input.key.trim().toUpperCase();
    if (!PROJECT_KEY_RE.test(key)) throw new BadRequestException(MESSAGES.badKey);
    const name = input.name.trim();
    if (!name) throw new BadRequestException(MESSAGES.nameRequired);
    const parent = input.parentKey
      ? await this.parentProject(actor, input.parentKey)
      : null;
    const client = input.clientId
      ? await this.linkableClient(actor, input.clientId)
      : null;
    try {
      const id = await this.prisma.$transaction(async (tx) => {
        const row = await tx.project.create({
          data: {
            firmId: user.firmId,
            key,
            name,
            description: input.description ?? "",
            repoUrl: input.repoUrl ?? "",
            liveUrl: input.liveUrl ?? "",
            deployAppName: input.deployAppName ?? "",
            parentProjectId: parent?.id ?? null,
            clientId: client?.id ?? null,
          },
        });
        await this.activity.log(tx, actor, {
          projectId: row.id,
          action: "project.created",
          changes: [
            { field: "key", old: null, new: key },
            { field: "name", old: null, new: name },
            ...(client ? [{ field: "client", old: null, new: client.businessName }] : []),
          ],
        });
        return row.id;
      });
      return projectDto(
        await this.prisma.project.findUniqueOrThrow({
          where: { id },
          include: PROJECT_INCLUDE,
        }),
      );
    } catch (err) {
      if ((err as { code?: string })?.code === "P2002")
        throw new ConflictException(MESSAGES.keyUsed);
      throw err;
    }
  }

  async update(actor: ProjectsActor, key: string, patch: UpdateProjectInput) {
    await this.access.need(actor, P.update);
    const cur = await this.access.project(actor.user, key);
    if (patch.key !== undefined && patch.key.trim().toUpperCase() !== cur.key) {
      throw new BadRequestException(MESSAGES.keyFixed);
    }
    const data: Prisma.ProjectUncheckedUpdateInput = {};
    const changes: Change[] = [];
    if (patch.name !== undefined) {
      const name = patch.name.trim();
      if (!name) throw new BadRequestException(MESSAGES.nameRequired);
      if (name !== cur.name) {
        data.name = name;
        changes.push({ field: "name", old: cur.name, new: name });
      }
    }
    if (patch.description !== undefined && patch.description !== cur.description) {
      data.description = patch.description;
      changes.push({ field: "description", old: "(previous text)", new: "(new text)" });
    }
    for (const f of ["repoUrl", "liveUrl", "deployAppName"] as const) {
      const v = patch[f];
      if (v !== undefined && v !== cur[f]) {
        data[f] = v;
        changes.push({ field: f, old: cur[f], new: v });
      }
    }
    if (patch.parentKey !== undefined) {
      const parent = patch.parentKey
        ? await this.parentProject(actor, patch.parentKey, cur)
        : null;
      if ((parent?.id ?? null) !== cur.parentProjectId) {
        const before = cur.parentProjectId
          ? await this.prisma.project.findUnique({
              where: { id: cur.parentProjectId },
              select: { key: true },
            })
          : null;
        data.parentProjectId = parent?.id ?? null;
        changes.push({
          field: "parent",
          old: before?.key ?? null,
          new: parent?.key ?? null,
        });
      }
    }
    if (patch.clientId !== undefined) {
      const client = patch.clientId
        ? await this.linkableClient(actor, patch.clientId)
        : null;
      if ((client?.id ?? null) !== cur.clientId) {
        const before = cur.clientId
          ? await this.prisma.client.findUnique({
              where: { id: cur.clientId },
              select: { businessName: true },
            })
          : null;
        data.clientId = client?.id ?? null;
        changes.push({
          field: "client",
          old: before?.businessName ?? null,
          new: client?.businessName ?? null,
        });
      }
    }
    if (changes.length > 0) {
      await this.prisma.$transaction(async (tx) => {
        await tx.project.update({ where: { id: cur.id }, data });
        await this.activity.log(tx, actor, {
          projectId: cur.id,
          action: "project.updated",
          changes,
        });
      });
    }
    return projectDto(
      await this.prisma.project.findUniqueOrThrow({
        where: { id: cur.id },
        include: PROJECT_INCLUDE,
      }),
    );
  }

  /** Archive or unarchive. Nothing is ever deleted. Doing what is already done changes nothing. */
  async setArchived(actor: ProjectsActor, key: string, archived: boolean) {
    await this.access.need(actor, P.update);
    const cur = await this.access.project(actor.user, key);
    if (cur.archived !== archived) {
      await this.prisma.$transaction(async (tx) => {
        await tx.project.update({ where: { id: cur.id }, data: { archived } });
        await this.activity.log(tx, actor, {
          projectId: cur.id,
          action: archived ? "project.archived" : "project.unarchived",
          changes: diffFields({ archived: cur.archived }, { archived }, ["archived"]),
        });
      });
    }
    return projectDto(
      await this.prisma.project.findUniqueOrThrow({
        where: { id: cur.id },
        include: PROJECT_INCLUDE,
      }),
    );
  }

  // ---------------------------------------------------------------------------------------
  // Status updates
  // ---------------------------------------------------------------------------------------

  async statusUpdates(actor: ProjectsActor, key: string) {
    await this.access.need(actor, P.read);
    const p = await this.access.project(actor.user, key);
    const rows = await this.prisma.projectStatusUpdate.findMany({
      where: { projectId: p.id },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      include: { actorUser: { select: { id: true, fullName: true } } },
    });
    return rows.map(statusUpdateDto);
  }

  async postStatus(actor: ProjectsActor, key: string, input: PostStatusInput) {
    await this.access.need(actor, P.update);
    const p = await this.access.project(actor.user, key);
    const created = await this.prisma.$transaction(async (tx) => {
      const before = await tx.projectStatusUpdate.findFirst({
        where: { projectId: p.id },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      });
      const row = await tx.projectStatusUpdate.create({
        data: {
          firmId: actor.user.firmId,
          projectId: p.id,
          status: input.status,
          note: input.note,
          actorType: actor.actorType,
          actorUserId: actor.user.id,
        },
        include: { actorUser: { select: { id: true, fullName: true } } },
      });
      await this.activity.log(tx, actor, {
        projectId: p.id,
        action: "project.status",
        changes: [
          { field: "status", old: before?.status ?? "NOT_STARTED", new: input.status },
          ...(input.note
            ? [{ field: "note", old: null, new: input.note.slice(0, 300) }]
            : []),
        ],
      });
      return row;
    });
    return statusUpdateDto(created);
  }

  // ---------------------------------------------------------------------------------------
  // Activity
  // ---------------------------------------------------------------------------------------

  async activityOf(
    actor: ProjectsActor,
    key: string,
    opts: { actorType?: ActorType; page: number; pageSize: number },
  ) {
    await this.access.need(actor, P.read);
    const p = await this.access.project(actor.user, key);
    return this.activity.list(actor.user.firmId, p.id, opts);
  }
}
