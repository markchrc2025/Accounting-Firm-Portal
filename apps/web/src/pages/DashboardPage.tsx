import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { fetchClients, fetchUsers } from "../lib/api";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  ChipVariant,
  EmptyState,
  ErrorState,
  PageHeader,
  RegimeChip,
  Skeleton,
  StatusChip,
} from "../components/ui";

/** Map a client status string to a chip tone. */
function statusTone(status?: string | null): ChipVariant {
  const s = (status ?? "").toUpperCase();
  if (s.includes("ACTIVE")) return "success";
  if (s.includes("ONBOARD") || s.includes("PENDING")) return "warn";
  if (s.includes("INACTIVE")) return "neutral";
  return "neutral";
}

/** Two-letter initials from a business/person name. */
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "—";
  if (parts.length === 1) return (parts[0] ?? "").slice(0, 2).toUpperCase();
  return `${(parts[0] ?? "").charAt(0)}${(parts[parts.length - 1] ?? "").charAt(0)}`.toUpperCase();
}

export default function DashboardPage() {
  const { user, permissions, hasPermission } = useAuth();
  const canReadClients = hasPermission("Clients:Read");
  const canCreateClient = hasPermission("Clients:Create");
  const canReadUsers = hasPermission("Users:Read");

  const clients = useQuery({
    queryKey: ["clients"],
    queryFn: fetchClients,
    enabled: canReadClients,
  });
  const users = useQuery({
    queryKey: ["users"],
    queryFn: fetchUsers,
    enabled: canReadUsers,
  });

  const globalCount = permissions?.global.length ?? 0;
  const accessSummary = permissions?.canViewAllClients
    ? "Firm-wide client visibility"
    : `${permissions?.assignedClientIds.length ?? 0} assigned client(s)`;

  return (
    <div className="animate-fade-rise">
      <PageHeader
        title="Dashboard"
        eyebrow={`PORTFOLIO · ${user?.fullName ?? ""}`}
        description={accessSummary}
        actions={
          canCreateClient ? (
            <Link
              to="/clients/new"
              className="inline-flex items-center rounded-btn bg-navy px-4 py-[10px] text-[13.5px] font-semibold text-white transition-colors hover:bg-navy-hover"
            >
              + Add client
            </Link>
          ) : null
        }
      />

      <div className="grid gap-6 md:grid-cols-2">
        {/* Your access */}
        <Card>
          <CardHeader>
            <CardTitle>Your access</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-[13.5px] text-content-secondary">{accessSummary}</p>
            <p className="text-[13.5px] text-content">
              <span className="font-serif text-[24px] font-medium text-navy">{globalCount}</span>{" "}
              <span className="text-content-secondary">global permission(s)</span>
            </p>
            <details className="group mt-1">
              <summary className="cursor-pointer select-none text-[12px] font-medium text-blue hover:text-navy-hover">
                Show permissions
              </summary>
              <ul className="mt-3 max-h-40 space-y-1 overflow-auto font-mono text-[11px] text-content-secondary">
                {permissions?.global.map((p) => (
                  <li key={p} className="border-b border-line-divider pb-1">
                    {p}
                  </li>
                ))}
              </ul>
            </details>
          </CardContent>
        </Card>

        {/* Firm users */}
        {canReadUsers && (
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
              {users.isError && <ErrorState message="Could not load users." />}
              {users.data && (
                <ul className="divide-y divide-line-divider">
                  {users.data.map((u) => (
                    <li
                      key={u.id}
                      className="flex items-center justify-between gap-3 px-6 py-3 text-[13px] transition-colors hover:bg-rowhover"
                    >
                      <span className="font-medium text-content">{u.fullName}</span>
                      <span className="text-content-secondary">
                        {u.userRoles.map((r) => r.role.name).join(", ") || "no role"}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        )}

        {/* Clients */}
        {canReadClients && (
          <Card className="md:col-span-2">
            <CardHeader>
              <CardTitle>Clients</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {clients.isPending && (
                <div className="space-y-3 px-6 py-5">
                  <Skeleton />
                  <Skeleton />
                  <Skeleton className="w-2/3" />
                </div>
              )}
              {clients.isError && <ErrorState message="Could not load clients." />}
              {clients.data && clients.data.length === 0 && (
                <EmptyState
                  title="No clients yet"
                  description="Add your first client to start tracking sales, expenses, and tax estimates."
                />
              )}
              {clients.data && clients.data.length > 0 && (
                <div className="overflow-x-auto">
                  <table className="w-full text-left">
                    <thead>
                      <tr className="border-b border-line-divider bg-sidebar font-mono text-[10px] uppercase tracking-[.14em] text-content-secondary">
                        <th className="px-6 py-2.5 font-semibold">Business</th>
                        <th className="px-6 py-2.5 font-semibold">TIN</th>
                        <th className="px-6 py-2.5 font-semibold">Regime</th>
                        <th className="px-6 py-2.5 font-semibold">Status</th>
                        <th className="px-6 py-2.5 font-semibold text-right">&nbsp;</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-line-divider">
                      {clients.data.map((c) => (
                        <tr key={c.id} className="text-[13px] transition-colors hover:bg-rowhover">
                          <td className="px-6 py-3">
                            <div className="flex items-center gap-3">
                              <span className="flex h-8 w-8 flex-none items-center justify-center rounded-full bg-navy font-mono text-[11px] font-semibold text-gold-soft">
                                {initials(c.businessName)}
                              </span>
                              <span className="font-medium text-content">{c.businessName}</span>
                            </div>
                          </td>
                          <td className="px-6 py-3 font-mono text-[12px] text-content-secondary">
                            {c.tin ?? "—"}
                          </td>
                          <td className="px-6 py-3">
                            <RegimeChip regime={c.taxType} />
                          </td>
                          <td className="px-6 py-3">
                            {c.status ? (
                              <StatusChip label={c.status} variant={statusTone(c.status)} />
                            ) : (
                              <span className="text-content-muted">—</span>
                            )}
                          </td>
                          <td className="px-6 py-3 text-right">
                            <Link
                              to={`/clients/${c.id}`}
                              className="font-semibold text-blue underline-offset-2 hover:text-navy-hover hover:underline"
                            >
                              Open
                            </Link>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
