import { useState, type FormEvent, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ApiError,
  createFirmInvitation,
  deleteUser,
  fetchFirmInvitations,
  fetchUsers,
  resendFirmInvitation,
  revokeFirmInvitation,
  setUserRoles,
  updateUser,
} from "../lib/api";
import type { FirmInvitation, FirmUserSummary } from "../lib/api";
import { useAuth } from "../auth/AuthContext";
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Chip,
  ChipVariant,
  cn,
  EmptyState,
  ErrorState,
  PageHeader,
  Skeleton,
} from "../components/ui";
import { SettingsTabs } from "../components/SettingsTabs";
import { RolesManager } from "../components/RolesManager";

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
  {
    label: "Manage chart of accounts",
    roles: ["Super Admin", "Accountant"],
  },
  { label: "Send invoices", roles: ["Super Admin", "Manager", "Accountant"] },
  {
    label: "View reports",
    roles: ["Super Admin", "Manager", "Accountant", "Auditor"],
  },
  { label: "Manage integrations", roles: ["Super Admin"] },
  { label: "View audit log", roles: ["Super Admin", "Manager", "Auditor"] },
];

export default function UsersPage() {
  const { hasPermission, user: me } = useAuth();
  const queryClient = useQueryClient();
  const canInvite = hasPermission("Users:Create");
  const canManage = hasPermission("Users:Update");
  const canDelete = hasPermission("Users:Delete");
  const canAssignRoles = hasPermission("Roles:Assign");
  const canConfigureRoles = hasPermission("Roles:Configure");
  const showActions = canManage || canDelete;
  const users = useQuery({ queryKey: ["users"], queryFn: () => fetchUsers() });
  const [inviteOpen, setInviteOpen] = useState(false);
  const [profileUser, setProfileUser] = useState<FirmUserSummary | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const invalidateUsers = () =>
    void queryClient.invalidateQueries({ queryKey: ["users"] });
  const onActionError = (e: unknown) =>
    setActionError(e instanceof ApiError ? e.message : "That action could not be completed.");

  // Deactivate / reactivate a firm user (status DISABLED ⇄ ACTIVE).
  const setStatus = useMutation({
    mutationFn: (v: { id: string; status: "ACTIVE" | "DISABLED" }) =>
      updateUser(v.id, { status: v.status }),
    onSuccess: invalidateUsers,
    onError: onActionError,
  });
  // Permanently delete a firm user.
  const removeUser = useMutation({
    mutationFn: (id: string) => deleteUser(id),
    onSuccess: invalidateUsers,
    onError: onActionError,
  });
  // Change a firm user's role.
  const setRole = useMutation({
    mutationFn: (v: { id: string; role: string }) => setUserRoles(v.id, [v.role]),
    onSuccess: invalidateUsers,
    onError: onActionError,
  });
  const actionBusy = setStatus.isPending || removeUser.isPending || setRole.isPending;

  return (
    <div className="animate-fade-rise">
      <SettingsTabs />
      <PageHeader
        title="Users & Roles"
        eyebrow="FIRM ADMIN"
        description="Firm staff and their access."
        actions={
          canInvite ? (
            <Button onClick={() => setInviteOpen(true)}>Invite user</Button>
          ) : undefined
        }
      />

      <div className="space-y-6">
        {/* Users */}
        <Card>
          <CardHeader>
            <CardTitle>Firm users</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {actionError ? (
              <div className="mx-6 mt-4 rounded-card border border-danger/30 bg-danger-bg px-4 py-3 text-[12.5px] text-danger-ink">
                {actionError}
              </div>
            ) : null}
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
                      {showActions ? (
                        <th className="px-6 py-2.5 text-right font-semibold">Actions</th>
                      ) : null}
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
                            <button
                              type="button"
                              onClick={() => setProfileUser(u)}
                              className="flex items-center gap-3 text-left transition-colors hover:text-navy"
                              aria-label={`View ${u.fullName}'s profile`}
                            >
                              <span className="flex h-8 w-8 flex-none items-center justify-center overflow-hidden rounded-full bg-navy font-mono text-[11px] font-semibold text-gold-soft">
                                {u.avatarUrl ? (
                                  <img src={u.avatarUrl} alt="" className="h-full w-full object-cover" />
                                ) : (
                                  initials(u.fullName)
                                )}
                              </span>
                              <span className="font-medium text-content underline-offset-2 hover:underline">
                                {u.fullName}
                              </span>
                            </button>
                          </td>
                          <td className="px-6 py-3 font-mono text-[12px] text-content-secondary">
                            {u.email}
                          </td>
                          <td className="px-6 py-3">
                            {canAssignRoles && u.id !== me?.id ? (
                              // Change this user's role. Your own role is locked
                              // (rendered as a chip) so you can't demote yourself
                              // out of Users & Roles management.
                              <select
                                className="input h-9 py-1 text-[13px]"
                                value={roles[0] ?? ""}
                                disabled={actionBusy}
                                onChange={(e) =>
                                  setRole.mutate({ id: u.id, role: e.target.value })
                                }
                                aria-label={`Role for ${u.fullName}`}
                              >
                                {roles[0] ? null : <option value="">— No role —</option>}
                                {FIRM_ROLES.map((r) => (
                                  <option key={r} value={r}>
                                    {r}
                                  </option>
                                ))}
                              </select>
                            ) : roles.length > 0 ? (
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
                          {showActions ? (
                            <td className="px-6 py-3">
                              {u.id === me?.id ? (
                                // No self-service deactivate/delete — that would lock
                                // you out of your own firm. Manage yourself in Profile.
                                <span className="block text-right text-[11px] uppercase tracking-wide text-content-muted">
                                  You
                                </span>
                              ) : (
                                <div className="flex items-center justify-end gap-1.5">
                                  {canManage ? (
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      disabled={actionBusy}
                                      onClick={() =>
                                        setStatus.mutate({
                                          id: u.id,
                                          status:
                                            u.status?.toUpperCase() === "ACTIVE"
                                              ? "DISABLED"
                                              : "ACTIVE",
                                        })
                                      }
                                    >
                                      {u.status?.toUpperCase() === "ACTIVE"
                                        ? "Deactivate"
                                        : "Reactivate"}
                                    </Button>
                                  ) : null}
                                  {canDelete ? (
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      className="text-danger hover:bg-danger-bg"
                                      disabled={actionBusy}
                                      onClick={() => {
                                        setActionError(null);
                                        if (
                                          window.confirm(
                                            `Delete ${u.fullName}? This permanently removes their account and cannot be undone.`,
                                          )
                                        ) {
                                          removeUser.mutate(u.id);
                                        }
                                      }}
                                    >
                                      Delete
                                    </Button>
                                  ) : null}
                                </div>
                              )}
                            </td>
                          ) : null}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        {canInvite && <InvitationsCard />}

        {/* Roles & permissions — editable for role admins, else a read-only matrix. */}
        {canConfigureRoles ? (
          <RolesManager />
        ) : (
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
        )}
      </div>

      {inviteOpen && <InviteUserModal onClose={() => setInviteOpen(false)} />}
      {profileUser && (
        <UserProfileModal user={profileUser} onClose={() => setProfileUser(null)} />
      )}
    </div>
  );
}

/* ------------------------------------------------------------ User profile */

/** Manila-formatted date, or a dash when absent. */
function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-PH", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Manila",
  });
}

