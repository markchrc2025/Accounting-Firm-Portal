// work-sessions.service.ts — PA3 (D67): a Claude work session on a project.
//
// start opens one (and says so in the project's activity); every change made with its id is
// tagged with it and adds its issue to the session; end saves what was done and what comes next,
// which the next briefing shows. A session id is honoured only for the person who started it.
import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { extractIssueKeys } from "@portal/projects-core";
import { PrismaService } from "../prisma/prisma.service";
import { SUMMARY_REQUIRED } from "./dto/sessions.schemas";
import { ProjectsAccess, type ProjectsActor } from "./projects.access";
import { ProjectsActivity } from "./projects-activity.service";
import { PROJECTS_PERMISSION as P } from "./projects.constants";

export const SESSION_NOT_FOUND = "Session not found.";
export const SESSION_NEEDS_TARGET = "Pass session_id from start_session, or project_key.";
const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type SessionRow = {
  id: string;
  client: string;
  title: string;
  startedAt: Date;
  endedAt: Date | null;
  summary: string;
  nextSteps: string;
  issueKeys: string[];
  projectId: string;
  project: { key: string };
  /** null for a session imported from Sentire Projects whose person has no account here. */
  user: { id: string; fullName: string } | null;
};

const INCLUDE = {
  project: { select: { key: true } },
  user: { select: { id: true, fullName: true } },
} as const;

export function sessionDto(s: SessionRow) {
  return {
    id: s.id,
    projectKey: s.project.key,
    client: s.client,
    title: s.title,
    startedAt: s.startedAt.toISOString(),
    endedAt: s.endedAt ? s.endedAt.toISOString() : null,
    summary: s.summary,
    nextSteps: s.nextSteps,
    issueKeys: s.issueKeys,
    user: s.user ? { id: s.user.id, fullName: s.user.fullName } : null,
  };
}

/** A project's sessions, newest first (ties by id), with the total. Shared by the list and the overview. */
export async function projectSessions(
  prisma: PrismaService,
  firmId: string,
  projectId: string,
  opts: { skip: number; take: number },
) {
  const where = { firmId, projectId };
  const [total, rows] = await Promise.all([
    prisma.projectWorkSession.count({ where }),
    prisma.projectWorkSession.findMany({
      where,
      orderBy: [{ startedAt: "desc" }, { id: "desc" }],
      skip: opts.skip,
      take: opts.take,
      include: INCLUDE,
    }),
  ]);
  return { total, items: rows.map(sessionDto) };
}

