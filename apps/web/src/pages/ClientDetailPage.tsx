import { InputVATCategory, VatClass } from "@portal/shared";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import TransactionEntryModal, {
  type Kind,
  type Regime,
} from "../components/TransactionEntryModal";
import { useAuth } from "../auth/AuthContext";
import {
  createCategory,
  deleteIncome,
  deletePurchase,
  fetchCategories,
  fetchClient,
  fetchIncome,
  fetchPurchases,
  type IncomeTxn,
  type Paginated,
  type PurchaseTxn,
} from "../lib/api";
import {
  Button,
  Card,
  Chip,
  ChipVariant,
  cn,
  EmptyState,
  ErrorState,
  peso,
  RegimeChip,
  Skeleton,
  StatusChip,
} from "../components/ui";

const VAT_INCOME_CLASSES = VatClass.options.filter((c) => c !== "NON_VAT");

/** Map a client status string to a chip tone. */
function statusTone(status?: string | null): ChipVariant {
  const s = (status ?? "").toUpperCase();
  if (s.includes("ACTIVE")) return "success";
  if (s.includes("ONBOARD") || s.includes("PENDING")) return "warn";
  if (s.includes("INACTIVE")) return "neutral";
  return "neutral";
}

/** Two-letter initials from a business/person name. */
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "—";
  if (parts.length === 1) return (parts[0] ?? "").slice(0, 2).toUpperCase();
  return `${(parts[0] ?? "").charAt(0)}${(parts[parts.length - 1] ?? "").charAt(0)}`.toUpperCase();
}

