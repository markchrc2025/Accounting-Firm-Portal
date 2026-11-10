// sentire-import.ts: turns an export of the owner's Sentire Projects database into a plain,
// versioned import plan that the Portal's Projects services can apply in order, and checks a plan.
//
// Pure: JSON in, JSON out. The source tables are those of Sentire Projects' src/db/schema.ts. Sentire
// Projects has no export of its own, so the input format is defined here (see SentireExport).
//
// In the plan every reference is by KEY or NAME (project key, issue key, status name, person's
// e-mail), never by a Sentire id. The only exception is `ref` on a work session, a label made up
// for this plan because a session has no natural key.

export const IMPORT_PLAN_FORMAT = "portal-projects-import-plan";
export const IMPORT_PLAN_VERSION = 1;

/**
 * The order the Portal applies a plan in. Each step only refers to steps before it.
 * Issues are already sorted so a parent comes before its children.
 */
export const IMPORT_APPLY_ORDER = [
  "projects",
  "issueTypes",
  "statuses",
  "labels",
  "milestones",
  "issues",
  "comments",
  "statusUpdates",
  "sessions",
  "activities",
  "githubLinks",
  "securityAudits",
] as const;

// ---------------------------------------------------------------------------------------------
// The input

/**
 * What the mapper reads: the tables of Sentire Projects as arrays of rows, either at the top level
 * or under `tables`. Table names may be camelCase (`statusUpdates`) or the SQL names
 * (`status_updates`); column names may be Drizzle's (`projectId`) or SQL's (`project_id`); dates
 * may be ISO strings or Date objects. Tables: `organizations`, `users`, `projects`,
 * `statusUpdates`, `milestones`, `issueTypes`, `statuses`, `issues`, `labels`, `issueLabels`,
 * `comments`, `activities`, `workSessions`, `githubLinks`, `securityAudits`.
 * `notifications`, `apiTokens` and `sessions` (logins) are ignored and never read.
 * For `users` only `id`, `name` and `email` are read; leave the rest out of the export.
 */
export type SentireExport = Record<string, unknown>;

export class SentireExportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SentireExportError";
  }
}

// ---------------------------------------------------------------------------------------------
// The plan

export type PlanProjectStatus =
  "NOT_STARTED" | "ON_TRACK" | "AT_RISK" | "OFF_TRACK" | "ON_HOLD" | "FINISHED";
export type PlanActorType = "USER" | "CLAUDE" | "GITHUB" | "SYSTEM";
export type PlanChannel = "web" | "api" | "mcp" | "github" | "system";

export interface PlanPerson {
  /** Lower case. People are matched to Portal users by e-mail. */
  email: string;
  name: string;
}
export interface PlanProject {
  key: string;
  name: string;
  description: string;
  /** The current status; the status updates below carry the history. */
  status: PlanProjectStatus;
  statusNote: string;
  repoUrl: string;
  liveUrl: string;
  /** Sentire Projects' `dokployApp`. */
  deployAppName: string;
  parentKey: string | null;
  archived: boolean;
  /** At least the highest issue number of the project. */
  issueCounter: number;
  createdAt: string | null;
  updatedAt: string | null;
}
export interface PlanIssueType {
  name: string;
  colour: string;
  order: number;
}
export interface PlanIssueStatus {
  name: string;
  colour: string;
  order: number;
  category: "TODO" | "IN_PROGRESS" | "DONE";
  isDefault: boolean;
}
export interface PlanLabel {
  name: string;
  colour: string;
}
export interface PlanMilestone {
  projectKey: string;
  name: string;
  description: string;
  startDate: string | null;
  dueDate: string | null;
  state: "OPEN" | "LOCKED" | "CLOSED";
  createdAt: string | null;
  closedAt: string | null;
}
export interface PlanIssue {
  key: string;
  projectKey: string;
  number: number;
  /** Issue type name. */
  type: string;
  /** Issue status name. */
  status: string;
  priority: "LOW" | "NORMAL" | "HIGH" | "URGENT";
  title: string;
  description: string;
  assigneeEmail: string | null;
  authorEmail: string | null;
  /** Name of a milestone of the same project. */
  milestone: string | null;
  parentKey: string | null;
  startDate: string | null;
  dueDate: string | null;
  position: number;
  labels: string[];
  /** The security-audit finding id, if the issue came from an audit. */
  fingerprint: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  closedAt: string | null;
  deletedAt: string | null;
}
export interface PlanComment {
  issueKey: string;
  authorEmail: string | null;
  actorType: PlanActorType;
  sessionRef: string | null;
  body: string;
  createdAt: string | null;
  /** The time of the last edit, or null if it was never edited. */
  editedAt: string | null;
}
export interface PlanStatusUpdate {
  projectKey: string;
  status: PlanProjectStatus;
  note: string;
  actorType: PlanActorType;
  actorEmail: string | null;
  createdAt: string | null;
}
export interface PlanSession {
  /** Made up for this plan, `<projectKey>#<n>` in start order; not a Sentire id. */
  ref: string;
  projectKey: string | null;
  userEmail: string | null;
  client: string;
  title: string;
  summary: string;
  nextSteps: string;
  /** Issue keys. */
  issuesTouched: string[];
  startedAt: string | null;
  endedAt: string | null;
}
export interface PlanActivity {
  projectKey: string;
  issueKey: string | null;
  action: string;
  actorType: PlanActorType;
  actorEmail: string | null;
  /** Sentire Projects' `client` text (claude-code, claude.ai, github, rest ...). */
  client: string | null;
  /** The Portal's channel, worked out from the actor type. */
  channel: PlanChannel;
  sessionRef: string | null;
  summary: string;
  /** The Portal's shape: a list of { field, old, new }. */
  changes: { field: string; old: unknown; new: unknown }[];
  createdAt: string | null;
}
export interface PlanGithubLink {
  issueKey: string;
  kind: "pr" | "commit";
  repo: string;
  number: number | null;
  sha: string | null;
  url: string;
  title: string;
  state: string;
  merged: boolean;
  updatedAt: string | null;
}
export interface PlanSecurityAudit {
  projectKey: string;
  runId: string;
  sourceRef: string;
  profile: string;
  /** Paths the run was limited to; empty for the whole repository. */
  scope: string[];
  runStatus: string;
  incompleteReason: string;
  coverage: Record<string, number>;
  counts: Record<string, number>;
  issueKeys: string[];
  rejected: { fingerprint: string; title: string; reason: string }[];
  report: string;
  importedByEmail: string | null;
  actorType: PlanActorType;
  createdAt: string | null;
}

export interface UnmappedField {
  /** Sentire Projects table, or table.column. */
  field: string;
  reason: string;
}

