import { NavLink } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { cn } from "./ui";

/**
 * Tab bar for the consolidated Settings area (Users & Roles, Documents,
 * Integrations, Audit Log, Email & Senders) — the sidebar keeps a single
 * "Settings" entry instead of five Firm Admin items. Tabs are permission-
 * gated the same way the old sidebar entries were.
 */
export function SettingsTabs() {
  const { hasPermission } = useAuth();
  const canAdmin = hasPermission("Users:Read");
  const canDocs = hasPermission("Clients:Read");

  const tabs: { to: string; label: string }[] = [
    ...(canAdmin ? [{ to: "/settings/users", label: "Users & Roles" }] : []),
    ...(canDocs ? [{ to: "/settings/documents", label: "Documents" }] : []),
    ...(canAdmin
      ? [
          { to: "/settings/integrations", label: "Integrations" },
          { to: "/settings/audit", label: "Audit Log" },
          { to: "/settings/email", label: "Email & Senders" },
        ]
      : []),
  ];

  return (
    <div className="mb-6 flex items-center gap-1 overflow-x-auto border-b border-line-strong">
      {tabs.map((t) => (
        <NavLink
          key={t.to}
          to={t.to}
          className={({ isActive }) =>
            cn(
              "-mb-px whitespace-nowrap border-b-[2.5px] px-3.5 py-2.5 text-[13.5px] font-medium transition-colors",
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
