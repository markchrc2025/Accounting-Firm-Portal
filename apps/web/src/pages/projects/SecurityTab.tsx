// SecurityTab - a project's security (PB4, Track A PA4 / D68): whether a release is blocked, the
// open findings by severity, the open security issues as links, the last audit, and the history of
// every audit imported. Anyone who may read the project sees it; importing an audit takes
// Projects:Create and Projects:Update.

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Chip,
  EmptyState,
  ErrorState,
  Skeleton,
} from "../../components/ui";
import { ErrorBanner, SuccessBanner } from "../../components/projects/parts";
import { SecurityChip } from "../../components/projects/SecurityChip";
import { ImportAuditDialog, AuditOutcome } from "./ImportAuditDialog";
import {
  actorName,
  errorLines,
  fetchAudits,
  fetchSecurity,
  issuePath,
  momentText,
  SEVERITIES,
  type OpenSecurityIssue,
  type ProjectsCan,
  type SecurityAudit,
  type SecurityCounts,
  type SecurityStatus,
} from "../../lib/projects";

const SEVERITY_LABEL: Record<string, string> = {
  critical: "Critical",
  high: "High",
  medium: "Medium",
  low: "Low",
  informational: "Informational",
};

const COUNT_ROWS: { id: keyof SecurityCounts; label: string }[] = [
  { id: "critical", label: "Critical" },
  { id: "high", label: "High" },
  { id: "medium", label: "Medium" },
  { id: "low", label: "Low" },
  { id: "informational", label: "Informational" },
  { id: "needsValidation", label: "Needs validation" },
  { id: "unrated", label: "Unrated" },
];

/** A commit as people read it: the first 12 characters, or a word when there is none. */
const commitText = (c: string) => (c ? c.slice(0, 12) : "No commit");
/** Ledger units by status on one line: "covered 2, candidate 1". */
const coverageText = (c: Record<string, number>) =>
  Object.entries(c)
    .map(([k, v]) => `${k.replace(/_/g, " ")} ${v}`)
    .join(", ") || "None";
const scopeText = (s: string[]) => (s.length === 0 ? "Whole repository" : s.join(", "));

