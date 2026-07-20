/**
 * Billing & Invoices — the CENTRALIZED firm-admin screen (all clients, one
 * consolidated list) with three local views (no routing):
 *  - "list"    — every invoice in the firm (filterable by client) + "New invoice".
 *  - "create"  — invoice form: a type-to-search "Bill to" combobox, dates, a
 *                Description field, an editable LINE ITEMS grid, and a live totals block.
 *  - "preview" — a rendered branded email mock (From/To/Subject + navy header,
 *                AMOUNT DUE panel, CTA, engagement-lead footer).
 *
 * Wired to the live API (`../lib/api`): `fetchInvoices` / `createInvoice` /
 * `sendInvoice`, plus `fetchClients` for the combobox + filter. Money is always
 * rendered via `peso`, mono + right-aligned; numeric fields are coerced with
 * `Number()`. GUARDRAIL-neutral: invoices are firm billing, not BIR tax.
 */
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BillingDocument } from "../components/BillingDocument";
import { McrcMark } from "../components/McrcMark";
import { useAuth } from "../auth/AuthContext";
import {
  createInvoice,
  fetchClients,
  fetchInvoices,
  sendInvoice,
  type ClientSummary,
  type Invoice,
  type InvoiceInput,
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
  RegimeChip,
  Skeleton,
  type ChipVariant,
} from "../components/ui";

type View = "list" | "create" | "preview";

const VAT_RATE = 0.12;

/** Payment terms: days from the invoice date to the due date. "custom" means
 *  the user set the due date by hand and it no longer tracks the terms. */
const TERMS_OPTIONS = [
  { value: "0", label: "Due on receipt" },
  { value: "7", label: "Net 7" },
  { value: "15", label: "Net 15" },
  { value: "30", label: "Net 30" },
  { value: "45", label: "Net 45" },
  { value: "60", label: "Net 60" },
  { value: "custom", label: "Custom" },
] as const;
type TermsValue = (typeof TERMS_OPTIONS)[number]["value"];
const DEFAULT_TERMS: TermsValue = "30";

/** Local, unsaved line item — amount is derived (qty × rate), not stored. */
interface DraftLine {
  description: string;
  qty: number;
  rate: number;
}

function emptyLine(): DraftLine {
  return { description: "", qty: 1, rate: 0 };
}

/** Blank / non-finite input → 0, so totals never render NaN. */
function num(v: string): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** Today as `YYYY-MM-DD` for a native date input. */
function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

/** `iso` shifted by `days`, back to `YYYY-MM-DD`. */
function addDaysISO(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Up-to-two-letter initials for the navy business tile. */
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const a = parts[0]?.[0] ?? "";
  const b = parts[1]?.[0] ?? "";
  return (a + b).toUpperCase() || "—";
}

/** Invoice status → chip tone. */
function statusVariant(status: string): ChipVariant {
  switch (status) {
    case "Paid":
      return "success";
    case "Sent":
      return "info";
    case "Overdue":
      return "danger";
    default:
      return "neutral";
  }
}

/** Draft / Overdue can still be (re)sent; Sent / Paid hide the action. */
function isSendable(status: string): boolean {
  return status === "Draft" || status === "Overdue";
}

const SearchIcon = () => (
  <svg
    width="15"
    height="15"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    aria-hidden="true"
  >
    <circle cx="11" cy="11" r="7" />
    <path d="M21 21l-4.3-4.3" strokeLinecap="round" />
  </svg>
);

/* ------------------------------------------------------------------------- *
 * "Bill to" type-to-search combobox — self-contained, no Radix. A controlled
 * input + a conditionally-rendered absolute dropdown, closing on blur/selection.
 * ------------------------------------------------------------------------- */

