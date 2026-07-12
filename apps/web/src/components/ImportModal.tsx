import { useRef, useState } from "react";
import { ExpenseImportRow, SalesImportRow } from "@portal/shared";
import {
  importIncome,
  importPurchases,
  type ImportResult,
} from "../lib/api";
import {
  EXPENSE_ALIASES,
  EXPENSE_HEADERS,
  SALES_ALIASES,
  SALES_HEADERS,
  downloadSheet,
  isBlankRow,
  mapImportRows,
  parseSheet,
} from "../lib/spreadsheet";
import { Button, cn, peso } from "./ui";

type Kind = "income" | "expense";
type Regime = "VAT" | "PERCENTAGE";

interface Entry {
  index: number; // 1-based row number in the file (after header)
  data: Record<string, unknown>;
  ok: boolean;
  error?: string;
}

/** Fill the domain-required fields the template treats as optional: a blank
 *  Category becomes "Uncategorized"; a blank Description falls back to the
 *  counterparty name (or a generic label). */
function fillRequired(row: Record<string, unknown>, isIncome: boolean): Record<string, unknown> {
  const r = { ...row };
  if (!String(r.Category ?? "").trim()) r.Category = "Uncategorized";
  if (!String(r.Description ?? "").trim()) {
    const party = String((isIncome ? r.Customer : r.Vendor) ?? "").trim();
    r.Description = party || (isIncome ? "Imported sale" : "Imported expense");
  }
  return r;
}

/** First zod issue as "path: message" (or the raw message). */
function firstIssue(err: { issues: { path: (string | number)[]; message: string }[] }): string {
  const i = err.issues[0];
  if (!i) return "Invalid row";
  const p = i.path.join(".");
  return p ? `${p}: ${i.message}` : i.message;
}

