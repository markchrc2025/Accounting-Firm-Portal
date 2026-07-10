/**
 * Screen 21 — Client Portal · Sales & Income.
 *
 * Direct entry is ENABLED for the client: a "+ Add record" action opens the
 * shared AddRecordModal (locked to income). A blue info banner explains that
 * added records are reviewed by MCRC before filing. The table is regime-aware,
 * mirroring the firm Sales screen. Four states (loading / error / empty / default).
 */
import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { Info, Plus } from "lucide-react";

import {
  Button,
  Chip,
  DataTable,
  EmptyState,
  ErrorState,
  PageHeader,
  Skeleton,
  TableSkeleton,
  type ChipVariant,
  type ColumnDef,
} from "@/components/ui";
import { AddRecordModal } from "@/components/transactions";
import { api } from "@/mock";
import { useSession } from "@/session";
import { peso } from "@/lib/utils";
import type { IncomeTxn, VatClass } from "@/types";

const PERIOD = "2026-Q2";

/** VAT-class → chip tone + short label (labels only; enum values imported). */
const VAT_CLASS_CHIP: Record<VatClass, { variant: ChipVariant; label: string }> = {
  VATABLE_12: { variant: "vat", label: "VATABLE 12%" },
  ZERO_RATED: { variant: "info", label: "ZERO-RATED" },
  EXEMPT: { variant: "neutral", label: "EXEMPT" },
  NON_VAT: { variant: "gold", label: "NON-VAT" },
};

export function PortalSalesScreen(): React.JSX.Element {
  const { activeClientId, activeClient, regime } = useSession();
  const [addOpen, setAddOpen] = React.useState(false);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["portal-income", activeClientId, PERIOD],
    queryFn: () => api.listIncome(activeClientId, PERIOD),
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

  return (
    <>
      <PageHeader
        title="Sales & Income"
        description={activeClient.name}
        actions={
          <Button variant="primary" size="sm" onClick={() => setAddOpen(true)}>
            <Plus className="h-4 w-4" aria-hidden="true" />
            Add record
          </Button>
        }
      />

      {/* Direct-entry info banner */}
      <div className="mb-5 flex items-start gap-3 rounded-card bg-info-bg px-5 py-4 text-info">
        <Info className="mt-0.5 h-[18px] w-[18px] shrink-0" aria-hidden="true" />
        <p className="text-[13px] leading-snug">
          Direct entry is enabled for your organization. Records you add are reviewed by
          MCRC before filing.
        </p>
      </div>

      <div className="overflow-hidden rounded-card border border-line-strong bg-card">
        {isLoading ? (
          <TableSkeleton rows={8} cols={6} />
        ) : isError ? (
          <ErrorState
            title="Couldn't load records"
            message="Your sales records failed to load. Please try again."
            onRetry={() => void refetch()}
          />
        ) : rows.length === 0 ? (
          <EmptyState
            title="No records for this quarter"
            description="Add a sale to start tracking income. Your MCRC team reviews each record before filing."
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
        lockKind
        period={PERIOD}
        onSaved={() => void refetch()}
      />
    </>
  );
}
