/**
 * Screen 21 — Client Portal · Filed forms.
 *
 * Read-only list of the BIR forms filed for the client, pushed by the
 * integration. Clients get the PDF copy only (no XML). Four states
 * (loading / error / empty / default).
 */
import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { Download } from "lucide-react";

import {
  Button,
  Card,
  Chip,
  DataTable,
  EmptyState,
  ErrorState,
  PageHeader,
  StatusChip,
  TableSkeleton,
  type ChipVariant,
  type ColumnDef,
} from "@/components/ui";
import { api } from "@/mock";
import { useSession } from "@/session";
import type { Filing, FilingDisplayStatus, FilingForm } from "@/types";

/** Filed-status → chip tone. */
function statusVariant(status: FilingDisplayStatus): ChipVariant {
  return status === "Accepted" ? "success" : "gold";
}

/** Form → chip tone. The VAT quarterly return reads as the VAT (blue) chip. */
function formVariant(form: FilingForm): ChipVariant {
  return form === "2550Q" ? "vat" : "info";
}

const columns: ColumnDef<Filing>[] = [
  {
    id: "form",
    header: "FORM",
    cell: ({ row }) => (
      <Chip variant={formVariant(row.original.form)}>{row.original.form}</Chip>
    ),
  },
  { id: "period", header: "PERIOD", accessorKey: "period" },
  { id: "filed", header: "FILED", accessorKey: "filed" },
  {
    id: "reference",
    header: "REFERENCE",
    accessorKey: "reference",
    meta: { className: "font-mono" },
  },
  {
    id: "status",
    header: "STATUS",
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
      <div className="flex items-center justify-end">
        <Button
          variant="outline"
          size="sm"
          aria-label={`Download PDF for ${row.original.reference}`}
        >
          <Download className="h-3.5 w-3.5" aria-hidden="true" />
          PDF
        </Button>
      </div>
    ),
  },
];

export function PortalFilingsScreen(): React.JSX.Element {
  const { activeClientId, activeClient } = useSession();

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["portal-filings", activeClientId],
    queryFn: () => api.listFilings(activeClientId),
    enabled: Boolean(activeClient),
  });

  const rows = data ?? [];

  const header = (
    <PageHeader
      title="Filed forms"
      eyebrow="Compliance"
      description={
        activeClient
          ? `${activeClient.name} · filed by MCRC on your behalf`
          : undefined
      }
    />
  );

  let body: React.JSX.Element;
  if (isLoading) {
    body = (
      <Card className="overflow-hidden">
        <TableSkeleton rows={6} cols={6} />
      </Card>
    );
  } else if (isError) {
    body = (
      <Card>
        <ErrorState
          title="Couldn't load filings"
          message="Your filed forms failed to load. Please try again."
          onRetry={() => void refetch()}
        />
      </Card>
    );
  } else if (rows.length === 0) {
    body = (
      <Card>
        <EmptyState
          title="No filed forms yet"
          description="No BIR forms have been filed for your organization yet. Filed forms will appear here for download."
        />
      </Card>
    );
  } else {
    body = (
      <Card className="overflow-hidden">
        <DataTable columns={columns} data={rows} />
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