export interface ImportPlan {
  format: typeof IMPORT_PLAN_FORMAT;
  version: typeof IMPORT_PLAN_VERSION;
  source: "sentire-projects";
  applyOrder: readonly string[];
  /** Row counts of the plan, by section. */
  counts: Record<string, number>;
  people: PlanPerson[];
  projects: PlanProject[];
  issueTypes: PlanIssueType[];
  statuses: PlanIssueStatus[];
  labels: PlanLabel[];
  milestones: PlanMilestone[];
  issues: PlanIssue[];
  comments: PlanComment[];
  statusUpdates: PlanStatusUpdate[];
  sessions: PlanSession[];
  activities: PlanActivity[];
  githubLinks: PlanGithubLink[];
  securityAudits: PlanSecurityAudit[];
  /** Plain sentences about rows that were left out or changed because of what the export held. */
  warnings: string[];
  /** The Sentire Projects fields the Portal has no place for today. The same list for every plan. */
  unmapped: UnmappedField[];
}

/**
 * What cannot be carried over, and why. "Portal has no ... yet" means the Portal's PA1 tables have
 * no column or table for it; the plan still carries the value where it is cheap, so a later phase
 * can add the column and run the import again.
 */
export const UNMAPPED_SENTIRE_FIELDS: readonly UnmappedField[] = [
  {
    field: "organizations",
    reason:
      "The import goes into the firm that runs it; the Sentire Projects organisation and its name are not used.",
  },
  {
    field: "users.passwordHash",
    reason:
      "A secret. It is never read, and a plan holding one is refused by the validator. People sign in to the Portal with their own accounts.",
  },
  {
    field: "users.role",
    reason:
      "Sentire Projects owner, member and viewer do not map to Portal roles; the owner grants Projects:Read, Create, Update and Configure in the role editor.",
  },
  {
    field: "users.createdAt, users.lastLoginAt, users.disabledAt",
    reason: "Portal users are separate accounts. People are matched by e-mail only.",
  },
  {
    field: "users.id",
    reason: "An internal id. Every reference in the plan is by e-mail.",
  },
  {
    field: "sessions",
    reason:
      "Login sessions of the Sentire Projects web app; temporary and tied to its cookies.",
  },
  {
    field: "apiTokens",
    reason:
      "Token hashes are secrets and Sentire Projects tokens do not work on the Portal. Issue new personal tokens in the Portal.",
  },
  {
    field: "notifications",
    reason:
      "A per-user inbox of short-lived messages. The Portal has no notifications table yet.",
  },
  {
    field: "projects.archivedAt",
    reason: "The Portal keeps an archived flag only; the time of archiving is lost.",
  },
  {
    field: "issues.deletedAt",
    reason:
      "The Portal keeps a deleted flag only; the time of deleting is lost. Deleted issues are still imported, flagged, so their numbers stay used.",
  },
  {
    field: "issues.fingerprint",
    reason:
      "The Portal has no fingerprint column yet. The plan carries it, so the security-audit phase can match re-imports to these issues.",
  },
  {
    field: "milestones.closedAt",
    reason: "The Portal's milestone has a state but no closing time.",
  },
  {
    field: "comments.actorKind, comments.sessionId",
    reason:
      "The Portal's comment table has no actor type or session yet. The plan carries both.",
  },
  {
    field: "activities.client",
    reason:
      "The Portal records a channel (web, api, mcp, github, system), worked out from the actor type here. The plan carries the original client text.",
  },
  {
    field: "activities (no project)",
    reason: "The Portal's activity log needs a project; rows with none are left out.",
  },
  {
    field: "workSessions",
    reason:
      "The Portal has no work-session table yet. The plan carries every session for the later phase that adds it.",
  },
  {
    field: "githubLinks",
    reason: "The Portal has no GitHub link table yet. The plan carries every link.",
  },
  {
    field: "securityAudits",
    reason: "The Portal has no audit table yet. The plan carries every audit record.",
  },
  {
    field: "projects.status, projects.statusNote",
    reason:
      "The Portal takes a project's current status from its latest status update. A status update is added to the plan when the history does not already end with the current status.",
  },
];

// ---------------------------------------------------------------------------------------------
// Reading the export

type Row = Record<string, unknown>;

const isObj = (v: unknown): v is Row => !!v && typeof v === "object" && !Array.isArray(v);
const camel = (k: string) => k.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());
const str = (v: unknown): string =>
  typeof v === "string" ? v : v == null ? "" : String(v);
const strOrNull = (v: unknown): string | null =>
  typeof v === "string" && v !== "" ? v : null;
const int = (v: unknown, fallback = 0): number => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
};
const real = (v: unknown, fallback = 0): number => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : fallback;
};
const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

function normalise(row: Row): Row {
  return Object.fromEntries(Object.entries(row).map(([k, v]) => [camel(k), v]));
}

/** A timestamp as ISO text, null when empty; text that is not a date is kept as it was, for the validator. */
function stamp(v: unknown): string | null {
  if (v == null || v === "") return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? String(v) : v.toISOString();
  if (typeof v !== "string") return String(v);
  const t = Date.parse(v);
  return Number.isNaN(t) ? v : new Date(t).toISOString();
}

/** A calendar date as YYYY-MM-DD, null when empty; text that is not a date is kept as it was. */
function day(v: unknown): string | null {
  if (v == null || v === "") return null;
  if (v instanceof Date)
    return Number.isNaN(v.getTime()) ? String(v) : v.toISOString().slice(0, 10);
  const s = String(v);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const t = Date.parse(s);
  return Number.isNaN(t) ? s : new Date(t).toISOString().slice(0, 10);
}

const byTime = (a: string | null, b: string | null) => (a ?? "").localeCompare(b ?? "");

class Notes {
  private readonly counts = new Map<string, { n: number; examples: string[] }>();
  add(category: string, example?: string): void {
    const c = this.counts.get(category) ?? { n: 0, examples: [] };
    c.n++;
    if (example && c.examples.length < 5 && !c.examples.includes(example))
      c.examples.push(example);
    this.counts.set(category, c);
  }
  sentences(messages: Record<string, (n: number, examples: string) => string>): string[] {
    return Object.keys(messages)
      .filter((k) => this.counts.has(k))
      .map((k) => {
        const c = this.counts.get(k)!;
        return messages[k]!(c.n, c.examples.length ? ` (${c.examples.join(", ")})` : "");
      });
  }
}

const PROJECT_STATUS = new Set([
  "NOT_STARTED",
  "ON_TRACK",
  "AT_RISK",
  "OFF_TRACK",
  "ON_HOLD",
  "FINISHED",
]);
const ACTORS = new Set(["USER", "CLAUDE", "GITHUB", "SYSTEM"]);

