// projects-activity.service.ts — PA1 (D65): the activity log of a project.
//
// log() takes the transaction of the change it records, so the rows are written with the
// change and are gone with it if the change rolls back. Nothing else writes ProjectActivity.
import { Injectable } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import type { Change, ActorType } from "./projects.constants";
import type { ProjectsActor, Tx } from "./projects.access";

export interface ActivityInput {
  projectId: string;
  issueId?: string | null;
  action: string;
  changes?: Change[];
}

@Injectable()
export class ProjectsActivity {
  constructor(private readonly prisma: PrismaService) {}

  /** Write one activity row inside the caller's transaction. */
  async log(tx: Tx, actor: ProjectsActor, input: ActivityInput): Promise<void> {
    await tx.projectActivity.create({
      data: {
        firmId: actor.user.firmId,
        projectId: input.projectId,
        issueId: input.issueId ?? null,
        actorType: actor.actorType,
        actorUserId: actor.user.id,
        channel: actor.channel,
        sessionId: actor.sessionId ?? null,
        action: input.action,
        changes: (input.changes ?? []) as unknown as Prisma.InputJsonValue,
      },
    });
  }

  /** A project's activity, newest first, paged; optionally one kind of actor. */
  async list(
    firmId: string,
    projectId: string,
    opts: { actorType?: ActorType; page: number; pageSize: number },
  ) {
    const where: Prisma.ProjectActivityWhereInput = {
      firmId,
      projectId,
      ...(opts.actorType ? { actorType: opts.actorType } : {}),
    };
    const [total, rows] = await Promise.all([
      this.prisma.projectActivity.count({ where }),
      this.prisma.projectActivity.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: (opts.page - 1) * opts.pageSize,
        take: opts.pageSize,
        include: {
          actorUser: { select: { id: true, fullName: true } },
          issue: { select: { key: true, title: true } },
        },
      }),
    ]);
    return {
      items: rows.map(activityDto),
      page: opts.page,
      pageSize: opts.pageSize,
      total,
    };
  }
}

type ActivityRow = Prisma.ProjectActivityGetPayload<{
  include: {
    actorUser: { select: { id: true; fullName: true } };
    issue: { select: { key: true; title: true } };
  };
}>;

export function activityDto(a: ActivityRow) {
  return {
    id: a.id,
    projectId: a.projectId,
    issueKey: a.issue?.key ?? null,
    issueTitle: a.issue?.title ?? null,
    action: a.action,
    actorType: a.actorType,
    actor: a.actorUser ? { id: a.actorUser.id, fullName: a.actorUser.fullName } : null,
    channel: a.channel,
    changes: a.changes as unknown as Change[],
    createdAt: a.createdAt.toISOString(),
  };
}
