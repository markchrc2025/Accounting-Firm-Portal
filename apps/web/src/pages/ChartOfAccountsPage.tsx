import { useMemo, useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "../auth/AuthContext";
import {
  ApiError,
  archiveChartAccount,
  createChartAccount,
  deleteAccountTaxMapping,
  fetchAccountTaxMappings,
  fetchChartAccounts,
  restoreChartAccount,
  setAccountTaxMapping,
  updateChartAccount,
  type ChartAccount,
} from "../lib/api";
import {
  Button,
  Card,
  Chip,
  cn,
  EmptyState,
  ErrorState,
  PageHeader,
  Skeleton,
  type ChipVariant,
} from "../components/ui";

/** Firm Admin — the PH SME chart + BIR mapping. Reads for everyone; edits are
 *  gated by ChartOfAccounts:Manage, and the server re-validates every write
 *  against the chart's conventions (bad edits come back as a 400 naming the
 *  offending account code — surfaced verbatim in the modal). */

type Tab = "accounts" | "mapping";

const CLASSES = ["Asset", "Liability", "Equity", "Revenue", "Expense"] as const;

/** Account-type options per class (mirrors the seeded dataset's taxonomy). */
const TYPES_BY_CLASS: Record<string, string[]> = {
  Asset: ["Bank Accounts", "Current Asset", "Fixed Asset", "Non-current Asset"],
  Liability: ["Current Liability", "Non-current Liability"],
  Equity: ["Shareholders Equity"],
  Revenue: ["Operating Revenue", "Other Revenue"],
  Expense: ["Direct Costs", "Operating Expense", "Other Expense"],
};

const PL_CLASSES = ["Revenue", "Expense"];
const ALLOWED_UNMAPPED = ["4001", "4002", "5008"];

function classTone(cls: string): ChipVariant {
  switch (cls) {
    case "Asset":
      return "info";
    case "Liability":
      return "warn";
    case "Equity":
      return "gold";
    case "Revenue":
      return "success";
    default:
      return "neutral"; // Expense
  }
}

export default function ChartOfAccountsPage() {
  const { hasPermission } = useAuth();
  const canManage = hasPermission("ChartOfAccounts:Manage");
  const queryClient = useQueryClient();

  const [tab, setTab] = useState<Tab>("accounts");
  const [search, setSearch] = useState("");
  const [cls, setCls] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [accountModal, setAccountModal] = useState<{ existing: ChartAccount | null } | null>(
    null,
  );
  const [mappingModal, setMappingModal] = useState<{
    accountCode: string;
    accountName: string;
    line: string;
  } | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);

  const accounts = useQuery({
    queryKey: ["coa-accounts"],
    queryFn: () => fetchChartAccounts(),
    staleTime: 5 * 60 * 1000,
  });
  const mappings = useQuery({
    queryKey: ["coa-mappings"],
    queryFn: fetchAccountTaxMappings,
    staleTime: 5 * 60 * 1000,
  });

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ["coa-accounts"] });
    queryClient.invalidateQueries({ queryKey: ["coa-mappings"] });
  }

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (accounts.data ?? []).filter((a) => {
      if (!showArchived && a.archived) return false;
      if (cls && a.class !== cls) return false;
      if (q && !(a.code.includes(q) || a.name.toLowerCase().includes(q))) return false;
      return true;
    });
  }, [accounts.data, search, cls, showArchived]);

  const accountByCode = useMemo(
    () => new Map((accounts.data ?? []).map((a) => [a.code, a])),
    [accounts.data],
  );
  const mappedCodes = useMemo(
    () => new Set((mappings.data ?? []).map((m) => m.accountCode)),
    [mappings.data],
  );
  /** Active P&L accounts a new mapping could be added for. */
  const unmappedPl = useMemo(
    () =>
      (accounts.data ?? []).filter(
        (a) => PL_CLASSES.includes(a.class) && !a.archived && !mappedCodes.has(a.code),
      ),
    [accounts.data, mappedCodes],
  );

  async function onArchiveToggle(a: ChartAccount) {
    setRowError(null);
    try {
      if (a.archived) await restoreChartAccount(a.code);
      else await archiveChartAccount(a.code);
      invalidate();
    } catch (e) {
      setRowError(e instanceof ApiError ? e.message : "Action failed.");
    }
  }

  async function onDeleteMapping(accountCode: string) {
    if (!confirm(`Remove the BIR mapping for account ${accountCode}?`)) return;
    setRowError(null);
    try {
      await deleteAccountTaxMapping(accountCode);
      invalidate();
    } catch (e) {
      // Typically the coverage rule: an active P&L account must stay mapped.
      setRowError(e instanceof ApiError ? e.message : "Delete failed.");
    }
  }

  return (
    <div className="animate-fade-rise">
      <PageHeader
        title="Chart of Accounts"
        eyebrow="FIRM ADMIN"
        description="The firm's standard PH SME chart and its BIR income-tax return mapping."
        actions={
          canManage && tab === "accounts" ? (
            <Button onClick={() => setAccountModal({ existing: null })}>+ Add account</Button>
          ) : canManage && tab === "mapping" && unmappedPl.length > 0 ? (
            <Button
              onClick={() =>
                setMappingModal({
                  accountCode: unmappedPl[0]?.code ?? "",
                  accountName: "",
                  line: "",
                })
              }
            >
              + Add mapping
            </Button>
          ) : undefined
        }
      />

      {/* Tab bar */}
      <div className="mb-6 flex gap-6 border-b border-line-strong">
        {(
          [
            ["accounts", "Chart of Accounts"],
            ["mapping", "BIR Mapping"],
          ] as [Tab, string][]
        ).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={cn(
              "-mb-px px-1 pb-3 pt-1 text-[13px] transition-colors",
              tab === key
                ? "border-b-[2.5px] border-gold font-bold text-navy"
                : "text-content-secondary hover:text-navy",
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {rowError && (
        <div className="mb-4 rounded-card border border-danger/30 bg-danger-bg px-4 py-3 text-[13px] text-danger-ink">
          {rowError}
        </div>
      )}

      {tab === "accounts" && (
        <>
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by code or name…"
              className="input max-w-[320px] flex-1"
            />
            <select
              value={cls}
              onChange={(e) => setCls(e.target.value)}
              className="input max-w-[200px]"
              aria-label="Filter by class"
            >
              <option value="">All classes</option>
              {CLASSES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            <label className="flex items-center gap-2 text-[12.5px] text-content-secondary">
              <input
                type="checkbox"
                checked={showArchived}
                onChange={(e) => setShowArchived(e.target.checked)}
              />
              Show archived
            </label>
          </div>

          <Card>
            {accounts.isPending ? (
              <div className="space-y-3 p-6">
                {Array.from({ length: 8 }).map((_, i) => (
                  <Skeleton key={i} className="h-9" />
                ))}
              </div>
            ) : accounts.isError ? (
              <ErrorState
                message="Couldn't load the chart of accounts."
                onRetry={() => void accounts.refetch()}
              />
            ) : rows.length === 0 ? (
              <EmptyState
                title={accounts.data?.length === 0 ? "No accounts seeded yet" : "No matches"}
                description={
                  accounts.data?.length === 0
                    ? "Redeploy the API service — the seed loads the chart from the xlsx data files automatically."
                    : "No accounts match your filters."
                }
              />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-left">
                  <thead>
                    <tr className="border-b border-line bg-sidebar">
                      {[
                        "Code",
                        "Name",
                        "Parent account",
                        "Class",
                        "Type",
                        "Normal balance",
                        "Description",
                        ...(canManage ? ["Actions"] : []),
                      ].map((h) => (
                        <th
                          key={h}
                          className="px-5 py-2.5 font-mono text-[10px] font-normal uppercase tracking-[.14em] text-content-secondary"
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line-divider">
                    {rows.map((a) => (
                      <tr
                        key={a.code}
                        className={cn(
                          "transition-colors hover:bg-rowhover",
                          a.archived && "opacity-55",
                        )}
                      >
                        <td className="px-5 py-[11px] font-mono text-[13px] text-content">
                          {a.code}
                        </td>
                        <td className="px-5 py-[11px] text-[13px] font-medium text-navy">
                          {a.name}
                          {a.archived && (
                            <span className="ml-2 rounded-chip bg-paper px-1.5 py-0.5 font-mono text-[9.5px] uppercase tracking-wide text-content-muted">
                              Archived
                            </span>
                          )}
                          {a.source === "custom" && (
                            <span className="ml-2 rounded-chip bg-info-bg px-1.5 py-0.5 font-mono text-[9.5px] uppercase tracking-wide text-blue">
                              Custom
                            </span>
                          )}
                        </td>
                        <td className="whitespace-nowrap px-5 py-[11px] text-[12.5px] text-content-secondary">
                          {a.parentCode ? (
                            <>
                              <span className="font-mono text-content">{a.parentCode}</span>
                              {accountByCode.get(a.parentCode) && (
                                <span className="ml-1.5">
                                  {accountByCode.get(a.parentCode)?.name}
                                </span>
                              )}
                            </>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td className="px-5 py-[11px]">
                          <Chip variant={classTone(a.class)}>{a.class}</Chip>
                        </td>
                        <td className="px-5 py-[11px] text-[13px] text-content-secondary">
                          {a.accountType}
                        </td>
                        <td className="px-5 py-[11px] font-mono text-[12px] uppercase text-content-secondary">
                          {a.normalBalance}
                        </td>
                        <td className="max-w-[300px] truncate px-5 py-[11px] text-[12.5px] text-content-muted">
                          {a.description ?? "—"}
                        </td>
                        {canManage && (
                          <td className="px-5 py-[11px]">
                            <div className="flex items-center gap-2 text-[12.5px] font-semibold">
                              <button
                                type="button"
                                onClick={() => setAccountModal({ existing: a })}
                                className="text-blue hover:text-navy-hover hover:underline"
                              >
                                Edit
                              </button>
                              <button
                                type="button"
                                onClick={() => void onArchiveToggle(a)}
                                className={cn(
                                  "hover:underline",
                                  a.archived
                                    ? "text-success"
                                    : "text-content-secondary hover:text-danger",
                                )}
                              >
                                {a.archived ? "Restore" : "Archive"}
                              </button>
                            </div>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
          {!accounts.isPending && !accounts.isError && (
            <p className="mt-3 font-mono text-[11.5px] text-content-muted">
              {rows.length} of {accounts.data?.length ?? 0} account
              {(accounts.data?.length ?? 0) === 1 ? "" : "s"}
            </p>
          )}
        </>
      )}

      {tab === "mapping" && (
        <Card>
          {mappings.isPending ? (
            <div className="space-y-3 p-6">
              {Array.from({ length: 8 }).map((_, i) => (
                <Skeleton key={i} className="h-9" />
              ))}
            </div>
          ) : mappings.isError ? (
            <ErrorState
              message="Couldn't load the BIR mapping."
              onRetry={() => void mappings.refetch()}
            />
          ) : (mappings.data?.length ?? 0) === 0 ? (
            <EmptyState
              title="No mapping seeded yet"
              description="Redeploy the API service — the seed loads the BIR income-tax mapping from the xlsx data files automatically."
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-left">
                <thead>
                  <tr className="border-b border-line bg-sidebar">
                    {[
                      "Code",
                      "Account",
                      "Class",
                      "Tax category",
                      "1701/1702 tax return line",
                      ...(canManage ? ["Actions"] : []),
                    ].map((h) => (
                      <th
                        key={h}
                        className="px-5 py-2.5 font-mono text-[10px] font-normal uppercase tracking-[.14em] text-content-secondary"
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-line-divider">
                  {(mappings.data ?? []).map((m) => {
                    const account = accountByCode.get(m.accountCode);
                    return (
                      <tr
                        key={`${m.accountCode}|${m.taxCategory}`}
                        className="transition-colors hover:bg-rowhover"
                      >
                        <td className="px-5 py-[11px] font-mono text-[13px] text-content">
                          {m.accountCode}
                        </td>
                        <td className="px-5 py-[11px] text-[13px] font-medium text-navy">
                          {account?.name ?? m.accountName}
                        </td>
                        <td className="px-5 py-[11px]">
                          {account ? (
                            <Chip variant={classTone(account.class)}>{account.class}</Chip>
                          ) : (
                            <span className="text-content-muted">—</span>
                          )}
                        </td>
                        <td className="px-5 py-[11px] text-[13px] text-content-secondary">
                          {m.taxCategory}
                        </td>
                        <td className="px-5 py-[11px] text-[13px]">
                          {m.taxReturnLine ? (
                            <span className="text-content">{m.taxReturnLine}</span>
                          ) : (
                            <span
                              className="text-content-muted"
                              title="Intentionally unmapped: 4001/4002 belong to Cost of Sales; 5008 is below the line."
                            >
                              — not an itemized deduction
                            </span>
                          )}
                        </td>
                        {canManage && (
                          <td className="px-5 py-[11px]">
                            <div className="flex items-center gap-2 text-[12.5px] font-semibold">
                              {!ALLOWED_UNMAPPED.includes(m.accountCode) && (
                                <button
                                  type="button"
                                  onClick={() =>
                                    setMappingModal({
                                      accountCode: m.accountCode,
                                      accountName: account?.name ?? m.accountName,
                                      line: m.taxReturnLine ?? "",
                                    })
                                  }
                                  className="text-blue hover:text-navy-hover hover:underline"
                                >
                                  Edit line
                                </button>
                              )}
                              <button
                                type="button"
                                onClick={() => void onDeleteMapping(m.accountCode)}
                                className="text-content-secondary hover:text-danger hover:underline"
                              >
                                Remove
                              </button>
                            </div>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {accountModal && (
        <AccountModal
          existing={accountModal.existing}
          onClose={() => setAccountModal(null)}
          onSaved={() => {
            setAccountModal(null);
            invalidate();
          }}
        />
      )}

      {mappingModal && (
        <MappingModal
          state={mappingModal}
          unmappedPl={unmappedPl}
          onClose={() => setMappingModal(null)}
          onSaved={() => {
            setMappingModal(null);
            invalidate();
          }}
        />
      )}
    </div>
  );
}

/* -------------------------------------------------------------- Account modal */

function AccountModal({
  existing,
  onClose,
  onSaved,
}: {
  existing: ChartAccount | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [code, setCode] = useState(existing?.code ?? "");
  const [name, setName] = useState(existing?.name ?? "");
  const [cls, setCls] = useState(existing?.class ?? "Expense");
  const [accountType, setAccountType] = useState(existing?.accountType ?? "Operating Expense");
  const [description, setDescription] = useState(existing?.description ?? "");
  const [taxReturnLine, setTaxReturnLine] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const editing = Boolean(existing);
  const isPl = PL_CLASSES.includes(cls);
  const needsLine = !editing && isPl && !ALLOWED_UNMAPPED.includes(code.trim());
  const typeOptions = TYPES_BY_CLASS[cls] ?? [];

  function onClassChange(next: string) {
    setCls(next);
    const options = TYPES_BY_CLASS[next] ?? [];
    if (!options.includes(accountType)) setAccountType(options[0] ?? "");
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (editing && existing) {
        await updateChartAccount(existing.code, {
          name,
          class: cls,
          accountType,
          description: description || undefined,
        });
      } else {
        await createChartAccount({
          code: code.trim(),
          name,
          class: cls,
          accountType,
          description: description || undefined,
          ...(needsLine && taxReturnLine.trim()
            ? { taxReturnLine: taxReturnLine.trim() }
            : {}),
        });
      }
      onSaved();
    } catch (err) {
      // Convention violations arrive as a 400 naming the offending code.
      setError(err instanceof ApiError ? err.message : "Save failed.");
    } finally {
      setBusy(false);
    }
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
        className="flex max-h-[90vh] w-full max-w-[520px] animate-fade-rise flex-col overflow-hidden rounded-modal bg-card shadow-modal"
      >
        <div className="flex items-center justify-between border-b border-line px-6 py-4">
          <h2 className="font-serif text-[19px] font-medium text-navy">
            {editing ? `Edit account ${existing?.code}` : "Add account"}
          </h2>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="text-content-muted hover:text-navy"
          >
            ✕
          </button>
        </div>
        <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
          <div className="flex-1 space-y-4 overflow-auto px-6 py-5">
            {error && (
              <div className="rounded-input border border-danger/30 bg-danger-bg px-3.5 py-2.5 text-[13px] text-danger-ink">
                {error}
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <Field label="Code">
                <input
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 7))}
                  disabled={editing}
                  required
                  placeholder="4-digit or 7-digit"
                  className={cn("input font-mono", editing && "opacity-60")}
                />
              </Field>
              <Field label="Class">
                <select
                  value={cls}
                  onChange={(e) => onClassChange(e.target.value)}
                  className="input"
                >
                  {CLASSES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            <Field label="Name">
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                className="input"
              />
            </Field>
            <Field label="Account type">
              <select
                value={accountType}
                onChange={(e) => setAccountType(e.target.value)}
                className="input"
              >
                {typeOptions.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Description (optional)">
              <input
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="input"
              />
            </Field>
            {needsLine && (
              <Field label="BIR 1701/1702 tax return line (required for P&L accounts)">
                <input
                  value={taxReturnLine}
                  onChange={(e) => setTaxReturnLine(e.target.value)}
                  required
                  placeholder="e.g. Office Supplies"
                  className="input"
                />
              </Field>
            )}
            <p className="text-[12px] text-content-muted">
              The normal balance and parent group derive from the code and class; currency is
              always PHP. Edits are kept on future redeploys — the xlsx only updates untouched
              rows.
            </p>
          </div>
          <div className="flex justify-end gap-2 border-t border-line px-6 py-4">
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={busy}>
              {busy ? "Saving…" : "Save"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------- Mapping modal */

function MappingModal({
  state,
  unmappedPl,
  onClose,
  onSaved,
}: {
  state: { accountCode: string; accountName: string; line: string };
  unmappedPl: ChartAccount[];
  onClose: () => void;
  onSaved: () => void;
}) {
  // Editing an existing row locks the account; adding picks from unmapped P&L.
  const adding = state.accountName === "" && state.line === "";
  const [accountCode, setAccountCode] = useState(state.accountCode);
  const [line, setLine] = useState(state.line);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await setAccountTaxMapping(accountCode, line.trim());
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Save failed.");
    } finally {
      setBusy(false);
    }
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
        className="w-full max-w-[460px] animate-fade-rise overflow-hidden rounded-modal bg-card shadow-modal"
      >
        <div className="flex items-center justify-between border-b border-line px-6 py-4">
          <h2 className="font-serif text-[19px] font-medium text-navy">
            {adding ? "Add BIR mapping" : `Mapping · ${state.accountCode}`}
          </h2>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="text-content-muted hover:text-navy"
          >
            ✕
          </button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="space-y-4 px-6 py-5">
            {error && (
              <div className="rounded-input border border-danger/30 bg-danger-bg px-3.5 py-2.5 text-[13px] text-danger-ink">
                {error}
              </div>
            )}
            {adding ? (
              <Field label="Account (unmapped P&L)">
                <select
                  value={accountCode}
                  onChange={(e) => setAccountCode(e.target.value)}
                  className="input"
                >
                  {unmappedPl.map((a) => (
                    <option key={a.code} value={a.code}>
                      {a.code} — {a.name}
                    </option>
                  ))}
                </select>
              </Field>
            ) : (
              <p className="text-[13px] text-content-secondary">{state.accountName}</p>
            )}
            <Field label="1701/1702 tax return line">
              <input
                value={line}
                onChange={(e) => setLine(e.target.value)}
                required
                placeholder="e.g. Rental"
                className="input"
              />
            </Field>
          </div>
          <div className="flex justify-end gap-2 border-t border-line px-6 py-4">
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={busy || !accountCode}>
              {busy ? "Saving…" : "Save"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-[13px] font-semibold text-content">{label}</span>
      <div className="mt-1.5">{children}</div>
    </label>
  );
}
