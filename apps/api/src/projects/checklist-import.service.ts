// checklist-import.service.ts — PA4 (D68): a markdown checklist becomes milestones and issues.
//
// parseChecklist (projects-core) reads the text: at most 500 items, headings may name milestones,
// a closed box is a closed item, #words are labels. Milestones are reused by name; closed items go
// in the firm's first done status; labels are matched by name and an unknown one is made only for a
// person who may configure labels, otherwise the whole import is refused with their names. The
// import is one transaction; a dry run answers the plan and writes nothing.
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  ChecklistError,
  parseChecklist,
  type ChecklistItem,
} from "@portal/projects-core";
import { AuditService } from "../audit/audit.service";
import { PrismaService } from "../prisma/prisma.service";
import { RbacService } from "../rbac/rbac.service";
import { IssueWrites } from "./issue-writes";
import { ProjectsAccess, type ProjectsActor } from "./projects.access";
import { ProjectsActivity } from "./projects-activity.service";
import { MESSAGES, PROJECTS_PERMISSION as P } from "./projects.constants";

export interface ChecklistImportInput {
  markdown: string;
  headingsAsMilestones: boolean;
  dryRun: boolean;
}

export interface ChecklistImportResult {
  dryRun: boolean;
  items: { total: number; open: number; closed: number };
  milestones: { name: string; created: boolean }[];
  labels: { name: string; created: boolean }[];
  warnings: string[];
  keys: string[];
  /** A dry run only: what would be made. */
  plan?: ChecklistItem[];
}

export const missingLabels = (names: string) =>
  `The import uses labels that do not exist: ${names}. Creating a label needs ${P.configure}, so nothing was imported.`;

/** A long import is a long transaction: well past Prisma's 5 second default. */
const TX_OPTIONS = { timeout: 120_000, maxWait: 15_000 };

@Injectable()
export class ChecklistImportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ProjectsAccess,
    private readonly rbac: RbacService,
    private readonly writes: IssueWrites,
    private readonly activity: ProjectsActivity,
    private readonly audit: AuditService,
  ) {}

  async run(
    actor: ProjectsActor,
    projectKey: string,
    input: ChecklistImportInput,
  ): Promise<ChecklistImportResult> {
    await this.access.need(actor, P.create);
    const project = await this.access.project(actor.user, projectKey);
    const firmId = actor.user.firmId;

    let parsed;
    try {
      parsed = parseChecklist(input.markdown, {
        headingsAsMilestones: input.headingsAsMilestones,
      });
    } catch (e) {
      if (e instanceof ChecklistError) throw new BadRequestException(e.message);
      throw e;
    }

    // what exists already
    const [milestones, labels] = await Promise.all([
      this.prisma.milestone.findMany({ where: { projectId: project.id } }),
      this.prisma.label.findMany({ where: { firmId } }),
    ]);
    const milestoneOf = new Map(milestones.map((m) => [m.name.toLowerCase(), m]));
    const labelOf = new Map(labels.map((l) => [l.name.toLowerCase(), l]));
    const usedLabels = [...new Set(parsed.items.flatMap((i) => i.labels))];
    const unknown = usedLabels.filter((n) => !labelOf.has(n.toLowerCase()));
    if (unknown.length && !(await this.rbac.authorize(actor.user, [P.configure]))) {
      throw new ForbiddenException(missingLabels(unknown.join(", ")));
    }

    const closed = parsed.items.filter((i) => i.closed).length;
    const result: ChecklistImportResult = {
      dryRun: input.dryRun,
      items: { total: parsed.items.length, open: parsed.items.length - closed, closed },
      milestones: parsed.milestones.map((name) => ({
        name,
        created: !milestoneOf.has(name.toLowerCase()),
      })),
      labels: usedLabels.map((name) => ({
        name,
        created: !labelOf.has(name.toLowerCase()),
      })),
      warnings: parsed.warnings,
      keys: [],
    };
    if (input.dryRun) return { ...result, plan: parsed.items };
    if (parsed.items.length === 0) return result;

    const [type, open, done] = await Promise.all([
      this.prisma.issueType.findFirst({ where: { firmId, name: "Task" } }).then(
        (t) =>
          t ??
          this.prisma.issueType.findFirst({
            where: { firmId },
            orderBy: { order: "asc" },
          }),
      ),
      this.prisma.issueStatus.findFirst({ where: { firmId, isDefault: true } }),
      closed
        ? this.prisma.issueStatus.findFirst({
            where: { firmId, category: "DONE" },
            orderBy: [{ order: "asc" }, { name: "asc" }],
          })
        : Promise.resolve(null),
    ]);
    if (!type) throw new NotFoundException(MESSAGES.typeNotFound);
    if (!open || (closed && !done)) throw new NotFoundException(MESSAGES.statusNotFound);

    const madeLabels: string[] = [];
    result.keys = await this.prisma.$transaction(async (tx) => {
      for (const name of unknown) {
        const l = await tx.label.create({ data: { firmId, name } });
        labelOf.set(name.toLowerCase(), l);
        madeLabels.push(name);
      }
      for (const name of parsed.milestones) {
        if (milestoneOf.has(name.toLowerCase())) continue;
        const m = await tx.milestone.create({
          data: { firmId, projectId: project.id, name },
        });
        milestoneOf.set(name.toLowerCase(), m);
        await this.activity.log(tx, actor, {
          projectId: project.id,
          action: "milestone.created",
          changes: [{ field: "name", old: null, new: name }],
        });
      }
      const keys: string[] = [];
      for (const item of parsed.items) {
        const ms = item.milestone
          ? milestoneOf.get(item.milestone.toLowerCase())
          : undefined;
        const made = await this.writes.insert(tx, actor, project, {
          title: item.title,
          description: item.description,
          type,
          status: item.closed ? done! : open,
          priority: "NORMAL",
          milestone: ms ? { id: ms.id, name: ms.name } : null,
          labels: item.labels.map((n) => labelOf.get(n.toLowerCase())!),
        });
        keys.push(made.key);
      }
      return keys;
    }, TX_OPTIONS);

    for (const name of madeLabels) {
      await this.audit.record({
        userId: actor.user.id,
        action: "projects.label.created",
        entityType: "Label",
        metadata: { name, via: "checklist import" },
      });
    }
    return result;
  }
}
