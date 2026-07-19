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
  const [region, setRegion] = useState("");
  const [province, setProvince] = useState("");

  const { data, isPending, isError, refetch } = useQuery({
    queryKey: ["clients"],
    queryFn: fetchClients,
  });

  // Distinct regions across the roster, and provinces within the chosen region
  // (so the province filter narrows as you slice by region).
  const regions = useMemo(
    () => Array.from(new Set((data ?? []).map((c) => c.region).filter(Boolean) as string[])).sort(),
    [data],
  );
  const provinces = useMemo(
    () =>
      Array.from(
        new Set(
          (data ?? [])
            .filter((c) => !region || c.region === region)
            .map((c) => c.province)
            .filter(Boolean) as string[],
        ),
      ).sort(),
    [data, region],
  );

  // Sub-client billing links: resolve the main client's name for the roster tag.
  const nameById = useMemo(
    () => new Map((data ?? []).map((c) => [c.id, c.businessName])),
    [data],
  );

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (data ?? []).filter((c) => {
      if (q && !(c.businessName.toLowerCase().includes(q) || (c.tin ?? "").toLowerCase().includes(q)))
        return false;
      if (region && c.region !== region) return false;
      if (province && c.province !== province) return false;
      return true;
    });
  }, [data, search, region, province]);

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
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by business name or TIN…"
            className="input max-w-[320px] flex-1"
          />
          <select
            value={region}
            onChange={(e) => {
              setRegion(e.target.value);
              setProvince(""); // reset province when the region changes
            }}
            className="input max-w-[240px]"
            aria-label="Filter by region"
          >
            <option value="">All regions</option>
            {regions.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
          <select
            value={province}
            onChange={(e) => setProvince(e.target.value)}
            className="input max-w-[220px]"
            aria-label="Filter by province"
          >
            <option value="">All provinces</option>
            {provinces.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
          {(region || province || search) && (
            <button
              type="button"
              onClick={() => {
                setSearch("");
                setRegion("");
                setProvince("");
              }}
              className="text-[12.5px] font-semibold text-content-secondary hover:text-navy hover:underline"
            >
              Clear
            </button>
          )}
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
                  {["Business", "TIN", "Location", "Regime", "Status", "Actions"].map((h) => (
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
                        <div className="min-w-0">
                          <Link
                            to={`/clients/${c.id}`}
                            className="text-[13px] font-semibold text-navy hover:underline"
                          >
                            {c.businessName}
                          </Link>
                          {c.billingParentId && (
                            <span className="mt-0.5 block font-mono text-[10px] uppercase tracking-[.08em] text-content-secondary">
                              Billed under{" "}
                              {nameById.get(c.billingParentId) ?? "main client"}
                            </span>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="px-5 py-[13px] font-mono text-[13px] text-content-secondary">
                      {c.tin ?? "—"}
                    </td>
                    <td className="px-5 py-[13px] text-[13px]">
                      {c.city || c.province ? (
                        <span>
                          <span className="text-content">{c.city || "—"}</span>
                          {c.province ? (
                            <span className="text-content-secondary">, {c.province}</span>
                          ) : null}
                        </span>
                      ) : (
                        <span className="text-content-muted">—</span>
                      )}
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
