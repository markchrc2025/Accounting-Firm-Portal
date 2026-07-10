/**
 * Screen 21 — Client Portal · Expenses (READ-ONLY).
 *
 * Clients can review expenses their MCRC team has recorded but cannot add or
 * edit them: a "VIEW ONLY" pill sits beside the title, and there are no add or
 * row actions. The table is regime-aware, mirroring the firm Expenses screen.
 * Four states (loading / error / empty / default).
 */
import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { Check } from "lucide-react";

import {
  Chip,
  DataTable,
  EmptyState,
  ErrorState,
  PageHeader,
  Skeleton,
  TableSkeleton,
  type ColumnDef,
} from "@/components/ui";
import { api } from "@/mock";
import { useSession } from "@/session";
import { peso } from "@/lib/utils";
import type { ExpenseTxn, InputVATCategory } from "@/types";

const PERIOD = "2026-Q2";

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

export function PortalExpensesScreen(): React.JSX.Element {
  const { activeClientId, activeClient, regime } = useSession();

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["portal-expenses", activeClientId, PERIOD],
    queryFn: () => api.listExpenses(activeClientId, PERIOD),
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
  const rows = data ?? [];

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

  return (
    <>
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-3">
            <span>Expenses</span>
            <Chip variant="neutral">VIEW ONLY</Chip>
          </span>
        }
        description={activeClient.name}
      />

      <div className="overflow-hidden rounded-card border border-line-strong bg-card">
        {isLoading ? (
          <TableSkeleton rows={8} cols={6} />
        ) : isError ? (
          <ErrorState
            title="Couldn't load records"
            message="Your expense records failed to load. Please try again."
            onRetry={() => void refetch()}
          />
        ) : rows.length === 0 ? (
          <EmptyState
            title="No expenses for this quarter"
            description="Your MCRC team hasn't recorded any expenses for this period yet."
          />
        ) : (
          <DataTable columns={columns} data={rows} />
        )}
      </div>
    </>
  );
}
