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
  postPurchase,
  type PurchaseTxn,
} from "../lib/api";
import {
  EXPENSE_STATUS_FILTERS,
  expenseBadges,
  isHeld,
  statusFilterParams,
  type ExpenseStatusFilter,
} from "../lib/expenseStatus";
import { manilaQuarter } from "../lib/manilaQuarter";
import { permittedFor } from "../lib/permissions";
import { isVatRegistered, regimeLabel } from "../lib/regime";
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

/** The export column that carries a non-VAT client's VAT (D23, W7 R3). */
const NON_CLAIMABLE_VAT = "VAT (non-claimable)";

export default function ExpensesPage() {
  const { clientId = "" } = useParams();
  const { user, permissions, hasPermission } = useAuth();
  const queryClient = useQueryClient();

  const [filters, setFilters] = useState<Record<string, string>>({});
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<PurchaseTxn | null>(null);
  const [exporting, setExporting] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [statusFilter, setStatusFilter] = useState<ExpenseStatusFilter>("all");
  const [posting, setPosting] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const client = useQuery({
    queryKey: ["client", clientId],
    queryFn: () => fetchClient(clientId),
  });
  const categories = useQuery({
    queryKey: ["categories", clientId, "EXPENSE"],
    queryFn: () => fetchCategories(clientId, "EXPENSE"),
  });
  // The Status filter is the server's (Track A U6-A1, W6 R2): status and
  // needsReview go with the one list request, the page shows the server's
  // first page of matches, and the footer counts the server's total.
  const listFilters = useMemo(
    () => ({ ...filters, ...statusFilterParams(statusFilter) }),
    [filters, statusFilter],
  );
  const list = useQuery<{ rows: PurchaseTxn[]; total: number }>({
    queryKey: ["purchases", clientId, listFilters],
    queryFn: async () => {
      const page = await fetchPurchases(clientId, listFilters);
      return { rows: page.data, total: page.total };
    },
  });
  // "Posted total for the quarter" (W7 R3): the server totals posted records
  // only — held ones count nowhere — for the current calendar quarter.
  const quarter = useMemo(() => manilaQuarter(), []);
  const summary = useQuery({
    queryKey: ["purchase-summary", clientId, quarter.dateFrom, quarter.dateTo],
    queryFn: () =>
      fetchPurchaseSummary(clientId, {
        dateFrom: quarter.dateFrom,
        dateTo: quarter.dateTo,
      }),
  });

  const isVat = isVatRegistered(client.data?.taxType);
  const regime: Regime | undefined = client.data
    ? isVat
      ? "VAT"
      : "PERCENTAGE"
    : undefined;
  // The header names the regime: null reads "Exempt from business tax" (W6 R1).
  const regimeNote = client.data ? regimeLabel(client.data.taxType) : undefined;

  const categoryName = useMemo(() => {
    const map = new Map((categories.data ?? []).map((c) => [c.id, c.name]));
    return (id: string) => map.get(id) ?? "—";
  }, [categories.data]);

  const canWrite = hasPermission("Expenses:Create");
  const canDelete = hasPermission("Expenses:Delete");
  // W7 R5: Edit and Post are offered only where the server would allow them
  // on THIS client — editing needs Expenses:Update; posting a held record is
  // the firm's decision (a client role is refused whatever it holds), with
  // Expenses:Create (the import controller's gate).
  const canEdit = permittedFor(permissions, "Expenses:Update", clientId);
  const canPost =
    user?.userType === "FIRM" && permittedFor(permissions, "Expenses:Create", clientId);

  function refresh() {
    queryClient.invalidateQueries({ queryKey: ["purchases", clientId] });
    queryClient.invalidateQueries({ queryKey: ["purchase-summary", clientId] });
    // The Client Detail page's Expenses tab caches the same records (F23).
    queryClient.invalidateQueries({ queryKey: ["expense", clientId] });
  }

  function openAdd() {
    setEditing(null);
    setModalOpen(true);
  }

  async function handlePost(t: PurchaseTxn) {
    const what = [t.referenceNo, t.vendor].filter(Boolean).join(" · ") || "this record";
    if (
      !confirm(
        `Post ${what}? It is held now and counts nowhere. Once posted it counts in the books.`,
      )
    )
      return;
    setPosting(t.id);
    setActionError(null);
    try {
      await postPurchase(t.id);
      refresh();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Could not post this record.");
    } finally {
      setPosting(null);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("Delete this record?")) return;
    await deletePurchase(clientId, id);
    refresh();
  }
  async function onExport() {
    setExporting(true);
    try {
      // What the Status filter shows is what is exported — every record the
      // server matches, page by page — and every row says whether it is held:
      // a held record counts nowhere until it is posted.
      const all = await fetchAllPurchases(clientId, listFilters);
      const tax = (t: (typeof all)[number]) => t.taxAmount ?? t.inputVAT ?? 0;
      // A client that is not VAT-registered keeps the VAT in the cost (D23):
      // its record's amount already includes it, so the amount is the expense
      // and the VAT is shown once, in its own column, as non-claimable (W7 R3).
      // A VAT client's amounts are net of VAT, so its VAT is added back.
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
        "Amount*": Math.round((isVat ? t.netAmount + tax(t) : t.netAmount) * 100) / 100,
        "COA Code*": t.account ?? "",
        ...(isVat ? {} : { [NON_CLAIMABLE_VAT]: Math.round(tax(t) * 100) / 100 }),
        Status: isHeld(t) ? "Held" : "Posted",
        "Needs review": t.needsReview === true ? "Yes" : "",
      }));
      const base = (client.data?.businessName ?? "client").replace(/[^\w.-]+/g, "_");
      await downloadSheet(`${base}-expenses.xlsx`, "EXPENSES", out, [
        ...EXPENSE_HEADERS,
        ...(isVat ? [] : [NON_CLAIMABLE_VAT]),
        "Status",
        "Needs review",
      ]);
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

  const rows = list.data?.rows ?? [];

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
          <label className="block">
            <div className="mb-1 text-[13px] font-semibold text-content">Status</div>
            <select
              className="input"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as ExpenseStatusFilter)}
            >
              {EXPENSE_STATUS_FILTERS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
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

        {/* Posted total for the current calendar quarter */}
        <div className="text-right">
          <div className="font-mono text-[10px] uppercase tracking-[.14em] text-content-secondary">
            Posted total for the quarter
          </div>
          {summary.isPending ? (
            <Skeleton className="mt-1 h-7 w-32" />
          ) : (
            <div className="font-serif text-[24px] font-medium tabular-nums text-navy">
              {peso(summary.data?.totalNet)}
            </div>
          )}
          <div className="mt-0.5 font-mono text-[11px] text-content-tertiary">
            Q{quarter.quarter} {quarter.year} · Deductible{" "}
            {peso(summary.data?.deductibleNet)}
          </div>
        </div>
      </div>

      {actionError ? (
        <p
          role="alert"
          className="mb-3 rounded-input border border-danger/30 bg-danger-bg px-3 py-2 text-[13px] text-danger-ink"
        >
          {actionError}
        </p>
      ) : null}

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
                  <Th>Status</Th>
                  <Th>Category</Th>
                  <Th>{isVat ? "Input VAT category" : "Type"}</Th>
                  <Th>Deduct.</Th>
                  <Th className="text-right">Amount</Th>
                  <Th className="text-right">&nbsp;</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line-divider">
                {rows.map((t) => (
                  <tr
                    key={t.id}
                    data-status={isHeld(t) ? "held" : "posted"}
                    className="text-[13px] transition-colors hover:bg-rowhover"
                  >
                    <Td className="font-mono text-[12px] text-content-secondary">
                      {t.txnDate}
                    </Td>
                    <Td className="font-mono text-[12px] text-blue">{t.referenceNo ?? "—"}</Td>
                    <Td className="text-content">{t.vendor ?? "—"}</Td>
                    <Td>
                      <div className="flex flex-wrap gap-1">
                        {expenseBadges(t).map((b) => (
                          <Chip key={b.label} variant={b.variant}>
                            {b.label}
                          </Chip>
                        ))}
                      </div>
                    </Td>
                    <Td className="text-content-secondary">
                      {categoryName(t.categoryId)}
                    </Td>
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
                    <Td className="whitespace-nowrap text-right">
                      {isHeld(t) && canPost ? (
                        <button
                          onClick={() => void handlePost(t)}
                          disabled={posting === t.id}
                          className="mr-3 font-semibold text-success underline-offset-2 hover:underline disabled:opacity-50"
                        >
                          {posting === t.id ? "Posting…" : "Post"}
                        </button>
                      ) : null}
                      {canEdit ? (
                        <button
                          onClick={() => {
                            setEditing(t);
                            setModalOpen(true);
                          }}
                          className="font-semibold text-blue underline-offset-2 hover:text-navy-hover hover:underline"
                        >
                          Edit
                        </button>
                      ) : null}
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
          {statusFilter === "all"
            ? `${list.data.total} record(s)`
            : `${
                rows.length < list.data.total
                  ? `${rows.length} of ${list.data.total}`
                  : list.data.total
              } shown · ${EXPENSE_STATUS_FILTERS.find((f) => f.value === statusFilter)?.label}`}
        </p>
      ) : null}

      {modalOpen && regime ? (
        <TransactionEntryModal
          clientId={clientId}
          regime={regime}
          taxType={client.data?.taxType ?? null}
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
