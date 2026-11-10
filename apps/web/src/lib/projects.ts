// projects.ts - the Projects module as the web sees it (PB1, Track A PA1 / D65): the API's
// shapes, the calls, and the small pure rules the screens share (filters and views kept in
// the address, Manila dates, activity grouped by day, a change put into plain words). The API
// decides everything else; its sentences are shown exactly as sent.

import { ApiError, apiFetch } from "./api";

// --- words and colours ---------------------------------------------------------------------

export const PROJECT_STATUSES = [
  "NOT_STARTED",
  "ON_TRACK",
  "AT_RISK",
  "OFF_TRACK",
  "ON_HOLD",
  "FINISHED",
] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];
export const PROJECT_STATUS_LABEL: Record<ProjectStatus, string> = {
  NOT_STARTED: "Not started",
  ON_TRACK: "On track",
  AT_RISK: "At risk",
  OFF_TRACK: "Off track",
  ON_HOLD: "On hold",
  FINISHED: "Finished",
};
/** The Portal's chip colours: grey, green, amber, red, blue, indigo. */
export const PROJECT_STATUS_VARIANT: Record<
  ProjectStatus,
  "neutral" | "success" | "warn" | "danger" | "info" | "vat"
> = {
  NOT_STARTED: "neutral",
  ON_TRACK: "success",
  AT_RISK: "warn",
  OFF_TRACK: "danger",
  ON_HOLD: "info",
  FINISHED: "vat",
};
export const projectStatusLabel = (s: string): string =>
  PROJECT_STATUS_LABEL[s as ProjectStatus] ?? s;

export const PRIORITIES = ["LOW", "NORMAL", "HIGH", "URGENT"] as const;
export type Priority = (typeof PRIORITIES)[number];
export const PRIORITY_LABEL: Record<Priority, string> = {
  LOW: "Low",
  NORMAL: "Normal",
  HIGH: "High",
  URGENT: "Urgent",
};
export const priorityLabel = (p: string): string => PRIORITY_LABEL[p as Priority] ?? p;

export const MILESTONE_STATES = ["OPEN", "LOCKED", "CLOSED"] as const;
export type MilestoneState = (typeof MILESTONE_STATES)[number];
export const MILESTONE_STATE_LABEL: Record<MilestoneState, string> = {
  OPEN: "Open",
  LOCKED: "Locked",
  CLOSED: "Closed",
};
export const milestoneStateLabel = (s: string): string =>
  MILESTONE_STATE_LABEL[s as MilestoneState] ?? s;

export const CATEGORIES = ["TODO", "IN_PROGRESS", "DONE"] as const;
export type Category = (typeof CATEGORIES)[number];
export const CATEGORY_LABEL: Record<Category, string> = {
  TODO: "To do",
  IN_PROGRESS: "In progress",
  DONE: "Done",
};

/** The format the API checks a project key against (a hint in the form; the API decides). */
export const PROJECT_KEY_RE = /^[A-Z][A-Z0-9]{1,9}$/;
export const PROJECT_KEY_HINT =
  "2 to 10 capital letters or digits, starting with a letter. It cannot be changed later.";
export const ISSUE_KEY_RE = /^([A-Z][A-Z0-9]{1,9})-(\d{1,7})$/;

// --- shapes --------------------------------------------------------------------------------

