/**
 * Screen 17 — Users & RBAC (Super Admin).
 *
 * Two stacked sections:
 *  - the firm-users DataTable (4 states) with an "Invite user" action, showing
 *    role / MFA / status chips + an Edit affordance per row.
 *  - a static "Roles & permissions matrix" card driven entirely by the frozen
 *    RBAC policy (`CAPABILITY_ROWS` × `FIRM_ROLES`, evaluated through `can`).
 *
 * The matrix is derived from imported policy data, so it always renders; only the
 * users table participates in the loading / empty / error scenarios.
 */
import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, Minus, Plus } from "lucide-react";

import {
  Avatar,
  AvatarFallback,
  Button,
  Card,
  DataTable,
  EmptyState,
  ErrorState,
  PageHeader,
  StatusChip,
  TableSkeleton,
  type ColumnDef,
} from "@/components/ui";
import { api } from "@/mock";
import { CAPABILITY_ROWS, FIRM_ROLES, can } from "@/session";
import type { FirmUser } from "@/types";
import { initials } from "@/lib/utils";

/* ------------------------------------------------------------------------- *
 * Users table
 * ------------------------------------------------------------------------- */

const userColumns: ColumnDef<FirmUser>[] = [
  {
    id: "user",
    header: "User",
    cell: ({ row }) => (
      <div className="flex items-center gap-3">
        <Avatar>
          <AvatarFallback>{initials(row.original.name)}</AvatarFallback>
        </Avatar>
        <span className="font-semibold text-content">{row.original.name}</span>
      </div>
    ),
  },
  {
    id: "email",
    header: "Email",
    cell: ({ row }) => (
      <span className="font-mono text-[12px] text-content-secondary">
        {row.original.email}
      </span>
    ),
  },
  {
    id: "role",
    header: "Role",
    cell: ({ row }) => (
      <StatusChip
        label={row.original.role}
        variant={row.original.role === "Super Admin" ? "gold" : "info"}
      />
    ),
  },
  {
    id: "mfa",
    header: "MFA",
    cell: ({ row }) => (
      <StatusChip
        label={row.original.mfa}
        variant={row.original.mfa === "Enrolled" ? "success" : "warn"}
      />
    ),
  },
  {
    id: "status",
    header: "Status",
    cell: ({ row }) => (
      <StatusChip
        label={row.original.status}
        variant={row.original.status === "Active" ? "success" : "neutral"}
      />
    ),
  },
  {
    id: "actions",
    header: "",
    meta: { align: "right" },
    cell: ({ row }) => (
      <div className="flex justify-end">
        <Button
          variant="outline"
          size="sm"
          aria-label={`Edit ${row.original.name}`}
        >
          Edit
        </Button>
      </div>
    ),
  },
];

function UsersTable(): React.JSX.Element {
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["firm-users"],
    queryFn: () => api.listUsers(),
  });

  if (isLoading) {
    return (
      <Card className="overflow-hidden">
        <TableSkeleton rows={5} cols={6} />
      </Card>
    );
  }
  if (isError) {
    return (
      <Card>
        <ErrorState
          message="Couldn't load firm users."
          onRetry={() => void refetch()}
        />
      </Card>
    );
  }
  const rows = data ?? [];
  if (rows.length === 0) {
    return (
      <Card>
        <EmptyState
          title="No firm users yet"
          description="Invite your first teammate to give them access to the portal."
        >
          <Button variant="primary" size="md">
            <Plus className="h-4 w-4" aria-hidden="true" />
            Invite user
          </Button>
        </EmptyState>
      </Card>
    );
  }

  return (
    <Card className="overflow-hidden">
      <DataTable columns={userColumns} data={rows} />
    </Card>
  );
}

/* ------------------------------------------------------------------------- *
 * Roles & permissions matrix
 * ------------------------------------------------------------------------- */

function RolesMatrix(): React.JSX.Element {
  return (
    <Card className="overflow-hidden">
      <div className="border-b border-line px-6 py-5">
        <div className="eyebrow mb-1">Access control</div>
        <h3 className="font-serif text-[14.5px] font-bold text-content">
          Roles &amp; permissions matrix
        </h3>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-left">
          <thead>
            <tr className="border-b border-line bg-sidebar">
              <th
                scope="col"
                className="px-5 py-2.5 font-mono text-[10px] font-normal uppercase tracking-[.14em] text-content-secondary"
              >
                Capability
              </th>
              {FIRM_ROLES.map((role) => (
                <th
                  key={role}
                  scope="col"
                  className="px-5 py-2.5 text-center font-mono text-[10px] font-normal uppercase tracking-[.14em] text-content-secondary"
                >
                  {role}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-line-divider">
            {CAPABILITY_ROWS.map((row) => (
              <tr key={row.capability} className="transition-colors hover:bg-rowhover">
                <td className="px-5 py-[13px] text-[13px] font-medium text-content">
                  {row.label}
                </td>
                {FIRM_ROLES.map((role) => (
                  <td key={role} className="px-5 py-[13px] text-center">
                    {can(role, row.capability) ? (
                      <Check
                        className="mx-auto h-4 w-4 text-success"
                        aria-label={`${role} can ${row.label}`}
                      />
                    ) : (
                      <Minus
                        className="mx-auto h-4 w-4 text-content-muted"
                        aria-label={`${role} cannot ${row.label}`}
                      />
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

/* ------------------------------------------------------------------------- *
 * Screen
 * ------------------------------------------------------------------------- */

export function UsersScreen(): React.JSX.Element {
  return (
    <>
      <PageHeader
        title="Users & Roles"
        eyebrow="Firm admin"
        actions={
          <Button variant="primary" size="sm">
            <Plus className="h-4 w-4" aria-hidden="true" />
            Invite user
          </Button>
        }
      />
      <div className="space-y-6">
        <UsersTable />
        <RolesMatrix />
      </div>
    </>
  );
}
