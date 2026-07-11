import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { fetchClients } from "../lib/api";
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  PageHeader,
  RegimeChip,
  Skeleton,
  StatusChip,
  type ChipVariant,
} from "../components/ui";

/** Clients list (design handoff screen 6) — the firm's whole client roster. */
function statusTone(status: string): ChipVariant {
  const s = status.toLowerCase();
  if (s === "active") return "success";
  if (s === "onboarding" || s === "pending") return "warn";
  return "neutral";
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
}

export default function ClientsPage() {
  const { hasPermission } = useAuth();
  const canCreate = hasPermission("Clients:Create");
  const [search, setSearch] = useState("");

  const { data, isPending, isError, refetch } = useQuery({
    queryKey: ["clients"],
    queryFn: fetchClients,
  });

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = data ?? [];
    if (!q) return list;
    return list.filter(
      (c) => c.businessName.toLowerCase().includes(q) || (c.tin ?? "").toLowerCase().includes(q),
    );
  }, [data, search]);

  const addAction = canCreate ? (
    <Link
      to="/clients/new"
      className="inline-flex items-center rounded-btn bg-navy px-4 py-[10px] text-[13.5px] font-semibold text-white transition-colors hover:bg-navy-hover"
    >
      + Add client
    </Link>
  ) : null;

  return (
    <div className="animate-fade-rise">
      <PageHeader
        title="Clients"
        eyebrow="OVERVIEW"
        description="Every business you manage for the firm."
        actions={addAction}
      />

      {!isPending && !isError && (data?.length ?? 0) > 0 && (
        <div className="mb-4">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by business name or TIN…"
            className="input max-w-[360px]"
          />
        </div>
      )}

      <Card>
        {isPending ? (
          <div className="space-y-3 p-6">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-10" />
            ))}
          </div>
        ) : isError ? (
          <ErrorState message="Couldn't load clients." onRetry={() => void refetch()} />
        ) : (data?.length ?? 0) === 0 ? (
          <EmptyState
            title="No clients yet"
            description="Add your first client to start tracking sales, expenses, and tax estimates."
          >
            {addAction}
          </EmptyState>
        ) : rows.length === 0 ? (
          <EmptyState title="No matches" description="No clients match your search." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left">
              <thead>
                <tr className="border-b border-line bg-sidebar">
                  {["Business", "TIN", "Regime", "Status", "Actions"].map((h) => (
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
                {rows.map((c) => (
                  <tr key={c.id} className="transition-colors hover:bg-rowhover">
                    <td className="px-5 py-[13px]">
                      <div className="flex items-center gap-2.5">
                        <span className="flex h-8 w-8 flex-none items-center justify-center rounded-full bg-navy font-mono text-[10px] font-semibold text-gold-soft">
                          {initials(c.businessName)}
                        </span>
                        <Link
                          to={`/clients/${c.id}`}
                          className="text-[13px] font-semibold text-navy hover:underline"
                        >
                          {c.businessName}
                        </Link>
                      </div>
                    </td>
                    <td className="px-5 py-[13px] font-mono text-[13px] text-content-secondary">
                      {c.tin ?? "—"}
                    </td>
                    <td className="px-5 py-[13px]">
                      <RegimeChip regime={c.taxType} />
                    </td>
                    <td className="px-5 py-[13px]">
                      <StatusChip label={c.status} variant={statusTone(c.status)} />
                    </td>
                    <td className="px-5 py-[13px]">
                      <div className="flex items-center gap-2">
                        <Link
                          to={`/clients/${c.id}`}
                          className="text-[12.5px] font-semibold text-blue hover:text-navy-hover hover:underline"
                        >
                          Open
                        </Link>
                        {hasPermission("Clients:Update") && (
                          <Link
                            to={`/clients/${c.id}/edit`}
                            className="text-[12.5px] font-semibold text-content-secondary hover:text-navy hover:underline"
                          >
                            Edit
                          </Link>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {!isPending && !isError && (data?.length ?? 0) > 0 && (
        <p className="mt-3 font-mono text-[11.5px] text-content-muted">
          {rows.length} of {data?.length ?? 0} client{(data?.length ?? 0) === 1 ? "" : "s"}
        </p>
      )}
    </div>
  );
}