function actor(v: unknown): PlanActorType {
  const a = str(v).toUpperCase();
  return (ACTORS.has(a) ? a : "USER") as PlanActorType;
}
function channelFor(a: PlanActorType): PlanChannel {
  return a === "GITHUB"
    ? "github"
    : a === "SYSTEM"
      ? "system"
      : a === "CLAUDE"
        ? "mcp"
        : "web";
}

const WARNINGS: Record<string, (n: number, ex: string) => string> = {
  "no-table": (n, ex) =>
    `${n} expected ${plural(n, "table is", "tables are")} missing from the export${ex}; ${plural(n, "it was", "they were")} read as empty.`,
  "person-missing": (n) =>
    `${n} ${plural(n, "reference points", "references point")} to a user that is not in the export; ${plural(n, "it was", "they were")} left empty.`,
  "milestone-no-project": (n, ex) =>
    `${n} ${plural(n, "milestone belongs", "milestones belong")} to a project that is not in the export and ${plural(n, "was", "were")} left out${ex}.`,
  "issue-no-project": (n, ex) =>
    `${n} ${plural(n, "issue belongs", "issues belong")} to a project that is not in the export and ${plural(n, "was", "were")} left out${ex}.`,
  "issue-no-type": (n, ex) =>
    `${n} ${plural(n, "issue has", "issues have")} a type that is not in the export and ${plural(n, "was", "were")} left out${ex}.`,
  "issue-no-status": (n, ex) =>
    `${n} ${plural(n, "issue has", "issues have")} a status that is not in the export and ${plural(n, "was", "were")} left out${ex}.`,
  "issue-no-milestone": (n, ex) =>
    `${n} ${plural(n, "issue has", "issues have")} a milestone that is not in the export; the milestone was left empty${ex}.`,
  "issue-no-parent": (n, ex) =>
    `${n} ${plural(n, "issue has", "issues have")} a parent that is not in the export; the parent link was left empty${ex}.`,
  "label-link-orphan": (n) =>
    `${n} label ${plural(n, "link points", "links point")} to an issue or label that is not in the export and ${plural(n, "was", "were")} left out.`,
  "comment-no-issue": (n) =>
    `${n} ${plural(n, "comment points", "comments point")} to an issue that is not in the export and ${plural(n, "was", "were")} left out.`,
  "status-update-no-project": (n) =>
    `${n} project status ${plural(n, "update belongs", "updates belong")} to a project that is not in the export and ${plural(n, "was", "were")} left out.`,
  "status-update-added": (n, ex) =>
    `${n} ${plural(n, "project's", "projects'")} current status was not at the end of ${plural(n, "its", "their")} status updates, so one update ${plural(n, "was", "were")} added, dated at the project's last change${ex}.`,
  "activity-no-project": (n) =>
    `${n} ${plural(n, "activity row belongs", "activity rows belong")} to no project, or one that is not in the export, and ${plural(n, "was", "were")} left out.`,
  "activity-no-issue": (n) =>
    `${n} ${plural(n, "activity row points", "activity rows point")} to an issue that is not in the export; the issue link was left empty.`,
  "session-no-project": (n) =>
    `${n} work ${plural(n, "session has", "sessions have")} no project in the export; ${plural(n, "its", "their")} project was left empty.`,
  "session-ref-missing": (n) =>
    `${n} ${plural(n, "row points", "rows point")} to a work session that is not in the export; the session link was left empty.`,
  "link-no-issue": (n) =>
    `${n} GitHub ${plural(n, "link points", "links point")} to an issue that is not in the export and ${plural(n, "was", "were")} left out.`,
  "audit-no-project": (n) =>
    `${n} security ${plural(n, "audit belongs", "audits belong")} to a project that is not in the export and ${plural(n, "was", "were")} left out.`,
  "ignored-table": (n, ex) =>
    `${plural(n, "This table was", "These tables were")} in the export and ignored on purpose${ex}.`,
};

/**
 * Turns an export of Sentire Projects into an import plan (see {@link ImportPlan}). Rows whose
 * parent is missing are left out or have the link emptied, and a sentence in `warnings` says
 * how many. Duplicate keys and numbers are NOT repaired: they stay in the plan for
 * {@link validateImportPlan} to report. Throws {@link SentireExportError} if the input is not
 * JSON or has no `projects` table.
 */
