import { useQuery } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { useAuth } from "../auth/AuthContext";
import { fetchPortalContext, fetchPortalUsers } from "../lib/api";
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Chip,
  type ChipVariant,
  cn,
  EmptyState,
  ErrorState,
  PageHeader,
  Skeleton,
} from "../components/ui";

/** Up-to-two-letter initials from a full name (guards empty input). */
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "";
  return (first + last).toUpperCase() || "?";
}

/** Role → chip tone: Owner→gold, Manager→info, else neutral. */
function roleTone(role: string): ChipVariant {
  const r = role.toLowerCase();
  if (r.includes("owner")) return "gold";
  if (r.includes("manager")) return "info";
  return "neutral";
}

/** Status → chip tone: Active→success, else neutral. */
function statusTone(status: string): ChipVariant {
  return status.trim().toLowerCase() === "active" ? "success" : "neutral";
}

export default function PortalUsersPage() {
  const { user } = useAuth();
  const [notice, setNotice] = useState<string | null>(null);

  const ctxQ = useQuery({
    queryKey: ["portal-context"],
    queryFn: fetchPortalContext,
  });
  const usersQ = useQuery({
    queryKey: ["portal-users"],
    queryFn: fetchPortalUsers,
  });

  // --- Business-context guards (needed for the header + seat limit) ----------
  if (ctxQ.isError) {
    return (
      <div className="animate-fade-rise">
        <Card>
          <ErrorState
            message="Could not load your business details."
            onRetry={() => void ctxQ.refetch()}
          />
        </Card>
      </div>
    );
  }
  if (ctxQ.isPending || !ctxQ.data) {
    return (
      <div className="animate-fade-rise space-y-6">
        <Skeleton className="h-8 w-64" />
        <Card>
          <div className="px-6 py-5">
            <Skeleton className="h-6 w-full" />
          </div>
        </Card>
      </div>
    );
  }

  const ctx = ctxQ.data;
  const users = usersQ.data ?? [];

  // Seat meter: at least 3 seats; used = number of portal users.
  const seats = Math.max(3, ctx.seatLimit ?? 3);
  const used = users.length;
  const pct = Math.min(100, Math.round((used / seats) * 100));

  return (
    <div className="animate-fade-rise">
      <PageHeader
        title="Users & Seats"
        eyebrow="SETTINGS"
        description={ctx.businessName}
      />

      {/* Seat meter */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Seats</CardTitle>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                setNotice(
                  "We'll reach out about adding seats — this is coming soon.",
                )
              }
            >
              Request more seats
            </Button>
            <Button
              size="sm"
              onClick={() =>
                setNotice("Inviting users from the portal is coming soon.")
              }
            >
              Invite
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-baseline justify-between gap-4">
            <span className="text-[13.5px] text-content-secondary">
              <span className="font-mono font-semibold text-navy">{used}</span>{" "}
              of{" "}
              <span className="font-mono font-semibold text-navy">{seats}</span>{" "}
              seats used
            </span>
            <span className="font-mono text-[11px] uppercase tracking-[.14em] text-content-tertiary">
              {pct}%
            </span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-chip bg-line">
            <div
              className="h-full rounded-chip bg-navy transition-[width]"
              style={{ width: `${pct}%` }}
            />
          </div>
          {notice ? (
            <p className="text-[12.5px] text-content-secondary">{notice}</p>
          ) : null}
        </CardContent>
      </Card>

      {/* Users table */}
      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-line-divider bg-sidebar font-mono text-[10px] uppercase tracking-[.14em] text-content-secondary">
                <Th>User</Th>
                <Th>Email</Th>
                <Th>Role</Th>
                <Th>Status</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line-divider">
              {usersQ.isPending &&
                Array.from({ length: 3 }).map((_, i) => (
                  <tr key={i} className="text-[13px]">
                    <Td>
                      <Skeleton className="w-40" />
                    </Td>
                    <Td>
                      <Skeleton className="w-52" />
                    </Td>
                    <Td>
                      <Skeleton className="w-16" />
                    </Td>
                    <Td>
                      <Skeleton className="w-16" />
                    </Td>
                  </tr>
                ))}

              {usersQ.isError && (
                <tr>
                  <td colSpan={4}>
                    <ErrorState
                      message="Could not load your users."
                      onRetry={() => void usersQ.refetch()}
                    />
                  </td>
                </tr>
              )}

              {usersQ.isSuccess && users.length === 0 && (
                <tr>
                  <td colSpan={4}>
                    <EmptyState
                      title="No users yet"
                      description="People with portal access to your business will appear here."
                    />
                  </td>
                </tr>
              )}

              {usersQ.isSuccess &&
                users.map((u) => {
                  const isYou = !!user && u.email === user.email;
                  return (
                    <tr
                      key={u.id}
                      className="text-[13px] transition-colors hover:bg-rowhover"
                    >
                      <Td>
                        <div className="flex items-center gap-3">
                          <span className="flex h-9 w-9 flex-none items-center justify-center rounded-full bg-navy font-mono text-[12px] font-semibold text-gold-soft">
                            {initials(u.fullName)}
                          </span>
                          <span className="font-medium text-content">
                            {u.fullName}
                            {isYou ? (
                              <span className="ml-2 font-mono text-[10px] uppercase tracking-[.14em] text-content-muted">
                                You
                              </span>
                            ) : null}
                          </span>
                        </div>
                      </Td>
                      <Td className="font-mono text-[12px] text-content-secondary">
                        {u.email}
                      </Td>
                      <Td>
                        <Chip variant={roleTone(u.role)}>{u.role}</Chip>
                      </Td>
                      <Td>
                        <Chip variant={statusTone(u.status)}>{u.status}</Chip>
                      </Td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Role legend */}
      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Roles</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-3">
          <RoleNote
            role="Owner"
            variant="gold"
            description="Full access to your business — sees estimates and filed forms, and manages users and seats."
          />
          <RoleNote
            role="Manager"
            variant="info"
            description="Works day-to-day across estimates and filed forms, but does not manage users or seats."
          />
          <RoleNote
            role="Viewer"
            variant="neutral"
            description="Read-only access to your estimates and filed BIR forms."
          />
        </CardContent>
      </Card>
    </div>
  );
}

function RoleNote({
  role,
  variant,
  description,
}: {
  role: string;
  variant: ChipVariant;
  description: string;
}) {
  return (
    <div>
      <Chip variant={variant}>{role}</Chip>
      <p className="mt-2 text-[12.5px] leading-relaxed text-content-secondary">
        {description}
      </p>
    </div>
  );
}

function Th({
  children,
  className = "",
}: {
  children?: ReactNode;
  className?: string;
}) {
  return <th className={cn("px-4 py-2.5 font-semibold", className)}>{children}</th>;
}

function Td({
  children,
  className = "",
}: {
  children?: ReactNode;
  className?: string;
}) {
  return <td className={cn("px-4 py-3", className)}>{children}</td>;
}
