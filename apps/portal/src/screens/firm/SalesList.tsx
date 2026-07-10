/**
 * Screen 9 — Sales / Income list (firm client workspace).
 *
 * Regime drives the classification column and the amount column header:
 *  - VAT clients: a per-row VAT-class chip + "NET AMOUNT (VAT)" (net of VAT);
 *  - PERCENTAGE clients: every row shows a NON-VAT gold chip + "GROSS RECEIPTS".
 * Four states (loading / error / empty / default). Money is always `peso`, mono,
 * right-aligned. The Portal only records amounts — no authoritative tax here.
 */
import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { Download, Plus, Upload } from "lucide-react";

import {
  Button,
  Chip,
  DataTable,
  EmptyState,
  ErrorState,
  Input,
  PageHeader,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  TableSkeleton,
} from "@/components/ui";
import type { ChipVariant, ColumnDef } from "@/components/ui";
import { AddRecordModal, ImportWizard } from "@/components/transactions";
import { api } from "@/mock";
import { useSession } from "@/session";
import { peso } from "@/lib/utils";
import type { IncomeTxn, VatClass } from "@/types";

/** VAT-class → chip tone + short label (labels only; enum values imported). */
const VAT_CLASS_CHIP: Record<VatClass, { variant: ChipVariant; label: string }> = {
  VATABLE_12: { variant: "vat", label: "VATABLE 12%" },
  ZERO_RATED: { variant: "info", label: "ZERO-RATED" },
  EXEMPT: { variant: "neutral", label: "EXEMPT" },
  NON_VAT: { variant: "gold", label: "NON-VAT" },
};

const PERIOD_OPTIONS = ["2026-Q2", "2026-Q1"] as const;

type VatFilter = "ALL" | VatClass;