export function mapSentireExport(exportJson: unknown): ImportPlan {
  let root = exportJson;
  if (typeof root === "string") {
    try {
      root = JSON.parse(root);
    } catch {
      throw new SentireExportError("The export is not valid JSON.");
    }
  }
  if (!isObj(root))
    throw new SentireExportError(
      "The export must be a JSON object with one array of rows per table.",
    );
  const tables = isObj(root.tables) ? root.tables : root;
  const notes = new Notes();

  const table = (name: string, core = false): Row[] => {
    const snake = name.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
    const found = [name, snake].map((n) => tables[n]).find(Array.isArray) as
      unknown[] | undefined;
    if (!found) {
      if (core) notes.add("no-table", name);
      return [];
    }
    return found.filter(isObj).map(normalise);
  };

  if (!Array.isArray(tables.projects))
    throw new SentireExportError("The export has no projects table.");
  const users = table("users");
  const projects = table("projects");
  const statusUpdateRows = table("statusUpdates");
  const milestoneRows = table("milestones");
  const typeRows = table("issueTypes", true);
  const statusRows = table("statuses", true);
  const issueRows = table("issues", true);
  const labelRows = table("labels");
  const issueLabelRows = table("issueLabels");
  const commentRows = table("comments");
  const activityRows = table("activities");
  const sessionRows = table("workSessions");
  const linkRows = table("githubLinks");
  const auditRows = table("securityAudits");
  for (const name of ["notifications", "apiTokens", "sessions"]) {
    if (table(name).length) notes.add("ignored-table", name);
  }

  // Lookups by Sentire id, used only inside this function.
  const email = new Map<string, string>();
  const people: PlanPerson[] = [];
  for (const u of users) {
    const e = str(u.email).trim().toLowerCase();
    if (!e) continue;
    email.set(str(u.id), e);
    people.push({ email: e, name: str(u.name) });
  }
  const person = (id: unknown): string | null => {
    if (id == null || id === "") return null;
    const e = email.get(str(id));
    if (!e) notes.add("person-missing");
    return e ?? null;
  };

  const projectKey = new Map(projects.map((p) => [str(p.id), str(p.key)]));
  const typeName = new Map(typeRows.map((t) => [str(t.id), str(t.name)]));
  const statusName = new Map(statusRows.map((s) => [str(s.id), str(s.name)]));
  const labelName = new Map(labelRows.map((l) => [str(l.id), str(l.name)]));
  const issueKey = new Map(issueRows.map((i) => [str(i.id), str(i.key)]));
  const milestoneName = new Map(milestoneRows.map((m) => [str(m.id), str(m.name)]));

  // Sessions get refs first, because comments and activities refer to them.
  const sessionRef = new Map<string, string>();
  const perProject = new Map<string, number>();
  const sortedSessions = [...sessionRows].sort(
    (a, b) =>
      byTime(stamp(a.startedAt), stamp(b.startedAt)) ||
      str(a.id).localeCompare(str(b.id)),
  );
  for (const s of sortedSessions) {
    const pk = projectKey.get(str(s.projectId)) ?? "NONE";
    const n = (perProject.get(pk) ?? 0) + 1;
    perProject.set(pk, n);
    sessionRef.set(str(s.id), `${pk}#${n}`);
  }
  const ref = (id: unknown): string | null => {
    if (id == null || id === "") return null;
    const r = sessionRef.get(str(id));
    if (!r) notes.add("session-ref-missing");
    return r ?? null;
  };

  // Issue labels, by issue id.
  const labelsOf = new Map<string, string[]>();
  for (const l of issueLabelRows) {
    const n = labelName.get(str(l.labelId));
    if (!n || !issueKey.has(str(l.issueId))) {
      notes.add("label-link-orphan");
      continue;
    }
    const list = labelsOf.get(str(l.issueId)) ?? [];
    list.push(n);
    labelsOf.set(str(l.issueId), list);
  }

  // Issues.
  const maxNumber = new Map<string, number>();
  const planIssues: PlanIssue[] = [];
  for (const i of issueRows) {
    const pk = projectKey.get(str(i.projectId));
    const key = str(i.key);
    if (!pk) {
      notes.add("issue-no-project", key);
      continue;
    }
    const type = typeName.get(str(i.typeId));
    if (type === undefined) {
      notes.add("issue-no-type", key);
      continue;
    }
    const status = statusName.get(str(i.statusId));
    if (status === undefined) {
      notes.add("issue-no-status", key);
      continue;
    }
    let milestone: string | null = null;
    if (i.milestoneId != null && i.milestoneId !== "") {
      milestone = milestoneName.get(str(i.milestoneId)) ?? null;
      if (milestone === null) notes.add("issue-no-milestone", key);
    }
    let parentKey: string | null = null;
    if (i.parentId != null && i.parentId !== "") {
      parentKey = issueKey.get(str(i.parentId)) ?? null;
      if (parentKey === null) notes.add("issue-no-parent", key);
    }
    const number = int(i.number);
    maxNumber.set(pk, Math.max(maxNumber.get(pk) ?? 0, number));
    const deletedAt = stamp(i.deletedAt);
    planIssues.push({
      key,
      projectKey: pk,
      number,
      type,
      status,
      priority: str(i.priority).toUpperCase() as PlanIssue["priority"],
      title: str(i.title),
      description: str(i.description),
      assigneeEmail: person(i.assigneeId),
      authorEmail: person(i.authorId),
      milestone,
      parentKey,
      startDate: day(i.startDate),
      dueDate: day(i.dueDate),
      position: real(i.position),
      labels: [...(labelsOf.get(str(i.id)) ?? [])].sort((a, b) => a.localeCompare(b)),
      fingerprint: strOrNull(i.fingerprint),
      createdAt: stamp(i.createdAt),
      updatedAt: stamp(i.updatedAt),
      closedAt: stamp(i.closedAt),
      deletedAt,
    });
  }
  const issues = parentsFirst(planIssues);

  // Projects, with their status history.
  const updatesByProject = new Map<string, PlanStatusUpdate[]>();
  const statusUpdates: PlanStatusUpdate[] = [];
  for (const u of statusUpdateRows) {
    const pk = projectKey.get(str(u.projectId));
    if (!pk) {
      notes.add("status-update-no-project");
      continue;
    }
    const s = str(u.status).toUpperCase();
    const row: PlanStatusUpdate = {
      projectKey: pk,
      status: s as PlanProjectStatus,
      note: str(u.note),
      actorType: actor(u.actorKind),
      actorEmail: person(u.authorId),
      createdAt: stamp(u.createdAt),
    };
    statusUpdates.push(row);
    updatesByProject.set(pk, [...(updatesByProject.get(pk) ?? []), row]);
  }
  const planProjects: PlanProject[] = projects.map((p) => {
    const key = str(p.key);
    const status = (str(p.status).toUpperCase() || "NOT_STARTED") as PlanProjectStatus;
    const note = str(p.statusNote);
    const list = (updatesByProject.get(key) ?? []).sort((a, b) =>
      byTime(a.createdAt, b.createdAt),
    );
    const latest = list[list.length - 1];
    if (latest ? latest.status !== status : status !== "NOT_STARTED" || note !== "") {
      const added: PlanStatusUpdate = {
        projectKey: key,
        status,
        note,
        actorType: "SYSTEM",
        actorEmail: null,
        createdAt: stamp(p.updatedAt) ?? stamp(p.createdAt),
      };
      statusUpdates.push(added);
      notes.add("status-update-added", key);
    }
    return {
      key,
      name: str(p.name),
      description: str(p.description),
      status,
      statusNote: note,
      repoUrl: str(p.repoUrl),
      liveUrl: str(p.liveUrl),
      deployAppName: str(p.dokployApp),
      parentKey:
        p.parentId == null || p.parentId === ""
          ? null
          : (projectKey.get(str(p.parentId)) ?? null),
      archived: p.archivedAt != null && p.archivedAt !== "",
      issueCounter: Math.max(int(p.issueCounter), maxNumber.get(key) ?? 0),
      createdAt: stamp(p.createdAt),
      updatedAt: stamp(p.updatedAt),
    };
  });
  planProjects.sort((a, b) => a.key.localeCompare(b.key));
  statusUpdates.sort(
    (a, b) =>
      a.projectKey.localeCompare(b.projectKey) || byTime(a.createdAt, b.createdAt),
  );

  // Types, statuses, labels.
  const issueTypes: PlanIssueType[] = typeRows
    .map((t) => ({ name: str(t.name), colour: str(t.color), order: int(t.position) }))
    .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
  const statuses: PlanIssueStatus[] = statusRows
    .map((s) => ({
      name: str(s.name),
      colour: str(s.color),
      order: int(s.position),
      category: str(s.category).toUpperCase() as PlanIssueStatus["category"],
      isDefault: s.isDefault === true,
    }))
    .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
  const labels: PlanLabel[] = labelRows
    .map((l) => ({ name: str(l.name), colour: str(l.color) }))
    .sort((a, b) => a.name.localeCompare(b.name));

  // Milestones.
  const milestones: PlanMilestone[] = [];
  for (const m of milestoneRows) {
    const pk = projectKey.get(str(m.projectId));
    if (!pk) {
      notes.add("milestone-no-project", str(m.name));
      continue;
    }
    milestones.push({
      projectKey: pk,
      name: str(m.name),
      description: str(m.description),
      startDate: day(m.startDate),
      dueDate: day(m.dueDate),
      state: (str(m.state).toUpperCase() || "OPEN") as PlanMilestone["state"],
      createdAt: stamp(m.createdAt),
      closedAt: stamp(m.closedAt),
    });
  }
  milestones.sort(
    (a, b) =>
      a.projectKey.localeCompare(b.projectKey) ||
      byTime(a.createdAt, b.createdAt) ||
      a.name.localeCompare(b.name),
  );

  // Comments.
  const comments: PlanComment[] = [];
  for (const c of commentRows) {
    const key = issueKey.get(str(c.issueId));
    if (!key) {
      notes.add("comment-no-issue");
      continue;
    }
    comments.push({
      issueKey: key,
      authorEmail: person(c.authorId),
      actorType: actor(c.actorKind),
      sessionRef: ref(c.sessionId),
      body: str(c.body),
      createdAt: stamp(c.createdAt),
      editedAt: stamp(c.editedAt),
    });
  }
  comments.sort(
    (a, b) =>
      a.issueKey.localeCompare(b.issueKey, undefined, { numeric: true }) ||
      byTime(a.createdAt, b.createdAt),
  );

  // Work sessions.
  const sessions: PlanSession[] = sortedSessions.map((s) => {
    const pk = projectKey.get(str(s.projectId)) ?? null;
    if (!pk) notes.add("session-no-project");
    return {
      ref: sessionRef.get(str(s.id))!,
      projectKey: pk,
      userEmail: person(s.userId),
      client: str(s.client),
      title: str(s.title),
      summary: str(s.summary),
      nextSteps: str(s.nextSteps),
      issuesTouched: Array.isArray(s.issuesTouched) ? s.issuesTouched.map(String) : [],
      startedAt: stamp(s.startedAt),
      endedAt: stamp(s.endedAt),
    };
  });

  // Activity.
  const activities: PlanActivity[] = [];
  for (const a of activityRows) {
    const pk = projectKey.get(str(a.projectId));
    if (!pk) {
      notes.add("activity-no-project");
      continue;
    }
    let ik: string | null = null;
    if (a.issueId != null && a.issueId !== "") {
      ik = issueKey.get(str(a.issueId)) ?? null;
      if (!ik) notes.add("activity-no-issue");
    }
    const who = actor(a.actorKind);
    const changes = isObj(a.changes)
      ? Object.entries(a.changes).map(([field, pair]) => ({
          field,
          old: Array.isArray(pair) ? (pair[0] ?? null) : null,
          new: Array.isArray(pair) ? (pair[1] ?? null) : null,
        }))
      : [];
    activities.push({
      projectKey: pk,
      issueKey: ik,
      action: str(a.action),
      actorType: who,
      actorEmail: person(a.actorId),
      client: strOrNull(a.client),
      channel: channelFor(who),
      sessionRef: ref(a.sessionId),
      summary: str(a.summary),
      changes,
      createdAt: stamp(a.createdAt),
    });
  }
  activities.sort((a, b) => byTime(a.createdAt, b.createdAt));

  // GitHub links.
  const githubLinks: PlanGithubLink[] = [];
  for (const l of linkRows) {
    const key = issueKey.get(str(l.issueId));
    if (!key) {
      notes.add("link-no-issue");
      continue;
    }
    githubLinks.push({
      issueKey: key,
      kind: str(l.kind) as PlanGithubLink["kind"],
      repo: str(l.repo),
      number: l.number == null ? null : int(l.number),
      sha: strOrNull(l.sha),
      url: str(l.url),
      title: str(l.title),
      state: str(l.state),
      merged: l.merged === true,
      updatedAt: stamp(l.updatedAt),
    });
  }
  githubLinks.sort(
    (a, b) =>
      a.issueKey.localeCompare(b.issueKey, undefined, { numeric: true }) ||
      a.url.localeCompare(b.url),
  );

  // Security audits.
  const securityAudits: PlanSecurityAudit[] = [];
  for (const a of auditRows) {
    const pk = projectKey.get(str(a.projectId));
    if (!pk) {
      notes.add("audit-no-project");
      continue;
    }
    securityAudits.push({
      projectKey: pk,
      runId: str(a.runId),
      sourceRef: str(a.sourceRef),
      profile: str(a.profile),
      scope: str(a.scope)
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
      runStatus: str(a.runStatus),
      incompleteReason: str(a.incompleteReason),
      coverage: numbers(a.coverage),
      counts: numbers(a.counts),
      issueKeys: Array.isArray(a.issueKeys) ? a.issueKeys.map(String) : [],
      rejected: Array.isArray(a.rejected)
        ? a.rejected.filter(isObj).map((r) => ({
            fingerprint: str(r.fingerprint),
            title: str(r.title),
            reason: str(r.reason),
          }))
        : [],
      report: str(a.report),
      importedByEmail: person(a.importedBy),
      actorType: actor(a.actorKind),
      createdAt: stamp(a.createdAt),
    });
  }
  securityAudits.sort(
    (a, b) =>
      a.projectKey.localeCompare(b.projectKey) || byTime(a.createdAt, b.createdAt),
  );

  const plan: ImportPlan = {
    format: IMPORT_PLAN_FORMAT,
    version: IMPORT_PLAN_VERSION,
    source: "sentire-projects",
    applyOrder: IMPORT_APPLY_ORDER,
    counts: {},
    people: people.sort((a, b) => a.email.localeCompare(b.email)),
    projects: planProjects,
    issueTypes,
    statuses,
    labels,
    milestones,
    issues,
    comments,
    statusUpdates,
    sessions,
    activities,
    githubLinks,
    securityAudits,
    warnings: notes.sentences(WARNINGS),
    unmapped: UNMAPPED_SENTIRE_FIELDS.map((u) => ({ ...u })),
  };
  plan.counts = Object.fromEntries(
    [
      "people",
      "projects",
      "issueTypes",
      "statuses",
      "labels",
      "milestones",
      "issues",
      "comments",
      "statusUpdates",
      "sessions",
      "activities",
      "githubLinks",
      "securityAudits",
    ].map((k) => [k, (plan[k as keyof ImportPlan] as unknown[]).length]),
  );
  return plan;
}

