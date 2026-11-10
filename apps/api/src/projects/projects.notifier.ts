// projects.notifier.ts — PA2 (D66): who is told when something happens to an issue.
//
// An issue's involved people are its assignee, its author and everyone who has commented on it.
// An event tells them all EXCEPT the person acting, once each:
//   * assigned: the new assignee (it is you who was given the issue);
//   * commented: the involved people;
//   * status changed: the involved people; closed (a move into a done status) replaces it.
// In one change a person is told once, in the order assigned, closed or status, commented. Only
// people who may see the project are told (a client-linked project follows the Portal's client
// visibility, and they need Projects:Read), so a notification never leaks a title.
// plan() writes the rows inside the change's transaction; deliver() is for after it commits.
import { Injectable } from "@nestjs/common";
import {
  NotificationsService,
  type PendingNotification,
} from "../notifications/notifications.service";
import { PrismaService } from "../prisma/prisma.service";
import { RbacService } from "../rbac/rbac.service";
import type { ProjectsActor, Tx } from "./projects.access";
import { NOTIFICATION_KINDS, PROJECTS_PERMISSION } from "./projects.constants";

export type IssueEvent =
  | { type: "assigned"; assigneeId: string }
  | { type: "commented"; snippet: string }
  | { type: "status"; statusName: string; closed: boolean };

export interface EventIssue {
  id: string;
  key: string;
  title: string;
  assigneeId: string | null;
  authorId: string | null;
  project: { key: string; clientId: string | null };
}

@Injectable()
export class ProjectsNotifier {
  constructor(
    private readonly prisma: PrismaService,
    private readonly rbac: RbacService,
    private readonly notifications: NotificationsService,
  ) {}

  /** Can this person see the project? An active firm user with Projects:Read who can see its client. */
  private async mayView(
    firmId: string,
    userId: string,
    clientId: string | null,
  ): Promise<boolean> {
    const u = await this.prisma.user.findFirst({
      where: { id: userId, firmId, userType: "FIRM", status: "ACTIVE" },
      select: { id: true, email: true },
    });
    if (!u) return false;
    const auth = { id: u.id, firmId, userType: "FIRM" as const, email: u.email };
    if (!(await this.rbac.authorize(auth, [PROJECTS_PERMISSION.read]))) return false;
    return clientId ? this.rbac.authorize(auth, [], clientId) : true;
  }

  /** Write the notifications for this change, inside its transaction. Returns what may need an email. */
  async plan(
    tx: Tx,
    actor: ProjectsActor,
    issue: EventIssue,
    events: IssueEvent[],
  ): Promise<PendingNotification[]> {
    if (events.length === 0) return [];
    const firmId = actor.user.firmId;
    const actorRow = await tx.user.findUnique({
      where: { id: actor.user.id },
      select: { fullName: true },
    });
    const who = actorRow?.fullName ?? "Someone";
    const link = `/projects/${issue.project.key}/issues/${issue.key}`;

    const commenters = await tx.issueComment.findMany({
      where: { issueId: issue.id, authorId: { not: null } },
      select: { authorId: true },
      distinct: ["authorId"],
    });
    const involved = [
      issue.assigneeId,
      issue.authorId,
      ...commenters.map((c) => c.authorId),
    ].filter((x): x is string => !!x);

    const told = new Set<string>([actor.user.id]);
    const pending: PendingNotification[] = [];
    const tell = async (
      candidates: string[],
      kind: string,
      title: string,
      body: string,
    ) => {
      const recipients: string[] = [];
      for (const id of new Set(candidates)) {
        if (told.has(id)) continue;
        if (!(await this.mayView(firmId, id, issue.project.clientId))) continue;
        recipients.push(id);
        told.add(id);
      }
      if (recipients.length === 0) return;
      pending.push(
        ...(await this.notifications.record(tx, {
          firmId,
          userIds: recipients,
          kind,
          title,
          body,
          link,
          entityType: "Issue",
          entityId: issue.id,
        })),
      );
    };

    const order = { assigned: 0, status: 1, commented: 2 } as const;
    for (const e of [...events].sort((a, b) => order[a.type] - order[b.type])) {
      if (e.type === "assigned") {
        await tell(
          [e.assigneeId],
          NOTIFICATION_KINDS.assigned,
          `${issue.key} was assigned to you`,
          `${who} assigned you ${issue.key}: ${issue.title}`,
        );
      } else if (e.type === "status") {
        await tell(
          involved,
          e.closed ? NOTIFICATION_KINDS.closed : NOTIFICATION_KINDS.status,
          e.closed ? `${issue.key} was closed` : `${issue.key} moved to ${e.statusName}`,
          `${who} moved ${issue.key}: ${issue.title} to ${e.statusName}`,
        );
      } else {
        await tell(
          involved,
          NOTIFICATION_KINDS.commented,
          `New comment on ${issue.key}`,
          `${who} commented on ${issue.key}: ${e.snippet}`,
        );
      }
    }
    return pending;
  }

  /** After the commit: the emails. Never throws. */
  deliver(pending: PendingNotification[]): Promise<void> {
    return this.notifications.deliver(pending);
  }
}
