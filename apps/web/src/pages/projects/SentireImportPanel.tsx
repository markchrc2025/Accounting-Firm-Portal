// SentireImportPanel - bring the owner's Sentire Projects into the Portal once (PB5, Track A PA5 /
// D69). Super Admin only (the Projects settings page shows it to no one else). Choose the export
// JSON file, Check it (a dry run: nothing is written) to see the counts per entity, the warnings,
// the e-mails with no account and the fields the Portal has no place for; Import is offered only for
// the exact file that was checked, asks once more with the plain warning, and then the summary links
// the imported projects. The API's refusals (a key that already exists, an export that cannot be
// imported) show as sent, with their list of problems.

import { useState, type ChangeEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Button, Card, Chip } from "../../components/ui";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { ErrorBanner, SuccessBanner } from "../../components/projects/parts";
import {
  errorLines,
  importSentire,
  projectPath,
  readFileText,
  type SentireImportCounts,
  type SentireImportReport,
} from "../../lib/projects";

/** What the person is told before an import, word for word. */
export const IMPORT_WARNING =
  "This adds every project, issue and history from the file. It cannot be undone from the Portal.";

const COUNT_LABELS: { id: keyof SentireImportCounts; label: string }[] = [
  { id: "projects", label: "Projects" },
  { id: "issueTypes", label: "New issue types" },
  { id: "statuses", label: "New statuses" },
  { id: "labels", label: "New labels" },
  { id: "milestones", label: "Milestones" },
  { id: "issues", label: "Issues" },
  { id: "comments", label: "Comments" },
  { id: "statusUpdates", label: "Status updates" },
  { id: "sessions", label: "Claude sessions" },
  { id: "activities", label: "Activity entries" },
  { id: "githubLinks", label: "GitHub links" },
  { id: "securityAudits", label: "Security audits" },
  { id: "securityFindings", label: "Security findings" },
];

interface Loaded {
  name: string;
  text: string;
  /** What the file holds once read; undefined while its text is not JSON. */
  value: unknown;
  validJson: boolean;
}

export function SentireImportPanel() {
  const qc = useQueryClient();
  const [file, setFile] = useState<Loaded | null>(null);
  const [checked, setChecked] = useState<{ text: string; report: SentireImportReport } | null>(null);
  const [done, setDone] = useState<SentireImportReport | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [asking, setAsking] = useState(false);

  // The check holds for the exact file (its content) that was checked, and for no other.
  const sameFile = !!file && !!checked && checked.text === file.text;

  async function choose(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0] ?? null;
    setErrors([]);
    setDone(null);
    if (!f) {
      setFile(null);
      return;
    }
    const text = await readFileText(f);
    let value: unknown;
    let validJson = true;
    try {
      value = JSON.parse(text);
    } catch {
      validJson = false;
    }
    setFile({ name: f.name, text, value, validJson });
  }

  async function run(dryRun: boolean) {
    if (!file) return;
    setBusy(true);
    setErrors([]);
    try {
      const report = await importSentire(file.value, dryRun);
      if (dryRun) {
        setChecked({ text: file.text, report });
      } else {
        setDone(report);
        setChecked(null);
        void qc.invalidateQueries({ queryKey: ["projects"] });
      }
    } catch (e) {
      setErrors(errorLines(e, dryRun ? "Could not check the file." : "Could not import the file."));
    } finally {
      setBusy(false);
      setAsking(false);
    }
  }

  return (
    <section aria-labelledby="sentire-import-title" data-sentire-import>
      <h2
        id="sentire-import-title"
        className="mb-2 font-serif text-[19px] font-medium text-navy"
      >
        Import from Sentire Projects
      </h2>
      <Card className="space-y-4 px-5 py-4 text-[13px] text-content">
        <p className="text-content-secondary">
          Choose the export of Sentire Projects (a JSON file). Check it first: nothing is written
          by a check.
        </p>
        <ErrorBanner lines={errors} />
        {file && !file.validJson ? (
          <ErrorBanner lines={[`${file.name} is not valid JSON.`]} />
        ) : null}

        <label className="block">
          <span className="mb-1.5 block font-semibold text-content">Export file</span>
          <input
            type="file"
            accept=".json,application/json"
            aria-label="Export file"
            className="block w-full text-[13px]"
            onChange={(e) => void choose(e)}
          />
        </label>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            disabled={busy || !file || !file.validJson}
            onClick={() => void run(true)}
          >
            Check
          </Button>
          <Button disabled={busy || !sameFile} onClick={() => setAsking(true)}>
            Import
          </Button>
          {file && checked && !sameFile ? (
            <span role="note" className="text-[12px] text-content-secondary">
              This is not the file that was checked. Check it first.
            </span>
          ) : null}
        </div>

        {checked && sameFile ? <Report report={checked.report} /> : null}
        {checked && sameFile ? (
          <p
            role="note"
            data-import-warning
            className="rounded-input border border-danger/30 bg-danger-bg px-3 py-2 font-semibold text-danger-ink"
          >
            {IMPORT_WARNING}
          </p>
        ) : null}

        {done ? <Summary report={done} /> : null}
      </Card>

      {asking && file ? (
        <ConfirmDialog
          question={`Import “${file.name}”?`}
          detail={IMPORT_WARNING}
          confirmLabel="Import"
          busy={busy}
          onCancel={() => setAsking(false)}
          onConfirm={() => void run(false)}
        />
      ) : null}
    </section>
  );
}

