// audit.ts: security-audit findings (findings.json of the Cloudflare security-audit skill)
// turned into issues, and a run summarised for the audit record.
//
// Pure: no database. The caller matches issues on `fingerprint` and decides what to create,
// update, reopen or comment; these helpers say what each finding is.
import { createHash } from "node:crypto";
import {
  AuditImportError,
  SEVERITIES,
  VERDICTS,
  type AuditRunMetadata,
  type ConfirmedFinding,
  type Finding,
  type IssuePriority,
  type MappedFinding,
  type MappedIssue,
  type NeedsValidationFinding,
  type Severity,
  type Verdict,
} from "./audit-types";

export const MAX_FINDINGS = 1000;
export const MAX_FINGERPRINT_LENGTH = 300;
export const MAX_ISSUE_TITLE = 250;
export const MAX_ISSUE_DESCRIPTION = 60_000;
const MAX_LISTED = 40;

/** The skill's rule for a fingerprint (report-schema.json "pattern"). */
const FINGERPRINT = /^[A-Za-z0-9][A-Za-z0-9._:/@+-]*$/;

export const PRIORITY_FOR_SEVERITY: Record<Severity, IssuePriority> = {
  critical: "URGENT",
  high: "HIGH",
  medium: "NORMAL",
  low: "LOW",
  informational: "LOW",
};

/** The label names an import applies, with the colours the owner's Sentire Projects uses. */
export const SECURITY_LABEL_COLORS: Readonly<Record<string, string>> = {
  security: "#cf222e",
  "sev-critical": "#82071e",
  "sev-high": "#cf222e",
  "sev-medium": "#bc4c00",
  "sev-low": "#9a6700",
  "sev-informational": "#57606a",
  "needs-validation": "#8250df",
};

// ---------------------------------------------------------------------------------------------
// Reading findings.json

/**
 * Reads findings.json (the array, or the text of the file) and checks what the mapping
 * depends on: an array of at most {@link MAX_FINDINGS} objects, each with a known verdict, a
 * fingerprint the skill's pattern allows (unique in the file), a title, and for a confirmed
 * finding a known overall severity. The skill's own validate-findings.cjs checks the rest.
 * Throws an {@link AuditImportError} with a sentence that names the finding.
 */
export function parseFindings(input: unknown): Finding[] {
  let value = input;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      throw new AuditImportError("findings is not valid JSON.");
    }
  }
  if (!Array.isArray(value))
    throw new AuditImportError("findings must be the findings.json array.");
  if (value.length > MAX_FINDINGS) {
    throw new AuditImportError(`More than ${MAX_FINDINGS} findings in one import.`);
  }
  const seen = new Set<string>();
  return value.map((f: unknown, i) => {
    if (!f || typeof f !== "object" || Array.isArray(f)) {
      throw new AuditImportError(`findings[${i}] is not an object.`);
    }
    const r = f as Record<string, unknown>;
    if (!VERDICTS.includes(r.verdict as Verdict)) {
      throw new AuditImportError(
        `findings[${i}].verdict must be confirmed, needs_validation or rejected.`,
      );
    }
    const fp = validFingerprint(r.fingerprint);
    if (!fp)
      throw new AuditImportError(`findings[${i}].fingerprint is missing or malformed.`);
    if (seen.has(fp)) throw new AuditImportError(`Duplicate fingerprint ${fp}.`);
    seen.add(fp);
    if (!text(r.title).trim())
      throw new AuditImportError(`findings[${i}].title is empty.`);
    if (r.verdict === "confirmed" && !severityOf(r)) {
      throw new AuditImportError(
        `findings[${i}] (${fp}) has no valid severity.overall_severity.`,
      );
    }
    return r as unknown as Finding;
  });
}

// ---------------------------------------------------------------------------------------------
// Fingerprint

export interface FingerprintInput {
  fingerprint?: string | null;
  title?: string;
  trace?: { kind?: string; file?: string; scope?: string }[];
  evidence?: { file?: string }[];
}

