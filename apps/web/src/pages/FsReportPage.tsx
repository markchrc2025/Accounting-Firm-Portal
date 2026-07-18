import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { AccountCombobox } from "../components/AccountCombobox";
import {
  ApiError,
  addFsCustomNote,
  createFsAdjustment,
  deleteFsAdjustment,
  deleteFsCustomNote,
  deleteFsReport,
  exportFsReport,
  fetchChartAccounts,
  fetchFsAdjustments,
  fetchFsNotes,
  fetchFsReport,
  fetchFsStatements,
  fetchFsTrialBalance,
  resetFsPolicyNote,
  setFsPolicyNote,
  setFsTrialBalance,
  updateFsCustomNote,
  type FsNoteDocItem,
  type FsPolicyBlock,
  type FsRow,
  type FsStatements,
} from "../lib/api";
import {
  Button,
  Card,
  Chip,
  EmptyState,
  ErrorState,
  PageHeader,
  Skeleton,
  cn,
  peso,
} from "../components/ui";

type StatementKind = "balance-sheet" | "income-statement" | "cash-flow" | "changes-in-equity";
type Tab = "trial-balance" | "adjustments" | StatementKind | "notes";

const TABS: { key: Tab; label: string }[] = [
  { key: "trial-balance", label: "Trial Balance" },
  { key: "adjustments", label: "Adjustments" },
  { key: "balance-sheet", label: "Balance Sheet" },
  { key: "income-statement", label: "Income Statement" },
  { key: "cash-flow", label: "Cash Flow" },
  { key: "changes-in-equity", label: "Changes in Equity" },
  { key: "notes", label: "Notes" },
];

export default function FsReportPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const { hasPermission } = useAuth();
  const canManage = hasPermission("FinancialStatements:Manage");
  const [tab, setTab] = useState<Tab>("trial-balance");

  const report = useQuery({ queryKey: ["fs-report", id], queryFn: () => fetchFsReport(id) });

  const remove = useMutation({
    mutationFn: () => deleteFsReport(id),
    onSuccess: () => navigate("/financial-statements"),
  });

  const exporting = useMutation({
    mutationFn: () => exportFsReport(id),
    onSuccess: ({ blob, filename }) => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      // The browser dereferences the blob URL in a queued task — revoking
      // synchronously races the download (intermittent failures on Safari).
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    },
  });

  if (report.isPending) return <Skeleton className="h-40" />;
  if (report.isError || !report.data)
    return <ErrorState message="Couldn't load this report." onRetry={() => void report.refetch()} />;

  const r = report.data;

  return (
    <div>
      <PageHeader
        eyebrow="Financial Statements"
        title={r.entityName}
        description={`${r.framework} · periods: ${r.periods.map((p) => p.label).join(", ") || "none"}`}
        actions={
          <>
            <Button variant="primary" disabled={exporting.isPending} onClick={() => exporting.mutate()}>
              {exporting.isPending ? "Exporting…" : "Export .xlsx"}
            </Button>
            {canManage && (
              <Button
                variant="ghost"
                onClick={() => {
                  if (confirm("Delete this FS report and all its data?")) remove.mutate();
                }}
              >
                Delete
              </Button>
            )}
          </>
        }
      />

      {exporting.isError && (
        <div className="mb-4 rounded-input border border-danger/30 bg-danger-bg px-3.5 py-2.5 text-[13px] text-danger-ink">
          {exporting.error instanceof ApiError ? exporting.error.message : "Export failed."}
        </div>
      )}

      <div className="mb-5 flex gap-1 border-b border-line">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={cn(
              "-mb-px border-b-2 px-4 py-2.5 text-[13.5px] font-semibold transition-colors",
              tab === t.key
                ? "border-gold-deep text-navy"
                : "border-transparent text-content-secondary hover:text-navy",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "trial-balance" && <TrialBalanceTab reportId={id} canManage={canManage} />}
      {tab === "adjustments" && <AdjustmentsTab reportId={id} canManage={canManage} />}
      {tab === "notes" && <NotesTab reportId={id} canManage={canManage} />}
      {tab !== "trial-balance" && tab !== "adjustments" && tab !== "notes" && (
        <StatementTab reportId={id} kind={tab} />
      )}
    </div>
  );
}

/* -------------------------------------------------------------- Trial Balance */

