/**
 * Screen 10 — Expenses list (firm client workspace).
 *
 * Mirrors the Sales list. Regime drives the classification column:
 *  - VAT clients: a per-row input-VAT-category chip (null → muted "—");
 *  - PERCENTAGE clients: a "TYPE" column showing "N/A" (input VAT isn't tracked).
 * Both regimes keep a DEDUCT. flag (green ✓ / muted —) and an AMOUNT column.
 * Four states (loading / error / empty / default). Money is always `peso`, mono.
 */
import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, Download, Plus, Upload } from "lucide-react";

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
import type { ColumnDef } from "@/components/ui";
import { AddRecordModal, ImportWizard } from "@/components/transactions";
import { api } from "@/mock";
import { useSession } from "@/session";
import { peso } from "@/lib/utils";
import type { ExpenseTxn, InputVATCategory } from "@/types";

/** Input-VAT category → short chip label (labels only; enum values imported). */
const INPUT_VAT_LABEL: Record<InputVATCategory, string> = {
  DOMESTIC_PURCHASES: "DOMESTIC",
  SERVICES_NONRESIDENT: "SVC · NON-RES",
  IMPORTATION_GOODS: "IMPORT GOODS",
  OTHERS_WITH_INPUT_TAX: "OTHERS",
  DOMESTIC_NO_INPUT_TAX: "DOMESTIC · NO IN",
  VAT_EXEMPT_IMPORTATION: "EXEMPT IMPORT",
  CAPITAL_GOODS_GT_1M: "CAPITAL > ₱1M",
};

const PERIOD_OPTIONS = ["2026-Q2", "2026-Q1"] as const;

export function ExpensesListScreen(): React.JSX.Element {
  const { activeClientId, activeClient, regime } = useSession();

  const [period, setPeriod] = React.useState<string>("2026-Q2");
  const [search, setSearch] = React.useState("");
  const [addOpen, setAddOpen] = React.useState(false);
  const [importOpen, setImportOpen] = React.useState(false);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["expenses", activeClientId, period],
    queryFn: () => api.listExpenses(activeClientId, period),
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
    if (query === "") return true;
    return [r.reference, r.supplier, r.category].some((f) =>
      f.toLowerCase().includes(query),
    );
  });
  const total = rows.reduce((sum, r) => sum + r.amount, 0);

  const columns: ColumnDef<ExpenseTxn>[] = [
    { accessorKey: "date", header: "DATE" },
    {
      accessorKey: "reference",
      header: "REF",
      cell: ({ row }) => (
        <span className="font-mono text-blue">{row.original.reference}</span>
      ),
    },
    { accessorKey: "supplier", header: "SUPPLIER" },
    { accessorKey: "category", header: "CATEGORY" },
    isVat
      ? {
          id: "inputVat",
          header: "INPUT VAT CATEGORY",
          cell: ({ row }) => {
            const cat = row.original.inputVatCategory;
            return cat ? (
              <Chip variant="neutral">{INPUT_VAT_LABEL[cat]}</Chip>
            ) : (
              <span className="text-content-muted">—</span>
            );
          },
        }
      : {
          id: "type",
          header: "TYPE",
          cell: () => <span className="text-content-muted">N/A</span>,
        },
    {
      id: "deductible",
      header: "DEDUCT.",
      cell: ({ row }) =>
        row.original.deductible ? (
          <Check className="h-4 w-4 text-success" aria-label="Deductible" />
        ) : (
          <span className="text-content-muted" aria-label="Not deductible">
            —
          </span>
        ),
    },
    {
      accessorKey: "amount",
      header: "AMOUNT",
      meta: { numeric: true },
      cell: ({ row }) => peso(row.original.amount),
    },
  ];

  const header = (
    <PageHeader
      title="Expenses"
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

          <Input
            aria-label="Search records"
            placeholder="Search reference, supplier, category…"
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
            message="The expense records failed to load. Please try again."
            onRetry={() => void refetch()}
          />
        ) : rows.length === 0 ? (
          <EmptyState
            title="No records for this period"
            description="Add an expense or import a spreadsheet to start tracking costs for this quarter."
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
        defaultKind="expense"
        period={period}
        onSaved={() => void refetch()}
      />
      <ImportWizard
        open={importOpen}
        onOpenChange={setImportOpen}
        regime={regime ?? "VAT"}
        kind="expense"
        onDone={() => void refetch()}
      />
    </>
  );
}