function numbers(v: unknown): Record<string, number> {
  if (!isObj(v)) return {};
  return Object.fromEntries(
    Object.entries(v).filter(([, n]) => typeof n === "number" && Number.isFinite(n)),
  ) as Record<string, number>;
}

/** Parents before children (also across projects); everything else by project key and number. A cycle is left in number order. */
function parentsFirst(issues: PlanIssue[]): PlanIssue[] {
  const sorted = [...issues].sort(
    (a, b) => a.projectKey.localeCompare(b.projectKey) || a.number - b.number,
  );
  const byKey = new Map<string, PlanIssue>();
  for (const i of sorted) if (!byKey.has(i.key)) byKey.set(i.key, i);
  const out: PlanIssue[] = [];
  const state = new Map<PlanIssue, "visiting" | "done">();
  const visit = (i: PlanIssue) => {
    if (state.has(i)) return;
    state.set(i, "visiting");
    const parent = i.parentKey ? byKey.get(i.parentKey) : undefined;
    if (parent && state.get(parent) !== "visiting") visit(parent);
    state.set(i, "done");
    out.push(i);
  };
  for (const i of sorted) visit(i);
  return out;
}

// ---------------------------------------------------------------------------------------------
// The validator

export interface ValidateOptions {
  /** At most this many sentences are returned, the last one saying how many more there were. Default 100. */
  maxMessages?: number;
}

