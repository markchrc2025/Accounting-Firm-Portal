// audit-types.ts: the shapes of the security-audit skill's output that the helpers rely on.
//
// Source: report-schema.json of the Cloudflare security-audit skill (MIT), which the owner's
// Sentire Projects repo vendors under .claude/skills/security-audit. Only the fields the
// helpers read are typed; the skill's own validate-findings.cjs checks the whole schema.

export const SEVERITIES = ["critical", "high", "medium", "low", "informational"] as const;
export type Severity = (typeof SEVERITIES)[number];

export const VERDICTS = ["confirmed", "needs_validation", "rejected"] as const;
export type Verdict = (typeof VERDICTS)[number];

export interface TraceStep {
  kind: "entrypoint" | "propagation" | "sink";
  file: string;
  line: number;
  scope: string;
  description: string;
}

export interface EvidenceRef {
  file: string;
  line: number;
  description: string;
}

export interface Condition {
  kind: string;
  description: string;
}

export interface Execution {
  attacker_perspective?: string;
  payloads?: string[];
  /** The schema says an array of steps. A single string is read too. */
  instructions?: string[] | string;
  observed_result?: string;
}

export interface Remediation {
  strategy: string;
  code_changes?: { file_name: string; fixed_code: string }[];
}

export interface Scored {
  score: string;
  reason: string;
}

interface FindingBase {
  /** The skill's stable, source-derived id; the same root cause keeps it in every state. */
  fingerprint: string;
  title: string;
  description: string;
  trace?: TraceStep[];
  evidence?: EvidenceRef[];
}

export interface ConfirmedFinding extends FindingBase {
  verdict: "confirmed";
  root_cause: string;
  intended_behavior: string;
  conditions?: Condition[];
  execution?: Execution;
  remediation?: Remediation;
  severity: { likelihood?: Scored; impact?: Scored; overall_severity: Severity };
  confidence?: Scored;
}

export interface NeedsValidationFinding extends FindingBase {
  verdict: "needs_validation";
  claimed_root_cause: string;
  blockers?: string[];
  validation_plan?: { local?: string; deployment?: string };
}

export interface RejectedFinding extends FindingBase {
  verdict: "rejected";
  claimed_root_cause: string;
  reason: string;
}

export type Finding = ConfirmedFinding | NeedsValidationFinding | RejectedFinding;

/** The fields of run-metadata.json that the helpers read. The file has more. */
export interface AuditRunMetadata {
  run_id?: string;
  /** The commit that was audited. */
  source_ref?: string;
  profile?: string;
  /** Empty or missing means the whole repository. */
  scope_paths?: string[];
  /** "complete", "incomplete" or "in_progress". */
  run_status?: string;
  incomplete_reason?: string;
}

export type IssueType = "Bug" | "Task";
export type IssuePriority = "URGENT" | "HIGH" | "NORMAL" | "LOW";

/** An issue to create or update from a confirmed finding or a lead that needs validation. */
export interface MappedIssue {
  kind: "issue";
  fingerprint: string;
  type: IssueType;
  title: string;
  /** Markdown. */
  description: string;
  /** "security" plus "sev-<severity>" (confirmed) or "needs-validation". */
  labels: string[];
  priority: IssuePriority;
  /** The finding's overall severity; null for a lead that needs validation. */
  severity: Severity | null;
}

/** A rejected finding. It is kept on the audit record and never becomes an issue. */
export interface MappedRejection {
  kind: "rejected";
  fingerprint: string;
  title: string;
  reason: string;
}

export type MappedFinding = MappedIssue | MappedRejection;

export class AuditImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuditImportError";
  }
}
