/**
 * Screen 21 — Client Portal · Users & Seats (Owner only; nav gates visibility).
 *
 * A seat meter ("X of N seats used" with a progress bar and a Request-more-seats
 * action), the organization's portal users (role + status), an Invite action,
 * and a role legend explaining Owner / Manager / Viewer. Four states
 * (loading / error / empty / default).
 */
import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { UserPlus } from "lucide-react";

import {
  Avatar,
  AvatarFallback,
  Button,
  Card,
  DataTable,
  EmptyState,
  ErrorState,
  PageHeader,
  Skeleton,
  StatusChip,
  TableSkeleton,
  type ChipVariant,
  type ColumnDef,
} from "@/components/ui";
import { api } from "@/mock";
import { useSession } from "@/session";
import { initials } from "@/lib/utils";
import type { PortalRole, PortalUser, PortalUserStatus } from "@/types";

/** Portal role → chip tone. */
const ROLE_CHIP: Record<PortalRole, ChipVariant> = {
  Owner: "gold",
  Manager: "info",
  Viewer: "neutral",
};

/** Portal status → chip tone. */
function statusVariant(status: PortalUserStatus): ChipVariant {
  return status === "Active" ? "success" : "neutral";
}

const ROLE_LEGEND: { role: PortalRole; blurb: string }[] = [
  { role: "Owner", blurb: "Full access — manages users, seats, and all records." },
  { role: "Manager", blurb: "Adds and reviews income and expense records." },
  { role: "Viewer", blurb: "Read-only access to records, estimates, and filings." },
];

const columns: ColumnDef<PortalUser>[] = [
  {
    id: "user",
    header: "USER",
    cell: ({ row }) => (
      <div className="flex items-center gap-3">
        <Avatar className="h-8 w-8">
          <AvatarFallback>{initials(row.original.name)}</AvatarFallback>
        </Avatar>
        <span className="font-medium text-content">{row.original.name}</span>
      </div>
    ),
  },
  {
    id: "email",
    header: "EMAIL",
    cell: ({ row }) => (
      <span className="font-mono text-[12px] text-content-secondary">
        {row.original.email}
      </span>
    ),
  },
  {
    id: "role",
    header: "ROLE",
    cell: ({ row }) => (
      <StatusChip label={row.original.role} variant={ROLE_CHIP[row.original.role]} />
    ),
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
];

export function PortalUsersScreen(): React.JSX.Element {
  const { activeClientId, activeClient } = useSession();

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["portal-users", activeClientId],
    queryFn: () => api.listPortalUsers(activeClientId),
    enabled: Boolean(activeClient),
  });

  const header = (
    <PageHeader
      title="Users & Seats"
      eyebrow="Access"
      description={activeClient ? activeClient.name : undefined}
      actions={
        <Button variant="primary" size="sm">
          <UserPlus className="h-4 w-4" aria-hidden="true" />
          Invite
        </Button>
      }
    />
  );

  // Guard: hold a skeleton until the active client (and thus seat count) resolves.
  if (!activeClient) {
    return (
      <>
        <Skeleton className="mb-6 h-9 w-64" />
        <Skeleton className="mb-5 h-28 w-full rounded-card" />
        <TableSkeleton rows={5} cols={4} />
      </>
    );
  }

  const rows = data ?? [];
  const seats = Math.max(activeClient.seats, 3);
  const used = rows.length;
  const usedPct = Math.min(100, Math.round((used / seats) * 100));

  return (
    <>
      {header}

      {/* Seat meter */}
      <Card className="mb-5 px-6 py-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className="eyebrow">Seats</div>
            <div className="mt-1 text-[15px] text-content">
              <span className="font-serif text-[22px] font-medium text-navy tabular-nums">
                {used}
              </span>{" "}
              of{" "}
              <span className="font-mono tabular-nums text-content">{seats}</span> seats used
            </div>
          </div>
          <Button variant="outline" size="sm">
            Request more seats
          </Button>
        </div>
        <div
          className="mt-4 h-2 w-full overflow-hidden rounded-chip bg-line"
          role="progressbar"
          aria-valuenow={used}
          aria-valuemin={0}
          aria-valuemax={seats}
          aria-label={`${used} of ${seats} seats used`}
        >
          <div
            className="h-full rounded-chip bg-navy"
            style={{ width: `${usedPct}%` }}
            aria-hidden="true"
          />
        </div>
      </Card>

      {/* Users table */}
      {isLoading ? (
        <Card className="overflow-hidden">
          <TableSkeleton rows={5} cols={4} />
        </Card>
      ) : isError ? (
        <Card>
          <ErrorState
            title="Couldn't load users"
            message="Your organization's users failed to load. Please try again."
            onRetry={() => void refetch()}
          />
        </Card>
      ) : rows.length === 0 ? (
        <Card>
          <EmptyState
            title="No users yet"
            description="Invite a colleague to give them access to your organization's portal."
          >
            <Button variant="primary" size="md">
              <UserPlus className="h-4 w-4" aria-hidden="true" />
              Invite
            </Button>
          </EmptyState>
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <DataTable columns={columns} data={rows} />
        </Card>
      )}

      {/* Role legend */}
      <div className="mt-5 rounded-card border border-line-strong bg-card px-6 py-5">
        <div className="eyebrow">Roles</div>
        <ul className="mt-3 space-y-2.5">
          {ROLE_LEGEND.map((r) => (
            <li key={r.role} className="flex items-start gap-3 text-[13px]">
              <StatusChip
                label={r.role}
                variant={ROLE_CHIP[r.role]}
                className="mt-0.5 shrink-0"
              />
              <span className="text-content-secondary">{r.blurb}</span>
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}