const PROJECT_KEY = /^[A-Z][A-Z0-9]{1,9}$/;
const ISSUE_KEY = /^([A-Z][A-Z0-9]{1,9})-([1-9][0-9]{0,6})$/;
const COLOUR = /^#[0-9a-fA-F]{6}$/;
const STAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;
const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

function validStamp(s: unknown): boolean {
  if (typeof s !== "string") return false;
  const m = STAMP.exec(s);
  if (!m || !validDay(s.slice(0, 10))) return false;
  const hour = Number(s.slice(11, 13));
  const minute = Number(s.slice(14, 16));
  const second = Number(s.slice(17, 19));
  return hour < 24 && minute < 60 && second < 60 && !Number.isNaN(Date.parse(s));
}
function validDay(s: unknown): boolean {
  if (typeof s !== "string") return false;
  const m = DAY.exec(s);
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return (
    d.getUTCFullYear() === Number(m[1]) &&
    d.getUTCMonth() === Number(m[2]) - 1 &&
    d.getUTCDate() === Number(m[3])
  );
}

/**
 * Checks an import plan and returns plain sentences, one per problem; an empty list means the plan
 * can be applied. Checks: the format and version; project keys valid and unique; project parents
 * exist and do not loop; issue types, statuses and labels unique by name, with a valid colour and
 * category, and one default status; milestones unique per project; issue keys valid and unique,
 * numbers unique per project and equal to the key, project, type, status, milestone and labels
 * present, parents exist and do not loop; every e-mail, issue key, project key and session ref
 * used in comments, status updates, sessions, activity, GitHub links and audits exists; every
 * date is a real date; project counters are not below the highest issue number; and the plan
 * holds no password or token hash.
 */
