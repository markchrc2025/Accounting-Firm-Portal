// issues.service.ts — PA1 (D65): issues, their comments, and the lists the screens show.
//
// Rules kept here: the next number comes from an atomic increment of Project.issueCounter in the
// create transaction (numbers are never reused, even after a soft delete); entering a DONE
// status sets closedAt and leaving it clears it; overdue is by the Manila date; delete is soft and
// detaches the children, each logged; every change writes its activity rows in its own
// transaction.
import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import type {
  CreateIssueInput,
  IssueListQuery,
  ReorderIssueInput,
  UpdateIssueInput,
} from "./dto/projects.schemas";
import { ProjectsAccess, type ProjectsActor, type Tx } from "./projects.access";
import { ProjectsActivity } from "./projects-activity.service";
import {
  dayOf,
  dayToDate,
  isRealDate,
  ISSUE_KEY_RE,
  manilaToday,
  MESSAGES,
  PRIORITY_RANK,
  PROJECTS_PERMISSION as P,
  type Change,
} from "./projects.constants";
import { ISSUE_INCLUDE, issueItem, type IssueRow } from "./projects.mappers";

type ProjectRef = { id: string; key: string };

@Injectable()
export class IssuesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ProjectsAccess,
    private readonly activity: ProjectsActivity,
  ) {}

  // ---------------------------------------------------------------------------------------
  // Reading
  // ---------------------------------------------------------------------------------------

  async list(actor: ProjectsActor, projectKey: string, q: IssueListQuery) {
    await this.access.need(actor, P.read);
    const project = await this.access.project(actor.user, projectKey);
    const today = manilaToday();
    const view = q.view;
    const state =
      q.state ??
      (view === "closed" ? "closed" : view === "all" ? "all" : view ? "open" : "all");
    const and: Prisma.IssueWhereInput[] = [];
    if (state === "open") and.push({ status: { category: { not: "DONE" } } });
    if (state === "closed") and.push({ status: { category: "DONE" } });
    if (view === "overdue") {
      and.push({
        status: { category: { not: "DONE" } },
        dueDate: { lt: dayToDate(today)! },
      });
    }
    if (view === "bugs")
      and.push({ type: { name: { equals: "Bug", mode: "insensitive" } } });
    const assignee = q.assigneeId ?? (view === "mine" ? "me" : undefined);
    if (assignee === "none") and.push({ assigneeId: null });
    else if (assignee === "me") and.push({ assigneeId: actor.user.id });
    else if (assignee) and.push({ assigneeId: assignee });
    if (q.milestoneId === "none") and.push({ milestoneId: null });
    else if (q.milestoneId) and.push({ milestoneId: q.milestoneId });
    if (q.statusId) and.push({ statusId: q.statusId });
    if (q.typeId) and.push({ typeId: q.typeId });
    if (q.priority) and.push({ priority: q.priority });
    if (q.labelId) and.push({ labels: { some: { labelId: q.labelId } } });
    const text = q.q?.trim();
    if (text) {
      and.push({
        OR: [
          { title: { contains: text, mode: "insensitive" } },
          { key: { contains: text, mode: "insensitive" } },
          { description: { contains: text, mode: "insensitive" } },
        ],
      });
    }
    const where: Prisma.IssueWhereInput = {
      firmId: actor.user.firmId,
      projectId: project.id,
      deleted: false,
      AND: and,
    };
    const sort = q.sort ?? "updated";
    const total = await this.prisma.issue.count({ where });
    let rows: IssueRow[];
    if (sort === "priority") {
      // Most urgent first, then the most recently updated: the order is not a column's own.
      const all = await this.prisma.issue.findMany({
        where,
        include: ISSUE_INCLUDE,
        orderBy: { updatedAt: "desc" },
        take: 2000,
      });
      all.sort(
        (a, b) => (PRIORITY_RANK[a.priority] ?? 9) - (PRIORITY_RANK[b.priority] ?? 9),
      );
      rows = all.slice(q.offset, q.offset + q.limit);
    } else {
      const orderBy: Prisma.IssueOrderByWithRelationInput[] =
        sort === "created"
          ? [{ createdAt: "desc" }, { number: "desc" }]
          : sort === "key"
            ? [{ number: "asc" }]
            : sort === "due"
              ? [{ dueDate: { sort: "asc", nulls: "last" } }, { number: "asc" }]
              : [{ updatedAt: "desc" }, { number: "desc" }];
      rows = await this.prisma.issue.findMany({
        where,
        include: ISSUE_INCLUDE,
        orderBy,
        skip: q.offset,
        take: q.limit,
      });
    }
    return {
      items: rows.map((r) => issueItem(r, today)),
      total,
      limit: q.limit,
      offset: q.offset,
    };
  }

  /** One issue of the project, not deleted; else 404. */
  private async load(
    actor: ProjectsActor,
    projectKey: string,
    issueKey: string,
    db: Tx | PrismaService = this.prisma,
  ) {
    const project = await this.access.project(actor.user, projectKey, db);
    const k = (issueKey ?? "").trim().toUpperCase();
    const issue = ISSUE_KEY_RE.test(k)
      ? await db.issue.findFirst({
          where: {
            firmId: actor.user.firmId,
            projectId: project.id,
            key: k,
            deleted: false,
          },
          include: ISSUE_INCLUDE,
        })
      : null;
    if (!issue) throw new NotFoundException(MESSAGES.issueNotFound);
    return { project, issue };
  }

  private async detail(actor: ProjectsActor, issueId: string) {
    const today = manilaToday();
    const i = await this.prisma.issue.findUniqueOrThrow({
      where: { id: issueId },
      include: {
        ...ISSUE_INCLUDE,
        author: { select: { id: true, fullName: true } },
        children: {
          where: { deleted: false },
          include: ISSUE_INCLUDE,
          orderBy: { number: "asc" },
        },
        _count: { select: { comments: true } },
      },
    });
    return {
      ...issueItem(i, today),
      description: i.description,
      author: i.author ? { id: i.author.id, fullName: i.author.fullName } : null,
      parent: i.parent ? { key: i.parent.key, title: i.parent.title } : null,
      children: i.children.map((c) => issueItem(c, today)),
      commentCount: i._count.comments,
    };
  }

  async get(actor: ProjectsActor, projectKey: string, issueKey: string) {
    await this.access.need(actor, P.read);
    const { issue } = await this.load(actor, projectKey, issueKey);
    return this.detail(actor, issue.id);
  }

  /** A key like PAY-12, turned into what the web needs to show a link: title, status, project. */
  async lookup(actor: ProjectsActor, issueKey: string) {
    await this.access.need(actor, P.read);
    const k = (issueKey ?? "").trim().toUpperCase();
    if (!ISSUE_KEY_RE.test(k))
      throw new BadRequestException(MESSAGES.badIssueKey(issueKey));
    const issue = await this.prisma.issue.findFirst({
      where: { firmId: actor.user.firmId, key: k, deleted: false },
      include: ISSUE_INCLUDE,
    });
    if (!issue) throw new NotFoundException(MESSAGES.issueNotFound);
    await this.access.project(actor.user, issue.project.key); // a hidden project is a 404
    return issueItem(issue, manilaToday());
  }

  // ---------------------------------------------------------------------------------------
  // Checks shared by create and update
  // ---------------------------------------------------------------------------------------

  private checkDates(
    start: string | null | undefined,
    due: string | null | undefined,
    cur?: { start: string | null; due: string | null },
  ) {
    for (const d of [start, due]) {
      if (d && !isRealDate(d)) throw new BadRequestException(MESSAGES.badDate);
    }
    const s = start === undefined ? (cur?.start ?? null) : start;
    const d = due === undefined ? (cur?.due ?? null) : due;
    if (s && d && d < s) throw new BadRequestException(MESSAGES.dueBeforeStart);
  }

  private async assignee(firmId: string, id: string | null | undefined) {
    if (!id) return null;
    const u = await this.prisma.user.findFirst({
      where: { id, firmId, userType: "FIRM", status: "ACTIVE" },
      select: { id: true, fullName: true },
    });
    if (!u) throw new BadRequestException(MESSAGES.assigneeNotFound);
    return u;
  }

  private async milestone(projectId: string, id: string | null | undefined) {
    if (!id) return null;
    const m = await this.prisma.milestone.findFirst({
      where: { id, projectId },
      select: { id: true, name: true },
    });
    if (!m) throw new NotFoundException(MESSAGES.milestoneNotFound);
    return m;
  }

  private async labels(firmId: string, ids: string[] | undefined) {
    if (!ids) return undefined;
    const unique = [...new Set(ids)];
    const rows = await this.prisma.label.findMany({
      where: { firmId, id: { in: unique } },
    });
    if (rows.length !== unique.length)
      throw new NotFoundException(MESSAGES.labelNotFound);
    return rows;
  }

  /** The parent, by key, in the same project, not the issue itself or one of its descendants. */
  private async parent(
    project: ProjectRef,
    firmId: string,
    parentKey: string | null | undefined,
    selfId?: string,
  ) {
    if (!parentKey) return null;
    const k = parentKey.trim().toUpperCase();
    const p = ISSUE_KEY_RE.test(k)
      ? await this.prisma.issue.findFirst({
          where: { firmId, projectId: project.id, key: k, deleted: false },
        })
      : null;
    if (!p) throw new NotFoundException(MESSAGES.parentNotFound);
    if (selfId) {
      if (p.id === selfId) throw new BadRequestException(MESSAGES.ownParent);
      let up = p.parentIssueId;
      for (let hops = 0; up && hops < 50; hops++) {
        if (up === selfId) throw new BadRequestException(MESSAGES.parentLoop);
        up =
          (
            await this.prisma.issue.findUnique({
              where: { id: up },
              select: { parentIssueId: true },
            })
          )?.parentIssueId ?? null;
      }
    }
    return p;
  }

  private async typeOrDefault(firmId: string, id: string | undefined) {
    const t = id
      ? await this.prisma.issueType.findFirst({ where: { id, firmId } })
      : ((await this.prisma.issueType.findFirst({ where: { firmId, name: "Task" } })) ??
        (await this.prisma.issueType.findFirst({
          where: { firmId },
          orderBy: { order: "asc" },
        })));
    if (!t) throw new NotFoundException(MESSAGES.typeNotFound);
    return t;
  }

  private async statusOrDefault(firmId: string, id: string | undefined) {
    const s = id
      ? await this.prisma.issueStatus.findFirst({ where: { id, firmId } })
      : await this.prisma.issueStatus.findFirst({ where: { firmId, isDefault: true } });
    if (!s) throw new NotFoundException(MESSAGES.statusNotFound);
    return s;
  }

  // ---------------------------------------------------------------------------------------
  // Create
  // ---------------------------------------------------------------------------------------

  async create(actor: ProjectsActor, projectKey: string, input: CreateIssueInput) {
    await this.access.need(actor, P.create);
    const firmId = actor.user.firmId;
    const project = await this.access.project(actor.user, projectKey);
    const title = input.title.trim();
    if (!title) throw new BadRequestException(MESSAGES.titleRequired);
    this.checkDates(input.startDate, input.dueDate);
    const [type, status, assignee, milestone, labels, parent] = await Promise.all([
      this.typeOrDefault(firmId, input.typeId),
      this.statusOrDefault(firmId, input.statusId),
      this.assignee(firmId, input.assigneeId),
      this.milestone(project.id, input.milestoneId),
      this.labels(firmId, input.labelIds),
      this.parent(project, firmId, input.parentKey),
    ]);
    const priority = input.priority ?? "NORMAL";

    const id = await this.prisma.$transaction(async (tx) => {
      // The next number: an atomic increment (the UPDATE locks the project row), so parallel
      // creates get distinct consecutive numbers and a number is never given twice.
      const { issueCounter: number } = await tx.project.update({
        where: { id: project.id },
        data: { issueCounter: { increment: 1 } },
        select: { issueCounter: true },
      });
      const last = await tx.issue.aggregate({
        where: { projectId: project.id },
        _max: { position: true },
      });
      const issue = await tx.issue.create({
        data: {
          firmId,
          projectId: project.id,
          number,
          key: `${project.key}-${number}`,
          title,
          description: input.description ?? "",
          typeId: type.id,
          statusId: status.id,
          priority,
          assigneeId: assignee?.id ?? null,
          authorId: actor.user.id,
          milestoneId: milestone?.id ?? null,
          parentIssueId: parent?.id ?? null,
          startDate: dayToDate(input.startDate),
          dueDate: dayToDate(input.dueDate),
          position: (last._max.position ?? 0) + 1,
          closedAt: status.category === "DONE" ? new Date() : null,
          ...(labels?.length
            ? { labels: { create: labels.map((l) => ({ labelId: l.id, firmId })) } }
            : {}),
        },
      });
      const changes: Change[] = [
        { field: "title", old: null, new: title },
        { field: "type", old: null, new: type.name },
        { field: "status", old: null, new: status.name },
        { field: "priority", old: null, new: priority },
        ...(assignee ? [{ field: "assignee", old: null, new: assignee.fullName }] : []),
        ...(milestone ? [{ field: "milestone", old: null, new: milestone.name }] : []),
        ...(parent ? [{ field: "parent", old: null, new: parent.key }] : []),
        ...(input.startDate
          ? [{ field: "startDate", old: null, new: input.startDate }]
          : []),
        ...(input.dueDate ? [{ field: "dueDate", old: null, new: input.dueDate }] : []),
        ...(labels?.length ? [{ field: "labels", old: null, new: names(labels) }] : []),
      ];
      await this.activity.log(tx, actor, {
        projectId: project.id,
        issueId: issue.id,
        action: "issue.created",
        changes,
      });
      return issue.id;
    });
    return this.detail(actor, id);
  }

  // ---------------------------------------------------------------------------------------
  // Update
  // ---------------------------------------------------------------------------------------

  async update(
    actor: ProjectsActor,
    projectKey: string,
    issueKey: string,
    patch: UpdateIssueInput,
  ) {
    await this.access.need(actor, P.update);
    const firmId = actor.user.firmId;
    const { project, issue: cur } = await this.load(actor, projectKey, issueKey);
    const data: Prisma.IssueUncheckedUpdateInput = {};
    const changes: Change[] = [];

    if (patch.title !== undefined) {
      const title = patch.title.trim();
      if (!title) throw new BadRequestException(MESSAGES.titleRequired);
      if (title !== cur.title) {
        data.title = title;
        changes.push({ field: "title", old: cur.title, new: title });
      }
    }
    if (patch.description !== undefined && patch.description !== cur.description) {
      data.description = patch.description;
      changes.push({ field: "description", old: "(previous text)", new: "(new text)" });
    }
    if (patch.typeId !== undefined && patch.typeId !== cur.typeId) {
      const t = await this.typeOrDefault(firmId, patch.typeId);
      data.typeId = t.id;
      changes.push({ field: "type", old: cur.type.name, new: t.name });
    }
    if (patch.statusId !== undefined && patch.statusId !== cur.statusId) {
      const s = await this.statusOrDefault(firmId, patch.statusId);
      data.statusId = s.id;
      changes.push({ field: "status", old: cur.status.name, new: s.name });
      const wasDone = cur.status.category === "DONE";
      if (s.category === "DONE" && !wasDone) data.closedAt = new Date();
      if (s.category !== "DONE" && wasDone) data.closedAt = null;
    }
    if (patch.priority !== undefined && patch.priority !== cur.priority) {
      data.priority = patch.priority;
      changes.push({ field: "priority", old: cur.priority, new: patch.priority });
    }
    if (patch.assigneeId !== undefined && (patch.assigneeId ?? null) !== cur.assigneeId) {
      const a = await this.assignee(firmId, patch.assigneeId);
      data.assigneeId = a?.id ?? null;
      changes.push({
        field: "assignee",
        old: cur.assignee?.fullName ?? null,
        new: a?.fullName ?? null,
      });
    }
    if (
      patch.milestoneId !== undefined &&
      (patch.milestoneId ?? null) !== cur.milestoneId
    ) {
      const m = await this.milestone(project.id, patch.milestoneId);
      data.milestoneId = m?.id ?? null;
      changes.push({
        field: "milestone",
        old: cur.milestone?.name ?? null,
        new: m?.name ?? null,
      });
    }
    if (patch.parentKey !== undefined) {
      const p = await this.parent(project, firmId, patch.parentKey, cur.id);
      if ((p?.id ?? null) !== cur.parentIssueId) {
        data.parentIssueId = p?.id ?? null;
        changes.push({
          field: "parent",
          old: cur.parent?.key ?? null,
          new: p?.key ?? null,
        });
      }
    }
    this.checkDates(patch.startDate, patch.dueDate, {
      start: dayOf(cur.startDate),
      due: dayOf(cur.dueDate),
    });
    for (const f of ["startDate", "dueDate"] as const) {
      if (patch[f] !== undefined) {
        const v = patch[f] ?? null;
        if (v !== dayOf(cur[f])) {
          data[f] = dayToDate(v);
          changes.push({ field: f, old: dayOf(cur[f]), new: v });
        }
      }
    }
    let newLabels: Awaited<ReturnType<IssuesService["labels"]>>;
    if (patch.labelIds !== undefined) {
      newLabels = await this.labels(firmId, patch.labelIds);
      const before = cur.labels.map((l) => l.label.name).sort();
      const after = (newLabels ?? []).map((l) => l.name).sort();
      if (before.join("\n") !== after.join("\n")) {
        changes.push({
          field: "labels",
          old: before.join(", ") || null,
          new: after.join(", ") || null,
        });
      } else {
        newLabels = undefined;
      }
    }
    if (patch.position !== undefined && patch.position !== cur.position)
      data.position = patch.position;

    if (changes.length === 0 && data.position === undefined)
      return this.detail(actor, cur.id);
    await this.prisma.$transaction(async (tx) => {
      if (newLabels) {
        await tx.issueLabel.deleteMany({ where: { issueId: cur.id } });
        if (newLabels.length) {
          await tx.issueLabel.createMany({
            data: newLabels.map((l) => ({ issueId: cur.id, labelId: l.id, firmId })),
          });
        }
      }
      await tx.issue.update({ where: { id: cur.id }, data });
      if (changes.length > 0) {
        await this.activity.log(tx, actor, {
          projectId: project.id,
          issueId: cur.id,
          action: "issue.updated",
          changes,
        });
      }
    });
    return this.detail(actor, cur.id);
  }

  /** Move an issue to a place on the board: a position, and optionally another status. */
  async reorder(
    actor: ProjectsActor,
    projectKey: string,
    issueKey: string,
    input: ReorderIssueInput,
  ) {
    return this.update(actor, projectKey, issueKey, {
      position: input.position,
      ...(input.statusId ? { statusId: input.statusId } : {}),
    });
  }

  // ---------------------------------------------------------------------------------------
  // Delete (soft)
  // ---------------------------------------------------------------------------------------

  async remove(actor: ProjectsActor, projectKey: string, issueKey: string) {
    await this.access.need(actor, P.update);
    const { project, issue } = await this.load(actor, projectKey, issueKey);
    await this.prisma.$transaction(async (tx) => {
      await tx.issue.update({ where: { id: issue.id }, data: { deleted: true } });
      const children = await tx.issue.findMany({
        where: { parentIssueId: issue.id, deleted: false },
        select: { id: true },
      });
      for (const c of children) {
        await tx.issue.update({ where: { id: c.id }, data: { parentIssueId: null } });
        await this.activity.log(tx, actor, {
          projectId: project.id,
          issueId: c.id,
          action: "issue.updated",
          changes: [{ field: "parent", old: issue.key, new: null }],
        });
      }
      await this.activity.log(tx, actor, {
        projectId: project.id,
        issueId: issue.id,
        action: "issue.deleted",
        changes: [{ field: "deleted", old: false, new: true }],
      });
    });
    return { deleted: true as const, key: issue.key };
  }

  // ---------------------------------------------------------------------------------------
  // Comments
  // ---------------------------------------------------------------------------------------

  async comments(actor: ProjectsActor, projectKey: string, issueKey: string) {
    await this.access.need(actor, P.read);
    const { issue } = await this.load(actor, projectKey, issueKey);
    const rows = await this.prisma.issueComment.findMany({
      where: { issueId: issue.id },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      include: { author: { select: { id: true, fullName: true } } },
    });
    return rows.map(commentDto);
  }

  async addComment(
    actor: ProjectsActor,
    projectKey: string,
    issueKey: string,
    body: string,
  ) {
    await this.access.need(actor, P.update);
    const text = body.trim();
    if (!text) throw new BadRequestException(MESSAGES.commentEmpty);
    const { project, issue } = await this.load(actor, projectKey, issueKey);
    const row = await this.prisma.$transaction(async (tx) => {
      const c = await tx.issueComment.create({
        data: {
          firmId: actor.user.firmId,
          issueId: issue.id,
          authorId: actor.user.id,
          body: text,
        },
        include: { author: { select: { id: true, fullName: true } } },
      });
      await tx.issue.update({ where: { id: issue.id }, data: { updatedAt: new Date() } });
      await this.activity.log(tx, actor, {
        projectId: project.id,
        issueId: issue.id,
        action: "comment.added",
        changes: [{ field: "comment", old: null, new: text.slice(0, 300) }],
      });
      return c;
    });
    return commentDto(row);
  }
}

const names = (rows: { name: string }[]) =>
  rows
    .map((r) => r.name)
    .sort()
    .join(", ");

function commentDto(c: {
  id: string;
  body: string;
  createdAt: Date;
  updatedAt: Date;
  author: { id: string; fullName: string } | null;
}) {
  return {
    id: c.id,
    body: c.body,
    author: c.author ? { id: c.author.id, fullName: c.author.fullName } : null,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
  };
}
