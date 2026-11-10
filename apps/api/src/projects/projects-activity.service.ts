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
        // GitHub and the system are not users: no row of the users table stands for them
        actorUserId:
          actor.actorType === "GITHUB" || actor.actorType === "SYSTEM"
            ? null
            : actor.user.id,
        channel: actor.channel,
        sessionId: actor.sessionId ?? null,
        action: input.action,
        changes: (input.changes ?? []) as unknown as Prisma.InputJsonValue,
      },
    });
    // PA3: a change made in a work session adds its issue to the session, in the same statement
    // of the same transaction, in the order the issues were first touched.
    if (actor.sessionId && input.issueId) {
      await tx.$executeRaw`
        UPDATE "project_work_sessions" s
        SET "issueKeys" = ARRAY(
          SELECT k FROM (
            SELECT k, min(o) AS o
            FROM unnest(s."issueKeys" || ARRAY[i."key"]) WITH ORDINALITY AS t(k, o)
            GROUP BY k
          ) x ORDER BY o)
        FROM "issues" i
        WHERE s."id" = ${actor.sessionId}::uuid AND i."id" = ${input.issueId}::uuid`;
    }
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
