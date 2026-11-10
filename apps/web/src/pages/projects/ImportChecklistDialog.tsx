// ImportChecklistDialog - make milestones and issues from a markdown checklist (PB4, Track A PA4 /
// D68). Paste the checklist, say whether headings become milestones, look at the Preview (a dry run:
// nothing is written), then Import. The API's refusals show as sent: too many items, labels that
// do not exist and need Projects:Configure to make. Import is offered only for the text and the
// switch that were previewed.

import { useState } from "react";
import { Link } from "react-router-dom";
import { Button, Chip } from "../../components/ui";
import { ErrorBanner, Modal } from "../../components/projects/parts";
import { useInvalidateProject } from "../../components/projects/useInvalidate";
import { useQueryClient } from "@tanstack/react-query";
import {
  errorLines,
  importChecklist,
  issuePath,
  type ChecklistImportResult,
} from "../../lib/projects";

const EXAMPLE = `## First release
- [ ] Sign-in page #frontend
- [x] Set up the database
  - the notes under an item become its description
## Later
- [ ] Reports`;

export function ImportChecklistDialog({
  projectKey,
  onClose,
}: {
  projectKey: string;
  onClose: () => void;
}) {
  const invalidate = useInvalidateProject(projectKey);
  const qc = useQueryClient();
  const [markdown, setMarkdown] = useState("");
  const [headings, setHeadings] = useState(false);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [preview, setPreview] = useState<{
    result: ChecklistImportResult;
    markdown: string;
    headings: boolean;
  } | null>(null);
  const [done, setDone] = useState<ChecklistImportResult | null>(null);

  // Import is for what was previewed: any change to the text or the switch asks for a new preview.
  const previewed =
    preview && preview.markdown === markdown && preview.headings === headings;

  async function run(dryRun: boolean) {
    setBusy(true);
    setErrors([]);
    try {
      const result = await importChecklist(projectKey, {
        markdown,
        headingsAsMilestones: headings,
        dryRun,
      });
      if (dryRun) setPreview({ result, markdown, headings });
      else {
        setDone(result);
        invalidate();
        // an import may have made labels
        void qc.invalidateQueries({ queryKey: ["projects", "meta"] });
      }
    } catch (e) {
      setErrors(errorLines(e, "Could not import the checklist."));
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <Modal title="Checklist imported" onClose={onClose} wide>
        <div className="space-y-4 text-[13px]" data-import-summary>
          <p className="font-semibold text-navy">
            {done.keys.length === 0
              ? "Nothing to import."
              : `Imported ${done.items.total} ${done.items.total === 1 ? "item" : "items"}: ${done.items.open} open, ${done.items.closed} closed.`}
          </p>
          {done.keys.length > 0 ? (
            <ul className="flex flex-wrap gap-2" data-created-keys>
              {done.keys.map((k) => (
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
          ) : null}
          <Made result={done} />
          <Warnings warnings={done.warnings} />
          <div className="flex justify-end">
            <Button onClick={onClose}>Close</Button>
          </div>
        </div>
      </Modal>
    );
  }

  return (
    <Modal title="Import a checklist" onClose={onClose} wide>
      <div className="space-y-4 text-[13px]">
        <ErrorBanner lines={errors} />
        <label className="block">
          <span className="mb-1.5 block font-semibold text-content">
            Markdown checklist
          </span>
          <textarea
            className="input min-h-[170px] font-mono text-[12px]"
            value={markdown}
            placeholder={EXAMPLE}
            onChange={(e) => setMarkdown(e.target.value)}
          />
          <span className="mt-1 block text-[11.5px] text-content-secondary">
            One line per item: <code>- [ ] open</code> or <code>- [x] closed</code>. A
            #word is a label. Indented bullets under an item are its description.
          </span>
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={headings}
            onChange={(e) => setHeadings(e.target.checked)}
          />
          Headings become milestones
        </label>

        {previewed ? <Preview result={preview.result} /> : null}

        <div className="flex flex-wrap justify-end gap-2 pt-1">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="outline"
            disabled={busy || markdown.trim() === ""}
            onClick={() => void run(true)}
          >
            Preview
          </Button>
          <Button
            disabled={busy || !previewed || preview.result.items.total === 0}
            onClick={() => void run(false)}
          >
            {busy && previewed ? "Importing…" : "Import"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function Made({ result }: { result: ChecklistImportResult }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div data-preview-milestones>
        <h3 className="mb-1 font-semibold text-content">Milestones</h3>
        {result.milestones.length === 0 ? (
          <p className="text-content-secondary">None.</p>
        ) : (
          <ul className="space-y-0.5">
            {result.milestones.map((m) => (
              <li key={m.name} data-milestone-name={m.name}>
                {m.name}{" "}
                <Chip variant={m.created ? "info" : "neutral"}>
                  {m.created ? "new" : "exists"}
                </Chip>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div data-preview-labels>
        <h3 className="mb-1 font-semibold text-content">Labels</h3>
        {result.labels.length === 0 ? (
          <p className="text-content-secondary">None.</p>
        ) : (
          <ul className="space-y-0.5">
            {result.labels.map((l) => (
              <li key={l.name} data-label-name={l.name}>
                {l.name}{" "}
                <Chip variant={l.created ? "warn" : "neutral"}>
                  {l.created ? "new" : "exists"}
                </Chip>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function Warnings({ warnings }: { warnings: string[] }) {
  if (warnings.length === 0) return null;
  return (
    <div
      data-import-warnings
      className="rounded-input border border-gold bg-warn-bg-2 px-3 py-2"
    >
      <h3 className="mb-1 font-semibold text-content">Warnings</h3>
      <ul className="list-disc space-y-0.5 pl-5">
        {warnings.map((w, i) => (
          <li key={i}>{w}</li>
        ))}
      </ul>
    </div>
  );
}

function Preview({ result }: { result: ChecklistImportResult }) {
  return (
    <section
      data-import-preview
      aria-label="Preview"
      className="space-y-3 rounded-input border border-line bg-paper px-4 py-3"
    >
      <p className="font-semibold text-navy" data-preview-total>
        {result.items.total === 0
          ? "No items found."
          : `${result.items.total} ${result.items.total === 1 ? "item" : "items"}: ${result.items.open} open, ${result.items.closed} closed.`}
      </p>
      <Made result={result} />
      <Warnings warnings={result.warnings} />
      {result.plan && result.plan.length > 0 ? (
        <div className="max-h-56 overflow-auto rounded-input border border-line bg-card">
          <table className="w-full text-left text-[12.5px]" data-preview-items>
            <thead>
              <tr className="border-b border-line font-mono text-[10px] uppercase tracking-[.12em] text-content-secondary">
                <th className="px-3 py-2 font-medium">Item</th>
                <th className="px-3 py-2 font-medium">Labels</th>
                <th className="px-3 py-2 font-medium">Milestone</th>
                <th className="px-3 py-2 font-medium">State</th>
              </tr>
            </thead>
            <tbody>
              {result.plan.map((it, i) => (
                <tr
                  key={i}
                  className="border-b border-line last:border-0"
                  data-preview-item
                >
                  <td className="px-3 py-1.5">{it.title}</td>
                  <td className="px-3 py-1.5 font-mono text-[11.5px]">
                    {it.labels.length ? it.labels.map((l) => `#${l}`).join(" ") : ""}
                  </td>
                  <td className="px-3 py-1.5">{it.milestone ?? ""}</td>
                  <td className="px-3 py-1.5">
                    <Chip variant={it.closed ? "neutral" : "info"}>
                      {it.closed ? "Closed" : "Open"}
                    </Chip>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}
