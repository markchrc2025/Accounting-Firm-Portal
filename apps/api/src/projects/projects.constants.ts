// projects.constants.ts — PA1 (D65): the words, patterns and pure rules of the Projects module.
// Pure: no database, no framework.

export const PROJECTS_PERMISSION = {
  read: "Projects:Read",
  create: "Projects:Create",
  update: "Projects:Update",
  configure: "Projects:Configure",
} as const;

/** 2 to 10 capital letters or digits, starting with a letter. */
export const PROJECT_KEY_RE = /^[A-Z][A-Z0-9]{1,9}$/;
export const ISSUE_KEY_RE = /^([A-Z][A-Z0-9]{1,9})-(\d{1,7})$/;
export const COLOUR_RE = /^#[0-9a-fA-F]{6}$/;

export const PROJECT_STATUSES = [
  "NOT_STARTED",
  "ON_TRACK",
  "AT_RISK",
  "OFF_TRACK",
  "ON_HOLD",
  "FINISHED",
] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export const CATEGORIES = ["TODO", "IN_PROGRESS", "DONE"] as const;
export type Category = (typeof CATEGORIES)[number];

export const PRIORITIES = ["LOW", "NORMAL", "HIGH", "URGENT"] as const;
export type Priority = (typeof PRIORITIES)[number];
/** Most urgent first. */
export const PRIORITY_RANK: Record<string, number> = {
  URGENT: 0,
  HIGH: 1,
  NORMAL: 2,
  LOW: 3,
};

export const MILESTONE_STATES = ["OPEN", "LOCKED", "CLOSED"] as const;
export type MilestoneState = (typeof MILESTONE_STATES)[number];

export const ACTOR_TYPES = ["USER", "CLAUDE", "GITHUB", "SYSTEM"] as const;
export type ActorType = (typeof ACTOR_TYPES)[number];
export const CHANNELS = ["web", "api", "mcp", "github", "system"] as const;
export type Channel = (typeof CHANNELS)[number];

/** The starting issue types and statuses every firm gets (migration 41 seeds the firms that exist). */
export const DEFAULT_ISSUE_TYPES = [
  { name: "Task", colour: "#57606a", order: 0 },
  { name: "Bug", colour: "#cf222e", order: 1 },
  { name: "Feature", colour: "#1a7f37", order: 2 },
  { name: "Epic", colour: "#8250df", order: 3 },
] as const;
/** PA8 (D70): the starting project categories every firm gets. */
export const DEFAULT_PROJECT_CATEGORIES = [
  { name: "Business Registration", colour: "#0969da", order: 0 },
  { name: "Business Closure", colour: "#cf222e", order: 1 },
  { name: "Tax Filing", colour: "#1a7f37", order: 2 },
  { name: "Encoding", colour: "#8250df", order: 3 },
] as const;
export const DEFAULT_ISSUE_STATUSES = [
  { name: "New", colour: "#57606a", order: 0, category: "TODO", isDefault: true },
  {
    name: "In progress",
    colour: "#bf8700",
    order: 1,
    category: "IN_PROGRESS",
    isDefault: false,
  },
  {
    name: "Blocked",
    colour: "#cf222e",
    order: 2,
    category: "IN_PROGRESS",
    isDefault: false,
  },
  {
    name: "In review",
    colour: "#8250df",
    order: 3,
    category: "IN_PROGRESS",
    isDefault: false,
  },
  { name: "Done", colour: "#1a7f37", order: 4, category: "DONE", isDefault: false },
  { name: "Won't do", colour: "#6e7781", order: 5, category: "DONE", isDefault: false },
] as const;

/** The built-in views of an issue list. */
export const ISSUE_VIEWS = ["open", "mine", "bugs", "overdue", "closed", "all"] as const;
export type IssueView = (typeof ISSUE_VIEWS)[number];
export const ISSUE_SORTS = ["updated", "priority", "due", "created", "key"] as const;
export type IssueSort = (typeof ISSUE_SORTS)[number];

