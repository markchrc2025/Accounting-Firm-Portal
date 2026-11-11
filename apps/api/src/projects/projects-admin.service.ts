// projects-admin.service.ts — PA1 (D65): the firm-wide lists the screens need (issue types,
// statuses, labels) and their editing, which needs Projects:Configure.
//
// A status or type that issues use cannot be deleted. The default status is the status a new
// issue gets: one per firm, always a to do status. A status that moves between open and closed
// (its category crosses DONE) sets or clears closedAt on its issues, each logged.
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { AuditService } from "../audit/audit.service";
import { PrismaService } from "../prisma/prisma.service";
import type { z } from "zod";
import type {
  ProjectCategorySchema,
  UpdateProjectCategorySchema,
  IssueStatusSchema,
  IssueTypeSchema,
  LabelSchema,
  UpdateIssueStatusSchema,
  UpdateIssueTypeSchema,
  UpdateLabelSchema,
} from "./dto/projects.schemas";
import { ProjectsAccess, type ProjectsActor } from "./projects.access";
import { ProjectsActivity } from "./projects-activity.service";
import { MESSAGES, PROJECTS_PERMISSION as P, type Change } from "./projects.constants";

const typeDto = (t: { id: string; name: string; colour: string; order: number }) => ({
  id: t.id,
  name: t.name,
  colour: t.colour,
  order: t.order,
});
const statusDto = (s: {
  id: string;
  name: string;
  colour: string;
  order: number;
  category: string;
  isDefault: boolean;
}) => ({
  id: s.id,
  name: s.name,
  colour: s.colour,
  order: s.order,
  category: s.category,
  isDefault: s.isDefault,
});
const labelDto = (l: { id: string; name: string; colour: string }) => ({
  id: l.id,
  name: l.name,
  colour: l.colour,
});

const isUnique = (err: unknown) => (err as { code?: string })?.code === "P2002";