function Counts({ counts }: { counts: SentireImportCounts }) {
  return (
    <dl className="grid grid-cols-2 gap-x-6 gap-y-1 sm:grid-cols-3" data-import-counts>
      {COUNT_LABELS.map((c) => (
        <div key={c.id} data-count={c.id} className="flex items-baseline justify-between gap-3">
          <dt className="text-content-secondary">{c.label}</dt>
          <dd className="font-mono text-[14px] text-navy">{counts[c.id]}</dd>
        </div>
      ))}
    </dl>
  );
}

function Report({ report }: { report: SentireImportReport }) {
  return (
    <div
      data-import-report
      className="space-y-3 rounded-input border border-line bg-paper px-4 py-3"
    >
      <p className="font-semibold text-navy">
        Checked: {report.projects.length}{" "}
        {report.projects.length === 1 ? "project" : "projects"} would be added
        {report.projects.length ? ` (${report.projects.join(", ")})` : ""}.
      </p>
      <Counts counts={report.counts} />
      <p className="text-[12px] text-content-secondary" data-import-reused>
        Already in the firm under the same name and reused: {report.reused.issueTypes} issue
        types, {report.reused.statuses} statuses, {report.reused.labels} labels.
      </p>
      {report.unmatchedEmails.length > 0 ? (
        <div data-import-unmatched>
          <h3 className="mb-1 font-semibold text-content">E-mails with no account here</h3>
          <p className="mb-1 text-content-secondary">
            Rows that name these people are imported without a person.
          </p>
          <ul className="list-disc space-y-0.5 pl-5 font-mono text-[12px]">
            {report.unmatchedEmails.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {report.warnings.length > 0 ? (
        <div
          data-import-warnings
          className="rounded-input border border-gold bg-warn-bg-2 px-3 py-2"
        >
          <h3 className="mb-1 font-semibold text-content">Warnings</h3>
          <ul className="list-disc space-y-0.5 pl-5">
            {report.warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {report.unmapped.length > 0 ? (
        <div data-import-unmapped>
          <h3 className="mb-1 font-semibold text-content">Not carried over</h3>
          <ul className="space-y-1">
            {report.unmapped.map((u) => (
              <li key={u.field}>
                <code className="font-mono text-[12px]">{u.field}</code>{" "}
                <span className="text-content-secondary">{u.reason}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function Summary({ report }: { report: SentireImportReport }) {
  return (
    <div data-import-summary className="space-y-3">
      <SuccessBanner>
        Imported {report.projects.length}{" "}
        {report.projects.length === 1 ? "project" : "projects"} from Sentire Projects.
      </SuccessBanner>
      <ul className="flex flex-wrap gap-2" data-imported-projects>
        {report.projects.map((k) => (
          <li key={k}>
            <Link
              to={projectPath(k)}
              className="font-mono text-[12px] text-blue underline-offset-2 hover:underline"
            >
              {k}
            </Link>
          </li>
        ))}
      </ul>
      <Counts counts={report.counts} />
      {report.unmatchedEmails.length > 0 ? (
        <p className="text-content-secondary">
          Imported without a person, because they have no account here:{" "}
          <span className="font-mono text-[12px]">{report.unmatchedEmails.join(", ")}</span>
        </p>
      ) : null}
      {report.warnings.length > 0 ? (
        <Chip variant="warn">{report.warnings.length} warnings were shown by the check</Chip>
      ) : null}
    </div>
  );
}