/**
 * The stable identity of a finding.
 *
 * The skill gives every record a `fingerprint` field, "a stable source-derived identifier that
 * does not change between validation states" (report-schema.json), and its rules say a re-run
 * keeps the fingerprint of the same root cause (VALIDATION-AND-REPORTING.md). So the field is
 * the identity: this returns it unchanged. It never reads a line number, so a finding whose
 * code moved keeps its fingerprint, and it is the same in every verdict.
 *
 * Only a record with no fingerprint at all (hand-written or from an older tool) gets one made:
 * `sha256:` and the SHA-256 of its trace anchors, each `kind|file|scope` with the file path
 * normalised and no line number, sorted and de-duplicated. A record with no trace falls back
 * to its evidence files, then to its title. The anchors are chosen because they survive what
 * changes between runs (line numbers, wording, verdict) and change when the code path does.
 *
 * A fingerprint that is present but malformed throws: it is a data error, and making a new
 * identity would quietly split one issue in two.
 */
export function fingerprint(finding: FingerprintInput): string {
  const own = finding.fingerprint;
  if (own !== undefined && own !== null && own !== "") {
    const ok = validFingerprint(own);
    if (!ok) {
      throw new AuditImportError(
        "The finding's fingerprint is malformed. It must start with a letter or digit and use only letters, digits and . _ : / @ + -.",
      );
    }
    return ok;
  }
  const norm = (s: string | undefined) => (s ?? "").replace(/\s+/g, " ").trim();
  const file = (s: string | undefined) =>
    norm(s)
      .replace(/\\/g, "/")
      .replace(/\/{2,}/g, "/")
      .replace(/^(\.\/)+/, "");
  let anchors = (finding.trace ?? []).map(
    (t) => `${norm(t.kind)}|${file(t.file)}|${norm(t.scope)}`,
  );
  if (!anchors.length)
    anchors = (finding.evidence ?? []).map((e) => `evidence|${file(e.file)}`);
  if (!anchors.length) anchors = [`title|${norm(finding.title).toLowerCase()}`];
  const body = [...new Set(anchors)].sort().join("\n");
  return `sha256:${createHash("sha256").update(body).digest("hex")}`;
}

function validFingerprint(v: unknown): string | null {
  return typeof v === "string" &&
    v.length <= MAX_FINGERPRINT_LENGTH &&
    FINGERPRINT.test(v)
    ? v
    : null;
}

// ---------------------------------------------------------------------------------------------
// Mapping a finding to an issue

export interface MapContext {
  /** Shown at the top of the description: "From security audit <runId> at <commit>". */
  runId?: string;
  commit?: string;
}

/**
 * What a finding becomes.
 *
 * - confirmed: a Bug, labels `security` and `sev-<severity>`, priority from the severity
 *   (critical URGENT, high HIGH, medium NORMAL, low and informational LOW).
 * - needs_validation: a Task, labels `security` and `needs-validation`, no severity, NORMAL.
 * - rejected: not an issue; returned as `{ kind: "rejected" }` to be stored on the audit record.
 *
 * The description is markdown made only of the sections the finding has.
 */
export function mapFinding(finding: Finding, context: MapContext = {}): MappedFinding {
  const fp = fingerprint(finding);
  const title = text(finding.title)
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_ISSUE_TITLE)
    .trimEnd();
  if (!title) throw new AuditImportError(`The finding ${fp} has no title.`);

  if (finding.verdict === "rejected") {
    return {
      kind: "rejected",
      fingerprint: fp,
      title,
      reason: text(finding.reason).trim(),
    };
  }
  if (finding.verdict === "confirmed") {
    const severity = severityOf(finding);
    if (!severity) {
      throw new AuditImportError(
        `The finding ${fp} has no valid severity.overall_severity.`,
      );
    }
    return {
      kind: "issue",
      fingerprint: fp,
      type: "Bug",
      title,
      description: cap(confirmedDescription(finding, fp, context)),
      labels: ["security", `sev-${severity}`],
      priority: PRIORITY_FOR_SEVERITY[severity],
      severity,
    };
  }
  if (finding.verdict === "needs_validation") {
    return {
      kind: "issue",
      fingerprint: fp,
      type: "Task",
      title,
      description: cap(needsValidationDescription(finding, fp, context)),
      labels: ["security", "needs-validation"],
      priority: "NORMAL",
      severity: null,
    };
  }
  throw new AuditImportError(
    `The finding ${fp} has an unknown verdict. It must be confirmed, needs_validation or rejected.`,
  );
}

