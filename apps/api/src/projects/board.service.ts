// board.service.ts — PA2 (D66): the board of a project, one column per status.
//
// Columns follow the firm's status order; cards in a column follow their position (then their
// number). The columns of a DONE category hold only the issues closed within the last 14 days,
// counted in Manila calendar days (today and the 14 days before it), unless doneRange is "all";
// each says how many older ones it left out. Moving a card is the reorder route.
import { Injectable } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import type { BoardQuery } from "./dto/projects.schemas";
import { ProjectsAccess, type ProjectsActor } from "./projects.access";
import { doneSince, manilaToday, PROJECTS_PERMISSION as P } from "./projects.constants";
import { ISSUE_INCLUDE, issueItem } from "./projects.mappers";

@Injectable()
export class BoardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ProjectsAccess,
  ) {}

  async board(actor: ProjectsActor, projectKey: string, q: BoardQuery) {
    await this.access.need(actor, P.read);
    const project = await this.access.project(actor.user, projectKey);
    const today = manilaToday();
    const since = q.doneRange === "all" ? null : doneSince(today);

    const and: Prisma.IssueWhereInput[] = [];
    if (q.milestoneId === "none") and.push({ milestoneId: null });
    else if (q.milestoneId) and.push({ milestoneId: q.milestoneId });
    if (q.assigneeId === "none") and.push({ assigneeId: null });
    else if (q.assigneeId === "me") and.push({ assigneeId: actor.user.id });
    else if (q.assigneeId) and.push({ assigneeId: q.assigneeId });
    const base: Prisma.IssueWhereInput = {
      firmId: actor.user.firmId,
      projectId: project.id,
      deleted: false,
      AND: and,
    };

    const statuses = await this.prisma.issueStatus.findMany({
      where: { firmId: actor.user.firmId },
      orderBy: [{ order: "asc" }, { name: "asc" }],
    });
    const shown: Prisma.IssueWhereInput = since
      ? {
          OR: [
            { status: { category: { not: "DONE" } } },
            { status: { category: "DONE" }, closedAt: { gte: since } },
          ],
        }
      : {};
    const [rows, older] = await Promise.all([
      this.prisma.issue.findMany({
        where: { AND: [base, shown] },
        include: ISSUE_INCLUDE,
        orderBy: [{ position: "asc" }, { number: "asc" }],
      }),
      since
        ? this.prisma.issue.groupBy({
            by: ["statusId"],
            where: {
              AND: [
                base,
                { status: { category: "DONE" } },
                { OR: [{ closedAt: null }, { closedAt: { lt: since } }] },
              ],
            },
            _count: { _all: true },
          })
        : Promise.resolve([] as { statusId: string; _count: { _all: number } }[]),
    ]);
    const hidden = new Map(older.map((o) => [o.statusId, o._count._all]));
    return {
      today,
      doneRange: q.doneRange,
      doneSince: since ? since.toISOString() : null,
      total: rows.length,
      columns: statuses.map((s) => ({
        status: {
          id: s.id,
          name: s.name,
          colour: s.colour,
          category: s.category,
          isDefault: s.isDefault,
        },
        items: rows.filter((r) => r.statusId === s.id).map((r) => issueItem(r, today)),
        olderHidden: hidden.get(s.id) ?? 0,
      })),
    };
  }
}