/** Read-only profile / contact preview for a firm user. */
function UserProfileModal({
  user,
  onClose,
}: {
  user: FirmUserSummary;
  onClose: () => void;
}) {
  const roles = distinctRoles(user);
  const rows: { label: string; value: ReactNode }[] = [
    {
      label: "Email",
      value: (
        <a href={`mailto:${user.email}`} className="font-mono text-[12.5px] text-blue hover:underline">
          {user.email}
        </a>
      ),
    },
    { label: "Title", value: user.firmProfile?.title || "—" },
    { label: "Employee ID", value: user.firmProfile?.employeeId || "—" },
    {
      label: "Role",
      value:
        roles.length > 0 ? (
          <span className="flex flex-wrap gap-1.5">
            {roles.map((r) => (
              <Chip key={r} variant={roleTone(r)}>
                {r}
              </Chip>
            ))}
          </span>
        ) : (
          "—"
        ),
    },
    {
      label: "Status",
      value: user.status ? <Chip variant={statusTone(user.status)}>{user.status}</Chip> : "—",
    },
    {
      label: "MFA",
      value: user.mfaEnabled ? (
        <Chip variant="success">Enrolled</Chip>
      ) : (
        <Chip variant="warn">Pending</Chip>
      ),
    },
    { label: "Last sign-in", value: fmtDate(user.lastLoginAt) },
    { label: "Joined", value: fmtDate(user.createdAt) },
  ];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(14,33,44,0.45)] p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-label={`${user.fullName} profile`}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md overflow-hidden rounded-card border border-line bg-card shadow-xl"
      >
        <div className="flex items-center gap-4 border-b border-line bg-sidebar px-6 py-5">
          <span className="flex h-14 w-14 flex-none items-center justify-center overflow-hidden rounded-full bg-navy font-mono text-[16px] font-semibold text-gold-soft">
            {user.avatarUrl ? (
              <img src={user.avatarUrl} alt="" className="h-full w-full object-cover" />
            ) : (
              initials(user.fullName)
            )}
          </span>
          <div>
            <div className="font-serif text-[18px] font-medium text-navy">{user.fullName}</div>
            <div className="text-[12.5px] text-content-secondary">
              {user.firmProfile?.title || "Firm staff"}
            </div>
          </div>
        </div>
        <dl className="divide-y divide-line-divider px-6">
          {rows.map((r) => (
            <div key={r.label} className="flex items-center justify-between gap-4 py-3">
              <dt className="text-[12px] font-semibold uppercase tracking-wide text-content-secondary">
                {r.label}
              </dt>
              <dd className="text-right text-[13px] text-content">{r.value}</dd>
            </div>
          ))}
        </dl>
        <div className="flex justify-end border-t border-line px-6 py-4">
          <Button variant="outline" size="sm" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------ Invitations */

