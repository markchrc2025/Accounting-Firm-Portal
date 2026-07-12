import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  fetchAccountTaxMappings,
  fetchChartAccounts,
  type ChartAccount,
} from "../lib/api";
import {
  Card,
  Chip,
  cn,
  EmptyState,
  ErrorState,
  PageHeader,
  Skeleton,
  type ChipVariant,
} from "../components/ui";

/** Firm Admin — the seeded PH SME chart (Firm-wide reference data, read-only:
 *  the xlsx files under the API's prisma/data are the source of truth). */

type Tab = "accounts" | "mapping";

const CLASSES = ["Asset", "Liability", "Equity", "Revenue", "Expense"] as const;

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
  const [tab, setTab] = useState<Tab>("accounts");
  const [search, setSearch] = useState("");
  const [cls, setCls] = useState("");

  const accounts = useQuery({
    queryKey: ["coa-accounts"],
    queryFn: () => fetchChartAccounts(),
    staleTime: 5 * 60 * 1000,
  });
  const mappings = useQuery({
    queryKey: ["coa-mappings"],
    queryFn: fetchAccountTaxMappings,
    staleTime: 5 * 60 * 1000,
    enabled: tab === "mapping",
  });

  // Client-side filtering keeps both filters instant on a 116-row set.
  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (accounts.data ?? []).filter((a) => {
      if (cls && a.class !== cls) return false;
      if (q && !(a.code.includes(q) || a.name.toLowerCase().includes(q))) return false;
      return true;
    });
  }, [accounts.data, search, cls]);

  // Account class lookup so the mapping tab can show each row's class chip.
  const classOf = useMemo(() => {
    const m = new Map((accounts.data ?? []).map((a) => [a.code, a.class]));
    return (code: string) => m.get(code) ?? "";
  }, [accounts.data]);

  return (
    <div className="animate-fade-rise">
      <PageHeader
        title="Chart of Accounts"
        eyebrow="FIRM ADMIN"
        description="The firm's standard PH SME chart and its BIR income-tax return mapping."
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
                message="Couldn't load the chart of accounts. If the API was just updated, redeploy it so the seed can run."
                onRetry={() => void accounts.refetch()}
              />
            ) : rows.length === 0 ? (
              <EmptyState
                title={accounts.data?.length === 0 ? "No accounts seeded yet" : "No matches"}
                description={
                  accounts.data?.length === 0
                    ? "Redeploy the API service — the seed loads the chart from the xlsx data files automatically."
                    : "No accounts match your search."
                }
              />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-left">
                  <thead>
                    <tr className="border-b border-line bg-sidebar">
                      {["Code", "Name", "Class", "Type", "Normal balance", "Description"].map(
                        (h) => (
                          <th
                            key={h}
                            className="px-5 py-2.5 font-mono text-[10px] font-normal uppercase tracking-[.14em] text-content-secondary"
                          >
                            {h}
                          </th>
                        ),
                      )}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line-divider">
                    {rows.map((a: ChartAccount) => (
                      <tr key={a.code} className="transition-colors hover:bg-rowhover">
                        <td className="px-5 py-[11px] font-mono text-[13px] text-content">
                          {/* Indent sub-accounts under their 4-digit group. */}
                          <span className={cn(a.parentCode && "pl-4")}>{a.code}</span>
                        </td>
                        <td className="px-5 py-[11px] text-[13px] font-medium text-navy">
                          {a.name}
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
                        <td className="max-w-[360px] truncate px-5 py-[11px] text-[12.5px] text-content-muted">
                          {a.description ?? "—"}
                        </td>
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
                    {["Code", "Account", "Class", "Tax category", "1701/1702 tax return line"].map(
                      (h) => (
                        <th
                          key={h}
                          className="px-5 py-2.5 font-mono text-[10px] font-normal uppercase tracking-[.14em] text-content-secondary"
                        >
                          {h}
                        </th>
                      ),
                    )}
                  </tr>
                </thead>
                <tbody className="divide-y divide-line-divider">
                  {(mappings.data ?? []).map((m) => (
                    <tr
                      key={`${m.accountCode}|${m.taxCategory}`}
                      className="transition-colors hover:bg-rowhover"
                    >
                      <td className="px-5 py-[11px] font-mono text-[13px] text-content">
                        {m.accountCode}
                      </td>
                      <td className="px-5 py-[11px] text-[13px] font-medium text-navy">
                        {m.accountName}
                      </td>
                      <td className="px-5 py-[11px]">
                        {classOf(m.accountCode) ? (
                          <Chip variant={classTone(classOf(m.accountCode))}>
                            {classOf(m.accountCode)}
                          </Chip>
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
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