@Injectable()
export class WorkSessionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ProjectsAccess,
    private readonly activity: ProjectsActivity,
  ) {}

  /** The actor with `sessionId` set, when that session is the caller's own; else unchanged. */
  async withSession(
    actor: ProjectsActor,
    sessionId?: string | null,
  ): Promise<ProjectsActor> {
    if (!sessionId || !UUID_SHAPE.test(sessionId)) return actor;
    const s = await this.prisma.projectWorkSession.findFirst({
      where: { id: sessionId, firmId: actor.user.firmId, userId: actor.user.id },
      select: { id: true },
    });
    return s ? { ...actor, sessionId: s.id } : actor;
  }

  /** A project's work sessions, newest first, paged. Needs Projects:Read on a project the caller sees. */
  async list(
    actor: ProjectsActor,
    projectKey: string,
    opts: { page: number; pageSize: number },
  ) {
    await this.access.need(actor, P.read);
    const project = await this.access.project(actor.user, projectKey);
    const { total, items } = await projectSessions(
      this.prisma,
      actor.user.firmId,
      project.id,
      { skip: (opts.page - 1) * opts.pageSize, take: opts.pageSize },
    );
    return { items, page: opts.page, pageSize: opts.pageSize, total };
  }

  /** Open a session on a project. Needs Projects:Update. */
  async start(actor: ProjectsActor, projectKey: string, opts: { title?: string } = {}) {
    await this.access.need(actor, P.update);
    const project = await this.access.project(actor.user, projectKey);
    const title = opts.title?.trim() ?? "";
    const row = await this.prisma.$transaction(async (tx) => {
      const s = await tx.projectWorkSession.create({
        data: {
          firmId: actor.user.firmId,
          projectId: project.id,
          userId: actor.user.id,
          tokenId: actor.tokenId ?? null,
          client: (
            actor.client ?? (actor.channel === "web" ? "web" : "claude-code")
          ).slice(0, 40),
          title,
        },
        include: INCLUDE,
      });
      await this.activity.log(
        tx,
        { ...actor, sessionId: s.id },
        {
          projectId: project.id,
          action: "session.started",
          changes: title ? [{ field: "title", old: null, new: title }] : [],
        },
      );
      return s;
    });
    return sessionDto(row);
  }

  /**
   * Close a session with what was done and what comes next. By id (the caller's own), or, with
   * only a project key, the caller's latest open session of that project (one is opened and closed
   * when there is none, so the summary is not lost). Ending twice overwrites, as in Sentire Projects.
   */
  async end(
    actor: ProjectsActor,
    input: {
      sessionId?: string | null;
      projectKey?: string;
      summary: string;
      nextSteps?: string;
    },
  ) {
    await this.access.need(actor, P.update);
    const summary = input.summary.trim();
    if (!summary) throw new BadRequestException(SUMMARY_REQUIRED);
    const nextSteps = input.nextSteps?.trim() ?? "";

    let id: string | null = null;
    if (input.sessionId) {
      id = await this.ownId(actor, input.sessionId);
      if (!id) throw new NotFoundException(SESSION_NOT_FOUND);
    } else if (input.projectKey) {
      const project = await this.access.project(actor.user, input.projectKey);
      const open = await this.prisma.projectWorkSession.findFirst({
        where: {
          firmId: actor.user.firmId,
          projectId: project.id,
          userId: actor.user.id,
          endedAt: null,
        },
        orderBy: { startedAt: "desc" },
        select: { id: true },
      });
      id = open?.id ?? (await this.start(actor, input.projectKey)).id;
    } else {
      throw new BadRequestException(SESSION_NEEDS_TARGET);
    }

    const keys = await this.keysNamedIn(actor, `${summary} ${nextSteps}`);
    const row = await this.prisma.$transaction(async (tx) => {
      const s = await tx.projectWorkSession.update({
        where: { id: id! },
        data: { summary, nextSteps, endedAt: new Date() },
        include: INCLUDE,
      });
      if (keys.length) {
        await tx.$executeRaw`
          UPDATE "project_work_sessions"
          SET "issueKeys" = ARRAY(
            SELECT k FROM (
              SELECT k, min(o) AS o
              FROM unnest("issueKeys" || ${keys}::text[]) WITH ORDINALITY AS t(k, o)
              GROUP BY k
            ) x ORDER BY o)
          WHERE "id" = ${s.id}::uuid`;
      }
      await this.activity.log(
        tx,
        { ...actor, sessionId: s.id },
        {
          projectId: s.projectId,
          action: "session.ended",
          changes: [
            { field: "summary", old: null, new: summary.slice(0, 400) },
            ...(nextSteps
              ? [{ field: "nextSteps", old: null, new: nextSteps.slice(0, 300) }]
              : []),
          ],
        },
      );
      return tx.projectWorkSession.findUniqueOrThrow({
        where: { id: s.id },
        include: INCLUDE,
      });
    });
    return sessionDto(row);
  }

  /** The caller's own session by id, or null. */
  private async ownId(actor: ProjectsActor, id: string): Promise<string | null> {
    if (!UUID_SHAPE.test(id)) return null;
    const s = await this.prisma.projectWorkSession.findFirst({
      where: { id, firmId: actor.user.firmId, userId: actor.user.id },
      select: { id: true },
    });
    return s?.id ?? null;
  }

  /** Issue keys written in the text that are real issues the caller may see, in order. */
  private async keysNamedIn(actor: ProjectsActor, text: string): Promise<string[]> {
    const named = extractIssueKeys(text);
    if (!named.length) return [];
    const visible = await this.access.visibleWhere(actor.user);
    const found = await this.prisma.issue.findMany({
      where: {
        firmId: actor.user.firmId,
        key: { in: named },
        deleted: false,
        project: visible,
      },
      select: { key: true },
    });
    const real = new Set(found.map((f) => f.key));
    return named.filter((k) => real.has(k));
  }
}