export interface ProjectRef {
  key: string;
  name: string;
}
export interface ProjectDto {
  id: string;
  key: string;
  name: string;
  description: string;
  repoUrl: string;
  liveUrl: string;
  deployAppName: string;
  archived: boolean;
  parent: ProjectRef | null;
  client: { id: string; businessName: string } | null;
  createdAt: string;
  updatedAt: string;
}
export interface Progress {
  done: number;
  total: number;
  percent: number;
}
export interface Counts {
  todo: number;
  inProgress: number;
  done: number;
  overdue: number;
  openBugs: number;
}
export interface Milestone {
  id: string;
  name: string;
  description: string;
  startDate: string | null;
  dueDate: string | null;
  state: MilestoneState;
  progress: Progress;
  /** PB2: percent done as the API worked it out, for a roadmap bar. */
  percent: number;
  /** PB2: today in Manila (YYYY-MM-DD). */
  today: string;
  overdueIssues: number;
  createdAt: string;
  updatedAt: string;
}
export type SecurityState = "clear" | "open" | "blocked";
/** What the portfolio and the overview carry of a project's security (PA4). */
export interface SecurityBadge {
  state: SecurityState;
  open: number;
  critical: number;
  high: number;
}
export interface ProjectSummary extends ProjectDto {
  security: SecurityBadge;
  status: ProjectStatus;
  statusNote: string;
  statusUpdatedAt: string | null;
  progress: Progress;
  counts: Counts;
  nextMilestone: Milestone | null;
  lastActivityAt: string | null;
}
export interface IssueStatusRef {
  id: string;
  name: string;
  colour: string;
  category: Category;
}
export interface IssueTypeRef {
  id: string;
  name: string;
  colour: string;
}
export interface LabelRef {
  id: string;
  name: string;
  colour: string;
}
export interface IssueItem {
  id: string;
  key: string;
  number: number;
  title: string;
  priority: Priority;
  startDate: string | null;
  dueDate: string | null;
  overdue: boolean;
  position: number;
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
  project: ProjectRef;
  type: IssueTypeRef;
  status: IssueStatusRef;
  assignee: { id: string; fullName: string } | null;
  milestone: { id: string; name: string } | null;
  parentKey: string | null;
  labels: LabelRef[];
}
/** A pull request or commit that names an issue (Track A PA4, D68). */
export interface GithubLink {
  kind: "pr" | "commit";
  /** owner/repo */
  repo: string;
  number: number | null;
  sha: string | null;
  title: string;
  /** open, closed, merged or pushed */
  state: string;
  merged: boolean;
  url: string;
  updatedAt: string;
}
export interface IssueDetail extends IssueItem {
  description: string;
  author: { id: string; fullName: string } | null;
  parent: { key: string; title: string } | null;
  children: IssueItem[];
  commentCount: number;
  /** PB4: the pull requests and commits that name this issue, the latest first. */
  githubLinks: GithubLink[];
}
export interface IssueComment {
  id: string;
  body: string;
  author: { id: string; fullName: string } | null;
  createdAt: string;
  updatedAt: string;
}
export interface IssueList {
  items: IssueItem[];
  total: number;
  limit: number;
  offset: number;
}
export type ActorType = "USER" | "CLAUDE" | "GITHUB" | "SYSTEM";
export interface StatusUpdate {
  id: string;
  status: ProjectStatus;
  note: string;
  actorType: ActorType;
  actor: { id: string; fullName: string } | null;
  createdAt: string;
}
export interface Change {
  field: string;
  old: unknown;
  new: unknown;
}
export interface ActivityItem {
  id: string;
  projectId: string;
  issueKey: string | null;
  issueTitle: string | null;
  action: string;
  actorType: ActorType;
  actor: { id: string; fullName: string } | null;
  channel: string;
  changes: Change[];
  /** PB5: the Claude work session the change was made in, or null. */
  session: { id: string; title: string } | null;
  createdAt: string;
}
/** A Claude work session on a project (Track A PA3 / PA5, D69). */
export interface ClaudeSession {
  id: string;
  projectKey: string;
  /** web, claude-code, or what the client called itself */
  client: string;
  title: string;
  startedAt: string;
  /** null while the session is open */
  endedAt: string | null;
  summary: string;
  nextSteps: string;
  issueKeys: string[];
  /** null when no person is known: the session was run by Claude */
  user: { id: string; fullName: string } | null;
}
export interface SessionPage {
  items: ClaudeSession[];
  page: number;
  pageSize: number;
  total: number;
}
export interface ActivityPage {
  items: ActivityItem[];
  page: number;
  pageSize: number;
  total: number;
}
export interface ProjectOverview {
  security: SecurityBadge;
  /** PB5: the latest five Claude work sessions. */
  recentSessions: ClaudeSession[];
  project: ProjectDto;
  status: { value: ProjectStatus; note: string; updatedAt: string | null };
  statusUpdates: StatusUpdate[];
  progress: Progress;
  counts: Counts;
  countsByStatus: { status: IssueStatusRef; count: number }[];
  countsByType: { type: IssueTypeRef; count: number }[];
  openMilestones: Milestone[];
  inProgress: IssueItem[];
  recentActivity: ActivityItem[];
  lastActivityAt: string | null;
}
export interface IssueStatusRow extends IssueStatusRef {
  order: number;
  isDefault: boolean;
}
export interface IssueTypeRow extends IssueTypeRef {
  order: number;
}
export interface ProjectsMeta {
  issueTypes: IssueTypeRow[];
  issueStatuses: IssueStatusRow[];
  labels: LabelRef[];
  users: { id: string; fullName: string; email: string }[];
}

// --- PB2: board, roadmap, My Work, search -----------------------------------------------------

