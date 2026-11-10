// security-queries.ts — PA4 (D68): reads the open security issues of projects, once, for the status,
// the portfolio, the overview and the release gate. An issue is a security finding when it carries
// the label `security` (see security.ts); only issues that are not done and not deleted are open.
import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import {
  classifySecurityIssue,
  securitySummary,
  type OpenSecurityIssue,
  type SecuritySummary,
} from "./security";

/** What the portfolio and the overview carry, per project. */
export interface SecurityBadge {
  state: "clear" | "open" | "blocked";
  open: number;
  critical: number;
  high: number;
}

@Injectable()
export class SecurityQueries {
  constructor(private readonly prisma: PrismaService) {}

  /** The open security issues of the projects, by issue number. */
  async openIssues(
    firmId: string,
    projectIds: string[],
  ): Promise<Map<string, OpenSecurityIssue[]>> {
    const out = new Map<string, OpenSecurityIssue[]>(projectIds.map((id) => [id, []]));
    if (projectIds.length === 0) return out;
    const rows = await this.prisma.issue.findMany({
      where: {
        firmId,
        projectId: { in: projectIds },
        deleted: false,
        status: { category: { not: "DONE" } },
        labels: {
          some: { label: { name: { equals: "security", mode: "insensitive" } } },
        },
      },
      orderBy: [{ number: "asc" }],
      select: {
        projectId: true,
        key: true,
        number: true,
        title: true,
        labels: { select: { label: { select: { name: true } } } },
        securityFinding: { select: { fingerprint: true }, take: 1 },
      },
    });
    for (const r of rows) {
      const c = classifySecurityIssue(r.labels.map((l) => l.label.name));
      if (!c) continue;
      out.get(r.projectId)!.push({
        key: r.key,
        number: r.number,
        title: r.title,
        fingerprint: r.securityFinding[0]?.fingerprint ?? null,
        ...c,
      });
    }
    return out;
  }

  async summary(
    firmId: string,
    projectId: string,
  ): Promise<SecuritySummary & { open: OpenSecurityIssue[] }> {
    const open = (await this.openIssues(firmId, [projectId])).get(projectId) ?? [];
    return { ...securitySummary(open), open };
  }

  /** The badge of each project, in one query. */
  async badges(
    firmId: string,
    projectIds: string[],
  ): Promise<Map<string, SecurityBadge>> {
    const open = await this.openIssues(firmId, projectIds);
    return new Map(
      projectIds.map((id) => {
        const s = securitySummary(open.get(id) ?? []);
        return [
          id,
          {
            state: s.state,
            open: s.counts.open,
            critical: s.counts.critical,
            high: s.counts.high,
          },
        ];
      }),
    );
  }

  /** The keys that stop a milestone of this project from closing, by issue number. */
  async blockers(firmId: string, projectId: string): Promise<string[]> {
    return (await this.summary(firmId, projectId)).blockedBy;
  }
}
