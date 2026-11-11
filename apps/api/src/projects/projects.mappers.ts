// projects.mappers.ts — PA1 (D65): the shapes the API answers with. Dates are YYYY-MM-DD
// (calendar dates) or ISO instants (moments); colours, categories and priorities are as stored.
import type { Prisma } from "@prisma/client";
import { feeText } from "./project-details";
import { dayOf, isOverdue, manilaToday, percent } from "./projects.constants";

export const ISSUE_INCLUDE = {
  project: { select: { key: true, name: true } },
  type: true,
  status: true,
  assignee: { select: { id: true, fullName: true } },
  milestone: { select: { id: true, name: true } },
  parent: { select: { key: true, title: true } },
  labels: { include: { label: true } },
} satisfies Prisma.IssueInclude;

export type IssueRow = Prisma.IssueGetPayload<{ include: typeof ISSUE_INCLUDE }>;

/** An issue as a list shows it. */
export function issueItem(i: IssueRow, today: string) {
  const due = dayOf(i.dueDate);
  return {
    id: i.id,
    key: i.key,
    number: i.number,
    title: i.title,
    priority: i.priority,
    startDate: dayOf(i.startDate),
    dueDate: due,
    overdue: isOverdue(due, i.status.category, today),
    position: i.position,
    createdAt: i.createdAt.toISOString(),
    updatedAt: i.updatedAt.toISOString(),
    closedAt: i.closedAt ? i.closedAt.toISOString() : null,
    project: { key: i.project.key, name: i.project.name },
    type: { id: i.type.id, name: i.type.name, colour: i.type.colour },
    status: {
      id: i.status.id,
      name: i.status.name,
      colour: i.status.colour,
      category: i.status.category,
    },
    assignee: i.assignee ? { id: i.assignee.id, fullName: i.assignee.fullName } : null,
    milestone: i.milestone ? { id: i.milestone.id, name: i.milestone.name } : null,
    parentKey: i.parent?.key ?? null,
    labels: i.labels.map((l) => ({
      id: l.label.id,
      name: l.label.name,
      colour: l.label.colour,
    })),
  };
}

export const PROJECT_INCLUDE = {
  client: { select: { id: true, businessName: true, professionalFee: true } },
  parent: { select: { key: true, name: true } },
  category: { select: { id: true, name: true, colour: true } },
} satisfies Prisma.ProjectInclude;
export type ProjectRow = Prisma.ProjectGetPayload<{ include: typeof PROJECT_INCLUDE }>;

export function projectDto(p: ProjectRow) {
  return {
    id: p.id,
    key: p.key,
    name: p.name,
    description: p.description,
    repoUrl: p.repoUrl,
    liveUrl: p.liveUrl,
    deployAppName: p.deployAppName,
    archived: p.archived,
    parent: p.parent ? { key: p.parent.key, name: p.parent.name } : null,
    client: p.client ? { id: p.client.id, businessName: p.client.businessName } : null,
    // PA8 (D70): the client as the firm names it, the fee, and the category
    clientName: p.clientName,
    professionalFee: feeText(p.professionalFee),
    // the listed client's own fee, offered when the project has none; never saved by itself
    suggestedProfessionalFee:
      p.professionalFee == null ? feeText(p.client?.professionalFee) : null,
    category: p.category
      ? { id: p.category.id, name: p.category.name, colour: p.category.colour }
      : null,
    // PA8 (D70): the recurring schedule
    isRecurring: p.isRecurring,
    recurrenceStart: dayOf(p.recurrenceStart),
    recurrenceEnd: dayOf(p.recurrenceEnd),
    recurrenceFrequency: p.recurrenceFrequency,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
  };
}

export function milestoneDto(
  m: {
    id: string;
    projectId: string;
    name: string;
    description: string;
    startDate: Date | null;
    dueDate: Date | null;
    state: string;
    createdAt: Date;
    updatedAt: Date;
  },
  p: { done: number; total: number; overdue?: number },
) {
  return {
    id: m.id,
    name: m.name,
    description: m.description,
    startDate: dayOf(m.startDate),
    dueDate: dayOf(m.dueDate),
    state: m.state,
    progress: { done: p.done, total: p.total, percent: percent(p.done, p.total) },
    // PA2: what a roadmap bar needs, beside startDate and dueDate: percent done, and today (Manila)
    percent: percent(p.done, p.total),
    today: manilaToday(),
    overdueIssues: p.overdue ?? 0,
    createdAt: m.createdAt.toISOString(),
    updatedAt: m.updatedAt.toISOString(),
  };
}

export function statusUpdateDto(u: {
  id: string;
  status: string;
  note: string;
  actorType: string;
  createdAt: Date;
  actorUser: { id: string; fullName: string } | null;
}) {
  return {
    id: u.id,
    status: u.status,
    note: u.note,
    actorType: u.actorType,
    actor: u.actorUser ? { id: u.actorUser.id, fullName: u.actorUser.fullName } : null,
    createdAt: u.createdAt.toISOString(),
  };
}
