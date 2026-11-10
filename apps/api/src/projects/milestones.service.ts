// milestones.service.ts — PA1 (D65): the milestones of a project, with their progress.
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { ProjectsAccess, type ProjectsActor } from "./projects.access";
import { ProjectsActivity } from "./projects-activity.service";
import { ProjectsService } from "./projects.service";
import { gateMessage } from "./security";
import { SecurityQueries } from "./security-queries";
import {
  dayOf,
  dayToDate,
  isRealDate,
  manilaToday,
  MESSAGES,
  PROJECTS_PERMISSION as P,
  type Change,
} from "./projects.constants";
import { milestoneDto } from "./projects.mappers";
import type { z } from "zod";
import type {
  CreateMilestoneSchema,
  UpdateMilestoneSchema,
} from "./dto/projects.schemas";

@Injectable()
export class MilestonesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ProjectsAccess,
    private readonly activity: ProjectsActivity,
    private readonly projects: ProjectsService,
    private readonly security: SecurityQueries,
  ) {}

  private checkDates(
    start: string | null | undefined,
    due: string | null | undefined,
    cur?: { start: string | null; due: string | null },
  ) {
    for (const d of [start, due])
      if (d && !isRealDate(d)) throw new BadRequestException(MESSAGES.badDate);
    const s = start === undefined ? (cur?.start ?? null) : start;
    const d = due === undefined ? (cur?.due ?? null) : due;
    if (s && d && d < s) throw new BadRequestException(MESSAGES.dueBeforeStart);
  }

  async list(actor: ProjectsActor, projectKey: string) {
    await this.access.need(actor, P.read);
    const project = await this.access.project(actor.user, projectKey);
    const rows = await this.prisma.milestone.findMany({
      where: { projectId: project.id },
      orderBy: [{ dueDate: { sort: "asc", nulls: "last" } }, { createdAt: "asc" }],
    });
    const progress = await this.projects.milestoneProgress(
      actor.user.firmId,
      rows.map((m) => m.id),
      manilaToday(),
    );
    const items = rows.map((m) =>
      milestoneDto(m, progress.get(m.id) ?? { done: 0, total: 0, overdue: 0 }),
    );
    // open and locked first, closed last
    return [
      ...items.filter((m) => m.state !== "CLOSED"),
      ...items.filter((m) => m.state === "CLOSED"),
    ];
  }

  /**
   * The roadmap: every milestone with what a bar needs (startDate, dueDate, percent done) and
   * today in Manila; the milestones with neither date are listed apart, in `undated`.
   */
  async roadmap(actor: ProjectsActor, projectKey: string) {
    const all = await this.list(actor, projectKey);
    const when = (m: { startDate: string | null; dueDate: string | null }) =>
      m.dueDate ?? m.startDate ?? "";
    return {
      today: manilaToday(),
      dated: all
        .filter((m) => m.startDate || m.dueDate)
        .sort((a, b) => when(a).localeCompare(when(b)) || a.name.localeCompare(b.name)),
      undated: all.filter((m) => !m.startDate && !m.dueDate),
    };
  }

  async create(
    actor: ProjectsActor,
    projectKey: string,
    input: z.infer<typeof CreateMilestoneSchema>,
  ) {
    await this.access.need(actor, P.update);
    const project = await this.access.project(actor.user, projectKey);
    const name = input.name.trim();
    if (!name) throw new BadRequestException(MESSAGES.nameRequired);
    this.checkDates(input.startDate, input.dueDate);
    const row = await this.prisma.$transaction(async (tx) => {
      const m = await tx.milestone.create({
        data: {
          firmId: actor.user.firmId,
          projectId: project.id,
          name,
          description: input.description ?? "",
          startDate: dayToDate(input.startDate),
          dueDate: dayToDate(input.dueDate),
        },
      });
      await this.activity.log(tx, actor, {
        projectId: project.id,
        action: "milestone.created",
        changes: [
          { field: "name", old: null, new: name },
          ...(input.dueDate ? [{ field: "dueDate", old: null, new: input.dueDate }] : []),
        ],
      });
      return m;
    });
    return milestoneDto(row, { done: 0, total: 0, overdue: 0 });
  }

  async update(
    actor: ProjectsActor,
    projectKey: string,
    id: string,
    patch: z.infer<typeof UpdateMilestoneSchema>,
  ) {
    await this.access.need(actor, P.update);
    const project = await this.access.project(actor.user, projectKey);
    const cur = /^[0-9a-f-]{36}$/i.test(id)
      ? await this.prisma.milestone.findFirst({ where: { id, projectId: project.id } })
      : null;
    if (!cur) throw new NotFoundException(MESSAGES.milestoneNotFound);
    const data: Prisma.MilestoneUncheckedUpdateInput = {};
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
    if (patch.state !== undefined && patch.state !== cur.state) {
      // PA4: the release gate. A milestone does not close while the project has open critical or
      // high security issues (unrated ones, leads and lesser findings do not block).
      if (patch.state === "CLOSED") {
        const blockers = await this.security.blockers(actor.user.firmId, project.id);
        if (blockers.length) throw new ConflictException(gateMessage(blockers));
      }
      data.state = patch.state;
      changes.push({ field: "state", old: cur.state, new: patch.state });
    }
    if (changes.length > 0) {
      await this.prisma.$transaction(async (tx) => {
        await tx.milestone.update({ where: { id: cur.id }, data });
        await this.activity.log(tx, actor, {
          projectId: project.id,
          action: "milestone.updated",
          changes,
        });
      });
    }
    const row = await this.prisma.milestone.findUniqueOrThrow({ where: { id: cur.id } });
    const progress = await this.projects.milestoneProgress(
      actor.user.firmId,
      [cur.id],
      manilaToday(),
    );
    return milestoneDto(row, progress.get(cur.id) ?? { done: 0, total: 0, overdue: 0 });
  }
}