/** Every message the module answers with: one plain sentence, no dashes. */
export const MESSAGES = {
  projectNotFound: "Project not found.",
  issueNotFound: "Issue not found.",
  milestoneNotFound: "Milestone not found.",
  labelNotFound: "Label not found.",
  typeNotFound: "Issue type not found.",
  statusNotFound: "Issue status not found.",
  clientNotFound: "Client not found.",
  assigneeNotFound: "The assignee must be an active member of the firm.",
  parentNotFound: "The parent issue must be an issue of the same project.",
  badKey: "The key must be 2 to 10 capital letters or digits and start with a letter.",
  keyUsed: "A project with this key already exists.",
  keyFixed: "A project key cannot be changed.",
  nameRequired: "The name is required.",
  titleRequired: "The title is required.",
  commentEmpty: "The comment is empty.",
  badDate: "Dates must be real dates written as YYYY-MM-DD.",
  dueBeforeStart: "The due date cannot be before the start date.",
  badColour: "The colour must look like #1a7f37.",
  ownParent: "An issue cannot be its own parent.",
  parentLoop: "That parent would make the issue its own ancestor.",
  parentProjectLoop: "That parent project would make the project its own ancestor.",
  ownParentProject: "A project cannot be its own parent.",
  parentProjectNotFound: "The parent project was not found.",
  nameUsed: "That name is already used.",
  defaultStatusDelete:
    "The default status cannot be deleted. Make another status the default first.",
  defaultStatusCategory: "The default status must be a to do status.",
  lastDefault:
    "A firm needs one default status. Make another status the default instead.",
  statusInUse: (n: number) =>
    `This status is used by ${n} issue${n === 1 ? "" : "s"}. Move ${n === 1 ? "it" : "them"} to another status first.`,
  typeInUse: (n: number) =>
    `This issue type is used by ${n} issue${n === 1 ? "" : "s"}. Change the type of ${n === 1 ? "it" : "them"} first.`,
  badIssueKey: (k: string) => `"${k}" is not an issue key like PAY-12.`,
  statusUpdateNote: "The note is too long.",
  categoryNotFound: "Category not found.",
  categoryInUse: (n: number) =>
    `This category is used by ${n} project${n === 1 ? "" : "s"}. Change the category of ${n === 1 ? "it" : "them"} first.`,
} as const;

/** Today's date in Asia/Manila as YYYY-MM-DD (the clock is Date.now, so tests can set it). */
export function manilaToday(nowMs: number = Date.now()): string {
  return new Date(nowMs + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/** True for a real calendar date written YYYY-MM-DD. */
export function isRealDate(s: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return false;
  const d = new Date(`${s}T00:00:00.000Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** Overdue: the due date is before today (Manila) and the status is not a DONE one. */
export function isOverdue(
  dueDate: string | null,
  category: string,
  today: string,
): boolean {
  return dueDate !== null && category !== "DONE" && dueDate < today;
}

/** A date as the API writes it: YYYY-MM-DD, or null. */
export function dayOf(d: Date | null | undefined): string | null {
  return d ? d.toISOString().slice(0, 10) : null;
}
/** A YYYY-MM-DD date as the database stores it. */
export function dayToDate(s: string | null | undefined): Date | null {
  return s ? new Date(`${s}T00:00:00.000Z`) : null;
}

export interface Change {
  field: string;
  old: unknown;
  new: unknown;
}

/** The fields whose value differs, as { field, old, new } in the order given. */
export function diffFields(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  fields: readonly string[],
): Change[] {
  const out: Change[] = [];
  for (const f of fields) {
    const a = before[f] ?? null;
    const b = after[f] ?? null;
    if (a !== b) out.push({ field: f, old: a, new: b });
  }
  return out;
}

/** The 1-based progress percentage, 0 when there is nothing to do. */
export function percent(done: number, total: number): number {
  return total === 0 ? 0 : Math.round((done / total) * 100);
}

/** A YYYY-MM-DD date moved by whole days. */
export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** The instant a Manila calendar day begins (00:00 in Asia/Manila, UTC+8). */
export function manilaDayStart(day: string): Date {
  return new Date(`${day}T00:00:00.000+08:00`);
}

/** How far back the Done columns of a board look: today and the 14 days before it, by Manila days. */
export const DONE_WINDOW_DAYS = 14;
export function doneSince(today: string): Date {
  return manilaDayStart(addDays(today, -DONE_WINDOW_DAYS));
}

/** The kinds of notification the Projects module writes. */
export const NOTIFICATION_KINDS = {
  assigned: "project.issue.assigned",
  commented: "project.issue.commented",
  status: "project.issue.status",
  closed: "project.issue.closed",
} as const;