export function validateImportPlan(
  plan: unknown,
  options: ValidateOptions = {},
): string[] {
  const out: string[] = [];
  const say = (s: string) => void out.push(s);
  if (!isObj(plan)) return ["The plan must be a JSON object."];
  if (plan.format !== IMPORT_PLAN_FORMAT)
    say(`The plan's format must be "${IMPORT_PLAN_FORMAT}".`);
  if (plan.version !== IMPORT_PLAN_VERSION) {
    say(
      `The plan is version ${JSON.stringify(plan.version)}; this check knows version ${IMPORT_PLAN_VERSION}.`,
    );
  }
  const list = (name: string): Row[] => {
    const v = plan[name];
    if (!Array.isArray(v)) {
      say(`The plan has no "${name}" list.`);
      return [];
    }
    return v.filter(isObj);
  };
  const people = list("people");
  const projects = list("projects");
  const types = list("issueTypes");
  const statuses = list("statuses");
  const labels = list("labels");
  const milestones = list("milestones");
  const issues = list("issues");
  const comments = list("comments");
  const updates = list("statusUpdates");
  const sessions = list("sessions");
  const activities = list("activities");
  const links = list("githubLinks");
  const audits = list("securityAudits");

  // Secrets.
  const text = JSON.stringify(plan);
  if (/"(passwordHash|password_hash|tokenHash|token_hash)"/.test(text)) {
    say(
      "The plan holds a password or token hash. Remove it: the Portal must never receive Sentire Projects secrets.",
    );
  }

  const dateCheck = (
    who: string,
    field: string,
    v: unknown,
    kind: "stamp" | "day",
    required = false,
  ) => {
    if (v == null || v === "") {
      if (required) say(`${who} has no ${field}.`);
      return;
    }
    if (kind === "stamp" ? !validStamp(v) : !validDay(v)) {
      say(
        `${who} has ${field} ${JSON.stringify(v)}, which is not a valid ${kind === "stamp" ? "date and time" : "date (YYYY-MM-DD)"}.`,
      );
    }
  };
  const dupes = (what: string, names: string[], fold = false) => {
    const seen = new Map<string, number>();
    for (const n of names) {
      const k = fold ? n.toLowerCase() : n;
      seen.set(k, (seen.get(k) ?? 0) + 1);
    }
    for (const [k, n] of seen)
      if (n > 1)
        say(`${what} ${JSON.stringify(k)} appears ${n} times; it must be unique.`);
  };

  // People.
  const emails = new Set<string>();
  for (const p of people) {
    const e = str(p.email);
    if (!e || e !== e.toLowerCase() || !e.includes("@"))
      say(
        `A person has the e-mail ${JSON.stringify(e)}; it must be an e-mail address in lower case.`,
      );
    emails.add(e);
  }
  dupes(
    "The person",
    people.map((p) => str(p.email)),
  );
  const person = (who: string, field: string, v: unknown) => {
    if (v != null && v !== "" && !emails.has(str(v)))
      say(
        `${who} names ${JSON.stringify(v)} as ${field}, who is not in the list of people.`,
      );
  };

  // Projects.
  const projectKeys = new Set<string>();
  for (const p of projects) {
    const key = str(p.key);
    if (!PROJECT_KEY.test(key))
      say(
        `The project key ${JSON.stringify(key)} is not valid: use 2 to 10 capital letters or digits, starting with a letter.`,
      );
    projectKeys.add(key);
    if (!str(p.name).trim()) say(`Project ${key} has no name.`);
    if (!PROJECT_STATUS.has(str(p.status)))
      say(
        `Project ${key} has the status ${JSON.stringify(p.status)}, which is not one of ${[...PROJECT_STATUS].join(", ")}.`,
      );
    dateCheck(`Project ${key}`, "createdAt", p.createdAt, "stamp");
    dateCheck(`Project ${key}`, "updatedAt", p.updatedAt, "stamp");
  }
  dupes(
    "The project key",
    projects.map((p) => str(p.key)),
  );
  for (const p of projects) {
    if (p.parentKey != null && p.parentKey !== "" && !projectKeys.has(str(p.parentKey))) {
      say(
        `Project ${str(p.key)} has the parent project ${JSON.stringify(p.parentKey)}, which is not in the plan.`,
      );
    }
  }
  for (const p of projects) {
    if (p.parentKey != null && p.parentKey !== "" && p.parentKey === p.key)
      say(`Project ${str(p.key)} is its own parent.`);
  }
  loops(
    "project",
    new Map(
      projects.map((p) => [str(p.key), p.parentKey == null ? null : str(p.parentKey)]),
    ),
    say,
  );

  // Types, statuses, labels.
  for (const t of types) {
    if (!str(t.name).trim()) say("An issue type has no name.");
    if (!COLOUR.test(str(t.colour)))
      say(
        `The issue type ${JSON.stringify(t.name)} has the colour ${JSON.stringify(t.colour)}; use #rrggbb.`,
      );
  }
  dupes(
    "The issue type",
    types.map((t) => str(t.name)),
    true,
  );
  for (const s of statuses) {
    if (!str(s.name).trim()) say("An issue status has no name.");
    if (!COLOUR.test(str(s.colour)))
      say(
        `The issue status ${JSON.stringify(s.name)} has the colour ${JSON.stringify(s.colour)}; use #rrggbb.`,
      );
    if (!["TODO", "IN_PROGRESS", "DONE"].includes(str(s.category))) {
      say(
        `The issue status ${JSON.stringify(s.name)} has the category ${JSON.stringify(s.category)}; it must be TODO, IN_PROGRESS or DONE.`,
      );
    }
  }
  dupes(
    "The issue status",
    statuses.map((s) => str(s.name)),
    true,
  );
  const defaults = statuses.filter((s) => s.isDefault === true).length;
  if (statuses.length && defaults !== 1)
    say(`Exactly one issue status must be the default; ${defaults} are.`);
  for (const l of labels) {
    if (!str(l.name).trim()) say("A label has no name.");
    if (!COLOUR.test(str(l.colour)))
      say(
        `The label ${JSON.stringify(l.name)} has the colour ${JSON.stringify(l.colour)}; use #rrggbb.`,
      );
  }
  dupes(
    "The label",
    labels.map((l) => str(l.name)),
    true,
  );
  const typeNames = new Set(types.map((t) => str(t.name).toLowerCase()));
  const statusNames = new Map(
    statuses.map((s) => [str(s.name).toLowerCase(), str(s.category)]),
  );
  const labelNames = new Set(labels.map((l) => str(l.name).toLowerCase()));

  // Milestones.
  const milestoneSet = new Set<string>();
  for (const m of milestones) {
    const pk = str(m.projectKey);
    const who = `Milestone ${JSON.stringify(m.name)} of ${pk}`;
    if (!projectKeys.has(pk))
      say(
        `${who} belongs to the project ${JSON.stringify(pk)}, which is not in the plan.`,
      );
    if (!str(m.name).trim()) say(`A milestone of ${pk} has no name.`);
    if (!["OPEN", "LOCKED", "CLOSED"].includes(str(m.state)))
      say(
        `${who} has the state ${JSON.stringify(m.state)}; it must be OPEN, LOCKED or CLOSED.`,
      );
    dateCheck(who, "startDate", m.startDate, "day");
    dateCheck(who, "dueDate", m.dueDate, "day");
    dateCheck(who, "createdAt", m.createdAt, "stamp");
    dateCheck(who, "closedAt", m.closedAt, "stamp");
    if (validDay(m.startDate) && validDay(m.dueDate) && str(m.startDate) > str(m.dueDate))
      say(`${who} starts (${str(m.startDate)}) after it is due (${str(m.dueDate)}).`);
    milestoneSet.add(`${pk}\u0000${str(m.name).toLowerCase()}`);
  }
  dupes(
    "The milestone",
    milestones.map((m) => `${str(m.projectKey)}: ${str(m.name)}`),
    true,
  );

  // Issues.
  const issueKeys = new Set<string>();
  const seenNumbers = new Map<string, Set<number>>();
  const highest = new Map<string, number>();
  for (const i of issues) {
    const key = str(i.key);
    const who = `Issue ${key}`;
    issueKeys.add(key);
    const m = ISSUE_KEY.exec(key);
    if (!m)
      say(
        `The issue key ${JSON.stringify(key)} is not valid: use a project key, a dash and a number from 1 (for example PAY-12).`,
      );
    const pk = str(i.projectKey);
    if (!projectKeys.has(pk))
      say(
        `${who} belongs to the project ${JSON.stringify(pk)}, which is not in the plan.`,
      );
    const n = i.number;
    if (typeof n !== "number" || !Number.isInteger(n) || n < 1) {
      say(
        `${who} has the number ${JSON.stringify(n)}; it must be a whole number from 1.`,
      );
    } else {
      const set = seenNumbers.get(pk) ?? new Set<number>();
      if (set.has(n))
        say(
          `Two issues of ${pk} have the number ${n}; numbers must be unique within a project.`,
        );
      set.add(n);
      seenNumbers.set(pk, set);
      highest.set(pk, Math.max(highest.get(pk) ?? 0, n));
      if (m && (m[1] !== pk || Number(m[2]) !== n))
        say(`${who} does not match its project and number (${pk}-${n}).`);
    }
    if (!str(i.title).trim()) say(`${who} has no title.`);
    if (!typeNames.has(str(i.type).toLowerCase()))
      say(
        `${who} has the type ${JSON.stringify(i.type)}, which is not in the list of issue types.`,
      );
    if (!statusNames.has(str(i.status).toLowerCase()))
      say(
        `${who} has the status ${JSON.stringify(i.status)}, which is not in the list of issue statuses.`,
      );
    if (!["LOW", "NORMAL", "HIGH", "URGENT"].includes(str(i.priority)))
      say(
        `${who} has the priority ${JSON.stringify(i.priority)}; it must be LOW, NORMAL, HIGH or URGENT.`,
      );
    if (
      i.milestone != null &&
      i.milestone !== "" &&
      !milestoneSet.has(`${pk}\u0000${str(i.milestone).toLowerCase()}`)
    ) {
      say(
        `${who} is in the milestone ${JSON.stringify(i.milestone)}, which ${pk} does not have.`,
      );
    }
    for (const l of Array.isArray(i.labels) ? i.labels : []) {
      if (!labelNames.has(str(l).toLowerCase()))
        say(
          `${who} has the label ${JSON.stringify(l)}, which is not in the list of labels.`,
        );
    }
    person(who, "assignee", i.assigneeEmail);
    person(who, "author", i.authorEmail);
    dateCheck(who, "startDate", i.startDate, "day");
    dateCheck(who, "dueDate", i.dueDate, "day");
    dateCheck(who, "createdAt", i.createdAt, "stamp", true);
    dateCheck(who, "updatedAt", i.updatedAt, "stamp");
    dateCheck(who, "closedAt", i.closedAt, "stamp");
    dateCheck(who, "deletedAt", i.deletedAt, "stamp");
  }
  dupes(
    "The issue key",
    issues.map((i) => str(i.key)),
  );
  for (const i of issues) {
    if (i.parentKey != null && i.parentKey !== "") {
      if (!issueKeys.has(str(i.parentKey)))
        say(
          `Issue ${str(i.key)} has the parent ${JSON.stringify(i.parentKey)}, which is not in the plan.`,
        );
      else if (i.parentKey === i.key) say(`Issue ${str(i.key)} is its own parent.`);
    }
  }
  loops(
    "issue",
    new Map(
      issues.map((i) => [
        str(i.key),
        i.parentKey == null || i.parentKey === "" ? null : str(i.parentKey),
      ]),
    ),
    say,
  );
  for (const p of projects) {
    const key = str(p.key);
    const counter = p.issueCounter;
    if (typeof counter !== "number" || !Number.isInteger(counter) || counter < 0)
      say(
        `Project ${key} has the issue counter ${JSON.stringify(counter)}; it must be a whole number, 0 or more.`,
      );
    else if (counter < (highest.get(key) ?? 0))
      say(
        `Project ${key} has the issue counter ${counter}, below its highest issue number ${highest.get(key)}; numbers would be reused.`,
      );
  }

  // Everything that points at a project, an issue, a person or a session.
  const refs = new Set<string>();
  for (const s of sessions) {
    const r = str(s.ref);
    if (!r) say("A work session has no ref.");
    refs.add(r);
  }
  dupes(
    "The work session ref",
    sessions.map((s) => str(s.ref)),
  );
  const project = (who: string, v: unknown, nullable = false) => {
    if ((v == null || v === "") && nullable) return;
    if (!projectKeys.has(str(v)))
      say(
        `${who} belongs to the project ${JSON.stringify(v)}, which is not in the plan.`,
      );
  };
  const issue = (who: string, v: unknown, nullable = false) => {
    if ((v == null || v === "") && nullable) return;
    if (!issueKeys.has(str(v)))
      say(`${who} points to the issue ${JSON.stringify(v)}, which is not in the plan.`);
  };
  const session = (who: string, v: unknown) => {
    if (v != null && v !== "" && !refs.has(str(v)))
      say(
        `${who} points to the work session ${JSON.stringify(v)}, which is not in the plan.`,
      );
  };
  comments.forEach((c, n) => {
    const who = `Comment ${n + 1} (on ${str(c.issueKey)})`;
    issue(who, c.issueKey);
    person(who, "author", c.authorEmail);
    session(who, c.sessionRef);
    if (!str(c.body).trim()) say(`${who} is empty.`);
    dateCheck(who, "createdAt", c.createdAt, "stamp", true);
    dateCheck(who, "editedAt", c.editedAt, "stamp");
  });
  updates.forEach((u, n) => {
    const who = `Status update ${n + 1} of ${str(u.projectKey)}`;
    project(who, u.projectKey);
    if (!PROJECT_STATUS.has(str(u.status)))
      say(
        `${who} has the status ${JSON.stringify(u.status)}, which is not one of ${[...PROJECT_STATUS].join(", ")}.`,
      );
    person(who, "author", u.actorEmail);
    dateCheck(who, "createdAt", u.createdAt, "stamp", true);
  });
  sessions.forEach((s) => {
    const who = `Work session ${str(s.ref)}`;
    project(who, s.projectKey, true);
    person(who, "user", s.userEmail);
    for (const k of Array.isArray(s.issuesTouched) ? s.issuesTouched : []) issue(who, k);
    dateCheck(who, "startedAt", s.startedAt, "stamp", true);
    dateCheck(who, "endedAt", s.endedAt, "stamp");
  });
  activities.forEach((a, n) => {
    const who = `Activity ${n + 1} (${str(a.action)})`;
    project(who, a.projectKey);
    issue(who, a.issueKey, true);
    person(who, "actor", a.actorEmail);
    session(who, a.sessionRef);
    dateCheck(who, "createdAt", a.createdAt, "stamp", true);
  });
  const linkSeen = new Set<string>();
  links.forEach((l) => {
    const who = `GitHub link ${JSON.stringify(l.url)}`;
    issue(who, l.issueKey);
    if (!["pr", "commit"].includes(str(l.kind)))
      say(`${who} has the kind ${JSON.stringify(l.kind)}; it must be pr or commit.`);
    if (!str(l.url)) say(`A GitHub link on ${str(l.issueKey)} has no url.`);
    const k = `${str(l.issueKey)}\u0000${str(l.url)}`;
    if (linkSeen.has(k)) say(`${who} appears twice on ${str(l.issueKey)}.`);
    linkSeen.add(k);
    dateCheck(who, "updatedAt", l.updatedAt, "stamp");
  });
  audits.forEach((a, n) => {
    const who = `Security audit ${n + 1} of ${str(a.projectKey)}`;
    project(who, a.projectKey);
    for (const k of Array.isArray(a.issueKeys) ? a.issueKeys : []) issue(who, k);
    person(who, "importer", a.importedByEmail);
    dateCheck(who, "createdAt", a.createdAt, "stamp", true);
  });

  const max = options.maxMessages ?? 100;
  if (out.length > max) {
    const extra = out.length - max;
    return [
      ...out.slice(0, max),
      `And ${extra} more ${plural(extra, "problem", "problems")}.`,
    ];
  }
  return out;
}

/** Says so for each parent chain that comes back to its start. */
function loops(
  what: string,
  parentOf: Map<string, string | null>,
  say: (s: string) => void,
): void {
  const reported = new Set<string>();
  for (const start of parentOf.keys()) {
    const path: string[] = [];
    let cur: string | null | undefined = start;
    while (cur && parentOf.has(cur) && !path.includes(cur)) {
      path.push(cur);
      cur = parentOf.get(cur);
    }
    if (cur && path.includes(cur) && path.length > 1) {
      const loop = path.slice(path.indexOf(cur));
      const id = [...loop].sort().join(",");
      if (!reported.has(id)) {
        reported.add(id);
        say(`These ${what}s are each other's parent in a loop: ${loop.join(", ")}.`);
      }
    }
  }
}
