// ExpenseImportModal.tsx — the Expenses import through the API (W5, D31).
//
// The browser reads nothing. The flow is:
//   Download template (built by the API for the selected client)
//   → choose the filled file
//   → the API checks it (dry run) and the table shows, row by row, what it WOULD
//     do: post, hold, or reject — with its messages and the records it would
//     create, and the totals
//   → Import sends the same file for real, and the table shows what it DID.
// Every error message is the server's own `{ message }`, shown verbatim.
//
// Contract: Track A U6, as fixed in W5 R1.

import { useRef, useState } from "react";
import {
  downloadExpenseTemplate,
  importExpenseFile,
  type ExpenseImportOutcome,
  type ExpenseImportResult,
} from "../lib/api";
import { outcomeLabel } from "../lib/expenseStatus";
import { Button, Chip, cn, peso } from "./ui";

type Stage = "pick" | "checking" | "checked" | "importing" | "done";

const XLSX_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/** The expenses template is an .xlsx workbook — by name or by type, as the
 *  file picker's `accept` list says; nothing else is sent. */
function isXlsxFile(f: File): boolean {
  return /\.xlsx$/i.test(f.name) || f.type === XLSX_TYPE;
}

/** What a picked or dropped file that is not the template reads as: the
 *  server's own words for it (expense-import.parser.ts), so both paths read
 *  as the picker always has. */
const NOT_XLSX =
  "The file is not an .xlsx workbook. Upload the template you downloaded, filled in.";

const OUTCOME_CHIP: Record<ExpenseImportOutcome, "success" | "warn" | "danger"> = {
  posted: "success",
  held: "warn",
  rejected: "danger",
};

/** The row-by-row result table, shared by the dry run and the final result. */
export function ExpenseImportResultTable({
  result,
  final,
}: {
  result: ExpenseImportResult;
  final: boolean;
}) {
  const t = result.totals;
  return (
    <div className="space-y-2">
      <div className="max-h-[380px] overflow-auto rounded-card border border-line-strong">
        <table
          className="w-full min-w-[680px] text-left text-[12.5px]"
          aria-label={final ? "Import result" : "Import check"}
        >
          <thead className="sticky top-0 bg-sidebar font-mono text-[10px] uppercase tracking-[.12em] text-content-secondary">
            <tr>
              <th className="px-3 py-2 font-normal">Row</th>
              <th className="px-3 py-2 font-normal">Outcome</th>
              <th className="px-3 py-2 font-normal">Messages</th>
              <th className="px-3 py-2 font-normal">
                {final ? "Records created" : "Records it will create"}
              </th>
              <th className="px-3 py-2 text-right font-normal">Amount</th>
              <th className="px-3 py-2 text-right font-normal">VAT</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line-divider align-top">
            {result.rows.map((r) => {
              const records = r.records.length ? r.records : [null];
              return records.map((rec, i) => (
                <tr
                  key={`${r.rowNumber}-${i}`}
                  data-row-number={r.rowNumber}
                  data-outcome={r.outcome}
                  className={cn(
                    i > 0 && "border-t-0",
                    r.outcome === "rejected" && "bg-danger-bg/40",
                  )}
                >
                  {i === 0 ? (
                    <>
                      <td
                        className="px-3 py-1.5 font-mono text-content-muted"
                        rowSpan={records.length}
                      >
                        {r.rowNumber}
                      </td>
                      <td className="px-3 py-1.5" rowSpan={records.length}>
                        <div className="flex flex-wrap gap-1">
                          <Chip variant={OUTCOME_CHIP[r.outcome]}>
                            {outcomeLabel(r.outcome, final)}
                          </Chip>
                          {r.needsReview ? (
                            <Chip variant="gold">Needs review</Chip>
                          ) : null}
                        </div>
                      </td>
                      <td
                        className="px-3 py-1.5 text-content-secondary"
                        rowSpan={records.length}
                      >
                        {r.messages.length ? (
                          <ul className="space-y-0.5">
                            {r.messages.map((m, j) => (
                              <li key={j}>{m}</li>
                            ))}
                          </ul>
                        ) : (
                          "—"
                        )}
                      </td>
                    </>
                  ) : null}
                  <td className="px-3 py-1.5 font-mono text-[11.5px] text-content">
                    {rec ? rec.classification : "None"}
                    {rec && !rec.vatClaimable && rec.vatAmount !== 0 ? (
                      <span className="ml-1 text-content-muted">(VAT not claimable)</span>
                    ) : null}
                  </td>
                  <td className="px-3 py-1.5 text-right font-mono" data-amount>
                    {rec ? peso(rec.amount) : "—"}
                  </td>
                  <td className="px-3 py-1.5 text-right font-mono text-content-secondary">
                    {rec ? peso(rec.vatAmount) : "—"}
                  </td>
                </tr>
              ));
            })}
          </tbody>
        </table>
      </div>
      <div
        className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-card bg-sidebar px-3 py-2 text-[12.5px]"
        data-testid="import-totals"
      >
        <span>
          <span className="font-semibold">{t.rows}</span> row{t.rows === 1 ? "" : "s"}
        </span>
        <span className="text-success">
          <span className="font-semibold">{t.posted}</span>{" "}
          {final ? "posted" : "will post"}
        </span>
        <span className="text-warn">
          <span className="font-semibold">{t.held}</span>{" "}
          {final ? "held" : "will be held"}
        </span>
        <span className="text-danger-ink">
          <span className="font-semibold">{t.rejected}</span> rejected
        </span>
        <span className="ml-auto">
          Gross <span className="font-mono font-semibold">{peso(t.grossAmount)}</span>
        </span>
      </div>
    </div>
  );
}

