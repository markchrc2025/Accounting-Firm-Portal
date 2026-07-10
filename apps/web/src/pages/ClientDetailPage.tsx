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

const VAT_INCOME_CLASSES = VatClass.options.filter((c) => c !== "NON_VAT");

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
    return <p className="p-8 text-red-700">Could not load this client.</p>;
  }

  return (
    <main className="mx-auto max-w-5xl px-6 py-8">
      <Link to="/" className="text-sm text-gray-500 hover:underline">
        ← Dashboard
      </Link>
      <header className="mb-6 mt-2 flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-bold">{client.data?.businessName ?? "…"}</h1>
          <p className="text-sm text-gray-600">
            {regime ? `${regime} client` : "Tax type not set"}
            {client.data?.tin ? ` · TIN ${client.data.tin}` : ""}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {hasPermission("Clients:Update") && (
            <Link
              to={`/clients/${clientId}/edit`}
              className="rounded border border-gray-300 px-4 py-2 text-sm"
            >
              Edit client
            </Link>
          )}
          {canWrite && regime && (
            <button
              onClick={() => {
                setEditing(null);
                setModalOpen(true);
              }}
              className="rounded bg-gray-900 px-4 py-2 text-sm font-medium text-white"
            >
              + Add {kind === "income" ? "income" : "expense"}
            </button>
          )}
        </div>
      </header>

      {!regime && (
        <div className="mb-4 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          Set this client&apos;s tax type (VAT or PERCENTAGE) before recording
          transactions.
        </div>
      )}

      <div className="mb-4 flex gap-2 border-b border-gray-200">
        {(["income", "expense"] as Kind[]).map((k) => (
          <button
            key={k}
            onClick={() => {
              setKind(k);
              setFilters({});
            }}
            className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium ${
              kind === k
                ? "border-gray-900 text-gray-900"
                : "border-transparent text-gray-500"
            }`}
          >
            {k === "income" ? "Sales / Income" : "Expenses / Purchases"}
          </button>
        ))}
      </div>

      {/* Filter bar */}
      <div className="mb-3 flex flex-wrap items-end gap-2">
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
        <div className="text-sm">
          <div className="font-medium text-gray-700">Category</div>
          <select
            className="input mt-1"
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
        </div>
        {isVat && (
          <div className="text-sm">
            <div className="font-medium text-gray-700">
              {kind === "income" ? "VAT class" : "Input VAT cat."}
            </div>
            <select
              className="input mt-1"
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
          </div>
        )}
        <FilterInput
          label="Search"
          type="text"
          onChange={(v) => setFilters((f) => ({ ...f, search: v }))}
        />
      </div>

      {/* Inline category add */}
      {canManageCategories && (
        <div className="mb-3 flex items-center gap-2 text-sm">
          <input
            placeholder={`New ${kind === "income" ? "income" : "expense"} category`}
            value={newCategory}
            onChange={(e) => setNewCategory(e.target.value)}
            className="input max-w-xs"
          />
          <button
            onClick={addCategory}
            className="rounded border border-gray-300 px-3 py-2 text-sm"
          >
            Add category
          </button>
        </div>
      )}

      {/* Table */}
      <div className="overflow-x-auto rounded border border-gray-200">
        <table className="w-full text-left text-sm">
          <thead className="bg-gray-50 text-xs uppercase text-gray-500">
            <tr>
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
              <Th></Th>
            </tr>
          </thead>
          <tbody>
            {list.isPending && (
              <tr>
                <td colSpan={9} className="p-4 text-gray-500">
                  Loading…
                </td>
              </tr>
            )}
            {list.data && list.data.data.length === 0 && (
              <tr>
                <td colSpan={9} className="p-4 text-gray-500">
                  No records.
                </td>
              </tr>
            )}
            {list.data?.data.map((t) => {
              const income = t as IncomeTxn;
              const purchase = t as PurchaseTxn;
              return (
                <tr key={t.id} className="border-t border-gray-100">
                  <Td>{t.txnDate}</Td>
                  <Td>{t.referenceNo ?? "—"}</Td>
                  <Td>
                    {kind === "income"
                      ? (income.customer ?? "—")
                      : (purchase.vendor ?? "—")}
                  </Td>
                  <Td>{t.description}</Td>
                  <Td>{categoryName(t.categoryId)}</Td>
                  <Td className="text-right tabular-nums">
                    {t.netAmount.toLocaleString()}
                  </Td>
                  {isVat && kind === "income" && <Td>{income.vatClass}</Td>}
                  {isVat && kind === "expense" && (
                    <Td>{purchase.inputVATCategory ?? "—"}</Td>
                  )}
                  {kind === "expense" && <Td>{purchase.deductible ? "Yes" : "No"}</Td>}
                  <Td className="text-right">
                    <button
                      onClick={() => {
                        setEditing(t);
                        setModalOpen(true);
                      }}
                      className="text-gray-600 hover:underline"
                    >
                      Edit
                    </button>
                    {canDelete && (
                      <button
                        onClick={() => handleDelete(t.id)}
                        className="ml-3 text-red-600 hover:underline"
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
      {list.data && (
        <p className="mt-2 text-xs text-gray-500">{list.data.total} record(s)</p>
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
    </main>
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
    <label className="text-sm">
      <div className="font-medium text-gray-700">{label}</div>
      <input
        type={type}
        onChange={(e) => onChange(e.target.value)}
        className="input mt-1"
      />
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
  return <th className={`px-3 py-2 font-medium ${className}`}>{children}</th>;
}
function Td({
  children,
  className = "",
}: {
  children?: React.ReactNode;
  className?: string;
}) {
  return <td className={`px-3 py-2 ${className}`}>{children}</td>;
}