export function ImportModal({
  kind,
  clientId,
  regime,
  onClose,
  onImported,
}: {
  kind: Kind;
  clientId: string;
  regime: Regime;
  onClose: () => void;
  onImported: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState("");
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [parsing, setParsing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const isIncome = kind === "income";
  const schema = isIncome ? SalesImportRow : ExpenseImportRow;
  const aliases = isIncome ? SALES_ALIASES : EXPENSE_ALIASES;
  const headers = isIncome ? SALES_HEADERS : EXPENSE_HEADERS;
  // Income requires a VatClass; default it from the client's regime.
  const defaults = isIncome
    ? { VatClass: regime === "VAT" ? "VATABLE_12" : "NON_VAT" }
    : {};

  async function onPick(file: File | null) {
    if (fileRef.current) fileRef.current.value = "";
    if (!file) return;
    setFileName(file.name);
    setParsing(true);
    setError(null);
    setResult(null);
    try {
      const raw = await parseSheet(file);
      const mapped = mapImportRows(raw, aliases, defaults)
        .filter((r) => !isBlankRow(r))
        .map((r) => fillRequired(r, isIncome));
      const list: Entry[] = mapped.map((data, i) => {
        const parsed = schema.safeParse(data);
        return parsed.success
          ? { index: i + 1, data, ok: true }
          : { index: i + 1, data, ok: false, error: firstIssue(parsed.error) };
      });
      setEntries(list);
    } catch {
      setError("Couldn't read that file. Use the .xlsx or .csv template.");
    } finally {
      setParsing(false);
    }
  }

  async function onImport() {
    if (!entries) return;
    const valid = entries.filter((e) => e.ok).map((e) => e.data);
    if (valid.length === 0) return;
    setImporting(true);
    setError(null);
    try {
      const res = isIncome
        ? await importIncome(clientId, valid)
        : await importPurchases(clientId, valid);
      setResult(res);
      if (res.created > 0) onImported();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Import failed.");
    } finally {
      setImporting(false);
    }
  }

  function downloadTemplate() {
    void downloadSheet(
      `${isIncome ? "sales" : "expenses"}-template.xlsx`,
      isIncome ? "SALES" : "EXPENSES",
      [],
      headers,
    );
  }

  const validCount = entries?.filter((e) => e.ok).length ?? 0;
  const invalidCount = entries?.filter((e) => !e.ok).length ?? 0;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(14,33,44,0.45)] p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[90vh] w-full max-w-[760px] animate-fade-rise flex-col overflow-hidden rounded-modal bg-card shadow-modal"
      >
        <div className="flex items-center justify-between border-b border-line px-6 py-4">
          <div>
            <div className="eyebrow">Import · {isIncome ? "Sales & Income" : "Expenses"}</div>
            <h2 className="mt-0.5 font-serif text-[19px] font-medium text-navy">
              Import from Excel / CSV
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="text-content-muted hover:text-navy"
          >
            ✕
          </button>
        </div>

        <div className="flex-1 space-y-4 overflow-auto px-6 py-5">
          {/* Result view */}
          {result ? (
            <div className="space-y-3">
              <div className="rounded-card border border-success/30 bg-success-bg px-4 py-3 text-[13.5px]">
                <span className="font-semibold text-success">{result.created}</span> record
                {result.created === 1 ? "" : "s"} imported
                {result.failed > 0 ? (
                  <>
                    {" · "}
                    <span className="font-semibold text-danger-ink">{result.failed}</span> skipped
                  </>
                ) : null}
                .
              </div>
              {result.errors.length > 0 && (
                <div className="max-h-[240px] overflow-auto rounded-card border border-line-strong">
                  <table className="w-full text-left text-[12.5px]">
                    <thead className="bg-sidebar font-mono text-[10px] uppercase tracking-[.12em] text-content-secondary">
                      <tr>
                        <th className="px-4 py-2 font-normal">Row</th>
                        <th className="px-4 py-2 font-normal">Reason skipped</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-line-divider">
                      {result.errors.map((e) => (
                        <tr key={e.row}>
                          <td className="px-4 py-2 font-mono text-content-secondary">{e.row}</td>
                          <td className="px-4 py-2 text-danger-ink">{e.message}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          ) : entries ? (
            /* Preview view */
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-3 text-[13px]">
                <span className="font-mono text-content-secondary">{fileName}</span>
                <span className="rounded-chip bg-success-bg px-2 py-0.5 font-semibold text-success">
                  {validCount} ready
                </span>
                {invalidCount > 0 && (
                  <span className="rounded-chip bg-danger-bg px-2 py-0.5 font-semibold text-danger-ink">
                    {invalidCount} with errors
                  </span>
                )}
              </div>
              <div className="max-h-[360px] overflow-auto rounded-card border border-line-strong">
                <table className="w-full min-w-[620px] text-left text-[12.5px]">
                  <thead className="sticky top-0 bg-sidebar font-mono text-[10px] uppercase tracking-[.12em] text-content-secondary">
                    <tr>
                      <th className="px-3 py-2 font-normal">#</th>
                      <th className="px-3 py-2 font-normal">Date</th>
                      <th className="px-3 py-2 font-normal">{isIncome ? "Customer" : "Vendor"}</th>
                      <th className="px-3 py-2 font-normal">Category</th>
                      <th className="px-3 py-2 text-right font-normal">Amount</th>
                      <th className="px-3 py-2 font-normal">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line-divider">
                    {entries.slice(0, 200).map((e) => {
                      const amt = Number(e.data.NetAmount);
                      return (
                        <tr key={e.index} className={cn(!e.ok && "bg-danger-bg/40")}>
                          <td className="px-3 py-1.5 font-mono text-content-muted">{e.index}</td>
                          <td className="px-3 py-1.5 font-mono text-content-secondary">
                            {String(e.data.Date ?? "—")}
                          </td>
                          <td className="px-3 py-1.5 text-content">
                            {String((isIncome ? e.data.Customer : e.data.Vendor) ?? "—")}
                          </td>
                          <td className="px-3 py-1.5 text-content-secondary">
                            {String(e.data.Category ?? "—")}
                          </td>
                          <td className="px-3 py-1.5 text-right font-mono">
                            {Number.isFinite(amt) ? peso(amt) : "—"}
                          </td>
                          <td className="px-3 py-1.5">
                            {e.ok ? (
                              <span className="text-success">Ready</span>
                            ) : (
                              <span className="text-danger-ink" title={e.error}>
                                {e.error}
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {entries.length > 200 && (
                <p className="text-[12px] text-content-muted">
                  Showing the first 200 of {entries.length} rows. All valid rows will import.
                </p>
              )}
            </div>
          ) : (
            /* Pick view */
            <div className="space-y-4">
              <p className="text-[13.5px] text-content-secondary">
                Upload a <strong>.xlsx</strong> or <strong>.csv</strong> file. Columns from the
                standard template are recognised automatically. Amounts are stored{" "}
                <strong>net of VAT</strong>
                {isIncome ? (
                  <>
                    {" "}
                    and each row is classified as{" "}
                    <span className="font-mono">
                      {regime === "VAT" ? "VATABLE_12" : "NON_VAT"}
                    </span>{" "}
                    (this client&apos;s regime) unless the file sets a VAT class.
                  </>
                ) : (
                  "."
                )}{" "}
                New categories are created automatically.
              </p>
              <input
                ref={fileRef}
                type="file"
                accept=".xlsx,.xls,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
                className="hidden"
                onChange={(e) => onPick(e.target.files?.[0] ?? null)}
              />
              {/* Drag & drop zone (also click-to-browse). */}
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
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
                <span className="text-2xl" aria-hidden>
                  ⬆️
                </span>
                <span className="text-[14px] font-semibold text-navy">
                  {parsing ? "Reading…" : "Drop a file here, or click to browse"}
                </span>
                <span className="text-[12px] text-content-secondary">.xlsx or .csv</span>
              </button>
              <div className="flex flex-wrap items-center gap-3">
                <Button onClick={() => fileRef.current?.click()} disabled={parsing}>
                  {parsing ? "Reading…" : "Choose file"}
                </Button>
                <button
                  type="button"
                  onClick={downloadTemplate}
                  className="text-[13px] font-semibold text-blue hover:text-navy-hover hover:underline"
                >
                  Download blank template
                </button>
              </div>
              {error && (
                <p className="rounded-input border border-danger/30 bg-danger-bg px-3 py-2 text-[13px] text-danger-ink">
                  {error}
                </p>
              )}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-line px-6 py-4">
          <div className="text-[12.5px] text-danger-ink">{error && entries ? error : ""}</div>
          <div className="flex items-center gap-2">
            {result ? (
              <Button
                onClick={() => {
                  onClose();
                }}
              >
                Done
              </Button>
            ) : entries ? (
              <>
                <Button
                  variant="ghost"
                  onClick={() => {
                    setEntries(null);
                    setFileName("");
                  }}
                >
                  Back
                </Button>
                <Button onClick={onImport} disabled={importing || validCount === 0}>
                  {importing ? "Importing…" : `Import ${validCount} row${validCount === 1 ? "" : "s"}`}
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
    </div>
  );
}