export function SecurityTab({
  projectKey,
  can,
}: {
  projectKey: string;
  can: ProjectsCan;
}) {
  const status = useQuery({
    queryKey: ["projects", "security", projectKey],
    queryFn: () => fetchSecurity(projectKey),
    retry: false,
  });
  const audits = useQuery({
    queryKey: ["projects", "audits", projectKey],
    queryFn: () => fetchAudits(projectKey),
    retry: false,
  });
  const [importing, setImporting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  return (
    <div className="space-y-5" data-security-tab>
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-serif text-[19px] font-medium text-navy">Security</h2>
        {can.create && can.update ? (
          <Button onClick={() => setImporting(true)}>Import audit</Button>
        ) : null}
      </div>
      {notice ? <SuccessBanner>{notice}</SuccessBanner> : null}

      {status.isPending ? (
        <Skeleton />
      ) : status.isError ? (
        <>
          <ErrorBanner lines={errorLines(status.error)} />
          <ErrorState
            message="Could not load the security state."
            onRetry={() => void status.refetch()}
          />
        </>
      ) : (
        <StatusCards s={status.data} projectKey={projectKey} />
      )}

      <Card>
        <CardHeader>
          <CardTitle>Audit history</CardTitle>
        </CardHeader>
        <CardContent>
          {audits.isPending ? (
            <Skeleton />
          ) : audits.isError ? (
            <>
              <ErrorBanner lines={errorLines(audits.error)} className="mb-3" />
              <ErrorState
                message="Could not load the audit history."
                onRetry={() => void audits.refetch()}
              />
            </>
          ) : audits.data.items.length === 0 ? (
            <EmptyState
              title="No audit imported yet"
              description="Import the findings of a security audit run to track them here."
            />
          ) : (
            <AuditTable audits={audits.data.items} projectKey={projectKey} />
          )}
        </CardContent>
      </Card>

      {importing ? (
        <ImportAuditDialog
          projectKey={projectKey}
          onClose={() => setImporting(false)}
          onImported={(a) =>
            setNotice(`Imported audit ${a.runId || "(no run id)"}.`)
          }
        />
      ) : null}
    </div>
  );
}

function StatusCards({ s, projectKey }: { s: SecurityStatus; projectKey: string }) {
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <Card data-security-status={s.state}>
        <CardHeader>
          <CardTitle>Release gate</CardTitle>
          <SecurityChip
            badge={{
              state: s.state,
              open: s.counts.open,
              critical: s.counts.critical,
              high: s.counts.high,
            }}
          />
        </CardHeader>
        <CardContent className="space-y-3 text-[13px]">
          {s.state === "clear" ? (
            <p>No open security issues.</p>
          ) : s.state === "open" ? (
            <p>
              {s.counts.open} open security {s.counts.open === 1 ? "issue" : "issues"}. None of
              them is critical or high, so no milestone is held back.
            </p>
          ) : (
            <div data-blocked-by>
              <p className="font-semibold text-danger-ink">
                A milestone cannot be closed while these are open:
              </p>
              <ul className="mt-1 flex flex-wrap gap-2">
                {s.blockedBy.map((k) => (
                  <li key={k}>
                    <Link
                      to={issuePath(projectKey, k)}
                      className="font-mono text-[12px] text-blue underline-offset-2 hover:underline"
                    >
                      {k}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-4" data-security-counts>
            {COUNT_ROWS.map((r) => (
              <div key={r.id} data-count={r.id}>
                <dt className="text-[11.5px] text-content-secondary">{r.label}</dt>
                <dd className="font-mono text-[15px] text-navy">{s.counts[r.id]}</dd>
              </div>
            ))}
          </dl>
        </CardContent>
      </Card>

      <Card data-last-audit>
        <CardHeader>
          <CardTitle>Last audit</CardTitle>
        </CardHeader>
        <CardContent className="text-[13px]">
          {s.lastAudit ? (
            <LastAudit a={s.lastAudit} />
          ) : (
            <p className="text-content-secondary">No audit has been imported yet.</p>
          )}
        </CardContent>
      </Card>

      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle>Open security issues</CardTitle>
        </CardHeader>
        <CardContent>
          {s.open.length === 0 ? (
            <p className="text-[13px] text-content-secondary">No open security issues.</p>
          ) : (
            <ul className="divide-y divide-line" data-open-security>
              {s.open.map((i) => (
                <OpenRow key={i.key} i={i} projectKey={projectKey} />
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function OpenRow({ i, projectKey }: { i: OpenSecurityIssue; projectKey: string }) {
  return (
    <li
      data-security-issue={i.key}
      className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-[13px]"
    >
      <Link
        to={issuePath(projectKey, i.key)}
        className="font-mono text-[12px] font-semibold text-blue underline-offset-2 hover:underline"
      >
        {i.key}
      </Link>
      <span className="min-w-0 flex-1">{i.title}</span>
      {i.severity ? (
        <Chip
          variant={
            i.severity === "critical" || i.severity === "high"
              ? "danger"
              : i.severity === "medium"
                ? "warn"
                : "neutral"
          }
          data-severity={i.severity}
        >
          {SEVERITY_LABEL[i.severity]}
        </Chip>
      ) : i.needsValidation ? (
        <Chip variant="info" data-severity="needs-validation">
          Needs validation
        </Chip>
      ) : (
        <Chip variant="neutral" data-severity="unrated">
          Unrated
        </Chip>
      )}
    </li>
  );
}

function LastAudit({ a }: { a: SecurityAudit }) {
  return (
    <dl className="grid grid-cols-[110px_minmax(0,1fr)] gap-x-3 gap-y-1">
      <dt className="text-content-secondary">Run</dt>
      <dd className="font-mono text-[12px]">{a.runId || "No run id"}</dd>
      <dt className="text-content-secondary">Commit</dt>
      <dd className="font-mono text-[12px]">{commitText(a.commit)}</dd>
      <dt className="text-content-secondary">When</dt>
      <dd>{momentText(a.createdAt)}</dd>
      <dt className="text-content-secondary">Result</dt>
      <dd>
        <Chip variant={a.complete ? "success" : "warn"}>
          {a.complete ? "Complete" : "Incomplete"}
        </Chip>
        {a.partial ? " A quick, limited or incomplete run." : ""}
      </dd>
      <dt className="text-content-secondary">Findings</dt>
      <dd>{findingsText(a)}</dd>
    </dl>
  );
}

function findingsText(a: SecurityAudit): string {
  const f = a.findings;
  return `${f.total} total, ${f.confirmed} confirmed, ${f.needsValidation} to validate, ${f.rejected} rejected`;
}

function AuditTable({ audits, projectKey }: { audits: SecurityAudit[]; projectKey: string }) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-[13px]" data-audit-history>
        <thead>
          <tr className="border-b border-line font-mono text-[10px] uppercase tracking-[.12em] text-content-secondary">
            <th className="px-3 py-2.5 font-medium">Run</th>
            <th className="px-3 py-2.5 font-medium">Commit</th>
            <th className="px-3 py-2.5 font-medium">Profile</th>
            <th className="px-3 py-2.5 font-medium">Scope</th>
            <th className="px-3 py-2.5 font-medium">Result</th>
            <th className="px-3 py-2.5 font-medium">Coverage</th>
            <th className="px-3 py-2.5 font-medium">Findings</th>
            <th className="px-3 py-2.5 font-medium">Imported by</th>
            <th className="px-3 py-2.5 font-medium">When</th>
          </tr>
        </thead>
        <tbody>
          {audits.map((a) => (
            <AuditRows
              key={a.id}
              a={a}
              projectKey={projectKey}
              open={open === a.id}
              toggle={() => setOpen(open === a.id ? null : a.id)}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AuditRows({
  a,
  projectKey,
  open,
  toggle,
}: {
  a: SecurityAudit;
  projectKey: string;
  open: boolean;
  toggle: () => void;
}) {
  return (
    <>
      <tr data-audit={a.id} className="border-b border-line align-top last:border-0">
        <td className="px-3 py-2.5 font-mono text-[12px]">{a.runId || "No run id"}</td>
        <td className="px-3 py-2.5 font-mono text-[12px]">{commitText(a.commit)}</td>
        <td className="px-3 py-2.5">{a.profile}</td>
        <td className="px-3 py-2.5">{scopeText(a.scope)}</td>
        <td className="px-3 py-2.5">
          <Chip variant={a.complete ? "success" : "warn"} data-audit-result>
            {a.complete ? "Complete" : "Incomplete"}
          </Chip>
          {!a.complete && a.incompleteReason ? (
            <div className="mt-0.5 text-[11.5px] text-content-secondary">
              {a.incompleteReason}
            </div>
          ) : null}
        </td>
        <td className="px-3 py-2.5 text-[12px]" data-audit-coverage>
          {coverageText(a.coverage)}
        </td>
        <td className="px-3 py-2.5 text-[12px]" data-audit-findings>
          <div>{findingsText(a)}</div>
          <div className="text-content-secondary">
            {SEVERITIES.map((s) => `${s} ${a.findings.bySeverity[s] ?? 0}`).join(", ")}
          </div>
        </td>
        <td className="px-3 py-2.5">
          {actorName({ actorType: a.actorType, actor: a.importedBy })}
        </td>
        <td className="px-3 py-2.5 font-mono text-[11.5px]">
          {momentText(a.createdAt)}
          <div>
            <button
              type="button"
              aria-expanded={open}
              onClick={toggle}
              className="font-sans text-[12px] text-blue underline-offset-2 hover:underline"
            >
              {open ? "Hide what it did" : "What it did"}
            </button>
          </div>
        </td>
      </tr>
      {open ? (
        <tr className="border-b border-line bg-paper last:border-0" data-audit-outcome={a.id}>
          <td colSpan={9} className="px-4 py-3">
            <AuditOutcome a={a} projectKey={projectKey} />
          </td>
        </tr>
      ) : null}
    </>
  );
}