interface TbLine {
  accountCode: string;
  amount: string; // kept as string for editing; parsed on save
}

function TrialBalanceTab({ reportId, canManage }: { reportId: string; canManage: boolean }) {
  const queryClient = useQueryClient();
  const report = useQuery({ queryKey: ["fs-report", reportId], queryFn: () => fetchFsReport(reportId) });
  const tb = useQuery({ queryKey: ["fs-tb", reportId], queryFn: () => fetchFsTrialBalance(reportId) });
  const accounts = useQuery({ queryKey: ["coa-accounts"], queryFn: () => fetchChartAccounts() });

  const periods = report.data?.periods ?? [];
  const [periodId, setPeriodId] = useState("");
  useEffect(() => {
    if (!periodId && periods.length) setPeriodId(periods[0]!.id);
  }, [periods, periodId]);

  const [lines, setLines] = useState<TbLine[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  // Seed the editable grid from the saved TB whenever the period changes.
  useEffect(() => {
    if (!periodId || !tb.data) return;
    const rows = tb.data
      .filter((e) => e.periodId === periodId)
      .map((e) => ({ accountCode: e.accountCode, amount: String(e.amount) }));
    setLines(rows.length ? rows : [{ accountCode: "", amount: "" }]);
    setSaved(false);
  }, [periodId, tb.data]);

  const totals = useMemo(() => {
    let debit = 0;
    let credit = 0;
    for (const l of lines) {
      const n = Number.parseFloat(l.amount);
      if (!Number.isFinite(n)) continue;
      if (n >= 0) debit += n;
      else credit += -n;
    }
    return { debit, credit, diff: Math.round((debit - credit) * 100) / 100 };
  }, [lines]);

  const save = useMutation({
    mutationFn: () => {
      const entries = lines
        .filter((l) => l.accountCode.trim() && l.amount.trim())
        .map((l) => ({ accountCode: l.accountCode.trim(), amount: Number.parseFloat(l.amount) }));
      return setFsTrialBalance(reportId, periodId, entries);
    },
    onSuccess: () => {
      setSaved(true);
      setError(null);
      queryClient.invalidateQueries({ queryKey: ["fs-tb", reportId] });
      queryClient.invalidateQueries({ queryKey: ["fs-statements", reportId] });
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : "Save failed."),
  });

  if (report.isPending || tb.isPending) return <Skeleton className="h-40" />;
  if (periods.length === 0)
    return <EmptyState title="No periods" description="Add a period to this report first." />;

  function setLine(i: number, patch: Partial<TbLine>) {
    setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
    setSaved(false);
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-[13px] text-content-secondary">
          Period
          <select value={periodId} onChange={(e) => setPeriodId(e.target.value)} className="input">
            {periods.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </label>
        <span className="font-mono text-[11.5px] text-content-muted">
          Enter each account&apos;s period-end balance — debit positive, credit negative.
        </span>
      </div>

      {error && (
        <div className="mb-3 rounded-input border border-danger/30 bg-danger-bg px-3.5 py-2.5 text-[13px] text-danger-ink">
          {error}
        </div>
      )}

      <Card className="overflow-visible">
        <table className="w-full border-collapse text-left">
          <thead>
            <tr className="border-b border-line bg-sidebar">
              {["Account", "Code", "Balance (dr +, cr −)", canManage ? "" : null]
                .filter((h) => h !== null)
                .map((h, i) => (
                  <th key={i} className="px-4 py-2.5 font-mono text-[10px] font-normal uppercase tracking-[.14em] text-content-secondary">
                    {h}
                  </th>
                ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-line-divider">
            {lines.map((l, i) => (
              <tr key={i}>
                <td className="w-[360px] px-4 py-2">
                  <AccountCombobox
                    accounts={accounts.data ?? []}
                    value={l.accountCode}
                    onSelect={(code) => setLine(i, { accountCode: code })}
                    disabled={!canManage}
                  />
                </td>
                <td className="px-4 py-2 font-mono text-[13px] text-content-secondary">
                  {l.accountCode || <span className="text-content-muted">—</span>}
                </td>
                <td className="px-4 py-2">
                  <input
                    value={l.amount}
                    onChange={(e) => setLine(i, { amount: e.target.value })}
                    disabled={!canManage}
                    inputMode="decimal"
                    placeholder="0.00"
                    className="input w-40 text-right font-mono"
                  />
                </td>
                {canManage && (
                  <td className="px-4 py-2">
                    <button
                      type="button"
                      onClick={() => setLines((ls) => ls.filter((_, idx) => idx !== i))}
                      className="text-content-muted hover:text-danger"
                      aria-label="Remove line"
                    >
                      ✕
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-line bg-sidebar font-mono text-[12px]">
              <td className="px-4 py-2.5 text-content-secondary" colSpan={2}>
                Debit {peso(totals.debit)} · Credit {peso(totals.credit)}
              </td>
              <td className={cn("px-4 py-2.5 text-right", totals.diff === 0 ? "text-success" : "text-warn")}>
                {totals.diff === 0 ? "In balance" : `Off by ${peso(totals.diff)}`}
              </td>
              {canManage && <td />}
            </tr>
          </tfoot>
        </table>
      </Card>

      {canManage && (
        <div className="mt-3 flex items-center gap-2">
          <Button variant="ghost" onClick={() => setLines((ls) => [...ls, { accountCode: "", amount: "" }])}>
            + Add line
          </Button>
          <Button variant="primary" disabled={save.isPending} onClick={() => save.mutate()}>
            {save.isPending ? "Saving…" : "Save trial balance"}
          </Button>
          {saved && <span className="text-[12.5px] text-success">Saved.</span>}
        </div>
      )}
    </div>
  );
}

/* --------------------------------------------------------------- Adjustments */

interface AdjLine {
  accountCode: string;
  debit: string;
  credit: string;
}

function AdjustmentsTab({ reportId, canManage }: { reportId: string; canManage: boolean }) {
  const queryClient = useQueryClient();
  const report = useQuery({ queryKey: ["fs-report", reportId], queryFn: () => fetchFsReport(reportId) });
  const adjustments = useQuery({ queryKey: ["fs-adj", reportId], queryFn: () => fetchFsAdjustments(reportId) });
  const accounts = useQuery({ queryKey: ["coa-accounts"], queryFn: () => fetchChartAccounts() });

  const periods = report.data?.periods ?? [];
  const [periodId, setPeriodId] = useState("");
  const [memo, setMemo] = useState("");
  const [lines, setLines] = useState<AdjLine[]>([
    { accountCode: "", debit: "", credit: "" },
    { accountCode: "", debit: "", credit: "" },
  ]);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!periodId && periods.length) setPeriodId(periods[0]!.id);
  }, [periods, periodId]);

  const nameByCode = useMemo(
    () => new Map((accounts.data ?? []).map((a) => [a.code, a.name])),
    [accounts.data],
  );
  const labelByPeriod = useMemo(
    () => new Map(periods.map((p) => [p.id, p.label])),
    [periods],
  );

  const create = useMutation({
    mutationFn: () =>
      createFsAdjustment(reportId, {
        periodId,
        memo: memo.trim() || undefined,
        lines: lines
          .filter((l) => l.accountCode.trim() && (l.debit.trim() || l.credit.trim()))
          .map((l) => ({
            accountCode: l.accountCode.trim(),
            debit: l.debit ? Number.parseFloat(l.debit) : undefined,
            credit: l.credit ? Number.parseFloat(l.credit) : undefined,
          })),
      }),
    onSuccess: () => {
      setMemo("");
      setLines([
        { accountCode: "", debit: "", credit: "" },
        { accountCode: "", debit: "", credit: "" },
      ]);
      setError(null);
      queryClient.invalidateQueries({ queryKey: ["fs-adj", reportId] });
      queryClient.invalidateQueries({ queryKey: ["fs-statements", reportId] });
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : "Save failed."),
  });

  const del = useMutation({
    mutationFn: (adjustmentId: string) => deleteFsAdjustment(reportId, adjustmentId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["fs-adj", reportId] });
      queryClient.invalidateQueries({ queryKey: ["fs-statements", reportId] });
    },
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    create.mutate();
  }

  return (
    <div className="space-y-6">
      {canManage && periods.length > 0 && (
        <Card className="p-5">
          <h3 className="mb-3 font-serif text-[16px] font-medium text-navy">New adjustment</h3>
          {error && (
            <div className="mb-3 rounded-input border border-danger/30 bg-danger-bg px-3.5 py-2.5 text-[13px] text-danger-ink">
              {error}
            </div>
          )}
          <form onSubmit={submit} className="space-y-3">
            <div className="flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-2 text-[13px] text-content-secondary">
                Period
                <select value={periodId} onChange={(e) => setPeriodId(e.target.value)} className="input">
                  {periods.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </label>
              <input
                value={memo}
                onChange={(e) => setMemo(e.target.value)}
                placeholder="Memo (e.g. accrue depreciation)"
                className="input flex-1"
              />
            </div>
            {lines.map((l, i) => (
              <div key={i} className="flex items-center gap-2">
                <AccountCombobox
                  accounts={accounts.data ?? []}
                  value={l.accountCode}
                  onSelect={(code) =>
                    setLines((ls) => ls.map((x, idx) => (idx === i ? { ...x, accountCode: code } : x)))
                  }
                  className="min-w-0 flex-1"
                />
                <span className="w-20 flex-none font-mono text-[12px] text-content-muted">
                  {l.accountCode}
                </span>
                <input
                  value={l.debit}
                  onChange={(e) => setLines((ls) => ls.map((x, idx) => (idx === i ? { ...x, debit: e.target.value, credit: "" } : x)))}
                  inputMode="decimal"
                  placeholder="Debit"
                  className="input w-32 text-right font-mono"
                />
                <input
                  value={l.credit}
                  onChange={(e) => setLines((ls) => ls.map((x, idx) => (idx === i ? { ...x, credit: e.target.value, debit: "" } : x)))}
                  inputMode="decimal"
                  placeholder="Credit"
                  className="input w-32 text-right font-mono"
                />
              </div>
            ))}
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="ghost"
                onClick={() => setLines((ls) => [...ls, { accountCode: "", debit: "", credit: "" }])}
              >
                + Add line
              </Button>
              <Button type="submit" variant="primary" disabled={create.isPending}>
                {create.isPending ? "Saving…" : "Post adjustment"}
              </Button>
            </div>
          </form>
        </Card>
      )}

      <div>
        <h3 className="mb-3 font-serif text-[16px] font-medium text-navy">Posted adjustments</h3>
        {adjustments.isPending ? (
          <Skeleton className="h-24" />
        ) : (adjustments.data?.length ?? 0) === 0 ? (
          <EmptyState title="No adjustments" description="Workpaper adjustments you post appear here and flow into the statements." />
        ) : (
          <div className="space-y-2.5">
            {adjustments.data!.map((a) => (
              <Card key={a.id} className="p-4">
                <div className="mb-2 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Chip variant="neutral">{labelByPeriod.get(a.periodId) ?? "?"}</Chip>
                    <span className="text-[13px] font-medium text-navy">{a.memo || "Adjustment"}</span>
                  </div>
                  {canManage && (
                    <button
                      type="button"
                      onClick={() => del.mutate(a.id)}
                      className="text-[12px] font-semibold text-content-secondary hover:text-danger"
                    >
                      Delete
                    </button>
                  )}
                </div>
                <table className="w-full text-[12.5px]">
                  <tbody>
                    {a.lines.map((l, i) => (
                      <tr key={i}>
                        <td className="py-0.5 font-mono text-content">{l.accountCode}</td>
                        <td className="py-0.5 text-content-secondary">{nameByCode.get(l.accountCode) ?? ""}</td>
                        <td className="py-0.5 text-right font-mono">{l.debit ? peso(l.debit) : ""}</td>
                        <td className="py-0.5 text-right font-mono">{l.credit ? peso(l.credit) : ""}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- Statements */

const STATEMENT_META: Record<
  "balance-sheet" | "income-statement" | "cash-flow" | "changes-in-equity",
  string
> = {
  "balance-sheet": "Statement of Financial Position",
  "income-statement": "Statement of Income",
  "cash-flow": "Statement of Cash Flows",
  "changes-in-equity": "Statement of Changes in Equity",
};

function StatementTab({
  reportId,
  kind,
}: {
  reportId: string;
  kind: "balance-sheet" | "income-statement" | "cash-flow" | "changes-in-equity";
}) {
  const statements = useQuery({
    queryKey: ["fs-statements", reportId],
    queryFn: () => fetchFsStatements(reportId),
  });

  if (statements.isPending) return <Skeleton className="h-64" />;
  if (statements.isError || !statements.data)
    return <ErrorState message="Couldn't compute the statements." onRetry={() => void statements.refetch()} />;

  const s = statements.data;
  const rows =
    kind === "balance-sheet"
      ? s.balanceSheet.rows
      : kind === "income-statement"
        ? s.incomeStatement.rows
        : kind === "cash-flow"
          ? s.cashFlow.rows
          : s.changesInEquity.rows;

  return (
    <div>
      <div className="mb-4">
        <h2 className="text-center font-serif text-[18px] font-medium text-navy">{s.report.entityName}</h2>
        <p className="text-center text-[13px] text-content-secondary">{STATEMENT_META[kind]}</p>
      </div>

      {kind === "balance-sheet" && <CheckBanner statements={s} kind="balance-sheet" />}
      {kind === "cash-flow" && <CheckBanner statements={s} kind="cash-flow" />}
      {(kind === "cash-flow" || kind === "changes-in-equity") && s.periods.length < 2 && (
        <div className="mb-3 rounded-input border border-line-strong bg-paper px-3.5 py-2 text-[12.5px] text-content-secondary">
          This statement needs at least two periods (it reports movements between periods).
        </div>
      )}

      <Card className="overflow-x-auto">
        <FsStatementTable rows={rows} periods={s.periods} />
      </Card>
    </div>
  );
}

/** Green when balanced, amber with the offending periods otherwise. Used for the
 *  balance-sheet tie and the cash-flow reconciliation to the change in cash. */
function CheckBanner({ statements, kind }: { statements: FsStatements; kind: "balance-sheet" | "cash-flow" }) {
  const check = kind === "balance-sheet" ? statements.balanceSheet.balanceCheck : statements.cashFlow.check;
  const offPeriods = statements.periods.filter((p) => p.id in check && Math.abs(check[p.id] ?? 0) >= 0.01);
  const okMsg =
    kind === "balance-sheet"
      ? "Balanced — Assets = Liabilities + Equity in every period."
      : "Reconciled — activities tie to the change in cash.";
  if (offPeriods.length === 0)
    return (
      <div className="mb-3 rounded-input border border-success/30 bg-success-bg px-3.5 py-2 text-[12.5px] text-success">
        {okMsg}
      </div>
    );
  return (
    <div className="mb-3 rounded-input border border-warn/40 bg-warn-bg px-3.5 py-2 text-[12.5px] text-warn">
      {kind === "balance-sheet" ? "Out of balance: " : "Doesn't reconcile: "}
      {offPeriods.map((p) => `${p.label} off by ${peso(check[p.id] ?? 0)}`).join(" · ")}
      {kind === "balance-sheet"
        ? ". Check the trial balance (a pre-closing TB differs by net income until earnings roll to equity)."
        : ". Check that each period's trial balance ties."}
    </div>
  );
}

function FsStatementTable({
  rows,
  periods,
}: {
  rows: FsRow[];
  periods: { id: string; label: string }[];
}) {
  return (
    <table className="w-full min-w-[540px] border-collapse text-left">
      <thead>
        <tr className="border-b border-line">
          <th className="px-5 py-2.5 font-mono text-[10px] font-normal uppercase tracking-[.14em] text-content-secondary">
            &nbsp;
          </th>
          {periods.map((p) => (
            <th
              key={p.id}
              className="px-5 py-2.5 text-right font-mono text-[10px] font-normal uppercase tracking-[.14em] text-content-secondary"
            >
              {p.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, i) => {
          if (row.kind === "spacer") return <tr key={i}><td colSpan={periods.length + 1} className="py-1.5" /></tr>;
          const isHeading = row.kind === "section";
          const isTotalish = row.kind === "total" || row.kind === "subtotal";
          return (
            <tr
              key={i}
              className={cn(
                (row.kind === "total" || row.emphasis) && "border-t border-line",
                row.kind === "total" && "border-t-2",
              )}
            >
              <td
                className={cn(
                  "px-5 py-[7px] text-[13px]",
                  isHeading && "font-mono text-[11px] uppercase tracking-[.12em] text-gold-deep",
                  isTotalish && "font-semibold text-navy",
                  row.kind === "group" && "font-medium text-navy",
                  row.kind === "line" && "text-content-secondary",
                  row.emphasis && "font-semibold text-navy",
                )}
                style={{ paddingLeft: `${20 + row.level * 16}px` }}
              >
                {row.label}
              </td>
              {periods.map((p) => (
                <td
                  key={p.id}
                  className={cn(
                    "px-5 py-[7px] text-right font-mono text-[12.5px] tabular-nums",
                    isTotalish || row.emphasis ? "font-semibold text-navy" : "text-content",
                  )}
                >
                  {row.amounts && p.id in row.amounts ? peso(row.amounts[p.id]!) : ""}
                </td>
              ))}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/* --------------------------------------------------------------------- Notes */

function NotesTab({ reportId, canManage }: { reportId: string; canManage: boolean }) {
  const queryClient = useQueryClient();
  const [managing, setManaging] = useState(false);
  const notes = useQuery({ queryKey: ["fs-notes", reportId], queryFn: () => fetchFsNotes(reportId) });

  if (notes.isPending) return <Skeleton className="h-64" />;
  if (notes.isError || !notes.data)
    return <ErrorState message="Couldn't load the notes." onRetry={() => void notes.refetch()} />;

  const doc = notes.data;
  const setData = (d: typeof doc) => queryClient.setQueryData(["fs-notes", reportId], d);

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="font-serif text-[18px] font-medium text-navy">{doc.report.entityName}</h2>
          <p className="text-[13px] text-content-secondary">Notes to Financial Statements</p>
        </div>
        {canManage && (
          <Button variant="ghost" onClick={() => setManaging((m) => !m)}>
            {managing ? "Done editing" : "Edit notes"}
          </Button>
        )}
      </div>

      {managing && canManage ? (
        <NotesManager reportId={reportId} doc={doc} onChange={setData} />
      ) : (
        <Card className="space-y-6 px-6 py-6">
          {doc.document.map((item) => (
            <NoteView key={item.key} item={item} periods={doc.periods} />
          ))}
        </Card>
      )}
    </div>
  );
}

function NoteView({
  item,
  periods,
}: {
  item: FsNoteDocItem;
  periods: { id: string; label: string }[];
}) {
  return (
    <div>
      <h3 className="mb-1.5 text-[14px] font-semibold text-navy">
        {item.number}. {item.title}
      </h3>
      {item.paragraphs?.map((p, i) => (
        <p key={i} className="mb-2 text-[13px] leading-relaxed text-content-secondary">
          {p}
        </p>
      ))}
      {item.table && (
        <table className="mt-1 w-full max-w-[520px] border-collapse text-left">
          <thead>
            <tr className="border-b border-line">
              <th />
              {periods.map((p) => (
                <th key={p.id} className="px-3 py-1.5 text-right font-mono text-[10px] uppercase tracking-wide text-content-secondary">
                  {p.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {item.table.rows.map((r, i) => (
              <tr key={i} className={cn(r.emphasis && "border-t border-line")}>
                <td className={cn("px-3 py-1 text-[12.5px]", r.emphasis ? "font-semibold text-navy" : "text-content-secondary")}>
                  {r.label}
                </td>
                {periods.map((p) => (
                  <td key={p.id} className={cn("px-3 py-1 text-right font-mono text-[12px] tabular-nums", r.emphasis && "font-semibold text-navy")}>
                    {p.id in r.amounts ? peso(r.amounts[p.id]!) : ""}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function NotesManager({
  reportId,
  doc,
  onChange,
}: {
  reportId: string;
  doc: import("../lib/api").FsNotesDocument;
  onChange: (d: import("../lib/api").FsNotesDocument) => void;
}) {
  const [newTitle, setNewTitle] = useState("");
  const [newBody, setNewBody] = useState("");

  const togglePolicy = useMutation({
    mutationFn: (b: FsPolicyBlock) => setFsPolicyNote(reportId, b.blockKey, { included: !b.included }),
    onSuccess: onChange,
  });
  const savePolicy = useMutation({
    mutationFn: (v: { blockKey: string; body: string }) => setFsPolicyNote(reportId, v.blockKey, { body: v.body }),
    onSuccess: onChange,
  });
  const resetPolicy = useMutation({
    mutationFn: (blockKey: string) => resetFsPolicyNote(reportId, blockKey),
    onSuccess: onChange,
  });
  const addCustom = useMutation({
    mutationFn: () => addFsCustomNote(reportId, { title: newTitle.trim() || undefined, body: newBody.trim() }),
    onSuccess: (d) => {
      setNewTitle("");
      setNewBody("");
      onChange(d);
    },
  });
  const delCustom = useMutation({
    mutationFn: (noteId: string) => deleteFsCustomNote(reportId, noteId),
    onSuccess: onChange,
  });
  const saveCustom = useMutation({
    mutationFn: (v: { noteId: string; title: string; body: string }) =>
      updateFsCustomNote(reportId, v.noteId, { title: v.title || undefined, body: v.body }),
    onSuccess: onChange,
  });

  return (
    <div className="space-y-6">
      <Card className="px-5 py-5">
        <h3 className="mb-3 font-serif text-[15px] font-medium text-navy">Accounting policy blocks</h3>
        <div className="space-y-4">
          {doc.policyBlocks.map((b) => (
            <PolicyBlockEditor
              key={b.blockKey}
              block={b}
              onToggle={() => togglePolicy.mutate(b)}
              onSave={(body) => savePolicy.mutate({ blockKey: b.blockKey, body })}
              onReset={() => resetPolicy.mutate(b.blockKey)}
            />
          ))}
        </div>
      </Card>

      <Card className="px-5 py-5">
        <h3 className="mb-3 font-serif text-[15px] font-medium text-navy">Custom notes</h3>
        <div className="space-y-4">
          {doc.customNotes.map((c) => (
            <CustomNoteEditor
              key={c.id}
              note={c}
              onSave={(title, body) => saveCustom.mutate({ noteId: c.id, title, body })}
              onDelete={() => delCustom.mutate(c.id)}
            />
          ))}
          <div className="rounded-input border border-dashed border-line-strong p-3">
            <input
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              placeholder="Note title (optional)"
              className="input mb-2"
            />
            <textarea
              value={newBody}
              onChange={(e) => setNewBody(e.target.value)}
              placeholder="Note text — blank lines separate paragraphs."
              rows={3}
              className="input"
            />
            <Button
              variant="primary"
              className="mt-2"
              disabled={!newBody.trim() || addCustom.isPending}
              onClick={() => addCustom.mutate()}
            >
              {addCustom.isPending ? "Adding…" : "Add note"}
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}

function PolicyBlockEditor({
  block,
  onToggle,
  onSave,
  onReset,
}: {
  block: FsPolicyBlock;
  onToggle: () => void;
  onSave: (body: string) => void;
  onReset: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [body, setBody] = useState(block.body);

  return (
    <div className="border-b border-line-divider pb-4 last:border-0 last:pb-0">
      <div className="flex items-center justify-between">
        <label className="flex items-center gap-2 text-[13.5px] font-semibold text-navy">
          <input type="checkbox" checked={block.included} onChange={onToggle} />
          {block.title}
          {block.overridden && (
            <span className="rounded-chip bg-info-bg px-1.5 py-0.5 font-mono text-[9.5px] uppercase tracking-wide text-blue">
              Edited
            </span>
          )}
        </label>
        <div className="flex items-center gap-2 text-[12px] font-semibold">
          <button
            type="button"
            className="text-blue hover:underline"
            onClick={() => {
              setBody(block.body);
              setEditing((e) => !e);
            }}
          >
            {editing ? "Close" : "Edit text"}
          </button>
          {block.overridden && (
            <button type="button" className="text-content-secondary hover:text-danger hover:underline" onClick={onReset}>
              Reset
            </button>
          )}
        </div>
      </div>
      {editing && (
        <div className="mt-2">
          <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={8} className="input font-[inherit]" />
          <Button
            variant="primary"
            className="mt-2"
            onClick={() => {
              onSave(body);
              setEditing(false);
            }}
          >
            Save text
          </Button>
        </div>
      )}
    </div>
  );
}

function CustomNoteEditor({
  note,
  onSave,
  onDelete,
}: {
  note: import("../lib/api").FsCustomNote;
  onSave: (title: string, body: string) => void;
  onDelete: () => void;
}) {
  const [title, setTitle] = useState(note.title ?? "");
  const [body, setBody] = useState(note.body);
  return (
    <div className="rounded-input border border-line p-3">
      <div className="mb-2 flex items-center gap-2">
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title" className="input flex-1" />
        <button type="button" onClick={onDelete} className="text-[12px] font-semibold text-content-secondary hover:text-danger">
          Delete
        </button>
      </div>
      <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={3} className="input" />
      <Button variant="ghost" className="mt-2" onClick={() => onSave(title, body)}>
        Save
      </Button>
    </div>
  );
}