export default function ClientDetailPage() {
  const { clientId = "" } = useParams();
  const { hasPermission } = useAuth();
  const queryClient = useQueryClient();

  const [kind, setKind] = useState<Kind>("income");
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<IncomeTxn | PurchaseTxn | null>(null);
  const [newCategory, setNewCategory] = useState("");

  const client = useQuery({
    queryKey: ["client", clientId],
    queryFn: () => fetchClient(clientId),
  });
  const categories = useQuery({
    queryKey: ["categories", clientId],
    queryFn: () => fetchCategories(clientId),
  });

  const activeFilters = { ...filters };
  const list = useQuery<Paginated<IncomeTxn | PurchaseTxn>>({
    queryKey: [kind, clientId, activeFilters],
    queryFn: () =>
      kind === "income"
        ? fetchIncome(clientId, activeFilters)
        : fetchPurchases(clientId, activeFilters),
  });

  const regime = (client.data?.taxType as Regime | undefined) ?? undefined;
  const isVat = regime === "VAT";
  const categoryName = useMemo(() => {
    const map = new Map((categories.data ?? []).map((c) => [c.id, c.name]));
    return (id: string) => map.get(id) ?? "—";
  }, [categories.data]);

  const canWrite = hasPermission(kind === "income" ? "Sales:Create" : "Expenses:Create");
  const canDelete = hasPermission(kind === "income" ? "Sales:Delete" : "Expenses:Delete");
  const canManageCategories = hasPermission("Categories:Create");

  function refresh() {
    queryClient.invalidateQueries({ queryKey: [kind, clientId] });
    queryClient.invalidateQueries({ queryKey: ["categories", clientId] });
  }

  async function handleDelete(id: string) {
    if (!confirm("Delete this record?")) return;
    if (kind === "income") await deleteIncome(clientId, id);
    else await deletePurchase(clientId, id);
    refresh();
  }

  async function addCategory() {
    if (!newCategory.trim()) return;
    await createCategory(clientId, {
      type: kind === "income" ? "INCOME" : "EXPENSE",
      name: newCategory.trim(),
    });
    setNewCategory("");
    categories.refetch();
  }

  if (client.isError) {
    return (
      <div className="animate-fade-rise">
        <Card>
          <ErrorState
            message="Could not load this client."
            onRetry={() => void client.refetch()}
          />
        </Card>
      </div>
    );
  }

  return (
    <div className="animate-fade-rise">
      {/* Breadcrumb */}
      <nav aria-label="Breadcrumb" className="mb-4 text-[12px] text-content-secondary">
        <Link to="/" className="text-blue hover:underline">
          Clients
        </Link>
        <span className="px-1.5 text-content-muted">/</span>
        <span className="text-content">{client.data?.businessName ?? "…"}</span>
      </nav>

      {/* Header */}
      <div className="mb-6 flex items-start justify-between gap-5">
        <div className="flex items-center gap-4">
          <span className="flex h-[52px] w-[52px] shrink-0 items-center justify-center rounded-card bg-navy font-mono text-[16px] font-bold text-gold-soft">
            {client.data ? initials(client.data.businessName) : "—"}
          </span>
          <div className="min-w-0">
            {client.isPending ? (
              <Skeleton className="h-8 w-64" />
            ) : (
              <h1 className="font-serif text-[30px] font-medium text-navy">
                {client.data?.businessName ?? "—"}
              </h1>
            )}
            <div className="mt-1.5 flex flex-wrap items-center gap-2">
              {client.data?.tin ? (
                <span className="font-mono text-[12px] text-content-secondary">
                  TIN {client.data.tin}
                </span>
              ) : null}
              <RegimeChip regime={client.data?.taxType} />
              {client.data?.status ? (
                <StatusChip
                  label={client.data.status}
                  variant={statusTone(client.data.status)}
                />
              ) : null}
            </div>
          </div>
        </div>
        {hasPermission("Clients:Update") && (
          <Link
            to={`/clients/${clientId}/edit`}
            className="inline-flex flex-none items-center rounded-btn border border-line-input bg-card px-4 py-[7px] text-[13px] font-semibold text-navy transition-colors hover:border-navy"
          >
            Edit client
          </Link>
        )}
      </div>

      {!regime && (
        <div className="mb-4 rounded-card border border-warn/30 bg-warn-bg px-4 py-3 text-[13px] text-gold-deep">
          Set this client&apos;s tax type (VAT or PERCENTAGE) before recording
          transactions.
        </div>
      )}

      {/* Tab bar */}
      <div className="mb-6 flex gap-6 border-b border-line-strong">
        {(["income", "expense"] as Kind[]).map((k) => (
          <button
            key={k}
            onClick={() => {
              setKind(k);
              setFilters({});
            }}
            className={cn(
              "-mb-px px-1 pb-3 pt-1 text-[13px] transition-colors",
              kind === k
                ? "border-b-[2.5px] border-gold font-bold text-navy"
                : "text-content-secondary hover:text-navy",
            )}
          >
            {k === "income" ? "Sales / Income" : "Expenses / Purchases"}
          </button>
        ))}
      </div>

      {/* Filter bar */}
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-wrap items-end gap-3">
          <FilterInput
            label="From"
            type="date"
            onChange={(v) => setFilters((f) => ({ ...f, dateFrom: v }))}
          />
          <FilterInput
            label="To"
            type="date"
            onChange={(v) => setFilters((f) => ({ ...f, dateTo: v }))}
          />
          <label className="block">
            <div className="mb-1 text-[13px] font-semibold text-content">Category</div>
            <select
              className="input"
              onChange={(e) => setFilters((f) => ({ ...f, categoryId: e.target.value }))}
            >
              <option value="">All</option>
              {(categories.data ?? [])
                .filter((c) => c.type === (kind === "income" ? "INCOME" : "EXPENSE"))
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
            </select>
          </label>
          {isVat && (
            <label className="block">
              <div className="mb-1 text-[13px] font-semibold text-content">
                {kind === "income" ? "VAT class" : "Input VAT cat."}
              </div>
              <select
                className="input"
                onChange={(e) =>
                  setFilters((f) => ({
                    ...f,
                    ...(kind === "income"
                      ? { vatClass: e.target.value }
                      : { inputVATCategory: e.target.value }),
                  }))
                }
              >
                <option value="">All</option>
                {(kind === "income" ? VAT_INCOME_CLASSES : InputVATCategory.options).map(
                  (o) => (
                    <option key={o} value={o}>
                      {o}
                    </option>
                  ),
                )}
              </select>
            </label>
          )}
          <FilterInput
            label="Search"
            type="text"
            onChange={(v) => setFilters((f) => ({ ...f, search: v }))}
          />
        </div>
        {canWrite && regime && (
          <Button
            onClick={() => {
              setEditing(null);
              setModalOpen(true);
            }}
          >
            + Add {kind === "income" ? "income" : "expense"}
          </Button>
        )}
      </div>

      {/* Inline category add */}
      {canManageCategories && (
        <div className="mb-4 flex items-center gap-2">
          <input
            placeholder={`New ${kind === "income" ? "income" : "expense"} category`}
            value={newCategory}
            onChange={(e) => setNewCategory(e.target.value)}
            className="input max-w-xs"
          />
          <Button variant="outline" size="sm" onClick={addCategory}>
            Add category
          </Button>
        </div>
      )}

      {/* Table */}
      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-line-divider bg-sidebar font-mono text-[10px] uppercase tracking-[.14em] text-content-secondary">
                <Th>Date</Th>
                <Th>Ref</Th>
                <Th>{kind === "income" ? "Customer" : "Vendor"}</Th>
                <Th>Description</Th>
                <Th>Category</Th>
                <Th className="text-right">
                  {isVat ? "Net" : kind === "income" ? "Gross" : "Net"}
                </Th>
                {isVat && kind === "income" && <Th>VAT class</Th>}
                {isVat && kind === "expense" && <Th>Input cat.</Th>}
                {kind === "expense" && <Th>Deduct.</Th>}
                <Th className="text-right">&nbsp;</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line-divider">
              {list.isPending && (
                <tr>
                  <td colSpan={9} className="px-4 py-5">
                    <div className="space-y-3">
                      <Skeleton />
                      <Skeleton className="w-3/4" />
                      <Skeleton className="w-2/3" />
                    </div>
                  </td>
                </tr>
              )}
              {list.isError && (
                <tr>
                  <td colSpan={9}>
                    <ErrorState
                      message="Could not load records."
                      onRetry={() => void list.refetch()}
                    />
                  </td>
                </tr>
              )}
              {list.data && list.data.data.length === 0 && (
                <tr>
                  <td colSpan={9}>
                    <EmptyState
                      title="No records"
                      description="Nothing matches the current filters yet."
                    />
                  </td>
                </tr>
              )}
              {list.data?.data.map((t) => {
                const income = t as IncomeTxn;
                const purchase = t as PurchaseTxn;
                return (
                  <tr key={t.id} className="text-[13px] transition-colors hover:bg-rowhover">
                    <Td className="font-mono text-[12px] text-content-secondary">
                      {t.txnDate}
                    </Td>
                    <Td className="font-mono text-[12px] text-content-secondary">
                      {t.referenceNo ?? "—"}
                    </Td>
                    <Td className="text-content">
                      {kind === "income"
                        ? (income.customer ?? "—")
                        : (purchase.vendor ?? "—")}
                    </Td>
                    <Td className="text-content">{t.description}</Td>
                    <Td className="text-content-secondary">{categoryName(t.categoryId)}</Td>
                    <Td className="text-right font-mono tabular-nums text-content">
                      {peso(t.netAmount)}
                    </Td>
                    {isVat && kind === "income" && (
                      <Td>
                        <Chip variant="vat">{income.vatClass}</Chip>
                      </Td>
                    )}
                    {isVat && kind === "expense" && (
                      <Td>
                        {purchase.inputVATCategory ? (
                          <Chip variant="neutral">{purchase.inputVATCategory}</Chip>
                        ) : (
                          <span className="text-content-muted">—</span>
                        )}
                      </Td>
                    )}
                    {kind === "expense" && (
                      <Td>
                        <Chip variant={purchase.deductible ? "success" : "neutral"}>
                          {purchase.deductible ? "Yes" : "No"}
                        </Chip>
                      </Td>
                    )}
                    <Td className="text-right">
                      <button
                        onClick={() => {
                          setEditing(t);
                          setModalOpen(true);
                        }}
                        className="font-semibold text-blue underline-offset-2 hover:text-navy-hover hover:underline"
                      >
                        Edit
                      </button>
                      {canDelete && (
                        <button
                          onClick={() => handleDelete(t.id)}
                          className="ml-3 font-semibold text-danger underline-offset-2 hover:underline"
                        >
                          Delete
                        </button>
                      )}
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
      {list.data && (
        <p className="mt-3 font-mono text-[11px] uppercase tracking-[.14em] text-content-secondary">
          {list.data.total} record(s)
        </p>
      )}

      {modalOpen && regime && (
        <TransactionEntryModal
          clientId={clientId}
          regime={regime}
          kind={kind}
          categories={categories.data ?? []}
          existing={editing}
          onClose={() => setModalOpen(false)}
          onSaved={() => {
            setModalOpen(false);
            refresh();
          }}
        />
      )}
    </div>
  );
}

function FilterInput({
  label,
  type,
  onChange,
}: {
  label: string;
  type: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="block">
      <div className="mb-1 text-[13px] font-semibold text-content">{label}</div>
      <input type={type} onChange={(e) => onChange(e.target.value)} className="input" />
    </label>
  );
}

function Th({
  children,
  className = "",
}: {
  children?: React.ReactNode;
  className?: string;
}) {
  return <th className={cn("px-4 py-2.5 font-semibold", className)}>{children}</th>;
}
function Td({
  children,
  className = "",
}: {
  children?: React.ReactNode;
  className?: string;
}) {
  return <td className={cn("px-4 py-3", className)}>{children}</td>;
}