@Injectable()
export class ProjectsAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ProjectsAccess,
    private readonly activity: ProjectsActivity,
    private readonly audit: AuditService,
  ) {}

  private async trail(
    actor: ProjectsActor,
    action: string,
    entityId: string,
    metadata: Prisma.InputJsonValue,
  ) {
    await this.audit.record({
      userId: actor.user.id,
      action,
      entityType: "ProjectsConfig",
      entityId,
      metadata: { channel: actor.channel, ...(metadata as object) },
    });
  }

  // ---------------------------------------------------------------------------------------
  // What a screen needs to draw its filters and forms
  // ---------------------------------------------------------------------------------------

  async meta(actor: ProjectsActor) {
    await this.access.need(actor, P.read);
    const firmId = actor.user.firmId;
    const [types, statuses, labels, users, categories] = await Promise.all([
      this.prisma.issueType.findMany({
        where: { firmId },
        orderBy: [{ order: "asc" }, { name: "asc" }],
      }),
      this.prisma.issueStatus.findMany({
        where: { firmId },
        orderBy: [{ order: "asc" }, { name: "asc" }],
      }),
      this.prisma.label.findMany({ where: { firmId }, orderBy: { name: "asc" } }),
      this.prisma.user.findMany({
        where: { firmId, userType: "FIRM", status: "ACTIVE" },
        select: { id: true, fullName: true, email: true },
        orderBy: { fullName: "asc" },
      }),
      this.prisma.projectCategory.findMany({
        where: { firmId },
        orderBy: [{ order: "asc" }, { name: "asc" }],
      }),
    ]);
    return {
      issueTypes: types.map(typeDto),
      issueStatuses: statuses.map(statusDto),
      labels: labels.map(labelDto),
      users,
      // PA8 (D70): the project categories, for the project form and the portfolio filter
      projectCategories: categories.map(typeDto),
    };
  }

  // ---------------------------------------------------------------------------------------
  // Issue types
  // ---------------------------------------------------------------------------------------

  async listTypes(actor: ProjectsActor) {
    await this.access.need(actor, P.configure);
    const rows = await this.prisma.issueType.findMany({
      where: { firmId: actor.user.firmId },
      orderBy: [{ order: "asc" }, { name: "asc" }],
      include: { _count: { select: { issues: true } } },
    });
    return rows.map((t) => ({ ...typeDto(t), issueCount: t._count.issues }));
  }

  async createType(actor: ProjectsActor, input: z.infer<typeof IssueTypeSchema>) {
    await this.access.need(actor, P.configure);
    const name = input.name.trim();
    if (!name) throw new BadRequestException(MESSAGES.nameRequired);
    try {
      const last = await this.prisma.issueType.aggregate({
        where: { firmId: actor.user.firmId },
        _max: { order: true },
      });
      const row = await this.prisma.issueType.create({
        data: {
          firmId: actor.user.firmId,
          name,
          colour: input.colour ?? "#57606a",
          order: input.order ?? (last._max.order ?? -1) + 1,
        },
      });
      await this.trail(actor, "projects.issue-type.created", row.id, { name });
      return typeDto(row);
    } catch (err) {
      if (isUnique(err)) throw new ConflictException(MESSAGES.nameUsed);
      throw err;
    }
  }

  private async typeOf(actor: ProjectsActor, id: string) {
    const row = /^[0-9a-f-]{36}$/i.test(id)
      ? await this.prisma.issueType.findFirst({
          where: { id, firmId: actor.user.firmId },
        })
      : null;
    if (!row) throw new NotFoundException(MESSAGES.typeNotFound);
    return row;
  }

  async updateType(
    actor: ProjectsActor,
    id: string,
    patch: z.infer<typeof UpdateIssueTypeSchema>,
  ) {
    await this.access.need(actor, P.configure);
    const cur = await this.typeOf(actor, id);
    const name = patch.name?.trim();
    if (patch.name !== undefined && !name)
      throw new BadRequestException(MESSAGES.nameRequired);
    try {
      const row = await this.prisma.issueType.update({
        where: { id: cur.id },
        data: {
          ...(name !== undefined ? { name } : {}),
          ...(patch.colour !== undefined ? { colour: patch.colour } : {}),
          ...(patch.order !== undefined ? { order: patch.order } : {}),
        },
      });
      await this.trail(actor, "projects.issue-type.updated", cur.id, {
        fields: Object.keys(patch),
      });
      return typeDto(row);
    } catch (err) {
      if (isUnique(err)) throw new ConflictException(MESSAGES.nameUsed);
      throw err;
    }
  }

  async deleteType(actor: ProjectsActor, id: string) {
    await this.access.need(actor, P.configure);
    const cur = await this.typeOf(actor, id);
    const used = await this.prisma.issue.count({ where: { typeId: cur.id } });
    if (used > 0) throw new ConflictException(MESSAGES.typeInUse(used));
    await this.prisma.issueType.delete({ where: { id: cur.id } });
    await this.trail(actor, "projects.issue-type.deleted", cur.id, { name: cur.name });
    return { deleted: true as const, id: cur.id };
  }

  // ---------------------------------------------------------------------------------------
  // Project categories (PA8, D70): the same pattern as issue types
  // ---------------------------------------------------------------------------------------

  async listCategories(actor: ProjectsActor) {
    await this.access.need(actor, P.configure);
    const rows = await this.prisma.projectCategory.findMany({
      where: { firmId: actor.user.firmId },
      orderBy: [{ order: "asc" }, { name: "asc" }],
      include: { _count: { select: { projects: true } } },
    });
    return rows.map((c) => ({ ...typeDto(c), projectCount: c._count.projects }));
  }

  async createCategory(
    actor: ProjectsActor,
    input: z.infer<typeof ProjectCategorySchema>,
  ) {
    await this.access.need(actor, P.configure);
    const name = input.name.trim();
    if (!name) throw new BadRequestException(MESSAGES.nameRequired);
    try {
      const last = await this.prisma.projectCategory.aggregate({
        where: { firmId: actor.user.firmId },
        _max: { order: true },
      });
      const row = await this.prisma.projectCategory.create({
        data: {
          firmId: actor.user.firmId,
          name,
          colour: input.colour ?? "#57606a",
          order: input.order ?? (last._max.order ?? -1) + 1,
        },
      });
      await this.trail(actor, "projects.category.created", row.id, { name });
      return typeDto(row);
    } catch (err) {
      if (isUnique(err)) throw new ConflictException(MESSAGES.nameUsed);
      throw err;
    }
  }

  private async categoryOf(actor: ProjectsActor, id: string) {
    const row = /^[0-9a-f-]{36}$/i.test(id)
      ? await this.prisma.projectCategory.findFirst({
          where: { id, firmId: actor.user.firmId },
        })
      : null;
    if (!row) throw new NotFoundException(MESSAGES.categoryNotFound);
    return row;
  }

  async updateCategory(
    actor: ProjectsActor,
    id: string,
    patch: z.infer<typeof UpdateProjectCategorySchema>,
  ) {
    await this.access.need(actor, P.configure);
    const cur = await this.categoryOf(actor, id);
    const name = patch.name?.trim();
    if (patch.name !== undefined && !name)
      throw new BadRequestException(MESSAGES.nameRequired);
    try {
      const row = await this.prisma.projectCategory.update({
        where: { id: cur.id },
        data: {
          ...(name !== undefined ? { name } : {}),
          ...(patch.colour !== undefined ? { colour: patch.colour } : {}),
          ...(patch.order !== undefined ? { order: patch.order } : {}),
        },
      });
      await this.trail(actor, "projects.category.updated", cur.id, {
        fields: Object.keys(patch),
      });
      return typeDto(row);
    } catch (err) {
      if (isUnique(err)) throw new ConflictException(MESSAGES.nameUsed);
      throw err;
    }
  }

  async deleteCategory(actor: ProjectsActor, id: string) {
    await this.access.need(actor, P.configure);
    const cur = await this.categoryOf(actor, id);
    const used = await this.prisma.project.count({ where: { categoryId: cur.id } });
    if (used > 0) throw new ConflictException(MESSAGES.categoryInUse(used));
    await this.prisma.projectCategory.delete({ where: { id: cur.id } });
    await this.trail(actor, "projects.category.deleted", cur.id, { name: cur.name });
    return { deleted: true as const, id: cur.id };
  }

  // ---------------------------------------------------------------------------------------
  // Issue statuses
  // ---------------------------------------------------------------------------------------

  async listStatuses(actor: ProjectsActor) {
    await this.access.need(actor, P.configure);
    const rows = await this.prisma.issueStatus.findMany({
      where: { firmId: actor.user.firmId },
      orderBy: [{ order: "asc" }, { name: "asc" }],
      include: { _count: { select: { issues: true } } },
    });
    return rows.map((s) => ({ ...statusDto(s), issueCount: s._count.issues }));
  }

  async createStatus(actor: ProjectsActor, input: z.infer<typeof IssueStatusSchema>) {
    await this.access.need(actor, P.configure);
    const firmId = actor.user.firmId;
    const name = input.name.trim();
    if (!name) throw new BadRequestException(MESSAGES.nameRequired);
    if (input.isDefault && input.category !== "TODO") {
      throw new BadRequestException(MESSAGES.defaultStatusCategory);
    }
    try {
      const row = await this.prisma.$transaction(async (tx) => {
        if (input.isDefault)
          await tx.issueStatus.updateMany({
            where: { firmId, isDefault: true },
            data: { isDefault: false },
          });
        const last = await tx.issueStatus.aggregate({
          where: { firmId },
          _max: { order: true },
        });
        return tx.issueStatus.create({
          data: {
            firmId,
            name,
            colour: input.colour ?? "#57606a",
            order: input.order ?? (last._max.order ?? -1) + 1,
            category: input.category,
            isDefault: input.isDefault ?? false,
          },
        });
      });
      await this.trail(actor, "projects.issue-status.created", row.id, {
        name,
        category: row.category,
      });
      return statusDto(row);
    } catch (err) {
      if (isUnique(err)) throw new ConflictException(MESSAGES.nameUsed);
      throw err;
    }
  }

  private async statusOf(actor: ProjectsActor, id: string) {
    const row = /^[0-9a-f-]{36}$/i.test(id)
      ? await this.prisma.issueStatus.findFirst({
          where: { id, firmId: actor.user.firmId },
        })
      : null;
    if (!row) throw new NotFoundException(MESSAGES.statusNotFound);
    return row;
  }

  async updateStatus(
    actor: ProjectsActor,
    id: string,
    patch: z.infer<typeof UpdateIssueStatusSchema>,
  ) {
    await this.access.need(actor, P.configure);
    const firmId = actor.user.firmId;
    const cur = await this.statusOf(actor, id);
    const name = patch.name?.trim();
    if (patch.name !== undefined && !name)
      throw new BadRequestException(MESSAGES.nameRequired);
    const category = patch.category ?? cur.category;
    const isDefault = patch.isDefault ?? cur.isDefault;
    if (cur.isDefault && patch.isDefault === false)
      throw new BadRequestException(MESSAGES.lastDefault);
    if (isDefault && category !== "TODO")
      throw new BadRequestException(MESSAGES.defaultStatusCategory);
    const crossesDone = (cur.category === "DONE") !== (category === "DONE");
    try {
      const row = await this.prisma.$transaction(async (tx) => {
        if (isDefault && !cur.isDefault) {
          await tx.issueStatus.updateMany({
            where: { firmId, isDefault: true },
            data: { isDefault: false },
          });
        }
        const updated = await tx.issueStatus.update({
          where: { id: cur.id },
          data: {
            ...(name !== undefined ? { name } : {}),
            ...(patch.colour !== undefined ? { colour: patch.colour } : {}),
            ...(patch.order !== undefined ? { order: patch.order } : {}),
            category,
            isDefault,
          },
        });
        if (crossesDone) {
          // The issues in this status are now open or closed: closedAt follows, each logged.
          const issues = await tx.issue.findMany({
            where: { statusId: cur.id, deleted: false },
            select: { id: true, projectId: true },
          });
          const closing = category === "DONE";
          await tx.issue.updateMany({
            where: { statusId: cur.id, ...(closing ? { closedAt: null } : {}) },
            data: { closedAt: closing ? new Date() : null },
          });
          for (const i of issues) {
            await this.activity.log(tx, actor, {
              projectId: i.projectId,
              issueId: i.id,
              action: "issue.updated",
              changes: [{ field: "statusCategory", old: cur.category, new: category }],
            });
          }
        }
        return updated;
      });
      await this.trail(actor, "projects.issue-status.updated", cur.id, {
        fields: Object.keys(patch),
      });
      return statusDto(row);
    } catch (err) {
      if (isUnique(err)) throw new ConflictException(MESSAGES.nameUsed);
      throw err;
    }
  }

  async deleteStatus(actor: ProjectsActor, id: string) {
    await this.access.need(actor, P.configure);
    const cur = await this.statusOf(actor, id);
    if (cur.isDefault) throw new ConflictException(MESSAGES.defaultStatusDelete);
    const used = await this.prisma.issue.count({ where: { statusId: cur.id } });
    if (used > 0) throw new ConflictException(MESSAGES.statusInUse(used));
    await this.prisma.issueStatus.delete({ where: { id: cur.id } });
    await this.trail(actor, "projects.issue-status.deleted", cur.id, { name: cur.name });
    return { deleted: true as const, id: cur.id };
  }

  // ---------------------------------------------------------------------------------------
  // Labels
  // ---------------------------------------------------------------------------------------

  async listLabels(actor: ProjectsActor) {
    await this.access.need(actor, P.configure);
    const rows = await this.prisma.label.findMany({
      where: { firmId: actor.user.firmId },
      orderBy: { name: "asc" },
      include: { _count: { select: { issues: true } } },
    });
    return rows.map((l) => ({ ...labelDto(l), issueCount: l._count.issues }));
  }

  async createLabel(actor: ProjectsActor, input: z.infer<typeof LabelSchema>) {
    await this.access.need(actor, P.configure);
    const name = input.name.trim();
    if (!name) throw new BadRequestException(MESSAGES.nameRequired);
    try {
      const row = await this.prisma.label.create({
        data: { firmId: actor.user.firmId, name, colour: input.colour ?? "#0969da" },
      });
      await this.trail(actor, "projects.label.created", row.id, { name });
      return labelDto(row);
    } catch (err) {
      if (isUnique(err)) throw new ConflictException(MESSAGES.nameUsed);
      throw err;
    }
  }

  private async labelOf(actor: ProjectsActor, id: string) {
    const row = /^[0-9a-f-]{36}$/i.test(id)
      ? await this.prisma.label.findFirst({ where: { id, firmId: actor.user.firmId } })
      : null;
    if (!row) throw new NotFoundException(MESSAGES.labelNotFound);
    return row;
  }

  async updateLabel(
    actor: ProjectsActor,
    id: string,
    patch: z.infer<typeof UpdateLabelSchema>,
  ) {
    await this.access.need(actor, P.configure);
    const cur = await this.labelOf(actor, id);
    const name = patch.name?.trim();
    if (patch.name !== undefined && !name)
      throw new BadRequestException(MESSAGES.nameRequired);
    try {
      const row = await this.prisma.$transaction(async (tx) => {
        const updated = await tx.label.update({
          where: { id: cur.id },
          data: {
            ...(name !== undefined ? { name } : {}),
            ...(patch.colour !== undefined ? { colour: patch.colour } : {}),
          },
        });
        if (name !== undefined && name !== cur.name)
          await this.logLabelOnIssues(tx, actor, cur.id, cur.name, name);
        return updated;
      });
      await this.trail(actor, "projects.label.updated", cur.id, {
        fields: Object.keys(patch),
      });
      return labelDto(row);
    } catch (err) {
      if (isUnique(err)) throw new ConflictException(MESSAGES.nameUsed);
      throw err;
    }
  }

  /** A label on issues was renamed or removed: each issue's activity says so. */
  private async logLabelOnIssues(
    tx: Prisma.TransactionClient,
    actor: ProjectsActor,
    labelId: string,
    oldName: string,
    newName: string | null,
  ) {
    const on = await tx.issueLabel.findMany({
      where: { labelId },
      select: { issue: { select: { id: true, projectId: true, deleted: true } } },
    });
    for (const { issue } of on) {
      if (issue.deleted) continue;
      const changes: Change[] = [{ field: "label", old: oldName, new: newName }];
      await this.activity.log(tx, actor, {
        projectId: issue.projectId,
        issueId: issue.id,
        action: "issue.updated",
        changes,
      });
    }
  }

  /** A label is deleted: it comes off its issues, each logged. */
  async deleteLabel(actor: ProjectsActor, id: string) {
    await this.access.need(actor, P.configure);
    const cur = await this.labelOf(actor, id);
    await this.prisma.$transaction(async (tx) => {
      await this.logLabelOnIssues(tx, actor, cur.id, cur.name, null);
      await tx.label.delete({ where: { id: cur.id } });
    });
    await this.trail(actor, "projects.label.deleted", cur.id, { name: cur.name });
    return { deleted: true as const, id: cur.id };
  }
}