export interface BoardColumn {
  status: IssueStatusRef & { isDefault: boolean };
  items: IssueItem[];
  /** Done columns only: how many closed cards the 14-day window left out. */
  olderHidden: number;
}
export interface Board {
  today: string;
  doneRange: "14d" | "all";
  doneSince: string | null;
  total: number;
  columns: BoardColumn[];
}
export interface BoardFilters {
  /** "" = any, "none" = no milestone, else a milestone id. */
  milestone: string;
  /** "" = anyone, "me", "none" = unassigned, else a user id. */
  assignee: string;
  /** true = every closed card, not just the last 14 days. */
  doneAll: boolean;
}
export interface Roadmap {
  today: string;
  dated: Milestone[];
  undated: Milestone[];
}
export interface MyWork {
  today: string;
  totals: { assignedOpen: number; overdue: number; dueThisWeek: number };
  assigned: IssueItem[];
  overdue: IssueItem[];
  upcomingMilestones: (Milestone & { project: ProjectRef })[];
  recentActivity: (ActivityItem & { project: ProjectRef })[];
}
export interface SearchProject {
  id: string;
  key: string;
  name: string;
  archived: boolean;
  client: { id: string; businessName: string } | null;
}
export interface SearchResult {
  jump: { projectKey: string; issueKey: string } | null;
  issues: IssueItem[];
  projects: SearchProject[];
}

// --- PB3: the repo kit -------------------------------------------------------------------------

export interface RepoKitFile {
  /** Relative to the repository root, forward slashes. */
  path: string;
  content: string;
}
export interface RepoKit {
  projectKey: string;
  /** The Portal's address the kit was made for (no path). */
  serverUrl: string;
  /** The NAME of the environment variable that holds the person's token. The kit holds no token. */
  tokenEnvVar: string;
  files: RepoKitFile[];
}

// --- PB4: checklist import, security -------------------------------------------------------------

export interface ChecklistItem {
  title: string;
  closed: boolean;
  labels: string[];
  description: string;
  milestone: string | null;
}
export interface ChecklistImportResult {
  dryRun: boolean;
  items: { total: number; open: number; closed: number };
  milestones: { name: string; created: boolean }[];
  labels: { name: string; created: boolean }[];
  warnings: string[];
  /** The keys made; empty for a preview. */
  keys: string[];
  /** A preview only: every item, as it would be made. */
  plan?: ChecklistItem[];
}
export const SEVERITIES = ["critical", "high", "medium", "low", "informational"] as const;
export type Severity = (typeof SEVERITIES)[number];
export interface SecurityCounts {
  open: number;
  critical: number;
  high: number;
  medium: number;
  low: number;
  informational: number;
  needsValidation: number;
  unrated: number;
}
export interface OpenSecurityIssue {
  key: string;
  title: string;
  /** null: no sev label (a lead, or labelled by hand) */
  severity: Severity | null;
  needsValidation: boolean;
  fingerprint: string | null;
}
export interface SecurityAudit {
  id: string;
  runId: string;
  commit: string;
  profile: string;
  /** Paths the run was limited to; empty for the whole repository. */
  scope: string[];
  complete: boolean;
  incompleteReason: string;
  /** A quick, scoped or incomplete run. */
  partial: boolean;
  /** Ledger units by status. */
  coverage: Record<string, number>;
  findings: {
    total: number;
    confirmed: number;
    needsValidation: number;
    rejected: number;
    bySeverity: Record<Severity, number>;
  };
  created: string[];
  updated: string[];
  reopened: string[];
  notReported: string[];
  rejectedNoted: string[];
  rejected: { fingerprint: string; title: string; reason: string }[];
  importedBy: { id: string; fullName: string } | null;
  actorType: ActorType;
  channel: string;
  createdAt: string;
}
export interface SecurityStatus {
  projectKey: string;
  state: SecurityState;
  /** The open critical and high issues that stop a milestone from closing. */
  blockedBy: string[];
  counts: SecurityCounts;
  open: OpenSecurityIssue[];
  lastAudit: SecurityAudit | null;
}
/** What the import sends: findings.json as text or array, the run metadata, the ledger. */
export interface AuditImportBody {
  findings: unknown;
  run?: Record<string, unknown>;
  ledger?: unknown[];
}

export type AdminType = IssueTypeRow & { issueCount: number };
export type AdminStatus = IssueStatusRow & { issueCount: number };
export type AdminLabel = LabelRef & { issueCount: number };

// --- the calls -----------------------------------------------------------------------------

