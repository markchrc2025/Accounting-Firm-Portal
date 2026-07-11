import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchUsers } from "../lib/api";
import type { FirmUserSummary } from "../lib/api";
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Chip,
  ChipVariant,
  EmptyState,
  ErrorState,
  PageHeader,
  Skeleton,
} from "../components/ui";

/** Two-letter initials from a person's name (mirrors the dashboard mark). */
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "—";
  if (parts.length === 1) return (parts[0] ?? "").slice(0, 2).toUpperCase();
  return `${(parts[0] ?? "").charAt(0)}${(parts[parts.length - 1] ?? "").charAt(0)}`.toUpperCase();
}

/** Distinct role names carried on a user's role assignments. */
function distinctRoles(user: FirmUserSummary): string[] {
  return Array.from(new Set(user.userRoles.map((r) => r.role.name)));
}

/** Super Admin reads as authority (gold); every other role is informational. */
function roleTone(name: string): ChipVariant {
  return name === "Super Admin" ? "gold" : "info";
}

/** Active accounts read as success; everything else is neutral. */
function statusTone(status: string): ChipVariant {
  return status.toUpperCase().includes("ACTIVE") ? "success" : "neutral";
}

/** Firm roles, in the seed's authority order. */
const FIRM_ROLES = ["Super Admin", "Manager", "Accountant", "Staff", "Auditor"] as const;

interface CapabilityRow {
  label: string;
  roles: string[];
}

/**
 * Capability → roles that hold it. Mirrors the backend RBAC seed
 * (apps/api/src/rbac/permissions.constants.ts). Values are authoritative — a
 * cell is checked when the role appears in the row's `roles`.
 */
const CAPABILITY_MATRIX: CapabilityRow[] = [
  { label: "Manage firm users & roles", roles: ["Super Admin"] },
  { label: "Create / edit clients", roles: ["Super Admin", "Manager"] },
  {
    label: "Enter & edit transactions",
    roles: ["Super Admin", "Manager", "Accountant", "Staff"],
  },
  { label: "Configure tax rules", roles: ["Super Admin", "Accountant"] },
  { label: "Send invoices", roles: ["Super Admin", "Manager", "Accountant"] },
  {
    label: "View reports",
    roles: ["Super Admin", "Manager", "Accountant", "Auditor"],
  },
  { label: "Manage integrations", roles: ["Super Admin"] },
  { label: "View audit log", roles: ["Super Admin", "Manager", "Auditor"] },
];

export default function UsersPage() {
  const users = useQuery({ queryKey: ["users"], queryFn: () => fetchUsers() });
  // Firm-level invitations aren't wired yet — the button is honest about that
  // rather than firing a fabricated request.
  const [inviteHint, setInviteHint] = useState(false);

  return (
    <div className="animate-fade-rise">
      <PageHeader
        title="Users & Roles"
        eyebrow="FIRM ADMIN"
        description="Firm staff and their access."
        actions={
          <div className="flex items-center gap-3">
            {inviteHint ? (
              <span className="text-[12px] text-content-muted">
                Firm invitations coming soon
              </span>
            ) : null}
            <Button variant="outline" onClick={() => setInviteHint(true)}>
              Invite user
            </Button>
          </div>
        }
      />

      <div className="space-y-6">
        {/* Users */}
        <Card>
          <CardHeader>
            <CardTitle>Firm users</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {users.isPending && (
              <div className="space-y-3 px-6 py-5">
                <Skeleton />
                <Skeleton className="w-3/4" />
                <Skeleton className="w-1/2" />
              </div>
            )}
            {users.isError && (
              <ErrorState
                message="Could not load firm users."
                onRetry={() => void users.refetch()}
              />
            )}
            {users.data && users.data.length === 0 && (
              <EmptyState
                title="No users yet"
                description="Firm staff will appear here once they've been invited and have accepted."
              />
            )}
            {users.data && users.data.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead>
                    <tr className="border-b border-line-divider bg-sidebar font-mono text-[10px] uppercase tracking-[.14em] text-content-secondary">
                      <th className="px-6 py-2.5 font-semibold">User</th>
                      <th className="px-6 py-2.5 font-semibold">Email</th>
                      <th className="px-6 py-2.5 font-semibold">Role</th>
                      <th className="px-6 py-2.5 font-semibold">MFA</th>
                      <th className="px-6 py-2.5 font-semibold">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line-divider">
                    {users.data.map((u) => {
                      const roles = distinctRoles(u);
                      return (
                        <tr
                          key={u.id}
                          className="text-[13px] transition-colors hover:bg-rowhover"
                        >
                          <td className="px-6 py-3">
                            <div className="flex items-center gap-3">
                              <span className="flex h-8 w-8 flex-none items-center justify-center overflow-hidden rounded-full bg-navy font-mono text-[11px] font-semibold text-gold-soft">
                                {u.avatarUrl ? (
                                  <img src={u.avatarUrl} alt="" className="h-full w-full object-cover" />
                                ) : (
                                  initials(u.fullName)
                                )}
                              </span>
                              <span className="font-medium text-content">{u.fullName}</span>
                            </div>
                          </td>
                          <td className="px-6 py-3 font-mono text-[12px] text-content-secondary">
                            {u.email}
                          </td>
                          <td className="px-6 py-3">
                            {roles.length > 0 ? (
                              <div className="flex flex-wrap items-center gap-1.5">
                                {roles.map((name) => (
                                  <Chip key={name} variant={roleTone(name)}>
                                    {name}
                                  </Chip>
                                ))}
                              </div>
                            ) : (
                              <span className="text-content-muted">—</span>
                            )}
                          </td>
                          <td className="px-6 py-3">
                            {u.mfaEnabled ? (
                              <Chip variant="success">Enrolled</Chip>
                            ) : (
                              <Chip variant="warn">Pending</Chip>
                            )}
                          </td>
                          <td className="px-6 py-3">
                            {u.status ? (
                              <Chip variant={statusTone(u.status)}>{u.status}</Chip>
                            ) : (
                              <span className="text-content-muted">—</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Roles & permissions matrix */}
        <Card>
          <CardHeader>
            <CardTitle>Roles &amp; permissions</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead>
                  <tr className="border-b border-line-divider bg-sidebar font-mono text-[10px] uppercase tracking-[.14em] text-content-secondary">
                    <th className="px-6 py-2.5 font-semibold">Capability</th>
                    {FIRM_ROLES.map((role) => (
                      <th key={role} className="px-4 py-2.5 text-center font-semibold">
                        {role}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-line-divider">
                  {CAPABILITY_MATRIX.map((row) => (
                    <tr
                      key={row.label}
                      className="text-[13px] transition-colors hover:bg-rowhover"
                    >
                      <td className="px-6 py-3 font-medium text-content">{row.label}</td>
                      {FIRM_ROLES.map((role) => (
                        <td key={role} className="px-4 py-3 text-center">
                          {row.roles.includes(role) ? (
                            <span className="text-success">✓</span>
                          ) : (
                            <span className="text-content-muted">—</span>
                          )}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