export interface MappedFindings {
  issues: MappedIssue[];
  rejected: Extract<MappedFinding, { kind: "rejected" }>[];
}

/** {@link mapFinding} for a whole file, split into issues to make and rejections to record. */
export function mapFindings(
  findings: readonly Finding[],
  context: MapContext = {},
): MappedFindings {
  const out: MappedFindings = { issues: [], rejected: [] };
  for (const f of findings) {
    const m = mapFinding(f, context);
    if (m.kind === "issue") out.issues.push(m);
    else out.rejected.push(m);
  }
  return out;
}

function severityOf(f: unknown): Severity | null {
  const s = (f as { severity?: { overall_severity?: unknown } }).severity
    ?.overall_severity;
  return SEVERITIES.includes(s as Severity) ? (s as Severity) : null;
}

// ---------------------------------------------------------------------------------------------
// Markdown

function text(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function codeSpan(s: string): string {
  const run = Math.max(0, ...(s.match(/`+/g) ?? []).map((r) => r.length));
  const d = "`".repeat(run + 1);
  return run ? `${d} ${s} ${d}` : `${d}${s}${d}`;
}

function fence(s: string): string {
  const run = Math.max(0, ...(s.match(/`+/g) ?? []).map((r) => r.length));
  const d = "`".repeat(Math.max(3, run + 1));
  return `${d}\n${s}\n${d}`;
}

function where(file: unknown, line: unknown): string {
  return codeSpan(`${text(file)}${typeof line === "number" ? `:${line}` : ""}`);
}

function bullets(rows: string[]): string {
  const shown = rows.slice(0, MAX_LISTED);
  if (rows.length > MAX_LISTED) shown.push(`- _and ${rows.length - MAX_LISTED} more_`);
  return shown.join("\n");
}

function traceSection(f: { trace?: unknown }): string {
  if (!Array.isArray(f.trace) || !f.trace.length) return "";
  return bullets(
    f.trace.map((t: Record<string, unknown>) => {
      const kind = text(t.kind) ? `**${text(t.kind)}** ` : "";
      const scope = text(t.scope) ? ` (${text(t.scope)})` : "";
      return `- ${kind}${where(t.file, t.line)}${scope}: ${text(t.description)}`;
    }),
  );
}

function evidenceSection(f: { evidence?: unknown }): string {
  if (!Array.isArray(f.evidence) || !f.evidence.length) return "";
  return bullets(
    f.evidence.map(
      (e: Record<string, unknown>) =>
        `- ${where(e.file, e.line)}: ${text(e.description)}`,
    ),
  );
}

function section(heading: string, body: string): string {
  return body.trim() ? `### ${heading}\n\n${body.trim()}` : "";
}

function header(fp: string, context: MapContext): string {
  const run = context.runId ? ` ${codeSpan(context.runId)}` : "";
  const commit = context.commit ? ` at ${codeSpan(context.commit)}` : "";
  return context.runId || context.commit
    ? `_From security audit${run}${commit}. Fingerprint ${codeSpan(fp)}._`
    : `_Fingerprint ${codeSpan(fp)}._`;
}

function confirmedDescription(
  f: ConfirmedFinding,
  fp: string,
  context: MapContext,
): string {
  const parts: string[] = [header(fp, context), text(f.description).trim()];

  const sev = f.severity;
  const headline = [`**Severity:** ${sev.overall_severity}.`];
  if (f.confidence?.score) headline.push(`**Confidence:** ${text(f.confidence.score)}.`);
  const why = [
    sev.likelihood
      ? `- Likelihood (${text(sev.likelihood.score)}): ${text(sev.likelihood.reason)}`
      : "",
    sev.impact ? `- Impact (${text(sev.impact.score)}): ${text(sev.impact.reason)}` : "",
    f.confidence?.reason
      ? `- Confidence (${text(f.confidence.score)}): ${text(f.confidence.reason)}`
      : "",
  ].filter(Boolean);
  parts.push([headline.join(" "), why.join("\n")].filter(Boolean).join("\n\n"));

  parts.push(section("Root cause", text(f.root_cause)));
  parts.push(section("Intended behaviour", text(f.intended_behavior)));
  parts.push(section("Trace", traceSection(f)));
  parts.push(section("Evidence", evidenceSection(f)));

  if (Array.isArray(f.conditions) && f.conditions.length) {
    parts.push(
      section(
        "Conditions",
        bullets(
          f.conditions.map(
            (c) => `- ${text(c.kind).replace(/_/g, " ")}: ${text(c.description)}`,
          ),
        ),
      ),
    );
  }

  const ex = f.execution;
  if (ex) {
    const body: string[] = [];
    if (text(ex.attacker_perspective))
      body.push(`Attacker: ${text(ex.attacker_perspective).trim()}`);
    if (Array.isArray(ex.instructions)) {
      const steps = ex.instructions.filter((s) => text(s).trim());
      if (steps.length)
        body.push(steps.map((s, i) => `${i + 1}. ${text(s).trim()}`).join("\n"));
    } else if (text(ex.instructions).trim()) {
      body.push(text(ex.instructions).trim());
    }
    for (const p of Array.isArray(ex.payloads) ? ex.payloads : []) {
      if (text(p)) body.push(fence(text(p)));
    }
    if (text(ex.observed_result))
      body.push(`Observed: ${text(ex.observed_result).trim()}`);
    parts.push(section("Reproduction", body.join("\n\n")));
  }

  const rem = f.remediation;
  if (rem) {
    const body: string[] = [text(rem.strategy).trim()];
    for (const c of rem.code_changes ?? []) {
      body.push(`${codeSpan(text(c.file_name))}\n\n${fence(text(c.fixed_code))}`);
    }
    parts.push(section("Fix", body.filter(Boolean).join("\n\n")));
  }
  return parts.filter(Boolean).join("\n\n");
}

function needsValidationDescription(
  f: NeedsValidationFinding,
  fp: string,
  context: MapContext,
): string {
  const parts: string[] = [
    header(fp, context),
    text(f.description).trim(),
    "**Needs validation.** There is no severity until the blockers below are resolved.",
    section("Claimed root cause", text(f.claimed_root_cause)),
    section("Trace", traceSection(f)),
    section("Evidence", evidenceSection(f)),
  ];
  if (Array.isArray(f.blockers) && f.blockers.length) {
    parts.push(section("Blockers", bullets(f.blockers.map((b) => `- ${text(b)}`))));
  }
  const plan = f.validation_plan;
  if (plan && (text(plan.local) || text(plan.deployment))) {
    const rows: string[] = [];
    if (text(plan.local)) rows.push(`- Local check: ${text(plan.local).trim()}`);
    if (text(plan.deployment))
      rows.push(`- Check on the deployment: ${text(plan.deployment).trim()}`);
    parts.push(section("How to resolve", rows.join("\n")));
  }
  return parts.filter(Boolean).join("\n\n");
}

function cap(markdown: string): string {
  if (markdown.length <= MAX_ISSUE_DESCRIPTION) return markdown;
  const note = "\n\n_The rest of this finding was cut. See the audit report._";
  return markdown.slice(0, MAX_ISSUE_DESCRIPTION - note.length).trimEnd() + note;
}

// ---------------------------------------------------------------------------------------------
// Summary of a run

export const PROFILES = ["quick", "standard", "deep"] as const;
export type AuditProfile = (typeof PROFILES)[number];

export interface AuditContext {
  /** The fields of run-metadata.json. */
  run?: AuditRunMetadata;
  /** coverage-ledger.json (the array of units); counted by each unit's `status`. */
  ledger?: unknown;
  /** Counts already made, by status (`{ covered: 40, candidate: 3 }`). Used when there is no ledger. */
  coverage?: Record<string, unknown>;
}

export interface AuditSummary {
  runId: string;
  /** The commit that was audited ("" when the metadata has none). */
  commit: string;
  profile: AuditProfile;
  /** Paths the run was limited to; empty for the whole repository. */
  scope: string[];
  status: "complete" | "incomplete";
  incompleteReason: string;
  /**
   * True for a quick run, a scoped run or an incomplete run. Such a run proves nothing about
   * what it did not look at, so a finding it does not report is not evidence that a fix worked.
   */
  partial: boolean;
  /** Ledger units by status (planned, covered, candidate, blocked, deferred, ...). */
  coverage: Record<string, number>;
  findings: {
    total: number;
    confirmed: number;
    needsValidation: number;
    rejected: number;
    /** Confirmed findings by overall severity; every severity is present. */
    bySeverity: Record<Severity, number>;
  };
}

/**
 * Counts a coverage ledger by unit status. Anything that is not an array of objects with a
 * string `status` of 1 to 40 lower-case letters and underscores is skipped.
 */
export function coverageCounts(ledger: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (!Array.isArray(ledger)) return out;
  for (const unit of ledger) {
    const s = (unit as { status?: unknown } | null)?.status;
    if (typeof s === "string" && /^[a-z_]{1,40}$/.test(s)) out[s] = (out[s] ?? 0) + 1;
  }
  return out;
}

/**
 * Summarises an audit for its record: the run (id, commit, profile, scope, complete or
 * incomplete), the coverage counts, and the findings by state and severity.
 *
 * findings.json has no run information, so that comes in `context` (run-metadata.json and
 * coverage-ledger.json). The findings are read with {@link parseFindings}.
 *
 * A profile that is missing or unknown is "standard", the skill's default. A run is
 * "complete" only when its metadata says `run_status: "complete"`; "in_progress", "incomplete",
 * anything else and no metadata at all are "incomplete".
 */
export function summariseAudit(
  findingsJson: unknown,
  context: AuditContext = {},
): AuditSummary {
  const findings = parseFindings(findingsJson);
  const run = context.run ?? {};
  const profile = PROFILES.find((p) => p === run.profile) ?? "standard";
  const scope = (Array.isArray(run.scope_paths) ? run.scope_paths : [])
    .filter((p): p is string => typeof p === "string")
    .map((p) => p.trim())
    .filter(Boolean);
  const complete = run.run_status === "complete";

  let coverage: Record<string, number> = {};
  if (context.ledger !== undefined) {
    coverage = coverageCounts(context.ledger);
  } else {
    for (const [k, v] of Object.entries(context.coverage ?? {})) {
      if (typeof v === "number" && Number.isFinite(v) && /^[a-z_]{1,40}$/.test(k)) {
        coverage[k] = Math.max(0, Math.floor(v));
      }
    }
  }

  const bySeverity = Object.fromEntries(SEVERITIES.map((s) => [s, 0])) as Record<
    Severity,
    number
  >;
  let confirmed = 0;
  let needsValidation = 0;
  let rejected = 0;
  for (const f of findings) {
    if (f.verdict === "confirmed") {
      confirmed++;
      bySeverity[severityOf(f)!]++;
    } else if (f.verdict === "needs_validation") needsValidation++;
    else rejected++;
  }

  return {
    runId: text(run.run_id).trim(),
    commit: text(run.source_ref).trim(),
    profile,
    scope,
    status: complete ? "complete" : "incomplete",
    incompleteReason: complete ? "" : text(run.incomplete_reason).trim(),
    partial: !complete || profile === "quick" || scope.length > 0,
    coverage,
    findings: {
      total: findings.length,
      confirmed,
      needsValidation,
      rejected,
      bySeverity,
    },
  };
}
