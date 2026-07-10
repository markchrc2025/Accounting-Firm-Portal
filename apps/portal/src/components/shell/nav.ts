/**
 * Sidebar navigation structure (labels + routes) for both audiences.
 *
 * Visibility policy lives in `@/session` (`isNavVisible`), keyed by the same
 * `NavId`s used here — this file is presentation only. The `to` builder receives
 * the active client id because "Client Overview" targets the current client's
 * detail route.
 */
import type { NavId } from "@/session";

export interface NavItemDef {
  id: NavId;
  label: string;
  /** Build the destination path (client id needed for the client-scoped item). */
  to: (activeClientId: string) => string;
  /** Match the route exactly (list vs. nested detail) — react-router `NavLink` `end`. */
  end?: boolean;
}

export interface NavGroupDef {
  label: string;
  items: NavItemDef[];
}

const s = (path: string) => () => path;

/** Firm-staff navigation: Overview · Client Workspace · Firm Admin. */
export const FIRM_NAV: readonly NavGroupDef[] = [
  {
    label: "Overview",
    items: [
      { id: "dashboard", label: "Dashboard", to: s("/"), end: true },
      { id: "clients", label: "Clients", to: s("/clients"), end: true },
    ],
  },
  {
    label: "Client Workspace",
    items: [
      { id: "client", label: "Client Overview", to: (id) => `/clients/${id}` },
      { id: "sales", label: "Sales & Income", to: s("/sales") },
      { id: "expenses", label: "Expenses", to: s("/expenses") },
      { id: "tax", label: "Tax Computation", to: s("/tax") },
      { id: "taxRules", label: "Tax Rules", to: s("/tax-rules") },
      { id: "billing", label: "Billing & Invoices", to: s("/billing") },
      { id: "filings", label: "BIR Filings", to: s("/filings") },
    ],
  },
  {
    label: "Firm Admin",
    items: [
      { id: "users", label: "Users & Roles", to: s("/admin/users") },
      { id: "services", label: "Services", to: s("/admin/services") },
      { id: "integrations", label: "Integrations", to: s("/admin/integrations") },
      { id: "audit", label: "Audit Log", to: s("/admin/audit") },
    ],
  },
];

/** Client-portal navigation: Your Business · Settings. */
export const PORTAL_NAV: readonly NavGroupDef[] = [
  {
    label: "Your Business",
    items: [
      { id: "pHome", label: "Home", to: s("/portal"), end: true },
      { id: "pSales", label: "Sales & Income", to: s("/portal/sales") },
      { id: "pExpenses", label: "Expenses", to: s("/portal/expenses") },
      { id: "pTax", label: "Tax Estimate", to: s("/portal/tax") },
      { id: "pFilings", label: "Filed BIR Forms", to: s("/portal/filings") },
    ],
  },
  {
    label: "Settings",
    items: [{ id: "pUsers", label: "Users & Seats", to: s("/portal/users") }],
  },
];
