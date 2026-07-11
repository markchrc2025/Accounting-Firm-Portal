import { Navigate, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { McrcMark } from "./McrcMark";
import { cn } from "./ui";

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

const OVERVIEW_NAV: NavItem[] = [{ to: "/", label: "Dashboard", end: true }];

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
}

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
  const { user, loading, signOut, hasPermission } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const activeClientId = activeClientIdFromPath(location.pathname);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-paper text-[13.5px] text-content-secondary">
        Loading…
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace />;

  function handleSignOut() {
    signOut();
    navigate("/login", { replace: true });
  }

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
          <NavGroup label="Overview" items={OVERVIEW_NAV} />

          {activeClientId && (
            <NavGroup
              label="Client Workspace"
              items={[
                { to: `/clients/${activeClientId}`, label: "Client Overview", end: true },
                { to: `/clients/${activeClientId}/sales`, label: "Sales & Income" },
                { to: `/clients/${activeClientId}/expenses`, label: "Expenses" },
                { to: `/clients/${activeClientId}/tax`, label: "Tax Estimate" },
                { to: `/clients/${activeClientId}/tax-rules`, label: "Tax Rules" },
                { to: `/clients/${activeClientId}/billing`, label: "Billing & Invoices" },
                { to: `/clients/${activeClientId}/filings`, label: "BIR Filings" },
              ]}
            />
          )}

          {hasPermission("Users:Read") && (
            <NavGroup
              label="Firm Admin"
              items={[
                { to: "/users", label: "Users & Roles", end: true },
                { to: "/services", label: "Services", end: true },
                { to: "/integrations", label: "Integrations", end: true },
              ]}
            />
          )}
        </div>

        {/* Signed-in user card */}
        <div className="border-t border-line-strong p-3">
          <div className="flex items-center gap-2.5 rounded-btn px-2 py-2">
            <span className="flex h-8 w-8 flex-none items-center justify-center rounded-full bg-navy font-mono text-[11px] font-semibold text-gold-soft">
              {initials(user.fullName)}
            </span>
            <div className="min-w-0 flex-1">
              <div className="truncate text-[13px] font-semibold text-navy">{user.fullName}</div>
              <div className="truncate text-[11.5px] text-content-secondary">
                {user.userType === "FIRM" ? "Firm staff" : "Client portal"}
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={handleSignOut}
            className="mt-1 w-full rounded-btn px-2 py-1.5 text-left text-[12.5px] font-semibold text-content-secondary transition-colors hover:bg-rowhover hover:text-navy"
          >
            Sign out
          </button>
        </div>
      </aside>

      {/* Main column */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-[60px] flex-none items-center gap-4 border-b border-line-strong bg-topbar px-9">
          <div className="flex-1">
            <input
              type="search"
              aria-label="Search"
              placeholder="Search clients, transactions, filings…"
              className="w-full max-w-[420px] rounded-input bg-paper px-3.5 py-2 text-[13px] text-content placeholder:text-content-placeholder focus-visible:bg-card focus-visible:outline-none"
            />
          </div>
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-navy font-mono text-[11px] font-semibold text-gold-soft">
            {initials(user.fullName)}
          </span>
        </header>

        <main className="flex-1 animate-fade-rise overflow-auto bg-paper px-9 py-[30px]">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