const enc = encodeURIComponent;
const json = (body: unknown) => ({ body: JSON.stringify(body) });
const query = (params: Record<string, string | undefined>): string => {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params))
    if (v !== undefined && v !== "") sp.set(k, v);
  const s = sp.toString();
  return s ? `?${s}` : "";
};

export const fetchProjectsMeta = () => apiFetch<ProjectsMeta>("/projects/meta");
export const lookupIssueKey = (key: string) =>
  apiFetch<IssueItem>(`/projects/issue-keys/${enc(key)}`);
export const fetchProjects = (includeArchived: boolean) =>
  apiFetch<ProjectSummary[]>(
    `/projects${query({ includeArchived: includeArchived ? "true" : undefined })}`,
  );
export interface ProjectInput {
  key?: string;
  name?: string;
  description?: string;
  repoUrl?: string;
  liveUrl?: string;
  deployAppName?: string;
  parentKey?: string | null;
  clientId?: string | null;
}
export const createProject = (b: ProjectInput) =>
  apiFetch<ProjectDto>("/projects", { method: "POST", ...json(b) });
export const updateProject = (key: string, b: ProjectInput) =>
  apiFetch<ProjectDto>(`/projects/${enc(key)}`, { method: "PATCH", ...json(b) });
export const fetchProject = (key: string) =>
  apiFetch<ProjectOverview>(`/projects/${enc(key)}`);
export const archiveProject = (key: string, archived: boolean) =>
  apiFetch<ProjectDto>(`/projects/${enc(key)}/${archived ? "archive" : "unarchive"}`, {
    method: "POST",
  });
export const postStatusUpdate = (
  key: string,
  b: { status: ProjectStatus; note: string },
) =>
  apiFetch<StatusUpdate>(`/projects/${enc(key)}/status-updates`, {
    method: "POST",
    ...json(b),
  });
export const fetchActivity = (
  key: string,
  o: { actorType?: ActorType; page: number; pageSize: number },
) =>
  apiFetch<ActivityPage>(
    `/projects/${enc(key)}/activity${query({
      actorType: o.actorType,
      page: String(o.page),
      pageSize: String(o.pageSize),
    })}`,
  );
export const fetchSessions = (key: string, o: { page: number; pageSize: number }) =>
  apiFetch<SessionPage>(
    `/projects/${enc(key)}/sessions${query({
      page: String(o.page),
      pageSize: String(o.pageSize),
    })}`,
  );
export const fetchMilestones = (key: string) =>
  apiFetch<Milestone[]>(`/projects/${enc(key)}/milestones`);
export interface MilestoneInput {
  name?: string;
  description?: string;
  startDate?: string | null;
  dueDate?: string | null;
  state?: MilestoneState;
}
export const createMilestone = (key: string, b: MilestoneInput) =>
  apiFetch<Milestone>(`/projects/${enc(key)}/milestones`, { method: "POST", ...json(b) });
export const updateMilestone = (key: string, id: string, b: MilestoneInput) =>
  apiFetch<Milestone>(`/projects/${enc(key)}/milestones/${enc(id)}`, {
    method: "PATCH",
    ...json(b),
  });
export const fetchRoadmap = (key: string) =>
  apiFetch<Roadmap>(`/projects/${enc(key)}/roadmap`);
export const fetchBoard = (key: string, f: BoardFilters) =>
  apiFetch<Board>(
    `/projects/${enc(key)}/board${query({
      milestoneId: f.milestone,
      assigneeId: f.assignee,
      doneRange: f.doneAll ? "all" : undefined,
    })}`,
  );
export const reorderIssue = (
  key: string,
  issueKey: string,
  b: { position: number; statusId?: string },
) =>
  apiFetch<IssueDetail>(`/projects/${enc(key)}/issues/${enc(issueKey)}/reorder`, {
    method: "POST",
    ...json(b),
  });
export const fetchMyWork = () => apiFetch<MyWork>("/projects/my-work");
export const searchProjects = (q: string) =>
  apiFetch<SearchResult>(`/projects/search${query({ q })}`);
export const fetchRepoKit = (key: string) =>
  apiFetch<RepoKit>(`/projects/${enc(key)}/repo-kit`);
export const importChecklist = (
  key: string,
  b: { markdown: string; headingsAsMilestones: boolean; dryRun: boolean },
) =>
  apiFetch<ChecklistImportResult>(`/projects/${enc(key)}/import`, {
    method: "POST",
    ...json(b),
  });
export const fetchSecurity = (key: string) =>
  apiFetch<SecurityStatus>(`/projects/${enc(key)}/security`);
export const fetchAudits = (key: string) =>
  apiFetch<{ items: SecurityAudit[] }>(`/projects/${enc(key)}/audits`);
