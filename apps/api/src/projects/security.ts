// security.ts — PA4 (D68): which issues are open security findings, how severe, and what that means
// for a project. Pure. An issue is a security finding when it carries the label `security`; its
// severity is its `sev-<severity>` label; `needs-validation` marks a lead. A security issue with no
// sev label is unrated. Critical and high block a release; nothing else does.
import { SEVERITIES, type Severity } from "@portal/projects-core";

export type SecurityState = "clear" | "open" | "blocked";

/** The severities that stop a milestone from closing. */
export const BLOCKING_SEVERITIES: readonly Severity[] = ["critical", "high"];

export interface OpenSecurityIssue {
  key: string;
  number: number;
  title: string;
  /** The audit finding's fingerprint, null for an issue labelled by hand. */
  fingerprint: string | null;
  severity: Severity | null;
  needsValidation: boolean;
}

/** null when the labels do not include `security`; else its severity and whether it is a lead. */
export function classifySecurityIssue(
  labelNames: readonly string[],
): { severity: Severity | null; needsValidation: boolean } | null {
  const names = labelNames.map((n) => n.trim().toLowerCase());
  if (!names.includes("security")) return null;
  // SEVERITIES runs from the worst down, so the first match is the worse of two by hand
  const severity = SEVERITIES.find((s) => names.includes(`sev-${s}`)) ?? null;
  return { severity, needsValidation: names.includes("needs-validation") };
}

const blocks = (i: OpenSecurityIssue) =>
  i.severity !== null && BLOCKING_SEVERITIES.includes(i.severity);

/** The open issues that block a release, by issue number. */
export function blockingKeys(open: readonly OpenSecurityIssue[]): string[] {
  return open
    .filter(blocks)
    .sort((a, b) => a.number - b.number)
    .map((i) => i.key);
}

export interface SecuritySummary {
  state: SecurityState;
  blockedBy: string[];
  counts: {
    open: number;
    critical: number;
    high: number;
    medium: number;
    low: number;
    informational: number;
    needsValidation: number;
    unrated: number;
  };
}

export function securitySummary(open: readonly OpenSecurityIssue[]): SecuritySummary {
  const counts = {
    open: open.length,
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
    informational: 0,
    needsValidation: 0,
    unrated: 0,
  };
  for (const i of open) {
    if (i.severity) counts[i.severity] += 1;
    else if (i.needsValidation) counts.needsValidation += 1;
    else counts.unrated += 1;
  }
  const blockedBy = blockingKeys(open);
  return {
    state: blockedBy.length ? "blocked" : open.length ? "open" : "clear",
    blockedBy,
    counts,
  };
}

/** The sentence a milestone gets when it cannot close. */
export function gateMessage(keys: readonly string[]): string {
  return `This milestone cannot be closed while security issues are open: ${keys.join(", ")}.`;
}
