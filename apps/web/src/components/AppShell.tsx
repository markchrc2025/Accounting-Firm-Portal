import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Navigate, NavLink, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { fetchClients } from "../lib/api";
import { ClientSwitcher } from "./ClientSwitcher";
import { McrcMark } from "./McrcMark";
import { UserMenu } from "./UserMenu";
import { cn } from "./ui";

const ACTIVE_CLIENT_KEY = "mcrc.activeClientId";

/**
 * Authenticated app shell (design handoff — sidebar variant A light + top bar).
 * Wraps every signed-in route: a fixed cream sidebar (brand + nav + user card)
 * and a 60px top bar over a paper-background scroll area. Also enforces auth —
 * unauthenticated visitors are redirected to /login.
 */

interface NavItem {
  to: string;
  label: string;
  end?: boolean;
}

const OVERVIEW_NAV: NavItem[] = [
  { to: "/", label: "Dashboard", end: true },
  { to: "/clients", label: "Clients", end: true },
];

function NavGroup({ label, items }: { label: string; items: NavItem[] }) {
  return (
    <div className="mb-5">
      <div className="eyebrow mb-2 px-2.5">{label}</div>
      <nav className="space-y-0.5">
        {items.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={({ isActive }) =>
              cn(
                "flex items-center rounded-btn px-2.5 py-2 text-[13.5px] transition-colors",
                isActive
                  ? "border-l-[3px] border-gold bg-warn-bg-2 pl-2 font-bold text-navy"
                  : "text-content-secondary hover:bg-rowhover hover:text-navy",
              )
            }
          >
            {item.label}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}

/** Extract an active client id from a `/clients/:id[/...]` path (excludes "new"). */
function activeClientIdFromPath(pathname: string): string | null {
  const m = pathname.match(/^\/clients\/([^/]+)/);
  if (!m || m[1] === "new") return null;
  return m[1] ?? null;
}

export function AppShell() {
  const { user, loading, hasPermission } = useAuth();
  const location = useLocation();
  const routeClientId = activeClientIdFromPath(location.pathname);
  const isPortal = user?.userType === "CLIENT";

  // Persistent "active client": whichever client you last opened (remembered across
  // pages) so the Client Workspace nav stays visible everywhere, defaulting to your
  // first client. Firm users only.
  const { data: clients } = useQuery({
    queryKey: ["clients"],
    queryFn: fetchClients,
    enabled: !isPortal && !!user,
  });
  const [storedClientId, setStoredClientId] = useState<string | null>(() =>
    typeof window === "undefined" ? null : window.localStorage.getItem(ACTIVE_CLIENT_KEY),
  );
  useEffect(() => {
    if (routeClientId) {
      setStoredClientId(routeClientId);
      window.localStorage.setItem(ACTIVE_CLIENT_KEY, routeClientId);
    }
  }, [routeClientId]);

  // The client the workspace nav points at: current route → last opened → first client.
  const knownIds = new Set((clients ?? []).map((c) => c.id));
  const persisted = storedClientId && knownIds.has(storedClientId) ? storedClientId : null;
  const workspaceClientId = routeClientId ?? persisted ?? clients?.[0]?.id ?? null;
  const activeClientId = routeClientId; // for the top-bar switcher's "selected" highlight

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-paper text-[13.5px] text-content-secondary">
        Loading…
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace />;

  return (
    <div className="flex h-screen overflow-hidden bg-paper">
      {/* Sidebar */}
      <aside className="flex w-[236px] flex-none flex-col border-r border-line-strong bg-sidebar">
        <div className="flex items-center gap-2.5 px-5 py-5">
          <McrcMark variant="light" size={30} />
          <div>
            <div className="font-serif text-[17px] font-medium leading-none text-navy">MCRC</div>
            <div className="mt-1 font-mono text-[8.5px] uppercase tracking-[.24em] text-gold-deep">
              Tax &amp; Accounting
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-3 py-2">
          {isPortal ? (
            <>
              <NavGroup
                label="Your Business"
                items={[
                  { to: "/portal", label: "Home", end: true },
                  { to: "/portal/sales", label: "Sales & Income", end: true },
                  { to: "/portal/expenses", label: "Expenses", end: true },
                  { to: "/portal/tax", label: "Tax Estimate", end: true },
                  { to: "/portal/filings", label: "Filed BIR Forms", end: true },
                ]}
              />
              {hasPermission("ClientUsers:Read") && (
                <NavGroup
                  label="Settings"
                  items={[{ to: "/portal/users", label: "Users & Seats", end: true }]}
                />
              )}
            </>
          ) : (
            <>
              <NavGroup label="Overview" items={OVERVIEW_NAV} />

              {workspaceClientId ? (
                <NavGroup
                  label="Client Workspace"
                  items={[
                    { to: `/clients/${workspaceClientId}`, label: "Client Overview", end: true },
                    { to: `/clients/${workspaceClientId}/sales`, label: "Sales & Income" },
                    { to: `/clients/${workspaceClientId}/expenses`, label: "Expenses" },
                    { to: `/clients/${workspaceClientId}/tax`, label: "Tax Estimate" },
                    { to: `/clients/${workspaceClientId}/tax-rules`, label: "Tax Rules" },
                    { to: `/clients/${workspaceClientId}/billing`, label: "Billing & Invoices" },
                    { to: `/clients/${workspaceClientId}/filings`, label: "BIR Filings" },
                  ]}
                />
              ) : (
                // No clients yet: keep the group visible (so it never reads as a
                // vanished menu) but explain it unlocks once a client exists.
                <div className="mb-5">
                  <div className="eyebrow mb-2 px-2.5">Client Workspace</div>
                  <div className="rounded-btn border border-dashed border-line-strong bg-warn-bg-2/40 px-2.5 py-2.5">
                    <p className="text-[12px] leading-snug text-content-secondary">
                      Sales, expenses, tax &amp; filings open here once you add a client.
                    </p>
                    <NavLink
                      to="/clients/new"
                      className="mt-1.5 inline-flex font-mono text-[11px] font-semibold uppercase tracking-[.12em] text-gold-deep hover:text-navy"
                    >
                      + Add your first client
                    </NavLink>
                  </div>
                </div>
              )}

              <NavGroup
                label="Financial Statements"
                items={[{ to: "/financial-statements", label: "FS Creator", end: false }]}
              />

              {hasPermission("Users:Read") && (
                <NavGroup
                  label="Firm Admin"
                  items={[
                    { to: "/users", label: "Users & Roles", end: true },
                    { to: "/services", label: "Services", end: true },
                    { to: "/chart-of-accounts", label: "Chart of Accounts", end: true },
                    { to: "/integrations", label: "Integrations", end: true },
                    { to: "/audit", label: "Audit Log", end: true },
                  ]}
                />
              )}
            </>
          )}
        </div>
      </aside>

      {/* Main column */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-[60px] flex-none items-center gap-4 border-b border-line-strong bg-topbar px-9">
          {isPortal ? (
            <span className="inline-flex items-center rounded-chip border border-gold px-3 py-1 font-mono text-[10px] font-semibold uppercase tracking-[.18em] text-gold-deep">
              Client Portal
            </span>
          ) : (
            <ClientSwitcher activeClientId={activeClientId} />
          )}
          <div className="flex-1">
            <input
              type="search"
              aria-label="Search"
              placeholder="Search clients, transactions, filings…"
              className="w-full max-w-[360px] rounded-input bg-paper px-3.5 py-2 text-[13px] text-content placeholder:text-content-placeholder focus-visible:bg-card focus-visible:outline-none"
            />
          </div>
          <UserMenu />
        </header>

        <main className="flex-1 animate-fade-rise overflow-auto bg-paper px-9 py-[30px]">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
