import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ApiError,
  createFirmInvitation,
  fetchFirmInvitations,
  fetchUsers,
  resendFirmInvitation,
  revokeFirmInvitation,
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
  EmptyState,
  ErrorState,
  PageHeader,
  Skeleton,
} from "../components/ui";
import { SettingsTabs } from "../components/SettingsTabs";

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
  const { hasPermission } = useAuth();
  const canInvite = hasPermission("Users:Create");
  const users = useQuery({ queryKey: ["users"], queryFn: () => fetchUsers() });
  const [inviteOpen, setInviteOpen] = useState(false);

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

        {canInvite && <InvitationsCard />}

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

      {inviteOpen && <InviteUserModal onClose={() => setInviteOpen(false)} />}
    </div>
  );
}

/* ------------------------------------------------------------ Invitations */

function invitationStatusTone(status: FirmInvitation["status"]): ChipVariant {
  if (status === "PENDING") return "info";
  if (status === "ACCEPTED") return "success";
  return "neutral";
}

/** Pending firm-staff invitations with email-delivery state and actions. */
function InvitationsCard() {
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const invitations = useQuery({
    queryKey: ["firm-invitations"],
    queryFn: () => fetchFirmInvitations(),
  });

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
      <CardHeader>
        <CardTitle>Invitations</CardTitle>
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
        {invitations.data && invitations.data.length === 0 && (
          <p className="px-6 py-5 text-[13px] text-content-secondary">
            No invitations yet — use “Invite user” to add firm staff by email.
          </p>
        )}
        {invitations.data && invitations.data.length > 0 && (
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
                {invitations.data.map((inv) => (
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
