import { NavLink } from "react-router-dom";
import { cn } from "./ui";

/**
 * Horizontal workspace tab bar shown on every client-scoped screen (Overview,
 * Sales, Expenses, Tax, Filings). Active tab draws the gold underline from the
 * design. `clientId` scopes the destinations.
 */
export function ClientWorkspaceTabs({ clientId }: { clientId: string }) {
  const tabs: { to: string; label: string; end?: boolean }[] = [
    { to: `/clients/${clientId}`, label: "Overview", end: true },
    { to: `/clients/${clientId}/sales`, label: "Sales & Income" },
    { to: `/clients/${clientId}/expenses`, label: "Expenses" },
    { to: `/clients/${clientId}/tax`, label: "Tax Estimate" },
    { to: `/clients/${clientId}/tax-rules`, label: "Tax Rules" },
    { to: `/clients/${clientId}/billing`, label: "Billing" },
    { to: `/clients/${clientId}/filings`, label: "BIR Filings" },
  ];
  return (
    <div className="mb-6 flex items-center gap-1 border-b border-line-strong">
      {tabs.map((t) => (
        <NavLink
          key={t.to}
          to={t.to}
          end={t.end}
          className={({ isActive }) =>
            cn(
              "-mb-px border-b-[2.5px] px-3.5 py-2.5 text-[13.5px] font-medium transition-colors",
              isActive
                ? "border-gold font-bold text-navy"
                : "border-transparent text-content-secondary hover:text-navy",
            )
          }
        >
          {t.label}
        </NavLink>
      ))}
    </div>
  );
}
