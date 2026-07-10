/**
 * Screen 15 — Billing & Invoices.
 *
 * Three local views, no routing:
 *  - "list"    — the invoices DataTable (4 states) + "New invoice".
 *  - "create"  — invoice form: a type-to-search "Bill to" combobox, dates, an
 *                editable LINE ITEMS grid, and a live totals block.
 *  - "preview" — a rendered branded email mock (From/To/Subject + navy header,
 *                AMOUNT DUE panel, CTA, engagement-lead footer).
 *
 * Money is always rendered via `peso`, mono + right-aligned. Nothing here is
 * persisted — "Save draft" / "Send email" simply return to the list.
 */
import * as React from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, Plus, Search, Send, Trash2, X } from "lucide-react";

import {
  Button,
  Card,
  DataTable,
  EmptyState,
  ErrorState,
  Input,
  Label,
  PageHeader,
  Popover,
  PopoverContent,
  PopoverTrigger,
  RegimeChip,
  StatusChip,
  TableSkeleton,
  type ChipVariant,
  type ColumnDef,
} from "@/components/ui";
import { McrcMark } from "@/components/shell";
import { api, CLIENTS } from "@/mock";
import { useSession } from "@/session";
import type { Client, Invoice, InvoiceLineItem, InvoiceStatus } from "@/types";
import { initials, peso } from "@/lib/utils";

type View = "list" | "create" | "preview";

const VAT_RATE = 0.12;

/** Invoice status → chip tone. */
function statusVariant(status: InvoiceStatus): ChipVariant {
  if (status === "Paid") return "success";
  if (status === "Sent") return "info";
  if (status === "Overdue") return "danger";
  return "neutral";
}

/* ------------------------------------------------------------------------- *
 * List view
 * ------------------------------------------------------------------------- */

const listColumns: ColumnDef<Invoice>[] = [
  {
    id: "number",
    header: "Invoice",
    accessorKey: "number",
    meta: { className: "font-mono font-semibold text-navy" },
  },
  {
    id: "description",
    header: "Description",
    cell: ({ row }) => (
      <span className="text-content">{row.original.description}</span>
    ),
  },
  { id: "issued", header: "Issued", accessorKey: "issued" },
  { id: "due", header: "Due", accessorKey: "due" },
  {
    id: "amount",
    header: "Amount",
    meta: { numeric: true },
    cell: ({ row }) => peso(row.original.amount),
  },
  {
    id: "status",
    header: "Status",
    cell: ({ row }) => (
      <StatusChip
        label={row.original.status}
        variant={statusVariant(row.original.status)}
      />
    ),
  },
  {
    id: "actions",
    header: "",
    meta: { align: "right" },
    cell: ({ row }) => (
      <div className="flex items-center justify-end gap-1">
        <Button
          variant="outline"
          size="sm"
          aria-label={`Send ${row.original.number}`}
        >
          Send
        </Button>
        <Button
          variant="ghost"
          size="sm"
          aria-label={`Download PDF for ${row.original.number}`}
        >
          PDF
        </Button>
      </div>
    ),
  },
];

function InvoiceList({
  activeClientId,
  onNew,
}: {
  activeClientId: string;
  onNew: () => void;
}): React.JSX.Element {
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["invoices", activeClientId],
    queryFn: () => api.listInvoices(activeClientId),
  });

  const header = (
    <PageHeader
      title="Billing & Invoices"
      eyebrow="Firm billing"
      actions={
        <Button variant="primary" size="sm" onClick={onNew}>
          <Plus className="h-4 w-4" aria-hidden="true" />
          New invoice
        </Button>
      }
    />
  );

  let body: React.JSX.Element;
  if (isLoading) {
    body = (
      <Card className="overflow-hidden">
        <TableSkeleton rows={6} cols={7} />
      </Card>
    );
  } else if (isError) {
    body = (
      <Card>
        <ErrorState
          message="Couldn't load invoices."
          onRetry={() => void refetch()}
        />
      </Card>
    );
  } else if ((data ?? []).length === 0) {
    body = (
      <Card>
        <EmptyState
          title="No invoices yet"
          description="Create the first invoice for this client to start billing."
        >
          <Button variant="primary" size="md" onClick={onNew}>
            <Plus className="h-4 w-4" aria-hidden="true" />
            New invoice
          </Button>
        </EmptyState>
      </Card>
    );
  } else {
    body = (
      <Card className="overflow-hidden">
        <DataTable columns={listColumns} data={data ?? []} />
      </Card>
    );
  }

  return (
    <>
      {header}
      {body}
    </>
  );
}