function BillToCombobox({
  value,
  onSelect,
}: {
  value: ClientSummary | null;
  onSelect: (client: ClientSummary) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const clientsQ = useQuery({ queryKey: ["clients"], queryFn: fetchClients });

  // Reflect the externally-selected client (e.g. the active-client default) in
  // the input. Fires only when the selection identity changes, not on keystrokes.
  useEffect(() => {
    if (value) setQuery(value.businessName);
  }, [value]);

  const matches = useMemo(() => {
    const all = clientsQ.data ?? [];
    const q = query.trim().toLowerCase();
    if (!q) return all;
    return all.filter(
      (c) =>
        c.businessName.toLowerCase().includes(q) ||
        (c.tin ?? "").toLowerCase().includes(q),
    );
  }, [clientsQ.data, query]);

  return (
    <div
      className="relative"
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
          setOpen(false);
        }
      }}
    >
      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-content-tertiary">
        <SearchIcon />
      </span>
      <input
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-label="Bill to — search clients by name or TIN"
        value={query}
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") setOpen(false);
        }}
        placeholder="Search a client by name or TIN…"
        className="input w-full pl-9"
      />

      {open ? (
        <div className="absolute z-20 mt-1 w-full overflow-hidden rounded-card border border-line-strong bg-card shadow-dropdown">
          <ul className="max-h-64 overflow-y-auto p-1" role="listbox">
            {clientsQ.isPending ? (
              <li className="px-3 py-3 text-[13px] text-content-secondary">
                Loading clients…
              </li>
            ) : null}
            {clientsQ.isError ? (
              <li className="px-3 py-3 text-[13px] text-danger">
                Couldn&apos;t load clients.
              </li>
            ) : null}
            {clientsQ.data
              ? matches.map((c) => (
                  <li key={c.id}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={value?.id === c.id}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => {
                        onSelect(c);
                        setQuery(c.businessName);
                        setOpen(false);
                      }}
                      className="flex w-full items-center gap-3 rounded-btn px-2.5 py-2 text-left transition-colors hover:bg-rowhover"
                    >
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-navy font-mono text-[11px] font-semibold text-gold-soft">
                        {initials(c.businessName)}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-semibold text-content">
                          {c.businessName}
                        </span>
                        <span className="block truncate font-mono text-[12px] text-content-secondary">
                          {c.tin ?? "—"}
                        </span>
                      </span>
                      <RegimeChip regime={c.taxType} />
                    </button>
                  </li>
                ))
              : null}
            {clientsQ.data && matches.length === 0 ? (
              <li className="px-2.5 py-3">
                <Link
                  to="/clients/new"
                  onMouseDown={(e) => e.preventDefault()}
                  className="flex items-center gap-2 text-[13px] text-blue hover:text-navy-hover hover:underline"
                >
                  <span className="text-[15px] leading-none">+</span>
                  No match — add a new client
                </Link>
              </li>
            ) : null}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------------- *
 * List view
 * ------------------------------------------------------------------------- */

function InvoiceList({
  canCreate,
  canSend,
  onNew,
}: {
  canCreate: boolean;
  canSend: boolean;
  onNew: () => void;
}) {
  const queryClient = useQueryClient();
  // "" = all clients; otherwise narrow the consolidated list to one client
  // (the API's clientId filter also matches invoices billed FOR a sub-client).
  const [clientFilter, setClientFilter] = useState("");
  const clientsQ = useQuery({ queryKey: ["clients"], queryFn: fetchClients });
  const invoicesQ = useQuery({
    queryKey: ["invoices", clientFilter || "all"],
    queryFn: () => fetchInvoices(clientFilter || undefined),
  });
  const sendMut = useMutation({
    mutationFn: (id: string) => sendInvoice(id),
    onSuccess: () =>
      void queryClient.invalidateQueries({ queryKey: ["invoices"] }),
  });

  // PDF / JPEG export: render the billing document off-screen, capture it with
  // html2canvas (lazy chunk), download; jsPDF wraps the capture for PDF.
  const [exporting, setExporting] = useState<{ inv: Invoice; format: "pdf" | "jpeg" } | null>(
    null,
  );
  const [exportError, setExportError] = useState<string | null>(null);
  const exportRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!exporting) return;
    let cancelled = false;
    const run = async () => {
      await new Promise((r) => setTimeout(r, 60)); // let the off-screen doc paint
      const node = exportRef.current;
      if (!node || cancelled) return;
      const html2canvas = (await import("html2canvas")).default;
      const canvas = await html2canvas(node, { scale: 2, backgroundColor: "#ffffff" });
      if (cancelled) return;
      const image = canvas.toDataURL("image/jpeg", 0.95);
      if (exporting.format === "jpeg") {
        const a = document.createElement("a");
        a.href = image;
        a.download = `${exporting.inv.number}.jpg`;
        a.click();
      } else {
        const { jsPDF } = await import("jspdf");
        const pdf = new jsPDF({ orientation: "portrait", unit: "pt", format: "a4" });
        const pageW = pdf.internal.pageSize.getWidth();
        const pageH = pdf.internal.pageSize.getHeight();
        const h = (canvas.height * pageW) / canvas.width;
        pdf.addImage(image, "JPEG", 0, 0, pageW, Math.min(h, pageH));
        pdf.save(`${exporting.inv.number}.pdf`);
      }
    };
    setExportError(null);
    run()
      .catch(() => setExportError("Could not export this billing — please retry."))
      .finally(() => {
        if (!cancelled) setExporting(null);
      });
    return () => {
      cancelled = true;
    };
  }, [exporting]);

  const header = (
    <PageHeader
      title="Billing"
      eyebrow="Firm admin"
      actions={
        canCreate ? (
          <Button size="sm" onClick={onNew}>
            + New billing
          </Button>
        ) : undefined
      }
    />
  );

  const filterBar = (
    <div className="mb-4 flex items-center gap-3">
      <label
        htmlFor="invoice-client-filter"
        className="text-[13px] font-semibold text-content"
      >
        Client
      </label>
      <select
        id="invoice-client-filter"
        value={clientFilter}
        onChange={(e) => setClientFilter(e.target.value)}
        className="input w-auto min-w-[240px]"
      >
        <option value="">All clients</option>
        {(clientsQ.data ?? []).map((c) => (
          <option key={c.id} value={c.id}>
            {c.businessName}
          </option>
        ))}
      </select>
    </div>
  );

  let body: ReactNode;
  if (invoicesQ.isPending) {
    body = (
      <Card className="p-6">
        <div className="space-y-3.5">
          <Skeleton className="h-5 w-48" />
          <Skeleton />
          <Skeleton className="w-5/6" />
          <Skeleton className="w-2/3" />
        </div>
      </Card>
    );
  } else if (invoicesQ.isError) {
    body = (
      <Card>
        <ErrorState
          message="Could not load billings."
          onRetry={() => void invoicesQ.refetch()}
        />
      </Card>
    );
  } else if (invoicesQ.data.length === 0) {
    body = (
      <Card>
        <EmptyState
          title="No billings yet"
          description={
            clientFilter
              ? "No billings for this client yet."
              : "Create the first billing to start invoicing your clients."
          }
        >
          {canCreate ? <Button onClick={onNew}>+ New billing</Button> : null}
        </EmptyState>
      </Card>
    );
  } else {
    body = (
      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-line-divider bg-sidebar font-mono text-[10px] uppercase tracking-[.14em] text-content-secondary">
                <th className="px-4 py-2.5 font-semibold">Billing No.</th>
                <th className="px-4 py-2.5 font-semibold">Client</th>
                <th className="px-4 py-2.5 font-semibold">Description</th>
                <th className="px-4 py-2.5 font-semibold">Issued</th>
                <th className="px-4 py-2.5 font-semibold">Due</th>
                <th className="px-4 py-2.5 text-right font-semibold">Amount</th>
                <th className="px-4 py-2.5 font-semibold">Status</th>
                <th className="px-4 py-2.5 text-right font-semibold">&nbsp;</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line-divider">
              {invoicesQ.data.map((inv) => (
                <tr
                  key={inv.id}
                  className="text-[13px] transition-colors hover:bg-rowhover"
                >
                  <td className="px-4 py-3 font-mono font-semibold text-navy">
                    {inv.number}
                  </td>
                  <td className="px-4 py-3">
                    <span className="block font-semibold text-content">
                      {inv.clientName || "—"}
                    </span>
                    {inv.billedForName ? (
                      // Provenance: this invoice is billed on behalf of a sub-client.
                      <span className="mt-0.5 block font-mono text-[10px] uppercase tracking-[.08em] text-content-secondary">
                        For: {inv.billedForName}
                      </span>
                    ) : null}
                  </td>
                  <td className="px-4 py-3 text-content">{inv.description}</td>
                  <td className="px-4 py-3 font-mono text-[12px] text-content-secondary">
                    {inv.issuedDate}
                  </td>
                  <td className="px-4 py-3 font-mono text-[12px] text-content-secondary">
                    {inv.dueDate}
                  </td>
                  <td className="px-4 py-3 text-right font-mono tabular-nums text-content">
                    {peso(inv.total)}
                  </td>
                  <td className="px-4 py-3">
                    <Chip variant={statusVariant(inv.status)}>{inv.status}</Chip>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1.5">
                      {canSend && isSendable(inv.status) ? (
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={sendMut.isPending}
                          onClick={() => sendMut.mutate(inv.id)}
                          aria-label={`Send billing ${inv.number}`}
                        >
                          Send
                        </Button>
                      ) : null}
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={exporting != null}
                        onClick={() => setExporting({ inv, format: "pdf" })}
                        aria-label={`Download PDF for billing ${inv.number}`}
                      >
                        {exporting?.inv.id === inv.id && exporting.format === "pdf"
                          ? "…"
                          : "PDF"}
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={exporting != null}
                        onClick={() => setExporting({ inv, format: "jpeg" })}
                        aria-label={`Download JPEG for billing ${inv.number}`}
                      >
                        {exporting?.inv.id === inv.id && exporting.format === "jpeg"
                          ? "…"
                          : "JPEG"}
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    );
  }

  return (
    <>
      {header}
      {filterBar}
      {exportError ? (
        <div className="mb-4 rounded-card border border-danger/30 bg-danger-bg px-4 py-3 text-[12.5px] text-danger-ink">
          {exportError}
        </div>
      ) : null}
      {body}
      {/* Off-screen render target for the PDF/JPEG capture. */}
      {exporting ? (
        <div aria-hidden style={{ position: "fixed", top: 0, left: -2000, zIndex: -1 }}>
          <div ref={exportRef}>
            <BillingDocument invoice={exporting.inv} />
          </div>
        </div>
      ) : null}
    </>
  );
}

/* ------------------------------------------------------------------------- *
 * Create view
 * ------------------------------------------------------------------------- */

function InvoiceCreate({
  billTo,
  onBillTo,
  issuedDate,
  onIssuedDate,
  terms,
  onTerms,
  dueDate,
  onDueDate,
  description,
  onDescription,
  lineItems,
  onLineItems,
  subtotal,
  vat,
  total,
  saving,
  onCancel,
  onSaveDraft,
  onPreview,
}: {
  billTo: ClientSummary | null;
  onBillTo: (c: ClientSummary) => void;
  issuedDate: string;
  onIssuedDate: (v: string) => void;
  terms: TermsValue;
  onTerms: (t: TermsValue) => void;
  dueDate: string;
  onDueDate: (v: string) => void;
  description: string;
  onDescription: (v: string) => void;
  lineItems: DraftLine[];
  onLineItems: Dispatch<SetStateAction<DraftLine[]>>;
  subtotal: number;
  vat: number;
  total: number;
  saving: boolean;
  onCancel: () => void;
  onSaveDraft: () => void;
  onPreview: () => void;
}) {
  function updateLine(index: number, patch: Partial<DraftLine>): void {
    onLineItems((prev) =>
      prev.map((li, i) => (i === index ? { ...li, ...patch } : li)),
    );
  }

  // Sub-client link: when the selected Bill-to is billed under a main client,
  // resolve the parent's name for the note below (list is cached from the combobox).
  const clientsQ = useQuery({ queryKey: ["clients"], queryFn: fetchClients });
  const billingParent = billTo?.billingParentId
    ? (clientsQ.data ?? []).find((c) => c.id === billTo.billingParentId) ?? null
    : null;

  return (
    <>
      <PageHeader title="New billing" eyebrow="Firm billing" />

      <Card className="p-6">
        {/* Bill to */}
        <div className="mb-6 max-w-xl">
          <label className="mb-1.5 block text-[13px] font-semibold text-content">
            Bill to
          </label>
          <BillToCombobox value={billTo} onSelect={onBillTo} />
          {billTo?.billingParentId ? (
            <p className="mt-2 rounded-btn border border-warn/40 bg-warn-bg-2 px-3 py-2 text-[12.5px] text-content">
              <span className="font-semibold">Sub-client:</span> this billing will be
              recorded under — and addressed to —{" "}
              <span className="font-semibold">
                {billingParent?.businessName ?? "the main client"}
              </span>
              , tagged{" "}
              <span className="font-mono text-[11px] uppercase">
                For: {billTo.businessName}
              </span>
              .
            </p>
          ) : null}
        </div>

        {/* Dates + terms */}
        <div className="mb-6 grid max-w-2xl grid-cols-1 gap-4 sm:grid-cols-3">
          <div>
            <label
              htmlFor="invoice-date"
              className="mb-1.5 block text-[13px] font-semibold text-content"
            >
              Billing date
            </label>
            <input
              id="invoice-date"
              type="date"
              className="input w-full"
              value={issuedDate}
              onChange={(e) => onIssuedDate(e.target.value)}
            />
          </div>
          <div>
            <label
              htmlFor="invoice-terms"
              className="mb-1.5 block text-[13px] font-semibold text-content"
            >
              Terms
            </label>
            <select
              id="invoice-terms"
              className="input w-full"
              value={terms}
              onChange={(e) => onTerms(e.target.value as TermsValue)}
            >
              {TERMS_OPTIONS.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label
              htmlFor="due-date"
              className="mb-1.5 block text-[13px] font-semibold text-content"
            >
              Due date
            </label>
            <input
              id="due-date"
              type="date"
              className="input w-full"
              value={dueDate}
              onChange={(e) => onDueDate(e.target.value)}
            />
            <p className="mt-1 text-[11.5px] text-content-secondary">
              {terms === "custom"
                ? "Set by hand — pick a term to recompute."
                : "Computed from the invoice date."}
            </p>
          </div>
        </div>

        {/* Description */}
        <div className="mb-8 max-w-xl">
          <label
            htmlFor="invoice-description"
            className="mb-1.5 block text-[13px] font-semibold text-content"
          >
            Description
          </label>
          <input
            id="invoice-description"
            type="text"
            className="input w-full"
            value={description}
            onChange={(e) => onDescription(e.target.value)}
            placeholder="e.g. Q2 2026 engagement fees"
          />
        </div>

        {/* Line items */}
        <div className="eyebrow mb-2">Line items</div>
        <div className="overflow-hidden rounded-card border border-line">
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="border-b border-line bg-sidebar font-mono text-[10px] uppercase tracking-[.14em] text-content-secondary">
                <th className="px-4 py-2.5 font-semibold">Description</th>
                <th className="w-24 px-4 py-2.5 text-right font-semibold">Qty</th>
                <th className="w-36 px-4 py-2.5 text-right font-semibold">Rate</th>
                <th className="w-40 px-4 py-2.5 text-right font-semibold">
                  Amount
                </th>
                <th className="w-12 px-4 py-2.5" />
              </tr>
            </thead>
            <tbody className="divide-y divide-line-divider">
              {lineItems.map((li, i) => (
                <tr key={i}>
                  <td className="px-3 py-2">
                    <input
                      type="text"
                      className="input w-full"
                      value={li.description}
                      onChange={(e) =>
                        updateLine(i, { description: e.target.value })
                      }
                      placeholder="Service or item…"
                      aria-label={`Line ${i + 1} description`}
                    />
                  </td>
                  <td className="px-3 py-2">
                    <input
                      type="number"
                      min={0}
                      className="input w-full text-right font-mono tabular-nums"
                      value={li.qty}
                      onChange={(e) =>
                        updateLine(i, { qty: num(e.target.value) })
                      }
                      aria-label={`Line ${i + 1} quantity`}
                    />
                  </td>
                  <td className="px-3 py-2">
                    <input
                      type="number"
                      min={0}
                      className="input w-full text-right font-mono tabular-nums"
                      value={li.rate}
                      onChange={(e) =>
                        updateLine(i, { rate: num(e.target.value) })
                      }
                      aria-label={`Line ${i + 1} rate`}
                    />
                  </td>
                  <td className="px-4 py-2 text-right font-mono tabular-nums text-content">
                    {peso(li.qty * li.rate)}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="px-2"
                      disabled={lineItems.length === 1}
                      onClick={() =>
                        onLineItems((prev) => prev.filter((_, j) => j !== i))
                      }
                      aria-label={`Remove line ${i + 1}`}
                    >
                      ✕
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-3">
          <Button
            variant="outline"
            size="sm"
            onClick={() => onLineItems((prev) => [...prev, emptyLine()])}
          >
            + Add line
          </Button>
        </div>

        {/* Totals */}
        <div className="mt-6 flex justify-end">
          <dl className="w-full max-w-xs space-y-2">
            <div className="flex items-center justify-between">
              <dt className="text-[13px] text-content-secondary">Subtotal</dt>
              <dd className="font-mono tabular-nums text-content">
                {peso(subtotal)}
              </dd>
            </div>
            <div className="flex items-center justify-between">
              <dt className="text-[13px] text-content-secondary">VAT 12%</dt>
              <dd className="font-mono tabular-nums text-content">{peso(vat)}</dd>
            </div>
            <div className="flex items-center justify-between border-t border-line-strong pt-2">
              <dt className="text-[13px] font-semibold text-navy">Total due</dt>
              <dd className="font-mono text-[15px] font-semibold tabular-nums text-navy">
                {peso(total)}
              </dd>
            </div>
          </dl>
        </div>
      </Card>

      {/* Footer actions */}
      <div className="mt-5 flex items-center justify-end gap-2">
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          variant="outline"
          disabled={!billTo || saving}
          onClick={onSaveDraft}
        >
          {saving ? "Saving…" : "Save draft"}
        </Button>
        <Button disabled={!billTo} onClick={onPreview}>
          Preview &amp; send &rarr;
        </Button>
      </div>
    </>
  );
}

/* ------------------------------------------------------------------------- *
 * Email preview view
 * ------------------------------------------------------------------------- */

function EmailPreview({
  billTo,
  total,
  sending,
  onBack,
  onSend,
}: {
  billTo: ClientSummary | null;
  total: number;
  sending: boolean;
  onBack: () => void;
  onSend: () => void;
}) {
  const toName = billTo?.businessName ?? "—";
  const subject = `Billing from MCRC — ${billTo?.businessName ?? ""}`;

  return (
    <>
      <PageHeader title="Email preview" eyebrow="Firm billing" />

      <Card className="overflow-hidden">
        {/* Envelope header rows */}
        <dl className="divide-y divide-line-divider border-b border-line">
          <div className="flex gap-3 px-6 py-3 text-[13px]">
            <dt className="w-20 shrink-0 font-mono text-[11px] uppercase tracking-[.12em] text-content-tertiary">
              From
            </dt>
            <dd className="text-content">
              MCRC Billing &lt;billing@mcrc.ph&gt;
            </dd>
          </div>
          <div className="flex gap-3 px-6 py-3 text-[13px]">
            <dt className="w-20 shrink-0 font-mono text-[11px] uppercase tracking-[.12em] text-content-tertiary">
              To
            </dt>
            <dd className="text-content">{toName}</dd>
          </div>
          <div className="flex gap-3 px-6 py-3 text-[13px]">
            <dt className="w-20 shrink-0 font-mono text-[11px] uppercase tracking-[.12em] text-content-tertiary">
              Subject
            </dt>
            <dd className="font-medium text-content">{subject}</dd>
          </div>
        </dl>

        {/* Rendered branded email */}
        <div className="bg-paper p-8">
          <div className="mx-auto max-w-lg overflow-hidden rounded-card border border-line-strong bg-card">
            {/* Navy header band */}
            <div className="flex items-center gap-3 bg-navy px-6 py-5">
              <McrcMark variant="navy" size={34} />
              <div className="leading-tight">
                <div className="font-serif text-[17px] font-medium text-white">
                  MCRC Tax &amp; Accounting
                </div>
                <div className="font-mono text-[10px] uppercase tracking-[.16em] text-gold-soft">
                  Accounting &amp; Advisory
                </div>
              </div>
            </div>

            {/* Body */}
            <div className="px-8 py-7">
              <p className="text-[14px] text-content">
                {billTo ? `Hi ${billTo.businessName},` : "Hi,"}
              </p>
              <p className="mt-2 text-[13.5px] text-content-secondary">
                Your latest billing statement from MCRC is ready. A summary is below — the
                full breakdown is attached as a PDF.
              </p>

              {/* Amount due panel */}
              <div className="my-6 rounded-card border border-line-strong bg-sidebar px-6 py-5 text-center">
                <div className="eyebrow">Amount due</div>
                <div className="mt-1 font-serif text-[34px] font-medium text-navy">
                  {peso(total)}
                </div>
              </div>

              {/* CTA */}
              <div className="text-center">
                <span className="inline-flex items-center justify-center rounded-btn bg-navy px-6 py-3 text-[13.5px] font-semibold text-white">
                  View &amp; pay billing
                </span>
              </div>

              {/* Engagement-lead footer */}
              <p className="mt-7 border-t border-line-divider pt-4 text-center text-[12px] text-content-tertiary">
                Prepared by your MCRC engagement team
              </p>
            </div>
          </div>
        </div>
      </Card>

      {/* Footer actions */}
      <div className="mt-5 flex items-center justify-end gap-2">
        <Button variant="outline" onClick={onBack}>
          &larr; Back to edit
        </Button>
        <Button disabled={sending} onClick={onSend}>
          {sending ? "Sending…" : "Send email"}
        </Button>
      </div>
    </>
  );
}

/* ------------------------------------------------------------------------- *
 * Screen
 * ------------------------------------------------------------------------- */

export default function BillingPage() {
  const { hasPermission } = useAuth();
  const queryClient = useQueryClient();

  const [view, setView] = useState<View>("list");
  const [billTo, setBillTo] = useState<ClientSummary | null>(null);
  const [issuedDate, setIssuedDate] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [terms, setTerms] = useState<TermsValue>(DEFAULT_TERMS);
  const [description, setDescription] = useState("");
  const [lineItems, setLineItems] = useState<DraftLine[]>([emptyLine()]);
  // Once a draft has been created in this session, "Send email" reuses its id
  // instead of creating a duplicate.
  const [createdId, setCreatedId] = useState<string | null>(null);

  const canCreate = hasPermission("Billing:Create");
  const canSend = hasPermission("Billing:Send");

  const subtotal = useMemo(
    () => lineItems.reduce((sum, li) => sum + li.qty * li.rate, 0),
    [lineItems],
  );
  const vat = subtotal * VAT_RATE;
  const total = subtotal + vat;

  const invalidateInvoices = () =>
    void queryClient.invalidateQueries({ queryKey: ["invoices"] });

  const buildInput = (status?: string): InvoiceInput => ({
    // The mutations are only reachable once a Bill-to client is selected
    // (Save/Preview are disabled without one).
    clientId: billTo?.id ?? "",
    description: description.trim() || undefined,
    issuedDate,
    dueDate,
    lineItems: lineItems.map((li) => ({
      description: li.description,
      qty: li.qty,
      rate: li.rate,
    })),
    ...(status ? { status } : {}),
  });

  const saveDraftMut = useMutation({
    mutationFn: () => createInvoice(buildInput("Draft")),
    onSuccess: () => {
      invalidateInvoices();
      setView("list");
    },
  });

  const sendMut = useMutation({
    mutationFn: async () => {
      let id = createdId;
      if (!id) {
        const created = await createInvoice(buildInput());
        id = created.id;
        setCreatedId(created.id);
      }
      return sendInvoice(id);
    },
    onSuccess: () => {
      invalidateInvoices();
      setView("list");
    },
  });

  function goCreate(): void {
    setBillTo(null);
    const today = todayISO();
    setIssuedDate(today);
    setTerms(DEFAULT_TERMS);
    setDueDate(addDaysISO(today, Number(DEFAULT_TERMS)));
    setDescription("");
    setLineItems([emptyLine()]);
    setCreatedId(null);
    setView("create");
  }

  // Terms drive the due date: picking a term (or moving the invoice date under
  // one) recomputes it; editing the due date by hand switches terms to Custom.
  function handleIssuedDate(v: string): void {
    setIssuedDate(v);
    if (terms !== "custom" && v) setDueDate(addDaysISO(v, Number(terms)));
  }
  function handleTerms(t: TermsValue): void {
    setTerms(t);
    if (t !== "custom" && issuedDate) setDueDate(addDaysISO(issuedDate, Number(t)));
  }
  function handleDueDate(v: string): void {
    setDueDate(v);
    setTerms("custom");
  }

  return (
    <div className="animate-fade-rise">
      {view === "list" ? (
        <InvoiceList canCreate={canCreate} canSend={canSend} onNew={goCreate} />
      ) : null}

      {view === "create" ? (
        <InvoiceCreate
          billTo={billTo}
          onBillTo={setBillTo}
          issuedDate={issuedDate}
          onIssuedDate={handleIssuedDate}
          terms={terms}
          onTerms={handleTerms}
          dueDate={dueDate}
          onDueDate={handleDueDate}
          description={description}
          onDescription={setDescription}
          lineItems={lineItems}
          onLineItems={setLineItems}
          subtotal={subtotal}
          vat={vat}
          total={total}
          saving={saveDraftMut.isPending}
          onCancel={() => setView("list")}
          onSaveDraft={() => {
            if (billTo) saveDraftMut.mutate();
          }}
          onPreview={() => setView("preview")}
        />
      ) : null}

      {view === "preview" ? (
        <EmailPreview
          billTo={billTo}
          total={total}
          sending={sendMut.isPending}
          onBack={() => setView("create")}
          onSend={() => sendMut.mutate()}
        />
      ) : null}
    </div>
  );
}
