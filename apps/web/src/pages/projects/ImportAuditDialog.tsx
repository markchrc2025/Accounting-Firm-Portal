// ImportAuditDialog - import a run of the security-audit skill (PB4, Track A PA4 / D68): its
// findings.json (a file or pasted text), and optionally the run metadata and the coverage ledger.
// The API's answer is shown, and its refusals as sent. A file that is not JSON is said so here,
// before anything is sent.

import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { Button } from "../../components/ui";
import { ErrorBanner, Field, Modal } from "../../components/projects/parts";
import { useInvalidateProject } from "../../components/projects/useInvalidate";
import { useQueryClient } from "@tanstack/react-query";
import {
  errorLines,
  importAudit,
  issuePath,
  readFileText,
  type AuditImportBody,
  type SecurityAudit,
} from "../../lib/projects";

function KeyList({
  label,
  keys,
  projectKey,
}: {
  label: string;
  keys: string[];
  projectKey: string;
}) {
  if (keys.length === 0) return null;
  return (
    <div data-outcome={label}>
      <h3 className="mb-1 font-semibold text-content">
        {label} <span className="font-mono text-[11px] text-content-secondary">{keys.length}</span>
      </h3>
      <ul className="flex flex-wrap gap-2">
        {keys.map((k) => (
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
  );
}

/** What an imported audit did: the issues it made, updated and reopened, and what it did not report. */
export function AuditOutcome({ a, projectKey }: { a: SecurityAudit; projectKey: string }) {
  const nothing =
    a.created.length +
      a.updated.length +
      a.reopened.length +
      a.notReported.length +
      a.rejectedNoted.length +
      a.rejected.length ===
    0;
  return (
    <div className="space-y-3 text-[13px]">
      {nothing ? <p className="text-content-secondary">It changed no issue.</p> : null}
      <KeyList label="Created" keys={a.created} projectKey={projectKey} />
      <KeyList label="Updated" keys={a.updated} projectKey={projectKey} />
      <KeyList label="Reopened" keys={a.reopened} projectKey={projectKey} />
      <KeyList label="Not reported by this run" keys={a.notReported} projectKey={projectKey} />
      <KeyList label="Rejection noted on" keys={a.rejectedNoted} projectKey={projectKey} />
      {a.rejected.length > 0 ? (
        <div data-outcome="Rejected">
          <h3 className="mb-1 font-semibold text-content">Rejected findings (kept on the audit)</h3>
          <ul className="list-disc space-y-0.5 pl-5">
            {a.rejected.map((r) => (
              <li key={r.fingerprint}>
                {r.title} <span className="text-content-secondary">{r.reason}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function parseFile(name: string, text: string, want: "object" | "array"): unknown {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error(`${name} is not valid JSON.`);
  }
  const ok =
    want === "array"
      ? Array.isArray(value)
      : !!value && typeof value === "object" && !Array.isArray(value);
  if (!ok) throw new Error(`${name} must be a JSON ${want}.`);
  return value;
}

export function ImportAuditDialog({
  projectKey,
  onClose,
  onImported,
}: {
  projectKey: string;
  onClose: () => void;
  onImported: (a: SecurityAudit) => void;
}) {
  const invalidate = useInvalidateProject(projectKey);
  const qc = useQueryClient();
  const [findingsFile, setFindingsFile] = useState<File | null>(null);
  const [findingsText, setFindingsText] = useState("");
  const [runFile, setRunFile] = useState<File | null>(null);
  const [ledgerFile, setLedgerFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [result, setResult] = useState<SecurityAudit | null>(null);

  const hasFindings = findingsFile !== null || findingsText.trim() !== "";

  async function submit() {
    setBusy(true);
    setErrors([]);
    try {
      const body: AuditImportBody = {
        findings: findingsFile ? await readFileText(findingsFile) : findingsText,
      };
      if (runFile) {
        body.run = parseFile("run-metadata.json", await readFileText(runFile), "object") as Record<
          string,
          unknown
        >;
      }
      if (ledgerFile) {
        body.ledger = parseFile(
          "coverage-ledger.json",
          await readFileText(ledgerFile),
          "array",
        ) as unknown[];
      }
      const a = await importAudit(projectKey, body);
      setResult(a);
      invalidate();
      void qc.invalidateQueries({ queryKey: ["projects", "security", projectKey] });
      void qc.invalidateQueries({ queryKey: ["projects", "audits", projectKey] });
      void qc.invalidateQueries({ queryKey: ["projects", "meta"] });
      onImported(a);
    } catch (e) {
      setErrors(
        e instanceof Error && !("status" in e)
          ? [e.message]
          : errorLines(e, "Could not import the audit."),
      );
    } finally {
      setBusy(false);
    }
  }

  if (result) {
    return (
      <Modal title="Audit imported" onClose={onClose} wide>
        <div className="space-y-4" data-audit-imported>
          <p className="text-[13px] font-semibold text-navy">
            Run {result.runId || "(no run id)"}: {result.findings.total} findings,{" "}
            {result.findings.confirmed} confirmed, {result.findings.needsValidation} to validate,{" "}
            {result.findings.rejected} rejected.
            {!result.complete ? " The run is incomplete." : ""}
          </p>
          <AuditOutcome a={result} projectKey={projectKey} />
          <div className="flex justify-end">
            <Button onClick={onClose}>Close</Button>
          </div>
        </div>
      </Modal>
    );
  }

  const fileField = (
    label: string,
    hint: ReactNode,
    onFile: (f: File | null) => void,
    aria: string,
  ) => (
    <Field label={label} hint={typeof hint === "string" ? hint : undefined}>
      <input
        type="file"
        accept=".json,application/json"
        aria-label={aria}
        className="block w-full text-[13px]"
        onChange={(e) => onFile(e.target.files?.[0] ?? null)}
      />
    </Field>
  );

  return (
    <Modal title="Import audit" onClose={onClose} wide>
      <div className="space-y-4 text-[13px]">
        <ErrorBanner lines={errors} />
        {fileField(
          "findings.json",
          "The file the audit wrote. Or paste its text below.",
          setFindingsFile,
          "findings.json file",
        )}
        <label className="block">
          <span className="mb-1.5 block font-semibold text-content">
            or paste the text of findings.json
          </span>
          <textarea
            className="input min-h-[110px] font-mono text-[12px]"
            value={findingsText}
            disabled={findingsFile !== null}
            onChange={(e) => setFindingsText(e.target.value)}
            aria-label="Text of findings.json"
          />
        </label>
        {fileField(
          "run-metadata.json (optional)",
          "The run id, commit, profile and scope.",
          setRunFile,
          "run-metadata.json file",
        )}
        {fileField(
          "coverage-ledger.json (optional)",
          "What the run covered.",
          setLedgerFile,
          "coverage-ledger.json file",
        )}
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={busy || !hasFindings} onClick={() => void submit()}>
            {busy ? "Importing…" : "Import audit"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