/* ------------------------------------------------------------------------- *
 * "Bill to" type-to-search combobox
 * ------------------------------------------------------------------------- */

function BillToCombobox({
  value,
  onSelect,
}: {
  value: Client | null;
  onSelect: (client: Client) => void;
}): React.JSX.Element {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");

  const matches = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return CLIENTS;
    return CLIENTS.filter(
      (c) =>
        c.name.toLowerCase().includes(q) || c.tin.toLowerCase().includes(q),
    );
  }, [query]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="Bill to — search clients by name or TIN"
          className="flex w-full items-center gap-2 rounded-input border border-line-input bg-card px-[13px] py-[10px] text-left text-sm text-content transition-colors hover:border-navy focus-visible:border-blue focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-blue/[0.14]"
        >
          <Search
            className="h-4 w-4 shrink-0 text-content-tertiary"
            aria-hidden="true"
          />
          {value ? (
            <span className="flex min-w-0 items-center gap-2">
              <span className="truncate font-semibold text-content">
                {value.name}
              </span>
              <span className="truncate font-mono text-[12px] text-content-secondary">
                {value.tin}
              </span>
            </span>
          ) : (
            <span className="text-content-placeholder">
              Search a client by name or TIN…
            </span>
          )}
          <ChevronDown
            className="ml-auto h-4 w-4 shrink-0 text-content-tertiary"
            aria-hidden="true"
          />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-[var(--radix-popover-trigger-width)] p-0"
      >
        <div className="border-b border-line p-2">
          <Input
            autoFocus
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Type to filter clients…"
            aria-label="Filter clients"
          />
        </div>
        <ul className="max-h-64 overflow-y-auto p-1" role="listbox">
          {matches.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                role="option"
                aria-selected={value?.id === c.id}
                onClick={() => {
                  onSelect(c);
                  setOpen(false);
                }}
                className="flex w-full items-center gap-3 rounded-btn px-2.5 py-2 text-left transition-colors hover:bg-rowhover"
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-btn bg-navy font-mono text-[11px] font-bold text-gold-soft">
                  {initials(c.name)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold text-content">
                    {c.name}
                  </span>
                  <span className="block truncate font-mono text-[12px] text-content-secondary">
                    {c.tin}
                  </span>
                </span>
                <RegimeChip regime={c.regime} />
              </button>
            </li>
          ))}
          {matches.length === 0 ? (
            <li className="px-2.5 py-3">
              <Link
                to="/clients/new"
                className="flex items-center gap-2 text-[13px] text-blue hover:text-navy-hover hover:underline"
              >
                <Plus className="h-4 w-4" aria-hidden="true" />
                No match — add a new client
              </Link>
            </li>
          ) : null}
        </ul>
      </PopoverContent>
    </Popover>
  );
}

/* ------------------------------------------------------------------------- *
 * Create view
 * ------------------------------------------------------------------------- */

function emptyLine(): InvoiceLineItem {
  return { description: "", qty: 1, rate: 0, amount: 0 };
}