function invitationStatusTone(status: FirmInvitation["status"]): ChipVariant {
  if (status === "PENDING") return "info";
  if (status === "ACCEPTED") return "success";
  return "neutral";
}

/** Firm-staff invitations: Active (pending) by default; revoked/expired/accepted
 *  are tucked into Archived. */
type InviteFilter = "active" | "archived" | "all";
const INVITE_FILTERS: { key: InviteFilter; label: string }[] = [
  { key: "active", label: "Active" },
  { key: "archived", label: "Archived" },
  { key: "all", label: "All" },
];
/** Only PENDING invitations are "active" (still actionable); the rest archive. */
function isActiveInvite(status: FirmInvitation["status"]): boolean {
  return status === "PENDING";
}

function InvitationsCard() {
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<InviteFilter>("active");
  const invitations = useQuery({
    queryKey: ["firm-invitations"],
    queryFn: () => fetchFirmInvitations(),
  });
  const all = invitations.data ?? [];
  const counts = {
    active: all.filter((i) => isActiveInvite(i.status)).length,
    archived: all.filter((i) => !isActiveInvite(i.status)).length,
    all: all.length,
  };
  const visible = all.filter((i) =>
    filter === "all" ? true : filter === "active" ? isActiveInvite(i.status) : !isActiveInvite(i.status),
  );

  const resend = useMutation({
    mutationFn: (id: string) => resendFirmInvitation(id),
    onSuccess: () => {
      setError(null);
      void qc.invalidateQueries({ queryKey: ["firm-invitations"] });
    },
    onError: (err) =>
      setError(err instanceof ApiError ? err.message : "Could not resend the invitation."),
  });
  const revoke = useMutation({
    mutationFn: (id: string) => revokeFirmInvitation(id),
    onSuccess: () => {
      setError(null);
      void qc.invalidateQueries({ queryKey: ["firm-invitations"] });
    },
    onError: (err) =>
      setError(err instanceof ApiError ? err.message : "Could not revoke the invitation."),
  });
  const busy = resend.isPending || revoke.isPending;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-3">
        <CardTitle>Invitations</CardTitle>
        {all.length > 0 && (
          <div
            role="group"
            aria-label="Filter invitations"
            className="inline-flex flex-wrap rounded-btn border border-line-input bg-card p-1"
          >
            {INVITE_FILTERS.map((f) => {
              const active = filter === f.key;
              return (
                <button
                  key={f.key}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setFilter(f.key)}
                  className={cn(
                    "rounded-[5px] px-3 py-1 text-[12.5px] font-semibold transition-colors",
                    active ? "bg-navy text-white" : "text-content-secondary hover:bg-rowhover",
                  )}
                >
                  {f.label}{" "}
                  <span className={active ? "text-white/70" : "text-content-muted"}>
                    {counts[f.key]}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </CardHeader>
      <CardContent className="p-0">
        {error && (
          <div className="mx-6 mt-4 rounded-input border border-danger/30 bg-danger-bg px-3.5 py-2.5 text-[13px] text-danger-ink">
            {error}
          </div>
        )}
        {invitations.isPending && (
          <div className="space-y-3 px-6 py-5">
            <Skeleton />
            <Skeleton className="w-2/3" />
          </div>
        )}
        {invitations.isError && (
          <ErrorState
            message="Could not load invitations."
            onRetry={() => void invitations.refetch()}
          />
        )}
        {invitations.data && all.length === 0 && (
          <p className="px-6 py-5 text-[13px] text-content-secondary">
            No invitations yet — use “Invite user” to add firm staff by email.
          </p>
        )}
        {all.length > 0 && visible.length === 0 && (
          <p className="px-6 py-5 text-[13px] text-content-secondary">
            {filter === "active"
              ? "No active invitations — everything here has been accepted, revoked, or has expired."
              : "No archived invitations."}
          </p>
        )}
        {visible.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-line-divider bg-sidebar font-mono text-[10px] uppercase tracking-[.14em] text-content-secondary">
                  <th className="px-6 py-2.5 font-semibold">Email</th>
                  <th className="px-6 py-2.5 font-semibold">Role</th>
                  <th className="px-6 py-2.5 font-semibold">Status</th>
                  <th className="px-6 py-2.5 font-semibold">Invite email</th>
                  <th className="px-6 py-2.5 font-semibold">Expires</th>
                  <th className="px-6 py-2.5 font-semibold" />
                </tr>
              </thead>
              <tbody className="divide-y divide-line-divider">
                {visible.map((inv) => (
                  <tr key={inv.id} className="text-[13px] transition-colors hover:bg-rowhover">
                    <td className="px-6 py-3 font-mono text-[12px] text-content-secondary">
                      {inv.email}
                    </td>
                    <td className="px-6 py-3">
                      <Chip variant={roleTone(inv.role)}>{inv.role}</Chip>
                    </td>
                    <td className="px-6 py-3">
                      <Chip variant={invitationStatusTone(inv.status)}>{inv.status}</Chip>
                    </td>
                    <td className="px-6 py-3">
                      {inv.emailStatus === "SENT" ? (
                        <Chip variant="success">Sent</Chip>
                      ) : inv.emailStatus === "FAILED" ? (
                        <span title={inv.emailError ?? undefined}>
                          <Chip variant="danger">Email failed</Chip>
                        </span>
                      ) : (
                        <span className="text-content-muted">—</span>
                      )}
                    </td>
                    <td className="px-6 py-3 font-mono text-[12px] text-content-secondary">
                      {inv.expiresAt.slice(0, 10)}
                    </td>
                    <td className="px-6 py-3">
                      {inv.status === "PENDING" && (
                        <div className="flex justify-end gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={busy}
                            onClick={() => resend.mutate(inv.id)}
                          >
                            Resend
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={busy}
                            onClick={() => revoke.mutate(inv.id)}
                          >
                            Revoke
                          </Button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/** Invite a staff member: email + firm role; the accept link is emailed. */
function InviteUserModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [email, setEmail] = useState("");
  const [roleName, setRoleName] = useState<string>("Staff");
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);

  const invite = useMutation({
    mutationFn: () => createFirmInvitation({ email: email.trim(), roleName }),
    onSuccess: (inv) => {
      void qc.invalidateQueries({ queryKey: ["firm-invitations"] });
      if (inv.emailStatus === "FAILED") {
        // The invitation exists; only delivery failed — keep the modal open so
        // the outcome is unmissable, with Resend available in the list below.
        setWarning(
          "The invitation was created, but the email could not be sent" +
            (inv.emailError ? ` (${inv.emailError})` : "") +
            ". Use Resend in the Invitations list once email is working.",
        );
        return;
      }
      onClose();
    },
    onError: (err) =>
      setError(err instanceof ApiError ? err.message : "Could not create the invitation."),
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setWarning(null);
    invite.mutate();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(14,33,44,0.45)] p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Invite user"
        className="w-full max-w-[440px] animate-fade-rise rounded-modal bg-card shadow-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <form onSubmit={submit} className="space-y-4 px-6 py-5">
          <h2 className="font-serif text-[19px] font-medium text-navy">Invite user</h2>
          <p className="text-[12.5px] text-content-secondary">
            They&apos;ll receive an email with a link to set their name and password.
            The link expires in 7 days.
          </p>
          <label className="block">
            <span className="text-[13px] font-semibold text-content">Email</span>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="staff@example.com"
              className="input mt-1.5"
            />
          </label>
          <label className="block">
            <span className="text-[13px] font-semibold text-content">Role</span>
            <select
              value={roleName}
              onChange={(e) => setRoleName(e.target.value)}
              className="input mt-1.5"
            >
              {FIRM_ROLES.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </label>
          {error && (
            <div className="rounded-input border border-danger/30 bg-danger-bg px-3.5 py-2.5 text-[13px] text-danger-ink">
              {error}
            </div>
          )}
          {warning && (
            <div className="rounded-input border border-gold/40 bg-warn-bg-2 px-3.5 py-2.5 text-[13px] text-content">
              {warning}
            </div>
          )}
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="ghost" type="button" onClick={onClose}>
              {warning ? "Close" : "Cancel"}
            </Button>
            <Button type="submit" variant="primary" disabled={invite.isPending || !!warning}>
              {invite.isPending ? "Sending…" : "Send invitation"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
