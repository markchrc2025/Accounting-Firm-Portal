import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import {
  ApiError,
  createFsReport,
  fetchClients,
  fetchFsReports,
  type CreateFsReportInput,
  type FsPeriodInput,
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
} from "../components/ui";

/** Standalone Financial Statement Creator — list of reports + a create dialog.
 *  Reads open to any firm user; creating requires FinancialStatements:Manage. */
export default function FinancialStatementsPage() {
  const { hasPermission } = useAuth();
  const canManage = hasPermission("FinancialStatements:Manage");
  const [creating, setCreating] = useState(false);

  const reports = useQuery({ queryKey: ["fs-reports"], queryFn: fetchFsReports });

  return (
    <div>
      <PageHeader
        eyebrow="Financial Statements"
        title="FS Creator"
        description="Build a set of financial statements from a trial balance validated against your Chart of Accounts."
        actions={
          canManage ? (
            <Button variant="primary" onClick={() => setCreating(true)}>
              + New report
            </Button>
          ) : null
        }
      />

      {reports.isPending ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-16" />
          ))}
        </div>
      ) : reports.isError ? (
        <ErrorState message="Couldn't load FS reports." onRetry={() => void reports.refetch()} />
      ) : reports.data.length === 0 ? (
        <EmptyState
          title="No financial statements yet"
          description={
            canManage
              ? "Create a report, enter a trial balance per period, and the statements build themselves."
              : "Ask an accountant to create the first report."
          }
        />
      ) : (
        <div className="space-y-2.5">
          {reports.data.map((r) => (
            <Link key={r.id} to={`/financial-statements/${r.id}`} className="block">
              <Card className="flex items-center justify-between px-5 py-4 transition-colors hover:bg-rowhover">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-[15px] font-semibold text-navy">
                      {r.entityName}
                    </span>
                    <Chip variant={r.status === "final" ? "success" : "neutral"}>{r.status}</Chip>
                  </div>
                  <div className="mt-1 font-mono text-[11.5px] text-content-muted">
                    {r.clientId ? "Linked client · " : ""}
                    {r.framework} · {r.periods.length} period{r.periods.length === 1 ? "" : "s"}
                    {r.periods.length ? ` (${r.periods.map((p) => p.label).join(", ")})` : ""}
                  </div>
                </div>
                <span className="font-mono text-[11px] uppercase tracking-wide text-gold-deep">
                  Open →
                </span>
              </Card>
            </Link>
          ))}
        </div>
      )}

      {creating && <CreateReportModal onClose={() => setCreating(false)} />}
    </div>
  );
}

const thisYear = new Date().getFullYear();

