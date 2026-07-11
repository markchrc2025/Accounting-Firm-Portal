import { VatClass } from "@portal/shared";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState, type ReactNode } from "react";
import TransactionEntryModal, {
  type Regime,
} from "../components/TransactionEntryModal";
import { useAuth } from "../auth/AuthContext";
import {
  deleteIncome,
  fetchCategories,
  fetchIncome,
  fetchIncomeSummary,
  fetchPortalContext,
  type IncomeTxn,
} from "../lib/api";
import {
  Button,
  Card,
  Chip,
  cn,
  EmptyState,
  ErrorState,
  PageHeader,
  peso,
  Skeleton,
} from "../components/ui";

/** VAT income may never be NON_VAT — that classification is the percentage regime. */
const VAT_INCOME_CLASSES = VatClass.options.filter((c) => c !== "NON_VAT");

export default function PortalSalesPage() {
  const { hasPermission } = useAuth();
  const queryClient = useQueryClient();

  const [filters, setFilters] = useState<Record<string, string>>({});
  const [search, setSearch] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<IncomeTxn | null>(null);

  const ctxQuery = useQuery({
    queryKey: ["portal-context"],
    queryFn: fetchPortalContext,
  });
  const ctx = ctxQuery.data;
  const clientId = ctx?.id ?? "";

  // Regime: taxType containing "VAT" (but not "NON") → VAT, else PERCENTAGE.
  const taxType = (ctx?.taxType ?? "").toUpperCase();
  const isVat = taxType.includes("VAT") && !taxType.includes("NON");
  const regime: Regime = isVat ? "VAT" : "PERCENTAGE";

  const income = useQuery({
    queryKey: ["income", clientId, filters],
    queryFn: () => fetchIncome(clientId, filters),
    enabled: !!clientId,
  });
  const summary = useQuery({
    queryKey: ["income-summary", clientId, filters],
    queryFn: () => fetchIncomeSummary(clientId, filters),
    enabled: !!clientId,
  });
  const categories = useQuery({
    queryKey: ["categories", clientId, "INCOME"],
    queryFn: () => fetchCategories(clientId, "INCOME"),
    enabled: !!clientId,
  });

  const categoryName = useMemo(() => {
    const map = new Map((categories.data ?? []).map((c) => [c.id, c.name]));
    return (id: string) => map.get(id) ?? "—";
  }, [categories.data]);

  // Client-side search across customer / reference / description.
  const rows = useMemo(() => {
    const all = income.data?.data ?? [];
    const q = search.trim().toLowerCase();
    if (!q) return all;
    return all.filter((t) =>
      [t.customer, t.referenceNo, t.description].some((v) =>
        (v ?? "").toLowerCase().includes(q),
      ),
    );
  }, [income.data, search]);

  const canCreate = hasPermission("Sales:Create");
  const canUpdate = hasPermission("Sales:Update");
  const canDelete = hasPermission("Sales:Delete");
  const showActions = canUpdate || canDelete;
  const filtersActive = search.trim() !== "" || (filters.vatClass ?? "") !== "";

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ["income", clientId] });
    queryClient.invalidateQueries({ queryKey: ["income-summary", clientId] });
  }
  function openAdd() {
    setEditing(null);
    setModalOpen(true);
  }
  function openEdit(txn: IncomeTxn) {
    setEditing(txn);
    setModalOpen(true);
  }
  async function handleDelete(id: string) {
    if (!confirm("Delete this sales record?")) return;
    await deleteIncome(clientId, id);
    invalidate();
  }

  if (ctxQuery.isPending) {
    return (
      <div className="animate-fade-rise space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-40" />
      </div>
    );
  }
  if (ctxQuery.isError || !ctx) {
    return (
      <div className="animate-fade-rise">
        <Card>
          <ErrorState
            message="Could not load your organization."
            onRetry={() => void ctxQuery.refetch()}
          />
        </Card>
      </div>
    );
  }

  const amountHeader = regime === "VAT" ? "Net amount (VAT)" : "Gross receipts";
  const colSpan = showActions ? 7 : 6;

  return (
    <div className="animate-fade-rise">
      <PageHeader
        title="Sales & Income"
        description={ctx.businessName}
        actions={
          canCreate ? <Button onClick={openAdd}>+ Add record</Button> : null
        }
      />

      {/* Reviewed-before-filing notice */}
      <div className="mb-4 rounded-card border border-line-strong bg-info-bg px-4 py-3 text-[13px] text-info">
        Direct entry is enabled for your organization. Records you add are
        reviewed by MCRC before filing.
      </div>

      {/* Toolbar: search + VAT-class filter + right-aligned quarter total */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <input
          type="search"
          placeholder="Search customer, reference, description…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="input max-w-xs"
          aria-label="Search sales records"
        />
        {isVat && (
          <select
            aria-label="Filter by VAT class"
            className="input max-w-[220px]"
            value={filters.vatClass ?? ""}
            onChange={(e) =>
              setFilters((f) => ({ ...f, vatClass: e.target.value }))
            }
          >
            <option value="">All VAT classes</option>
            {VAT_INCOME_CLASSES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        )}
        <div className="ml-auto flex items-baseline gap-2.5">
          <span className="eyebrow">Quarter total</span>
          <span className="font-mono text-[15px] font-semibold tabular-nums text-navy">
            {peso(summary.data?.totalNet ?? 0)}
          </span>
        </div>
      </div>

      {/* Table */}
      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-line-divider bg-sidebar font-mono text-[10px] uppercase tracking-[.14em] text-content-secondary">
                <Th>Date</Th>
                <Th>Ref</Th>
                <Th>Customer</Th>
                <Th>Category</Th>
                <Th>VAT class</Th>
                <Th className="text-right">{amountHeader}</Th>
                {showActions && <Th className="text-right">&nbsp;</Th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-line-divider">
              {income.isPending && (
                <tr>
                  <td colSpan={colSpan} className="px-4 py-5">
                    <div className="space-y-3">
                      <Skeleton />
                      <Skeleton className="w-3/4" />
                      <Skeleton className="w-2/3" />
                    </div>
                  </td>
                </tr>
              )}
              {income.isError && (
                <tr>
                  <td colSpan={colSpan}>
                    <ErrorState
                      message="Could not load sales records."
                      onRetry={() => void income.refetch()}
                    />
                  </td>
                </tr>
              )}
              {income.data && rows.length === 0 && (
                <tr>
                  <td colSpan={colSpan}>
                    <EmptyState
                      title="No sales records"
                      description={
                        filtersActive
                          ? "Nothing matches the current filters yet."
                          : "Record your first sale to get started."
                      }
                    >
                      {canCreate && !filtersActive ? (
                        <Button onClick={openAdd}>+ Add record</Button>
                      ) : null}
                    </EmptyState>
                  </td>
                </tr>
              )}
              {income.data &&
                rows.map((t) => (
                  <tr
                    key={t.id}
                    className="text-[13px] transition-colors hover:bg-rowhover"
                  >
                    <Td className="font-mono text-[12px] text-content-secondary">
                      {t.txnDate}
                    </Td>
                    <Td className="font-mono text-[12px] text-blue">
                      {t.referenceNo ?? "—"}
                    </Td>
                    <Td className="text-content">{t.customer ?? "—"}</Td>
                    <Td className="text-content-secondary">
                      {categoryName(t.categoryId)}
                    </Td>
                    <Td>
                      {regime === "VAT" ? (
                        <Chip variant="vat">{t.vatClass}</Chip>
                      ) : (
                        <Chip variant="gold">NON-VAT</Chip>
                      )}
                    </Td>
                    <Td className="text-right font-mono tabular-nums text-content">
                      {peso(t.netAmount)}
                    </Td>
                    {showActions && (
                      <Td className="text-right">
                        {canUpdate && (
                          <button
                            onClick={() => openEdit(t)}
                            className="font-semibold text-blue underline-offset-2 hover:text-navy-hover hover:underline"
                          >
                            Edit
                          </button>
                        )}
                        {canDelete && (
                          <button
                            onClick={() => handleDelete(t.id)}
                            className="ml-3 font-semibold text-danger underline-offset-2 hover:underline"
                          >
                            Delete
                          </button>
                        )}
                      </Td>
                    )}
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </Card>

      {income.data && (
        <p className="mt-3 font-mono text-[11px] uppercase tracking-[.14em] text-content-secondary">
          {rows.length} of {income.data.total} record(s)
        </p>
      )}

      {modalOpen && (
        <TransactionEntryModal
          clientId={clientId}
          regime={regime}
          kind="income"
          categories={categories.data ?? []}
          existing={editing}
          onClose={() => setModalOpen(false)}
          onSaved={() => {
            setModalOpen(false);
            invalidate();
          }}
        />
      )}
    </div>
  );
}

function Th({
  children,
  className = "",
}: {
  children?: ReactNode;
  className?: string;
}) {
  return <th className={cn("px-4 py-2.5 font-semibold", className)}>{children}</th>;
}

function Td({
  children,
  className = "",
}: {
  children?: ReactNode;
  className?: string;
}) {
  return <td className={cn("px-4 py-3", className)}>{children}</td>;
}