function InvoiceCreate({
  billTo,
  onBillTo,
  lineItems,
  onLineItems,
  invoiceDate,
  onInvoiceDate,
  dueDate,
  onDueDate,
  subtotal,
  vat,
  total,
  onCancel,
  onSaveDraft,
  onPreview,
}: {
  billTo: Client | null;
  onBillTo: (c: Client) => void;
  lineItems: InvoiceLineItem[];
  onLineItems: React.Dispatch<React.SetStateAction<InvoiceLineItem[]>>;
  invoiceDate: string;
  onInvoiceDate: (v: string) => void;
  dueDate: string;
  onDueDate: (v: string) => void;
  subtotal: number;
  vat: number;
  total: number;
  onCancel: () => void;
  onSaveDraft: () => void;
  onPreview: () => void;
}): React.JSX.Element {
  function updateLine(
    index: number,
    patch: Partial<Pick<InvoiceLineItem, "description" | "qty" | "rate">>,
  ): void {
    onLineItems((prev) =>
      prev.map((li, i) => {
        if (i !== index) return li;
        const next: InvoiceLineItem = { ...li, ...patch };
        next.amount = next.qty * next.rate;
        return next;
      }),
    );
  }

  return (
    <>
      <PageHeader title="New invoice" eyebrow="Firm billing" />
      <Card className="p-6">
        {/* Bill to */}
        <div className="mb-6 max-w-xl">
          <Label htmlFor="bill-to" className="mb-1.5 block">
            Bill to
          </Label>
          <div id="bill-to">
            <BillToCombobox value={billTo} onSelect={onBillTo} />
          </div>
        </div>

        {/* Dates */}
        <div className="mb-8 grid max-w-xl grid-cols-2 gap-4">
          <div>
            <Label htmlFor="invoice-date" className="mb-1.5 block">
              Invoice date
            </Label>
            <Input
              id="invoice-date"
              type="date"
              value={invoiceDate}
              onChange={(e) => onInvoiceDate(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="due-date" className="mb-1.5 block">
              Due date
            </Label>
            <Input
              id="due-date"
              type="date"
              value={dueDate}
              onChange={(e) => onDueDate(e.target.value)}
            />
          </div>
        </div>

        {/* Line items */}
        <div className="eyebrow mb-2">Line items</div>
        <div className="overflow-hidden rounded-card border border-line">
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="border-b border-line bg-sidebar">
                <th className="px-4 py-2.5 font-mono text-[10px] font-normal uppercase tracking-[.14em] text-content-secondary">
                  Description
                </th>
                <th className="w-24 px-4 py-2.5 text-right font-mono text-[10px] font-normal uppercase tracking-[.14em] text-content-secondary">
                  Qty
                </th>
                <th className="w-36 px-4 py-2.5 text-right font-mono text-[10px] font-normal uppercase tracking-[.14em] text-content-secondary">
                  Rate
                </th>
                <th className="w-40 px-4 py-2.5 text-right font-mono text-[10px] font-normal uppercase tracking-[.14em] text-content-secondary">
                  Amount
                </th>
                <th className="w-12 px-4 py-2.5" />
              </tr>
            </thead>
            <tbody className="divide-y divide-line-divider">
              {lineItems.map((li, i) => (
                <tr key={i}>
                  <td className="px-3 py-2">
                    <Input
                      value={li.description}
                      onChange={(e) =>
                        updateLine(i, { description: e.target.value })
                      }
                      placeholder="Service or item…"
                      aria-label={`Line ${i + 1} description`}
                    />
                  </td>
                  <td className="px-3 py-2">
                    <Input
                      type="number"
                      min={0}
                      value={li.qty}
                      onChange={(e) =>
                        updateLine(i, { qty: Number(e.target.value) })
                      }
                      className="text-right font-mono tabular-nums"
                      aria-label={`Line ${i + 1} quantity`}
                    />
                  </td>
                  <td className="px-3 py-2">
                    <Input
                      type="number"
                      min={0}
                      value={li.rate}
                      onChange={(e) =>
                        updateLine(i, { rate: Number(e.target.value) })
                      }
                      className="text-right font-mono tabular-nums"
                      aria-label={`Line ${i + 1} rate`}
                    />
                  </td>
                  <td className="px-4 py-2 text-right font-mono tabular-nums text-content">
                    {peso(li.amount)}
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
                      <Trash2 className="h-4 w-4" aria-hidden="true" />
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
            <Plus className="h-4 w-4" aria-hidden="true" />
            Add line
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
              <dd className="font-mono tabular-nums text-content">
                {peso(vat)}
              </dd>
            </div>
            <div className="flex items-center justify-between border-t border-line-strong pt-2">
              <dt className="text-[13px] font-semibold text-navy">Total due</dt>
              <dd className="font-mono tabular-nums text-[15px] font-semibold text-navy">
                {peso(total)}
              </dd>
            </div>
          </dl>
        </div>
      </Card>

      {/* Footer actions */}
      <div className="mt-5 flex items-center justify-end gap-2">
        <Button variant="ghost" size="md" onClick={onCancel}>
          Cancel
        </Button>
        <Button variant="outline" size="md" onClick={onSaveDraft}>
          Save draft
        </Button>
        <Button
          variant="primary"
          size="md"
          disabled={!billTo}
          onClick={onPreview}
        >
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
  onBack,
  onSend,
}: {
  billTo: Client | null;
  total: number;
  onBack: () => void;
  onSend: () => void;
}): React.JSX.Element {
  const toEmail = billTo?.email ?? "billing-contact@client.ph";
  const subject = `Invoice from MCRC${billTo ? ` — ${billTo.name}` : ""}`;

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
            <dd className="text-content">{toEmail}</dd>
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
                  MCRC
                </div>
                <div className="font-mono text-[10px] uppercase tracking-[.16em] text-gold-soft">
                  Accounting &amp; Advisory
                </div>
              </div>
            </div>

            {/* Body */}
            <div className="px-8 py-7">
              <p className="text-[14px] text-content">
                {billTo ? `Hi ${billTo.name},` : "Hi,"}
              </p>
              <p className="mt-2 text-[13.5px] text-content-secondary">
                Your latest invoice from MCRC is ready. A summary is below — the
                full breakdown is attached as a PDF.
              </p>

              {/* Amount due panel */}
              <div className="my-6 rounded-card border border-line-strong bg-sidebar px-6 py-5 text-center">
                <div className="eyebrow">Amount due</div>
                <div className="mt-1 font-mono tabular-nums text-[34px] font-medium text-navy">
                  {peso(total)}
                </div>
              </div>

              {/* CTA */}
              <div className="text-center">
                <span className="inline-flex items-center justify-center rounded-btn bg-navy px-6 py-3 text-[13.5px] font-semibold text-white">
                  View &amp; pay invoice
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
        <Button variant="outline" size="md" onClick={onBack}>
          <X className="h-4 w-4" aria-hidden="true" />
          Back to edit
        </Button>
        <Button variant="primary" size="md" onClick={onSend}>
          <Send className="h-4 w-4" aria-hidden="true" />
          Send email
        </Button>
      </div>
    </>
  );
}

/* ------------------------------------------------------------------------- *
 * Screen
 * ------------------------------------------------------------------------- */

export function BillingScreen(): React.JSX.Element {
  const { activeClientId, activeClient } = useSession();
  const [view, setView] = React.useState<View>("list");

  const [billTo, setBillTo] = React.useState<Client | null>(
    activeClient ?? null,
  );
  const [invoiceDate, setInvoiceDate] = React.useState("");
  const [dueDate, setDueDate] = React.useState("");
  const [lineItems, setLineItems] = React.useState<InvoiceLineItem[]>([
    emptyLine(),
  ]);

  const subtotal = React.useMemo(
    () => lineItems.reduce((sum, li) => sum + li.amount, 0),
    [lineItems],
  );
  const vat = subtotal * VAT_RATE;
  const total = subtotal + vat;

  function startCreate(): void {
    setBillTo(activeClient ?? null);
    setInvoiceDate("");
    setDueDate("");
    setLineItems([emptyLine()]);
    setView("create");
  }

  if (view === "create") {
    return (
      <InvoiceCreate
        billTo={billTo}
        onBillTo={setBillTo}
        lineItems={lineItems}
        onLineItems={setLineItems}
        invoiceDate={invoiceDate}
        onInvoiceDate={setInvoiceDate}
        dueDate={dueDate}
        onDueDate={setDueDate}
        subtotal={subtotal}
        vat={vat}
        total={total}
        onCancel={() => setView("list")}
        onSaveDraft={() => setView("list")}
        onPreview={() => setView("preview")}
      />
    );
  }

  if (view === "preview") {
    return (
      <EmailPreview
        billTo={billTo}
        total={total}
        onBack={() => setView("create")}
        onSend={() => setView("list")}
      />
    );
  }

  return <InvoiceList activeClientId={activeClientId} onNew={startCreate} />;
}