function CreateReportModal({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const clients = useQuery({ queryKey: ["clients"], queryFn: fetchClients, staleTime: 60_000 });
  const [clientId, setClientId] = useState("");
  const [entityName, setEntityName] = useState("");
  const [framework, setFramework] = useState("PFRS for Small Entities");
  const [includeNotes, setIncludeNotes] = useState(true);
  const [periods, setPeriods] = useState<FsPeriodInput[]>([
    { label: String(thisYear), endDate: `${thisYear}-12-31`, periodType: "FY" },
  ]);
  const [error, setError] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: (body: CreateFsReportInput) => createFsReport(body),
    onSuccess: (report) => {
      queryClient.invalidateQueries({ queryKey: ["fs-reports"] });
      navigate(`/financial-statements/${report.id}`);
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : "Create failed."),
  });

  function addPeriod() {
    if (periods.length >= 5) return;
    const y = thisYear - periods.length;
    setPeriods([...periods, { label: String(y), endDate: `${y}-12-31`, periodType: "FY" }]);
  }
  function updatePeriod(i: number, patch: Partial<FsPeriodInput>) {
    setPeriods(periods.map((p, idx) => (idx === i ? { ...p, ...patch } : p)));
  }
  function removePeriod(i: number) {
    if (periods.length <= 1) return;
    setPeriods(periods.filter((_, idx) => idx !== i));
  }

  function onPickClient(id: string) {
    setClientId(id);
    // Prefill (still editable) — the server snapshots the full profile
    // (registered name, address) from the client record on create.
    const picked = clients.data?.find((c) => c.id === id);
    if (picked) setEntityName(picked.businessName);
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    create.mutate({
      ...(clientId ? { clientId } : {}),
      ...(entityName.trim() ? { entityName: entityName.trim() } : {}),
      framework,
      includeNotes,
      periods,
    });
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(14,33,44,0.45)] p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[90vh] w-full max-w-[560px] animate-fade-rise flex-col overflow-hidden rounded-modal bg-card shadow-modal"
      >
        <div className="flex items-center justify-between border-b border-line px-6 py-4">
          <h2 className="font-serif text-[19px] font-medium text-navy">New financial statements</h2>
          <button type="button" aria-label="Close" onClick={onClose} className="text-content-muted hover:text-navy">
            ✕
          </button>
        </div>
        <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
          <div className="flex-1 space-y-4 overflow-auto px-6 py-5">
            {error && (
              <div className="rounded-input border border-danger/30 bg-danger-bg px-3.5 py-2.5 text-[13px] text-danger-ink">
                {error}
              </div>
            )}
            <label className="block">
              <span className="text-[13px] font-semibold text-content">Client</span>
              <select
                value={clientId}
                onChange={(e) => onPickClient(e.target.value)}
                className="input mt-1.5"
              >
                <option value="">— Standalone (enter details manually) —</option>
                {(clients.data ?? []).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.businessName}
                  </option>
                ))}
              </select>
              <span className="mt-1 block text-[11.5px] text-content-muted">
                Picking a client fetches its registered name and address from the client database.
              </span>
            </label>
            <label className="block">
              <span className="text-[13px] font-semibold text-content">Entity name</span>
              <input
                value={entityName}
                onChange={(e) => setEntityName(e.target.value)}
                required={!clientId}
                placeholder="e.g. Workscale Resources Inc."
                className="input mt-1.5"
              />
            </label>
            <label className="block">
              <span className="text-[13px] font-semibold text-content">Reporting framework</span>
              <select value={framework} onChange={(e) => setFramework(e.target.value)} className="input mt-1.5">
                <option>PFRS for Small Entities</option>
                <option>PFRS for SMEs</option>
                <option>Full PFRS</option>
              </select>
            </label>

            <label className="flex items-start gap-2.5">
              <input
                type="checkbox"
                checked={includeNotes}
                onChange={(e) => setIncludeNotes(e.target.checked)}
                className="mt-0.5"
              />
              <span>
                <span className="block text-[13px] font-semibold text-content">
                  Generate Notes to Financial Statements
                </span>
                <span className="block text-[11.5px] text-content-muted">
                  Required for entities with gross sales/revenue of ₱3,000,000 and above. If turned
                  off but the threshold is met, the export flags a warning.
                </span>
              </span>
            </label>

            <div>
              <div className="mb-2 flex items-center justify-between">
                <span className="text-[13px] font-semibold text-content">Periods (1–5)</span>
                <button
                  type="button"
                  onClick={addPeriod}
                  disabled={periods.length >= 5}
                  className="font-mono text-[11.5px] font-semibold uppercase tracking-wide text-gold-deep hover:text-navy disabled:opacity-40"
                >
                  + Add period
                </button>
              </div>
              <div className="space-y-2">
                {periods.map((p, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <span className="w-16 font-mono text-[11px] text-content-muted">
                      {i === 0 ? "Current" : `Comp ${i}`}
                    </span>
                    <input
                      value={p.label}
                      onChange={(e) => updatePeriod(i, { label: e.target.value })}
                      required
                      placeholder="Label"
                      className="input flex-1"
                    />
                    <input
                      type="date"
                      value={p.endDate}
                      onChange={(e) => updatePeriod(i, { endDate: e.target.value })}
                      required
                      className="input flex-1"
                    />
                    <button
                      type="button"
                      onClick={() => removePeriod(i)}
                      disabled={periods.length <= 1}
                      className="text-content-muted hover:text-danger disabled:opacity-30"
                      aria-label="Remove period"
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>
          <div className="flex justify-end gap-2 border-t border-line px-6 py-4">
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={create.isPending} className={cn(create.isPending && "opacity-70")}>
              {create.isPending ? "Creating…" : "Create report"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
