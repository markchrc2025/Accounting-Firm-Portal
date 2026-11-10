// issue-writes.ts — PA4 (D68): the writes of an issue that more than one door makes inside its own
// transaction: a new issue (the web, the MCP, the checklist import, a security audit) and a comment.
// The next number is an atomic increment of the project's counter, the activity row is written with
// the change, and nothing here sends a notification: the caller plans those.
import { Injectable } from "@nestjs/common";
import type { ProjectsActor, Tx } from "./projects.access";
import { ProjectsActivity } from "./projects-activity.service";
import { dayToDate, type Change } from "./projects.constants";

export interface NewIssueFields {
  title: string;
  description?: string;
  type: { id: string; name: string };
  status: { id: string; name: string; category: string };
  priority: string;
  assignee?: { id: string; fullName: string } | null;
  milestone?: { id: string; name: string } | null;
  parent?: { id: string; key: string } | null;
  startDate?: string | null;
  dueDate?: string | null;
  labels?: { id: string; name: string }[];
}

@Injectable()
export class IssueWrites {
  constructor(private readonly activity: ProjectsActivity) {}

  /** Create the issue and log it, in the caller's transaction. */
  async insert(
    tx: Tx,
    actor: ProjectsActor,
    project: { id: string; key: string },
    f: NewIssueFields,
  ): Promise<{ id: string; key: string; number: number }> {
    const firmId = actor.user.firmId;
    // The next number: an atomic increment (the UPDATE locks the project row), so parallel
    // creates get distinct consecutive numbers and a number is never given twice.
    const { issueCounter: number } = await tx.project.update({
      where: { id: project.id },
      data: { issueCounter: { increment: 1 } },
      select: { issueCounter: true },
    });
    const last = await tx.issue.aggregate({
      where: { projectId: project.id },
      _max: { position: true },
    });
    const issue = await tx.issue.create({
      data: {
        firmId,
        projectId: project.id,
        number,
        key: `${project.key}-${number}`,
        title: f.title,
        description: f.description ?? "",
        typeId: f.type.id,
        statusId: f.status.id,
        priority: f.priority,
        assigneeId: f.assignee?.id ?? null,
        authorId:
          actor.actorType === "USER" || actor.actorType === "CLAUDE"
            ? actor.user.id
            : null,
        milestoneId: f.milestone?.id ?? null,
        parentIssueId: f.parent?.id ?? null,
        startDate: dayToDate(f.startDate),
        dueDate: dayToDate(f.dueDate),
        position: (last._max.position ?? 0) + 1,
        closedAt: f.status.category === "DONE" ? new Date() : null,
        ...(f.labels?.length
          ? { labels: { create: f.labels.map((l) => ({ labelId: l.id, firmId })) } }
          : {}),
      },
    });
    const changes: Change[] = [
      { field: "title", old: null, new: f.title },
      { field: "type", old: null, new: f.type.name },
      { field: "status", old: null, new: f.status.name },
      { field: "priority", old: null, new: f.priority },
      ...(f.assignee ? [{ field: "assignee", old: null, new: f.assignee.fullName }] : []),
      ...(f.milestone ? [{ field: "milestone", old: null, new: f.milestone.name }] : []),
      ...(f.parent ? [{ field: "parent", old: null, new: f.parent.key }] : []),
      ...(f.startDate ? [{ field: "startDate", old: null, new: f.startDate }] : []),
      ...(f.dueDate ? [{ field: "dueDate", old: null, new: f.dueDate }] : []),
      ...(f.labels?.length
        ? [
            {
              field: "labels",
              old: null,
              new: f.labels
                .map((l) => l.name)
                .sort()
                .join(", "),
            },
          ]
        : []),
    ];
    await this.activity.log(tx, actor, {
      projectId: project.id,
      issueId: issue.id,
      action: "issue.created",
      changes,
    });
    return { id: issue.id, key: issue.key, number };
  }

  /** Add a comment, touch the issue and log it, in the caller's transaction. */
  async comment(
    tx: Tx,
    actor: ProjectsActor,
    projectId: string,
    issueId: string,
    text: string,
  ) {
    const c = await tx.issueComment.create({
      data: {
        firmId: actor.user.firmId,
        issueId,
        authorId:
          actor.actorType === "USER" || actor.actorType === "CLAUDE"
            ? actor.user.id
            : null,
        body: text,
      },
      include: { author: { select: { id: true, fullName: true } } },
    });
    await tx.issue.update({ where: { id: issueId }, data: { updatedAt: new Date() } });
    await this.activity.log(tx, actor, {
      projectId,
      issueId,
      action: "comment.added",
      changes: [{ field: "comment", old: null, new: text.slice(0, 300) }],
    });
    return c;
  }
}
