import { InputVATCategory } from "@portal/shared";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState, type ReactNode } from "react";
import { useParams } from "react-router-dom";
import TransactionEntryModal, { type Regime } from "../components/TransactionEntryModal";
import { ClientWorkspaceTabs } from "../components/ClientWorkspaceTabs";
import { ImportModal } from "../components/ImportModal";
import { useAuth } from "../auth/AuthContext";
import {
  deletePurchase,
  fetchAllPurchases,
  fetchCategories,
  fetchClient,
  fetchPurchases,
  fetchPurchaseSummary,
  type Paginated,
  type PurchaseTxn,
} from "../lib/api";
import { downloadSheet, EXPENSE_HEADERS } from "../lib/spreadsheet";
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

/** VAT when the tax type mentions VAT but is not NON-VAT; otherwise percentage. */
function isVatRegime(taxType?: string | null): boolean {
  const t = (taxType ?? "").toUpperCase();
  return t.includes("VAT") && !t.includes("NON");
}

export default function ExpensesPage() {
  const { clientId = "" } = useParams();
  const { hasPermission } = useAuth();
  const queryClient = useQueryClient();

  const [filters, setFilters] = useState<Record<string, string>>({});
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<PurchaseTxn | null>(null);
  const [exporting, setExporting] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

  const client = useQuery({
    queryKey: ["client", clientId],
    queryFn: () => fetchClient(clientId),
  });
  const categories = useQuery({
    queryKey: ["categories", clientId, "EXPENSE"],
    queryFn: () => fetchCategories(clientId, "EXPENSE"),
  });
  const list = useQuery<Paginated<PurchaseTxn>>({
    queryKey: ["purchases", clientId, filters],
    queryFn: () => fetchPurchases(clientId, filters),
  });
  const summary = useQuery({
    queryKey: ["purchase-summary", clientId, filters],
    queryFn: () => fetchPurchaseSummary(clientId, filters),
  });

  const isVat = isVatRegime(client.data?.taxType);
  const regime: Regime | undefined = client.data
    ? isVat
      ? "VAT"
      : "PERCENTAGE"
    : undefined;
  const regimeNote = client.data ? (isVat ? "VAT-registered" : "Percentage tax") : undefined;

  const categoryName = useMemo(() => {
    const map = new Map((categories.data ?? []).map((c) => [c.id, c.name]));
    return (id: string) => map.get(id) ?? "—";
  }, [categories.data]);

  const canWrite = hasPermission("Expenses:Create");
  const canDelete = hasPermission("Expenses:Delete");

  function refresh() {
    queryClient.invalidateQueries({ queryKey: ["purchases", clientId] });
    queryClient.invalidateQueries({ queryKey: ["purchase-summary", clientId] });
  }

  function openAdd() {
    setEditing(null);
    setModalOpen(true);
  }

  async function handleDelete(id: string) {
    if (!confirm("Delete this record?")) return;
    await deletePurchase(clientId, id);
    refresh();
  }
  async function onExport() {
    setExporting(true);
    try {
      const all = await fetchAllPurchases(clientId, filters);
      const tax = (t: (typeof all)[number]) => t.taxAmount ?? t.inputVAT ?? 0;
      const out = all.map((t) => ({
        "Date*": t.txnDate,
        "Vendor TIN*": t.vendorTin ?? "",
        "Vendor Name*": t.vendor ?? "",
        "Vendor Lastname": "",
        "Vendor Firstname": "",
        "Vendor Middlename": "",
        Address: "",
        City: "",
        "Postal Code*": "",
        "Reference Number*": t.referenceNo ?? "",
        "Tax Code*": t.atc ?? "",
        "Tax Type*": t.inputVATCategory ? "VAT" : "",
        Category: categoryName(t.categoryId),
        Description: t.description,
        // Amount is tax-inclusive (net + input VAT / tax).
        "Amount*": Math.round((t.netAmount + tax(t)) * 100) / 100,
        "COA Code*": t.account ?? "",
      }));
      const base = (client.data?.businessName ?? "client").replace(/[^\w.-]+/g, "_");
      await downloadSheet(`${base}-expenses.xlsx`, "EXPENSES", out, EXPENSE_HEADERS);
    } finally {
      setExporting(false);
    }
  }

  if (!clientId) {
    return (
      <div className="animate-fade-rise">
        <Card>
          <EmptyState
            title="No client selected"
            description="Choose a client to view their expenses."
          />
        </Card>
      </div>
    );
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

  const rows = list.data?.data ?? [];

  return (
    <div className="animate-fade-rise">
      <ClientWorkspaceTabs clientId={clientId} />

      <PageHeader
        title="Expenses"
        eyebrow={regimeNote}
        description={
          client.isPending ? (
            <Skeleton className="h-4 w-48" />
          ) : (
            (client.data?.businessName ?? "—")
          )
        }
        actions={
          <div className="flex items-center gap-2">
            {regime && canWrite ? (
              <Button variant="outline" onClick={() => setImportOpen(true)}>
                Import
              </Button>
            ) : null}
            <Button
              variant="outline"
              onClick={onExport}
              disabled={exporting || (list.data?.total ?? 0) === 0}
            >
              {exporting ? "Exporting…" : "Export"}
            </Button>
            {regime && canWrite ? <Button onClick={openAdd}>+ Add record</Button> : null}
          </div>
        }
      />

      {/* Toolbar */}
      <div className="mb-4 flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-wrap items-end gap-3">
          <label className="block">
            <div className="mb-1 text-[13px] font-semibold text-content">Search</div>
            <input
              type="text"
              placeholder="Vendor, reference, or description"
              className="input min-w-[16rem]"
              value={filters.search ?? ""}
              onChange={(e) => setFilters((f) => ({ ...f, search: e.target.value }))}
            />
          </label>
          {isVat && (
            <label className="block">
              <div className="mb-1 text-[13px] font-semibold text-content">
                Input VAT category
              </div>
              <select
                className="input"
                value={filters.inputVATCategory ?? ""}
                onChange={(e) =>
                  setFilters((f) => ({ ...f, inputVATCategory: e.target.value }))
                }
              >
                <option value="">All</option>
                {InputVATCategory.options.map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>

        {/* Quarter total */}
        <div className="text-right">
          <div className="font-mono text-[10px] uppercase tracking-[.14em] text-content-secondary">
            Quarter total
          </div>
          {summary.isPending ? (
            <Skeleton className="mt-1 h-7 w-32" />
          ) : (
            <div className="font-serif text-[24px] font-medium tabular-nums text-navy">
              {peso(summary.data?.totalNet)}
            </div>
          )}
          <div className="mt-0.5 font-mono text-[11px] text-content-tertiary">
            Deductible {peso(summary.data?.deductibleNet)}
          </div>
        </div>
      </div>

      {/* Table / states */}
      <Card className="overflow-hidden">
        {list.isError ? (
          <ErrorState
            message="Could not load expense records."
            onRetry={() => void list.refetch()}
          />
        ) : list.isPending ? (
          <div className="space-y-3 px-6 py-5">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className={cn(i % 3 === 1 && "w-3/4", i % 3 === 2 && "w-2/3")} />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <EmptyState
            title="No expense records"
            description="Nothing matches the current filters yet."
          >
            {regime && canWrite ? (
              <Button onClick={openAdd}>+ Add record</Button>
            ) : null}
          </EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-line-divider bg-sidebar font-mono text-[10px] uppercase tracking-[.14em] text-content-secondary">
                  <Th>Date</Th>
                  <Th>Ref</Th>
                  <Th>Supplier</Th>
                  <Th>Category</Th>
                  <Th>{isVat ? "Input VAT category" : "Type"}</Th>
                  <Th>Deduct.</Th>
                  <Th className="text-right">Amount</Th>
                  <Th className="text-right">&nbsp;</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line-divider">
                {rows.map((t) => (
                  <tr key={t.id} className="text-[13px] transition-colors hover:bg-rowhover">
                    <Td className="font-mono text-[12px] text-content-secondary">
                      {t.txnDate}
                    </Td>
                    <Td className="font-mono text-[12px] text-blue">{t.referenceNo ?? "—"}</Td>
                    <Td className="text-content">{t.vendor ?? "—"}</Td>
                    <Td className="text-content-secondary">{categoryName(t.categoryId)}</Td>
                    <Td>
                      {isVat ? (
                        t.inputVATCategory ? (
                          <Chip variant="neutral">{t.inputVATCategory}</Chip>
                        ) : (
                          <span className="text-content-muted">—</span>
                        )
                      ) : (
                        <span className="text-content-muted">N/A</span>
                      )}
                    </Td>
                    <Td>
                      {t.deductible ? (
                        <span className="font-semibold text-success">✓</span>
                      ) : (
                        <span className="text-content-muted">—</span>
                      )}
                    </Td>
                    <Td className="text-right font-mono tabular-nums text-content">
                      {peso(t.netAmount)}
                    </Td>
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
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {list.data ? (
        <p className="mt-3 font-mono text-[11px] uppercase tracking-[.14em] text-content-secondary">
          {list.data.total} record(s)
        </p>
      ) : null}

      {modalOpen && regime ? (
        <TransactionEntryModal
          clientId={clientId}
          regime={regime}
          kind="expense"
          categories={categories.data ?? []}
          existing={editing}
          onClose={() => setModalOpen(false)}
          onSaved={() => {
            setModalOpen(false);
            refresh();
          }}
        />
      ) : null}

      {importOpen && regime ? (
        <ImportModal
          kind="expense"
          clientId={clientId}
          regime={regime}
          onClose={() => setImportOpen(false)}
          onImported={() => {
            refresh();
            queryClient.invalidateQueries({ queryKey: ["categories", clientId] });
          }}
        />
      ) : null}
    </div>
  );
}

function Th({ children, className = "" }: { children?: ReactNode; className?: string }) {
  return <th className={cn("px-4 py-2.5 font-semibold", className)}>{children}</th>;
}
function Td({ children, className = "" }: { children?: ReactNode; className?: string }) {
  return <td className={cn("px-4 py-3", className)}>{children}</td>;
}
