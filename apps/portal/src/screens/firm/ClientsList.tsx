/**
 * Screen 6 — Clients list.
 *
 * Toolbar (search + regime/status/staff selects + result count) over a DataTable of
 * clients with client-side pagination. Four states: loading / empty / error / default.
 */
import * as React from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Pencil, Plus } from "lucide-react";

import {
  Button,
  Card,
  DataTable,
  EmptyState,
  ErrorState,
  Input,
  PageHeader,
  RegimeChip,
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
import { api, CLIENTS } from "@/mock";
import type { Client, ClientFilters, ClientStatus, Regime } from "@/types";
import { initials } from "@/lib/utils";

const PAGE_SIZE = 8;

/** Status → chip tone. */
function statusVariant(status: ClientStatus): ChipVariant {
  if (status === "Active") return "success";
  if (status === "Onboarding") return "warn";
  return "neutral";
}

/** Distinct assigned-staff names from the seed catalog (for the staff filter). */
const STAFF_OPTIONS: string[] = Array.from(
  new Set(CLIENTS.map((c) => c.assignedStaff)),
).sort();

const columns: ColumnDef<Client>[] = [
  {
    id: "business",
    header: "Business",
    cell: ({ row }) => {
      const c = row.original;
      return (
        <div className="flex items-center gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-btn bg-navy font-mono text-[11px] font-bold text-gold-soft">
            {initials(c.name)}
          </span>
          <div className="min-w-0">
            <div className="truncate font-semibold text-content">{c.name}</div>
            <div className="truncate text-[12px] text-content-secondary">{c.city}</div>
          </div>
        </div>
      );
    },
  },
  {
    id: "tin",
    header: "TIN",
    accessorKey: "tin",
    meta: { className: "font-mono" },
  },
  {
    id: "regime",
    header: "Regime",
    cell: ({ row }) => <RegimeChip regime={row.original.regime} />,
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
    id: "assigned",
    header: "Assigned",
    accessorKey: "assignedStaff",
  },
  {
    id: "actions",
    header: "",
    meta: { align: "right" },
    cell: ({ row }) => {
      const c = row.original;
      return (
        <div className="flex items-center justify-end gap-1">
          <Button asChild variant="outline" size="sm">
            <Link to={`/clients/${c.id}`}>Open</Link>
          </Button>
          <Button asChild variant="ghost" size="sm" className="px-2">
            <Link to={`/clients/${c.id}/edit`} aria-label={`Edit ${c.name}`}>
              <Pencil className="h-4 w-4" aria-hidden="true" />
            </Link>
          </Button>
        </div>
      );
    },
  },
];

export function ClientsListScreen(): React.JSX.Element {
  const [search, setSearch] = React.useState("");
  const [regime, setRegime] = React.useState<"all" | Regime>("all");
  const [status, setStatus] = React.useState<"all" | ClientStatus>("all");
  const [staff, setStaff] = React.useState<string>("all");
  const [page, setPage] = React.useState(0);

  const filters = React.useMemo<ClientFilters>(() => {
    const f: ClientFilters = {};
    if (search.trim()) f.search = search.trim();
    if (regime !== "all") f.regime = regime;
    if (status !== "all") f.status = status;
    if (staff !== "all") f.staff = staff;
    return f;
  }, [search, regime, status, staff]);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["clients", filters],
    queryFn: () => api.listClients(filters),
  });

  // Reset to the first page whenever the filter set changes.
  React.useEffect(() => {
    setPage(0);
  }, [filters]);

  const rows = data ?? [];
  const total = rows.length;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const start = safePage * PAGE_SIZE;
  const paged = rows.slice(start, start + PAGE_SIZE);
  const rangeStart = total === 0 ? 0 : start + 1;
  const rangeEnd = Math.min(start + PAGE_SIZE, total);

  const header = (
    <PageHeader
      title="Clients"
      actions={
        <Button asChild variant="primary" size="sm">
          <Link to="/clients/new">
            <Plus className="h-4 w-4" aria-hidden="true" />
            Add client
          </Link>
        </Button>
      }
    />
  );

  const toolbar = (
    <div className="mb-4 flex flex-wrap items-center gap-3">
      <Input
        type="search"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search name or TIN…"
        aria-label="Search clients by name or TIN"
        className="w-56"
      />
      <Select value={regime} onValueChange={(v) => setRegime(v as "all" | Regime)}>
        <SelectTrigger className="w-40" aria-label="Filter by regime">
          <SelectValue placeholder="Regime" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All regimes</SelectItem>
          <SelectItem value="VAT">VAT</SelectItem>
          <SelectItem value="PERCENTAGE">Percentage</SelectItem>
        </SelectContent>
      </Select>
      <Select value={status} onValueChange={(v) => setStatus(v as "all" | ClientStatus)}>
        <SelectTrigger className="w-40" aria-label="Filter by status">
          <SelectValue placeholder="Status" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All statuses</SelectItem>
          <SelectItem value="Active">Active</SelectItem>
          <SelectItem value="Onboarding">Onboarding</SelectItem>
          <SelectItem value="Inactive">Inactive</SelectItem>
        </SelectContent>
      </Select>
      <Select value={staff} onValueChange={setStaff}>
        <SelectTrigger className="w-44" aria-label="Filter by assigned staff">
          <SelectValue placeholder="Assigned" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All staff</SelectItem>
          {STAFF_OPTIONS.map((s) => (
            <SelectItem key={s} value={s}>
              {s}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <span className="ml-auto font-mono text-[12px] text-content-secondary">
        {total} {total === 1 ? "client" : "clients"}
      </span>
    </div>
  );

  let body: React.JSX.Element;
  if (isLoading) {
    body = (
      <Card className="overflow-hidden">
        <TableSkeleton rows={8} cols={6} />
      </Card>
    );
  } else if (isError) {
    body = (
      <Card>
        <ErrorState
          message="Couldn't load your clients."
          onRetry={() => void refetch()}
        />
      </Card>
    );
  } else if (total === 0) {
    body = (
      <Card>
        <EmptyState
          title="No clients found"
          description="No clients match the current filters. Adjust your search, or add a new client."
        >
          <Button asChild variant="primary" size="md">
            <Link to="/clients/new">
              <Plus className="h-4 w-4" aria-hidden="true" />
              Add client
            </Link>
          </Button>
        </EmptyState>
      </Card>
    );
  } else {
    body = (
      <Card className="overflow-hidden">
        <DataTable columns={columns} data={paged} />
        <div className="flex items-center justify-between border-t border-line px-5 py-3">
          <span className="font-mono text-[12px] text-content-secondary">
            {rangeStart}&ndash;{rangeEnd} of {total}
          </span>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={safePage === 0}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
            >
              Prev
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={safePage >= pageCount - 1}
              onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
            >
              Next
            </Button>
          </div>
        </div>
      </Card>
    );
  }

  return (
    <>
      {header}
      {toolbar}
      {body}
    </>
  );
}