export const importAudit = (key: string, b: AuditImportBody) =>
  apiFetch<SecurityAudit>(`/projects/${enc(key)}/audits`, { method: "POST", ...json(b) });
export const fetchIssues = (key: string, params: Record<string, string>) =>
  apiFetch<IssueList>(`/projects/${enc(key)}/issues${query(params)}`);
export const quickAddIssue = (key: string, title: string) =>
  apiFetch<IssueDetail>(`/projects/${enc(key)}/issues/quick`, {
    method: "POST",
    ...json({ title }),
  });
export interface IssueInput {
  title?: string;
  description?: string;
  typeId?: string;
  statusId?: string;
  priority?: Priority;
  assigneeId?: string | null;
  milestoneId?: string | null;
  parentKey?: string | null;
  startDate?: string | null;
  dueDate?: string | null;
  labelIds?: string[];
}
export const createIssue = (key: string, b: IssueInput) =>
  apiFetch<IssueDetail>(`/projects/${enc(key)}/issues`, { method: "POST", ...json(b) });
export const fetchIssue = (key: string, issueKey: string) =>
  apiFetch<IssueDetail>(`/projects/${enc(key)}/issues/${enc(issueKey)}`);
export const updateIssue = (key: string, issueKey: string, b: IssueInput) =>
  apiFetch<IssueDetail>(`/projects/${enc(key)}/issues/${enc(issueKey)}`, {
    method: "PATCH",
    ...json(b),
  });
export const deleteIssue = (key: string, issueKey: string) =>
  apiFetch<{ deleted: true; key: string }>(
    `/projects/${enc(key)}/issues/${enc(issueKey)}`,
    {
      method: "DELETE",
    },
  );
export const fetchComments = (key: string, issueKey: string) =>
  apiFetch<IssueComment[]>(`/projects/${enc(key)}/issues/${enc(issueKey)}/comments`);
export const addComment = (key: string, issueKey: string, body: string) =>
  apiFetch<IssueComment>(`/projects/${enc(key)}/issues/${enc(issueKey)}/comments`, {
    method: "POST",
    ...json({ body }),
  });

export type AdminKind = "issue-types" | "issue-statuses" | "labels";
export const listAdmin = <T>(kind: AdminKind) => apiFetch<T[]>(`/projects/admin/${kind}`);
export const createAdmin = <T>(kind: AdminKind, b: Record<string, unknown>) =>
  apiFetch<T>(`/projects/admin/${kind}`, { method: "POST", ...json(b) });
export const updateAdmin = <T>(kind: AdminKind, id: string, b: Record<string, unknown>) =>
  apiFetch<T>(`/projects/admin/${kind}/${enc(id)}`, { method: "PATCH", ...json(b) });
export const deleteAdmin = (kind: AdminKind, id: string) =>
  apiFetch<{ deleted: true; id: string }>(`/projects/admin/${kind}/${enc(id)}`, {
    method: "DELETE",
  });

// --- the API's refusals, as sent ------------------------------------------------------------

/**
 * What to show for a failed call: a 400 "Validation failed" lists the message of each of its
 * errors; any other refusal is its one sentence. Never reworded.
 */
export function errorLines(e: unknown, fallback = "Something went wrong."): string[] {
  if (e instanceof ApiError) {
    const errs = (e.body as { errors?: unknown } | undefined)?.errors;
    if (Array.isArray(errs)) {
      const lines = errs
        .map((x) => (x as { message?: unknown } | null)?.message)
        .filter((m): m is string => typeof m === "string" && m !== "");
      if (lines.length > 0) return lines;
    }
    return [e.message];
  }
  return [fallback];
}

// --- dates, all in Asia/Manila ---------------------------------------------------------------

const MANILA = "Asia/Manila";

/** A calendar date (YYYY-MM-DD, as the API writes it) as people read it: "Nov 10, 2026". */
export function dayText(day: string | null | undefined): string {
  if (!day) return "";
  const d = new Date(`${day}T00:00:00+08:00`);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "2-digit",
    year: "numeric",
    timeZone: MANILA,
  });
}

/** A moment (ISO instant) as a Manila date and time: "Nov 10, 2026, 3:42 PM". */
export function momentText(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("en-US", {
    month: "short",
    day: "2-digit",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: MANILA,
  });
}

/** The Manila calendar day (YYYY-MM-DD) a moment falls on. */
export function manilaDay(iso: string): string {
  return new Date(iso).toLocaleDateString("en-CA", { timeZone: MANILA });
}

