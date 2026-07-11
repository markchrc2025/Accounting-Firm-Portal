import { VatClass } from "@portal/shared";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import TransactionEntryModal, {
  type Regime,
} from "../components/TransactionEntryModal";
import { ClientWorkspaceTabs } from "../components/ClientWorkspaceTabs";
import { ImportModal } from "../components/ImportModal";
import { useAuth } from "../auth/AuthContext";
import {
  deleteIncome,
  fetchAllIncome,
  fetchCategories,
  fetchClient,
  fetchIncome,
  fetchIncomeSummary,
  type IncomeTxn,
} from "../lib/api";
import { downloadSheet, SALES_HEADERS } from "../lib/spreadsheet";
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

export default function SalesPage() {
  const { clientId = "" } = useParams();
  const { hasPermission } = useAuth();
  const queryClient = useQueryClient();

  const [filters, setFilters] = useState<Record<string, string>>({});
  const [search, setSearch] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<IncomeTxn | null>(null);
  const [exporting, setExporting] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

  const client = useQuery({
    queryKey: ["client", clientId],
    queryFn: () => fetchClient(clientId),
    enabled: !!clientId,
  });
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

  // Regime: taxType containing "VAT" (but not "NON") → VAT, else PERCENTAGE.
  const taxType = (client.data?.taxType ?? "").toUpperCase();
  const isVat = taxType.includes("VAT") && !taxType.includes("NON");
  const regime: Regime = isVat ? "VAT" : "PERCENTAGE";

  // Category-name lookup by id (same pattern as ClientDetailPage).
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
  const canDelete = hasPermission("Sales:Delete");
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
  async function onExport() {
    setExporting(true);
    try {
      const all = await fetchAllIncome(clientId, filters);
      const rows = all.map((t) => ({
        Date: t.txnDate,
        ReferenceNo: t.referenceNo ?? "",
        Customer: t.customer ?? "",
        Description: t.description,
        Category: categoryName(t.categoryId),
        NetAmount: t.netAmount,
        VatClass: t.vatClass,
        OutputVAT: t.outputVAT ?? "",
        SaleToGovernment: t.saleToGovernment ? "Yes" : "No",
        CreditableVATWithheld5pct: t.creditableVATWithheld5pct ?? "",
        ATC: t.atc ?? "",
        Currency: client.data?.currency ?? "PHP",
      }));
      const base = (client.data?.businessName ?? "client").replace(/[^\w.-]+/g, "_");
      await downloadSheet(`${base}-sales.xlsx`, "SALES", rows, SALES_HEADERS);
    } finally {
      setExporting(false);
    }
  }

  if (!clientId) {
    return (
      <div className="animate-fade-rise">
        <Card>
          <ErrorState message="No client selected." />
        </Card>
      </div>
    );
  }

  const amountHeader = regime === "VAT" ? "Net amount (VAT)" : "Gross receipts";
  const regimeNote = regime === "VAT" ? "VAT-registered" : "Percentage tax";

  return (
    <div className="animate-fade-rise">
      <ClientWorkspaceTabs clientId={clientId} />

      <PageHeader
        title="Sales & Income"
        eyebrow={regimeNote}
        description={
          client.isPending ? "…" : (client.data?.businessName ?? "—")
        }
        actions={
          <div className="flex items-center gap-2">
            {canCreate ? (
              <Button variant="outline" onClick={() => setImportOpen(true)}>
                Import
              </Button>
            ) : null}
            <Button
              variant="outline"
              onClick={onExport}
              disabled={exporting || (income.data?.total ?? 0) === 0}
            >
              {exporting ? "Exporting…" : "Export"}
            </Button>
            {canCreate ? <Button onClick={openAdd}>+ Add record</Button> : null}
          </div>
        }
      />

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
                <Th className="text-right">&nbsp;</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line-divider">
              {income.isPending && (
                <tr>
                  <td colSpan={7} className="px-4 py-5">
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
                  <td colSpan={7}>
                    <ErrorState
                      message="Could not load sales records."
                      onRetry={() => void income.refetch()}
                    />
                  </td>
                </tr>
              )}
              {income.data && rows.length === 0 && (
                <tr>
                  <td colSpan={7}>
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
                    <Td className="text-right">
                      <button
                        onClick={() => openEdit(t)}
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

      {modalOpen && client.data && (
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

      {importOpen && (
        <ImportModal
          kind="income"
          clientId={clientId}
          regime={regime}
          onClose={() => setImportOpen(false)}
          onImported={() => {
            invalidate();
            queryClient.invalidateQueries({ queryKey: ["categories", clientId] });
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
