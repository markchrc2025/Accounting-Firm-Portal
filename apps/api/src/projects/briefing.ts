// briefing.ts — PA3 (D67): the markdown briefing Claude reads at the start of a work session.
// Compact on purpose. The layout follows Sentire Projects' briefing; times are Manila time.
// Pure: the context service gathers the data and passes it here.
import { PRIORITY_RANK } from "./projects.constants";

export interface BriefIssue {
  key: string;
  status: string;
  type: string;
  priority: string;
  title: string;
  assignee: string | null;
  milestone: string | null;
  dueDate: string | null;
  overdue: boolean;
  labels: string[];
}

export interface BriefingInput {
  project: {
    key: string;
    name: string;
    description: string;
    status: string;
    statusNote: string | null;
    statusUpdatedAt: Date | null;
    repoUrl: string;
    liveUrl: string;
    deployAppName: string;
  };
  counts: {
    todo: number;
    inProgress: number;
    done: number;
    overdue: number;
    bugsOpen: number;
  };
  milestones: {
    name: string;
    dueDate: string | null;
    done: number;
    total: number;
    state: string;
    overdue: boolean;
  }[];
  inProgress: BriefIssue[];
  todo: BriefIssue[];
  sessions: {
    startedAt: Date;
    client: string;
    userName: string | null;
    title: string;
    summary: string;
    endedAt: Date | null;
    nextSteps: string;
  }[];
  activity: { at: Date; actor: string; text: string }[];
}

const STATUS_LABEL: Record<string, string> = {
  NOT_STARTED: "Not started",
  ON_TRACK: "On track",
  AT_RISK: "At risk",
  OFF_TRACK: "Off track",
  ON_HOLD: "On hold",
  FINISHED: "Finished",
};
export const projectStatusLabel = (s: string) => STATUS_LABEL[s] ?? s;

/** YYYY-MM-DD HH:mm in Asia/Manila (UTC+8, no daylight saving). */
export function manilaStamp(d: Date): string {
  return new Date(d.getTime() + 8 * 3600_000)
    .toISOString()
    .slice(0, 16)
    .replace("T", " ");
}

/** To do first by priority (urgent first), then the nearest due date, then the oldest number. */
export function byPriorityThenDue<
  T extends { priority: string; dueDate: string | null; key: string },
>(a: T, b: T): number {
  const p = (PRIORITY_RANK[a.priority] ?? 9) - (PRIORITY_RANK[b.priority] ?? 9);
  if (p) return p;
  if (a.dueDate !== b.dueDate) {
    if (!a.dueDate) return 1;
    if (!b.dueDate) return -1;
    return a.dueDate < b.dueDate ? -1 : 1;
  }
  const n = (k: string) => Number(k.slice(k.lastIndexOf("-") + 1));
  return n(a.key) - n(b.key);
}

function issueLine(i: BriefIssue): string {
  const head = [
    i.key,
    `[${i.status}]`,
    i.type !== "Task" ? i.type : null,
    i.priority !== "NORMAL" ? i.priority : null,
  ]
    .filter(Boolean)
    .join(" ");
  const extra = [
    i.assignee ? `@${i.assignee}` : null,
    i.milestone ? `ms: ${i.milestone}` : null,
    i.dueDate ? `due ${i.dueDate}${i.overdue ? " (OVERDUE)" : ""}` : null,
    i.labels.length ? i.labels.map((l) => `#${l}`).join(" ") : null,
  ]
    .filter(Boolean)
    .join(", ");
  return `- ${head} ${i.title}${extra ? ` (${extra})` : ""}`;
}

export function renderBriefing(b: BriefingInput): string {
  const p = b.project;
  const lines: string[] = [`# ${p.key}: ${p.name}`];
  if (p.description) lines.push(p.description);
  lines.push(
    `Status: ${projectStatusLabel(p.status)}${p.statusNote ? `, "${p.statusNote}"` : ""}` +
      (p.statusUpdatedAt ? ` (updated ${manilaStamp(p.statusUpdatedAt)})` : ""),
  );
  if (p.repoUrl) lines.push(`Repo: ${p.repoUrl}`);
  if (p.liveUrl) lines.push(`Live: ${p.liveUrl}`);
  if (p.deployAppName) lines.push(`Deployed as: ${p.deployAppName}`);
  const c = b.counts;
  lines.push(
    `Issues: ${c.todo} to do, ${c.inProgress} in progress, ${c.done} done, ${c.overdue} overdue, ${c.bugsOpen} open bugs.`,
  );
  lines.push("", "## Open milestones");
  if (!b.milestones.length) lines.push("- none");
  for (const m of b.milestones) {
    const pct = m.total ? Math.round((m.done / m.total) * 100) : 0;
    lines.push(
      `- ${m.name}${m.dueDate ? ` due ${m.dueDate}${m.overdue ? " (OVERDUE)" : ""}` : ""}: ${m.done}/${m.total} done (${pct}%)${m.state === "LOCKED" ? ", locked" : ""}`,
    );
  }
  lines.push("", "## In progress");
  lines.push(...(b.inProgress.length ? b.inProgress.map(issueLine) : ["- none"]));
  lines.push("", "## To do (highest priority first)");
  lines.push(...(b.todo.length ? b.todo.map(issueLine) : ["- none"]));
  if (b.sessions.length) {
    lines.push("", "## Recent Claude sessions");
    for (const s of b.sessions) {
      lines.push(
        `- ${manilaStamp(s.startedAt)} (${s.client}${s.userName ? `, ${s.userName}` : ""})${s.title ? ` ${s.title}` : ""}: ${s.summary || (s.endedAt ? "no summary" : "still open")}` +
          (s.nextSteps ? `\n  Next: ${s.nextSteps}` : ""),
      );
    }
  }
  lines.push("", "## Recent activity");
  if (!b.activity.length) lines.push("- none");
  for (const a of b.activity) lines.push(`- ${manilaStamp(a.at)} ${a.actor}: ${a.text}`);
  return lines.join("\n");
}

/** One line for an activity row: "PAY-3 updated: status New to In progress". */
export function describeActivity(a: {
  action: string;
  issueKey: string | null;
  changes: { field: string; old: unknown; new: unknown }[];
}): string {
  const verbs: Record<string, string> = {
    "issue.created": "created",
    "issue.updated": "updated",
    "issue.deleted": "deleted",
    "comment.added": "commented",
    "milestone.created": "milestone created",
    "milestone.updated": "milestone updated",
    "project.created": "created",
    "project.updated": "updated",
    "project.status": "status update",
    "session.started": "started a session",
    "session.ended": "ended a session",
  };
  const subject = a.issueKey ?? "project";
  const show = (v: unknown) => {
    const t = typeof v === "string" ? v : JSON.stringify(v);
    return t.length > 60 ? `${t.slice(0, 57)}...` : t;
  };
  const changes = a.changes
    .slice(0, 3)
    .map((c) =>
      c.old === null || c.old === undefined || c.old === ""
        ? `${c.field} set to ${show(c.new)}`
        : `${c.field} ${show(c.old)} to ${show(c.new)}`,
    );
  return `${subject} ${verbs[a.action] ?? a.action}${changes.length ? `: ${changes.join(", ")}` : ""}`;
}