/** The time of day in Manila: "3:42 PM". */
export function manilaTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: MANILA,
  });
}

/** A day heading: "Tuesday, Nov 10, 2026". */
export function dayHeading(day: string): string {
  const d = new Date(`${day}T00:00:00+08:00`);
  return d.toLocaleDateString("en-US", {
    weekday: "long",
    month: "short",
    day: "2-digit",
    year: "numeric",
    timeZone: MANILA,
  });
}

// --- activity: grouped by Manila day, each change in plain words ---------------------------------

export interface DayGroup<T> {
  day: string;
  label: string;
  items: T[];
}

/** Entries (newest first, as the API gives them) gathered under their Manila day, in order. */
export function groupByManilaDay<T extends { createdAt: string }>(
  items: T[],
): DayGroup<T>[] {
  const groups: DayGroup<T>[] = [];
  for (const it of items) {
    const day = manilaDay(it.createdAt);
    const last = groups[groups.length - 1];
    if (last && last.day === day) last.items.push(it);
    else groups.push({ day, label: dayHeading(day), items: [it] });
  }
  return groups;
}

export const ACTOR_FILTERS: { value: ActorType | ""; label: string }[] = [
  { value: "", label: "Everyone" },
  { value: "USER", label: "People" },
  { value: "CLAUDE", label: "Claude" },
  { value: "GITHUB", label: "GitHub" },
  { value: "SYSTEM", label: "System" },
];

/** Who acted: a person's name, or Claude, GitHub or System. */
export function actorName(a: Pick<ActivityItem, "actorType" | "actor">): string {
  if (a.actorType === "CLAUDE") return "Claude";
  if (a.actorType === "GITHUB") return "GitHub";
  if (a.actorType === "SYSTEM") return "System";
  return a.actor?.fullName ?? "Someone";
}

/** What the entry did, in a few words. */
export function activityHeadline(a: Pick<ActivityItem, "action" | "issueKey">): string {
  const k = a.issueKey ?? "an issue";
  switch (a.action) {
    case "issue.created":
      return `created ${k}`;
    case "issue.updated":
      return `updated ${k}`;
    case "issue.deleted":
      return `deleted ${k}`;
    case "comment.added":
      return `commented on ${k}`;
    case "milestone.created":
      return "created a milestone";
    case "milestone.updated":
      return "updated a milestone";
    case "project.created":
      return "created the project";
    case "project.updated":
      return "updated the project";
    case "project.archived":
      return "archived the project";
    case "project.unarchived":
      return "brought the project back from the archive";
    case "project.status":
      return "posted a status update";
    default:
      return a.action;
  }
}

const FIELD_LABEL: Record<string, string> = {
  key: "Key",
  name: "Name",
  title: "Title",
  description: "Description",
  type: "Type",
  status: "Status",
  priority: "Priority",
  assignee: "Assignee",
  milestone: "Milestone",
  parent: "Parent",
  client: "Client",
  startDate: "Start date",
  dueDate: "Due date",
  labels: "Labels",
  state: "State",
  note: "Note",
  comment: "Comment",
};

const isDay = (v: unknown): v is string =>
  typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);

/** A value as it reads in a sentence: dates and priorities as words, nothing as "nothing". */
function valueText(field: string, v: unknown, action: string): string {
  if (v === null || v === undefined || v === "") return "";
  if (isDay(v)) return dayText(v);
  const s = String(v);
  if (field === "priority") return priorityLabel(s);
  if (field === "state") return milestoneStateLabel(s);
  if (field === "status" && action === "project.status") return projectStatusLabel(s);
  return s;
}

/**
 * One change as a sentence: "Status changed from New to In progress.", "Assignee set to Ana.",
 * "Due date cleared (was Nov 10, 2026)." The fields that only repeat the headline return null.
 */
export function describeChange(c: Change, action: string): string | null {
  if (c.field === "archived" || c.field === "deleted") return null;
  const label = FIELD_LABEL[c.field] ?? c.field;
  // A text that was rewritten: the API says so with placeholders, not with the text.
  if (c.field === "description") return "Description changed.";
  const was = valueText(c.field, c.old, action);
  const now = valueText(c.field, c.new, action);
  if (c.field === "comment" || c.field === "note") return `${label}: ${now}`;
  if (!was && !now) return null;
  if (!was) return `${label} set to ${now}.`;
  if (!now) return `${label} cleared (was ${was}).`;
  return `${label} changed from ${was} to ${now}.`;
}

// --- the issue list: filters and views kept in the address -------------------------------------

