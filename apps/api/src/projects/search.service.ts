// search.service.ts — PA2 (D66): one search box over the issues and projects a person can see.
//
// Issues match on key, title or description; projects on key or name; 20 of each. When the
// text is exactly an issue key (any case, e.g. pay-12) that exists and is visible, the answer is
// a jump to it. An unknown key falls back to the ordinary search.
import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { ProjectsAccess, type ProjectsActor } from "./projects.access";
import {
  ISSUE_KEY_RE,
  manilaToday,
  PROJECTS_PERMISSION as P,
} from "./projects.constants";
import { ISSUE_INCLUDE, issueItem } from "./projects.mappers";

const PER_GROUP = 20;

@Injectable()
export class SearchService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ProjectsAccess,
  ) {}

  async search(actor: ProjectsActor, raw: string) {
    await this.access.need(actor, P.read);
    const user = actor.user;
    const q = raw.trim();
    const visible = await this.access.visibleWhere(user);

    const exact = q.toUpperCase();
    if (ISSUE_KEY_RE.test(exact)) {
      const hit = await this.prisma.issue.findFirst({
        where: { firmId: user.firmId, key: exact, deleted: false, project: visible },
        select: { key: true, project: { select: { key: true } } },
      });
      if (hit) {
        return {
          jump: { projectKey: hit.project.key, issueKey: hit.key },
          issues: [],
          projects: [],
        };
      }
    }

    const today = manilaToday();
    const [issues, projects] = await Promise.all([
      this.prisma.issue.findMany({
        where: {
          firmId: user.firmId,
          deleted: false,
          project: visible,
          OR: [
            { key: { contains: q, mode: "insensitive" } },
            { title: { contains: q, mode: "insensitive" } },
            { description: { contains: q, mode: "insensitive" } },
          ],
        },
        include: ISSUE_INCLUDE,
        orderBy: [{ updatedAt: "desc" }, { number: "desc" }],
        take: PER_GROUP,
      }),
      this.prisma.project.findMany({
        where: {
          AND: [
            visible,
            {
              OR: [
                { key: { contains: q, mode: "insensitive" } },
                { name: { contains: q, mode: "insensitive" } },
              ],
            },
          ],
        },
        include: { client: { select: { id: true, businessName: true } } },
        orderBy: { key: "asc" },
        take: PER_GROUP,
      }),
    ]);
    return {
      jump: null,
      issues: issues.map((i) => issueItem(i, today)),
      projects: projects.map((p) => ({
        id: p.id,
        key: p.key,
        name: p.name,
        archived: p.archived,
        client: p.client
          ? { id: p.client.id, businessName: p.client.businessName }
          : null,
      })),
    };
  }
}
