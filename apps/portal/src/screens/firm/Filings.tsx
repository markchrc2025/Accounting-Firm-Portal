/**
 * Screen 16 — BIR Filings.
 *
 * Read-only list of the filings the integration has pushed for the active
 * client, filterable by form. Available forms differ by regime (VAT clients
 * file 2550Q, PERCENTAGE clients file 2551Q), so the filter options are derived
 * from the forms actually present rather than hard-coded. Four states.
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
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
    header: "Form",
    cell: ({ row }) => (
      <Chip variant={formVariant(row.original.form)}>{row.original.form}</Chip>
    ),
  },
  {
    id: "period",
    header: "Period",
    cell: ({ row }) => (
      <span className="text-content">{row.original.period}</span>
    ),
  },
  { id: "filed", header: "Filed", accessorKey: "filed" },
  {
    id: "reference",
    header: "Reference",
    accessorKey: "reference",
    meta: { className: "font-mono" },
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
      <div className="flex items-center justify-end gap-1.5">
        <Button
          variant="outline"
          size="sm"
          aria-label={`Download XML for ${row.original.reference}`}
        >
          <Download className="h-3.5 w-3.5" aria-hidden="true" />
          XML
        </Button>
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

export function FilingsScreen(): React.JSX.Element {
  const { activeClientId, activeClient } = useSession();
  const [formFilter, setFormFilter] = React.useState<"all" | FilingForm>("all");

  // Unfiltered query drives the filter's option list (the forms present).
  const optionsQuery = useQuery({
    queryKey: ["filings", activeClientId, "options"],
    queryFn: () => api.listFilings(activeClientId),
  });

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["filings", activeClientId, formFilter],
    queryFn: () =>
      api.listFilings(
        activeClientId,
        formFilter === "all" ? undefined : formFilter,
      ),
  });

  const availableForms = React.useMemo<FilingForm[]>(() => {
    const seen = new Set<FilingForm>();
    for (const f of optionsQuery.data ?? []) seen.add(f.form);
    return Array.from(seen);
  }, [optionsQuery.data]);

  const rows = data ?? [];

  const header = (
    <PageHeader
      title="BIR Filings"
      eyebrow="Compliance"
      description={
        activeClient
          ? `${activeClient.name} · ${activeClient.regime} regime`
          : undefined
      }
      actions={
        <Select
          value={formFilter}
          onValueChange={(v) => setFormFilter(v as "all" | FilingForm)}
        >
          <SelectTrigger className="w-44" aria-label="Filter by form">
            <SelectValue placeholder="Form" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All forms</SelectItem>
            {availableForms.map((f) => (
              <SelectItem key={f} value={f}>
                {f}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
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
          message="Couldn't load filings."
          onRetry={() => void refetch()}
        />
      </Card>
    );
  } else if (rows.length === 0) {
    body = (
      <Card>
        <EmptyState
          title="No filings found"
          description={
            formFilter === "all"
              ? "No BIR filings have been pushed for this client yet."
              : `No ${formFilter} filings for this client.`
          }
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