export const ISSUE_VIEWS = ["open", "mine", "bugs", "overdue", "closed", "all"] as const;
export type IssueView = (typeof ISSUE_VIEWS)[number];
export const ISSUE_VIEW_LABEL: Record<IssueView, string> = {
  open: "Open",
  mine: "Assigned to me",
  bugs: "Open bugs",
  overdue: "Overdue",
  closed: "Closed",
  all: "All",
};
export const ISSUE_SORTS = ["updated", "priority", "due", "created", "key"] as const;
export type IssueSort = (typeof ISSUE_SORTS)[number];
export const ISSUE_SORT_LABEL: Record<IssueSort, string> = {
  updated: "Recently updated",
  priority: "Priority",
  due: "Due date",
  created: "Newest",
  key: "Key",
};
export const ISSUE_STATES = ["", "open", "closed", "all"] as const;
export type IssueState = (typeof ISSUE_STATES)[number];

export interface IssueFilters {
  view: IssueView;
  q: string;
  /** "" lets the view decide (Open shows open issues, Closed shows closed ones, and so on). */
  state: IssueState;
  statusId: string;
  typeId: string;
  /** "", "none" (unassigned), "me", or a user id. */
  assigneeId: string;
  /** "", "none", or a milestone id. */
  milestoneId: string;
  labelId: string;
  priority: "" | Priority;
  sort: IssueSort;
}

export const DEFAULT_FILTERS: IssueFilters = {
  view: "open",
  q: "",
  state: "",
  statusId: "",
  typeId: "",
  assigneeId: "",
  milestoneId: "",
  labelId: "",
  priority: "",
  sort: "updated",
};

const oneOf = <T extends string>(list: readonly T[], v: string | null, dflt: T): T =>
  v !== null && (list as readonly string[]).includes(v) ? (v as T) : dflt;

/** The filters an address holds; anything unknown falls back to the default. */
export function parseFilters(sp: URLSearchParams): IssueFilters {
  return {
    view: oneOf(ISSUE_VIEWS, sp.get("view"), DEFAULT_FILTERS.view),
    q: sp.get("q") ?? "",
    state: oneOf(ISSUE_STATES, sp.get("state"), ""),
    statusId: sp.get("status") ?? "",
    typeId: sp.get("type") ?? "",
    assigneeId: sp.get("assignee") ?? "",
    milestoneId: sp.get("milestone") ?? "",
    labelId: sp.get("label") ?? "",
    priority: oneOf(["", ...PRIORITIES] as const, sp.get("priority"), ""),
    sort: oneOf(ISSUE_SORTS, sp.get("sort"), DEFAULT_FILTERS.sort),
  };
}

/** The address parameters for filters: only what is not the default. */
export function filtersToSearch(
  f: IssueFilters,
  keep?: URLSearchParams,
): URLSearchParams {
  const sp = new URLSearchParams();
  const set = (k: string, v: string, dflt = "") => {
    if (v !== dflt) sp.set(k, v);
  };
  set("view", f.view, DEFAULT_FILTERS.view);
  set("q", f.q);
  set("state", f.state);
  set("status", f.statusId);
  set("type", f.typeId);
  set("assignee", f.assigneeId);
  set("milestone", f.milestoneId);
  set("label", f.labelId);
  set("priority", f.priority);
  set("sort", f.sort, DEFAULT_FILTERS.sort);
  const issue = keep?.get("issue");
  if (issue) sp.set("issue", issue);
  return sp;
}

/** The API's query for filters: the view and every filter that is set. */
export function filtersToQuery(f: IssueFilters): Record<string, string> {
  const q: Record<string, string> = { view: f.view, sort: f.sort, limit: "200" };
  if (f.q.trim()) q.q = f.q.trim();
  if (f.state) q.state = f.state;
  if (f.statusId) q.statusId = f.statusId;
  if (f.typeId) q.typeId = f.typeId;
  if (f.assigneeId) q.assigneeId = f.assigneeId;
  if (f.milestoneId) q.milestoneId = f.milestoneId;
  if (f.labelId) q.labelId = f.labelId;
  if (f.priority) q.priority = f.priority;
  return q;
}

/** A view tab: the view changes and the "open, closed or all" choice goes back to the view's own. */
export const withView = (f: IssueFilters, view: IssueView): IssueFilters => ({
  ...f,
  view,
  state: "",
});

/** True when anything beyond the view and the sort narrows the list. */
export function hasNarrowing(f: IssueFilters): boolean {
  return (
    f.q.trim() !== "" ||
    f.state !== "" ||
    f.statusId !== "" ||
    f.typeId !== "" ||
    f.assigneeId !== "" ||
    f.milestoneId !== "" ||
    f.labelId !== "" ||
    f.priority !== ""
  );
}