export function SalesListScreen(): React.JSX.Element {
  const { activeClientId, activeClient, regime } = useSession();

  const [period, setPeriod] = React.useState<string>("2026-Q2");
  const [vatFilter, setVatFilter] = React.useState<VatFilter>("ALL");
  const [search, setSearch] = React.useState("");
  const [addOpen, setAddOpen] = React.useState(false);
  const [importOpen, setImportOpen] = React.useState(false);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["income", activeClientId, period],
    queryFn: () => api.listIncome(activeClientId, period),
    enabled: Boolean(activeClient),
  });

  // Guard: hold a skeleton until the active client (and thus regime) resolves.
  if (!activeClient) {
    return (
      <>
        <Skeleton className="mb-6 h-9 w-64" />
        <TableSkeleton rows={8} cols={6} />
      </>
    );
  }

  const isVat = regime === "VAT";
  const regimeNote = isVat ? "VAT REGIME · 2550Q QUARTERLY" : "PERCENTAGE TAX · 2551Q QUARTERLY";

  const allRows = data ?? [];
  const query = search.trim().toLowerCase();
  const rows = allRows.filter((r) => {
    if (isVat && vatFilter !== "ALL" && r.vatClass !== vatFilter) return false;
    if (query === "") return true;
    return [r.reference, r.customer, r.category].some((f) =>
      f.toLowerCase().includes(query),
    );
  });
  const total = rows.reduce((sum, r) => sum + r.netAmount, 0);

  const columns: ColumnDef<IncomeTxn>[] = [
    { accessorKey: "date", header: "DATE" },
    {
      accessorKey: "reference",
      header: "REF",
      cell: ({ row }) => (
        <span className="font-mono text-blue">{row.original.reference}</span>
      ),
    },
    { accessorKey: "customer", header: "CUSTOMER" },
    { accessorKey: "category", header: "CATEGORY" },
    {
      id: "vatClass",
      header: isVat ? "VAT CLASS" : "CLASS",
      cell: ({ row }) => {
        const chip = isVat ? VAT_CLASS_CHIP[row.original.vatClass] : VAT_CLASS_CHIP.NON_VAT;
        return <Chip variant={chip.variant}>{chip.label}</Chip>;
      },
    },
    {
      id: "amount",
      header: isVat ? "NET AMOUNT (VAT)" : "GROSS RECEIPTS",
      meta: { numeric: true },
      cell: ({ row }) => peso(row.original.netAmount),
    },
  ];

  const header = (
    <PageHeader
      title="Sales & Income"
      description={
        <span className="flex flex-wrap items-center gap-2">
          <span>{activeClient.name}</span>
          <span aria-hidden="true" className="text-content-muted">
            ·
          </span>
          <span className="font-mono text-[11px] uppercase tracking-[.14em] text-gold-deep">
            {regimeNote}
          </span>
        </span>
      }
      actions={
        <>
          <Button variant="outline" size="sm" onClick={() => setImportOpen(true)}>
            <Upload className="h-4 w-4" aria-hidden="true" />
            Import
          </Button>
          <Button variant="outline" size="sm">
            <Download className="h-4 w-4" aria-hidden="true" />
            Export
          </Button>
          <Button variant="primary" size="sm" onClick={() => setAddOpen(true)}>
            <Plus className="h-4 w-4" aria-hidden="true" />
            Add record
          </Button>
        </>
      }
    />
  );

  return (
    <>
      {header}

      <div className="overflow-hidden rounded-card border border-line-strong bg-card">
        {/* Toolbar */}
        <div className="flex flex-wrap items-center gap-3 border-b border-line px-5 py-3.5">
          <Select value={period} onValueChange={setPeriod}>
            <SelectTrigger className="w-[140px]" aria-label="Period">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PERIOD_OPTIONS.map((p) => (
                <SelectItem key={p} value={p}>
                  {p}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {isVat ? (
            <Select value={vatFilter} onValueChange={(v) => setVatFilter(v as VatFilter)}>
              <SelectTrigger className="w-[170px]" aria-label="VAT class filter">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All VAT classes</SelectItem>
                <SelectItem value="VATABLE_12">Vatable 12%</SelectItem>
                <SelectItem value="ZERO_RATED">Zero-rated</SelectItem>
                <SelectItem value="EXEMPT">Exempt</SelectItem>
                <SelectItem value="NON_VAT">Non-VAT</SelectItem>
              </SelectContent>
            </Select>
          ) : null}

          <Input
            aria-label="Search records"
            placeholder="Search reference, customer, category…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-64"
          />

          {!isLoading && !isError ? (
            <div className="ml-auto text-right">
              <div className="eyebrow">Quarter total</div>
              <div className="font-mono text-[15px] font-semibold text-navy tabular-nums">
                {peso(total)}
              </div>
            </div>
          ) : null}
        </div>

        {/* Body: 4 states */}
        {isLoading ? (
          <TableSkeleton rows={8} cols={6} />
        ) : isError ? (
          <ErrorState
            title="Couldn't load records"
            message="The sales records failed to load. Please try again."
            onRetry={() => void refetch()}
          />
        ) : rows.length === 0 ? (
          <EmptyState
            title="No records for this period"
            description="Add a sale or import a spreadsheet to start tracking income for this quarter."
          >
            <Button variant="primary" size="md" onClick={() => setAddOpen(true)}>
              <Plus className="h-4 w-4" aria-hidden="true" />
              Add record
            </Button>
          </EmptyState>
        ) : (
          <DataTable columns={columns} data={rows} />
        )}
      </div>

      <AddRecordModal
        open={addOpen}
        onOpenChange={setAddOpen}
        clientId={activeClientId}
        clientName={activeClient.name}
        regime={regime ?? "VAT"}
        defaultKind="income"
        period={period}
        onSaved={() => void refetch()}
      />
      <ImportWizard
        open={importOpen}
        onOpenChange={setImportOpen}
        regime={regime ?? "VAT"}
        kind="income"
        onDone={() => void refetch()}
      />
    </>
  );
}
