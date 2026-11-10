// sentire-import.map.ts — PA5 (D69): the pure parts of the Sentire Projects importer.
// No database, no framework: how a Sentire activity is named in the Portal, and how the original
// actor is kept on the imported row.
import type { PlanActivity, PlanPerson, PlanSession } from "@portal/projects-core";
import type { Change } from "./projects.constants";

/**
 * The Portal's action name for an activity of Sentire Projects. The names the Portal writes itself
 * are used where the meaning is the same; an action the Portal has no name for keeps its own
 * under `imported.` so nothing is lost and nothing is mistaken for a Portal event.
 */
export function portalAction(
  a: Pick<PlanActivity, "action" | "issueKey" | "summary" | "createdAt">,
  session?: Pick<PlanSession, "endedAt"> | null,
): string {
  const action = a.action.trim().toLowerCase();
  switch (action) {
    case "created":
      return a.issueKey ? "issue.created" : "project.created";
    case "updated":
      return a.issueKey ? "issue.updated" : "project.updated";
    case "deleted":
      return a.issueKey ? "issue.deleted" : "project.updated";
    case "commented":
    case "comment":
    case "comment.added":
      return "comment.added";
    case "linked":
      return "github.linked";
    case "status":
      return "project.status";
    case "session": {
      const ended =
        /^(ended|finished|completed|closed)\b/i.test(a.summary.trim()) ||
        (!!session?.endedAt && session.endedAt === a.createdAt);
      return ended ? "session.ended" : "session.started";
    }
    default:
      return `imported.${action.replace(/[^a-z0-9._-]+/g, "-").slice(0, 60) || "activity"}`;
  }
}

const WHO_WITHOUT_EMAIL: Record<string, string> = {
  CLAUDE: "Claude",
  GITHUB: "GitHub",
  SYSTEM: "System",
  USER: "A person",
};

/**
 * Who did it, in words: "Ana Reyes <ana@firm.example> (claude, claude-code)". An imported row is
 * written as the system, so the person is named here, whether or not they have an account.
 */
export function importedFrom(
  a: Pick<PlanActivity, "actorType" | "actorEmail" | "client">,
  people: ReadonlyMap<string, PlanPerson>,
): string {
  const person = a.actorEmail ? people.get(a.actorEmail.toLowerCase()) : undefined;
  const who = a.actorEmail
    ? `${person?.name ? `${person.name} ` : ""}<${a.actorEmail}>`
    : (WHO_WITHOUT_EMAIL[a.actorType] ?? "Unknown");
  return `${who} (${a.actorType.toLowerCase()}${a.client ? `, ${a.client}` : ""})`;
}

/** The changes of an imported activity row: the plan's, then who did it, then Sentire's own summary. */
export function importedChanges(
  a: PlanActivity,
  people: ReadonlyMap<string, PlanPerson>,
): Change[] {
  const changes: Change[] = a.changes.map((c) => ({
    field: c.field,
    old: c.old as Change["old"],
    new: c.new as Change["new"],
  }));
  changes.push({ field: "importedFrom", old: null, new: importedFrom(a, people) });
  if (a.summary && !changes.some((c) => c.field === "summary")) {
    changes.push({ field: "summary", old: null, new: a.summary });
  }
  return changes;
}

/** The Portal channel of an audit run, by who made it. */
export function channelOf(actorType: string): string {
  switch (actorType) {
    case "CLAUDE":
      return "mcp";
    case "GITHUB":
      return "github";
    case "SYSTEM":
      return "system";
    default:
      return "web";
  }
}

/** Counts of an audit as the Portal keeps them (see SecurityAuditsService). */
export function auditCounts(counts: Record<string, number>, rejectedListed: number) {
  const sev = (k: string) => counts[k] ?? 0;
  const bySeverity = {
    critical: sev("critical"),
    high: sev("high"),
    medium: sev("medium"),
    low: sev("low"),
    informational: sev("informational"),
  };
  const confirmed = Object.values(bySeverity).reduce((a, b) => a + b, 0);
  const needsValidation = sev("needs_validation");
  return {
    total: confirmed + needsValidation,
    confirmed,
    needsValidation,
    rejected: counts.rejected ?? rejectedListed,
    bySeverity,
  };
}