export function ExpenseImportModal({
  clientId,
  onClose,
  onImported,
}: {
  clientId: string;
  onClose: () => void;
  onImported: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  /** Guards against a slow response for an earlier file landing on a later one. */
  const req = useRef(0);
  const [stage, setStage] = useState<Stage>("pick");
  const [file, setFile] = useState<File | null>(null);
  const [check, setCheck] = useState<ExpenseImportResult | null>(null);
  const [result, setResult] = useState<ExpenseImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  async function onDownload() {
    setDownloading(true);
    setError(null);
    try {
      const { blob, filename } = await downloadExpenseTemplate(clientId);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not download the template.");
    } finally {
      setDownloading(false);
    }
  }

  async function onPick(picked: File | null) {
    if (fileRef.current) fileRef.current.value = "";
    if (!picked) return;
    const mine = ++req.current;
    // Picked or dropped, only the .xlsx template goes to the server (W6 R3).
    if (!isXlsxFile(picked)) {
      setFile(null);
      setCheck(null);
      setResult(null);
      setError(NOT_XLSX);
      setStage("pick");
      return;
    }
    setFile(picked);
    setCheck(null);
    setResult(null);
    setError(null);
    setStage("checking");
    try {
      const res = await importExpenseFile(clientId, picked, true);
      if (mine !== req.current) return;
      setCheck(res);
      setStage("checked");
    } catch (e) {
      if (mine !== req.current) return;
      setError(e instanceof Error ? e.message : "The file could not be checked.");
      setStage("pick");
    }
  }

  async function onImport() {
    if (!file || !check) return;
    const mine = ++req.current;
    setError(null);
    setStage("importing");
    try {
      const res = await importExpenseFile(clientId, file, false);
      if (mine !== req.current) return;
      setResult(res);
      setStage("done");
      if (res.totals.posted + res.totals.held > 0) onImported();
    } catch (e) {
      if (mine !== req.current) return;
      setError(e instanceof Error ? e.message : "The import failed.");
      setStage("checked");
    }
  }

  function reset() {
    req.current++;
    setFile(null);
    setCheck(null);
    setResult(null);
    setError(null);
    setStage("pick");
  }

  const willCreate = check ? check.totals.posted + check.totals.held : 0;
  // While the import runs the dialog stays open: closing it would hide the
  // outcome of a write that is already under way (W6 R3).
  const importing = stage === "importing";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(14,33,44,0.45)] p-4"
      onClick={importing ? undefined : onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Import expenses"
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[90vh] w-full max-w-[880px] animate-fade-rise flex-col overflow-hidden rounded-modal bg-card shadow-modal"
      >
        <div className="flex items-center justify-between border-b border-line px-6 py-4">
          <div>
            <div className="eyebrow">Import · Expenses</div>
            <h2 className="mt-0.5 font-serif text-[19px] font-medium text-navy">
              Import from the expenses template
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            disabled={importing}
            title={
              importing ? "The import is running. Wait for it to finish." : undefined
            }
            className="text-content-muted hover:text-navy disabled:cursor-not-allowed disabled:opacity-40"
          >
            ✕
          </button>
        </div>

        <div className="flex-1 space-y-4 overflow-auto px-6 py-5">
          {stage === "done" && result ? (
            <div className="space-y-3">
              <div className="rounded-card border border-success/30 bg-success-bg px-4 py-3 text-[13.5px]">
                Import finished:{" "}
                <span className="font-semibold">{result.totals.posted}</span> posted,{" "}
                <span className="font-semibold">{result.totals.held}</span> held for
                review, <span className="font-semibold">{result.totals.rejected}</span>{" "}
                rejected.
              </div>
              <ExpenseImportResultTable result={result} final />
            </div>
          ) : (stage === "checked" || stage === "importing") && check ? (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px]">
                <span className="font-mono text-content-secondary">{file?.name}</span>
                <span className="text-content-muted">
                  Template version {check.templateVersion} · period {check.periodFrom} to{" "}
                  {check.periodTo}
                </span>
              </div>
              <p className="text-[13px] text-content-secondary">
                This is a check. Nothing has been saved yet. Press <strong>Import</strong>{" "}
                to save the rows that will post or be held; rejected rows are not saved.
              </p>
              <ExpenseImportResultTable result={check} final={false} />
            </div>
          ) : (
            <div className="space-y-4">
              <p className="text-[13.5px] text-content-secondary">
                Download the template for this client, fill it in, and upload it here. The
                Portal checks every row first and shows you what it will do. Nothing is
                saved until you press <strong>Import</strong>.
              </p>
              <div>
                <Button
                  variant="outline"
                  onClick={() => void onDownload()}
                  disabled={downloading}
                >
                  {downloading ? "Downloading…" : "Download template"}
                </Button>
              </div>
              <input
                ref={fileRef}
                type="file"
                accept={`.xlsx,${XLSX_TYPE}`}
                className="hidden"
                onChange={(e) => void onPick(e.target.files?.[0] ?? null)}
              />
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                disabled={stage === "checking"}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragOver(true);
                }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragOver(false);
                  void onPick(e.dataTransfer.files?.[0] ?? null);
                }}
                className={cn(
                  "flex w-full flex-col items-center justify-center gap-1.5 rounded-card border-2 border-dashed px-6 py-10 text-center transition-colors",
                  dragOver
                    ? "border-gold bg-warn-bg-2"
                    : "border-line-strong bg-paper hover:border-navy",
                )}
              >
                <span className="text-[14px] font-semibold text-navy">
                  {stage === "checking"
                    ? `Checking ${file?.name ?? "the file"}…`
                    : "Drop the filled template here, or click to choose it"}
                </span>
                <span className="text-[12px] text-content-secondary">.xlsx</span>
              </button>
            </div>
          )}

          {error ? (
            <p
              role="alert"
              className="rounded-input border border-danger/30 bg-danger-bg px-3 py-2 text-[13px] text-danger-ink"
            >
              {error}
            </p>
          ) : null}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-line px-6 py-4">
          {stage === "done" ? (
            <Button onClick={onClose}>Done</Button>
          ) : stage === "checked" || stage === "importing" ? (
            <>
              <Button variant="ghost" onClick={reset} disabled={stage === "importing"}>
                Choose another file
              </Button>
              <Button
                onClick={() => void onImport()}
                disabled={stage === "importing" || willCreate === 0}
              >
                {stage === "importing"
                  ? "Importing…"
                  : `Import ${willCreate} row${willCreate === 1 ? "" : "s"}`}
              </Button>
            </>
          ) : (
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