// --- permissions: what a screen shows ------------------------------------------------------------

export interface ProjectsCan {
  read: boolean;
  create: boolean;
  update: boolean;
  configure: boolean;
}
/** The four Projects permissions of a signed-in firm user. Client users hold none of them. */
export function projectsCan(
  user: { userType?: string } | null | undefined,
  has: (p: string) => boolean,
): ProjectsCan {
  const firm = user?.userType === "FIRM";
  return {
    read: firm && has("Projects:Read"),
    create: firm && has("Projects:Create"),
    update: firm && has("Projects:Update"),
    configure: firm && has("Projects:Configure"),
  };
}

// --- addresses ---------------------------------------------------------------------------------

export const projectPath = (key: string, tab = ""): string =>
  `/projects/${encodeURIComponent(key)}${tab ? `/${tab}` : ""}`;
export const issuePath = (projectKey: string, issueKey: string): string =>
  `/projects/${encodeURIComponent(projectKey)}/issues/${encodeURIComponent(issueKey)}`;
/** The project an issue key belongs to (PAY-12 is in PAY). */
export const projectKeyOf = (issueKey: string): string => issueKey.split("-")[0] ?? "";

// --- PB4: small helpers for GitHub links, security and sentences with issue keys -----------------

/** A link's address is followed only when it is a web address (it came from a webhook). */
export function safeWebUrl(url: string): string | null {
  try {
    const u = new URL(url);
    return u.protocol === "https:" || u.protocol === "http:" ? u.href : null;
  } catch {
    return null;
  }
}

/** "Merged", "Open", "Closed" or "Pushed" for a pull request or commit link. */
export function githubStateLabel(l: Pick<GithubLink, "state" | "merged">): string {
  if (l.merged) return "Merged";
  const s = l.state.trim().toLowerCase();
  if (s === "open") return "Open";
  if (s === "closed") return "Closed";
  if (s === "pushed") return "Pushed";
  return l.state;
}

/** The reference a link shows: owner/repo#12 for a pull request, owner/repo@abc1234 for a commit. */
export function githubRef(
  l: Pick<GithubLink, "kind" | "repo" | "number" | "sha">,
): string {
  if (l.kind === "pr") return l.number !== null ? `${l.repo}#${l.number}` : l.repo;
  return l.sha ? `${l.repo}@${l.sha.slice(0, 7)}` : l.repo;
}

/** What the badge says: "Clear", "3 open", or "Blocked: 1 critical, 2 high". */
export function securityText(b: SecurityBadge): string {
  if (b.state === "clear") return "Clear";
  if (b.state === "open") return `${b.open} open`;
  const parts = [
    b.critical > 0 ? `${b.critical} critical` : "",
    b.high > 0 ? `${b.high} high` : "",
  ].filter(Boolean);
  return `Blocked: ${parts.join(", ")}`;
}

/** A sentence cut into text and the issue keys in it (PAY-3), so the keys can be links. */
export function splitIssueKeys(sentence: string): Array<{ text: string; key: boolean }> {
  const out: Array<{ text: string; key: boolean }> = [];
  const re = /\b[A-Z][A-Z0-9]{1,9}-\d{1,7}\b/g;
  let at = 0;
  for (const m of sentence.matchAll(re)) {
    if (m.index! > at) out.push({ text: sentence.slice(at, m.index), key: false });
    out.push({ text: m[0], key: true });
    at = m.index! + m[0].length;
  }
  if (at < sentence.length) out.push({ text: sentence.slice(at), key: false });
  return out;
}

/** The text of a file the person chose. */
export function readFileText(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result ?? ""));
    r.onerror = () => reject(r.error);
    r.readAsText(file);
  });
}

// --- PB5: sessions ---------------------------------------------------------------------------------

/** Who ran a session: the person, or Claude when no person is known. */
export const sessionWho = (s: Pick<ClaudeSession, "user">): string =>
  s.user ? s.user.fullName : "Claude";
/** A session's title, or the word Session when it has none. */
export const sessionTitle = (s: { title: string }): string => s.title.trim() || "Session";
/** The Sessions tab of a project, optionally at one session. */
export const sessionPath = (projectKey: string, sessionId?: string): string =>
  `/projects/${encodeURIComponent(projectKey)}/sessions${
    sessionId ? `?session=${encodeURIComponent(sessionId)}` : ""
  }`;
