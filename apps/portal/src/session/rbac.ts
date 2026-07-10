/**
 * RBAC policy for the MCRC portal.
 *
 * Two independent concerns live here:
 *  1. `can(role, capability)` — the firm-staff permission matrix from screen 17
 *     (README "Roles & permissions matrix"), encoded once as data.
 *  2. `NAV_VISIBILITY` — which sidebar items a role may see. This is coarser than
 *     the capability matrix by design: per the README, the whole **Firm Admin**
 *     group is Super-Admin-only in the nav, even though (e.g.) an Auditor can
 *     technically view the audit log at the capability level.
 *
 * The presentation layer (shell/nav.ts) supplies labels + routes keyed by the same
 * `NavId`s; this module owns only the policy.
 */
import type { FirmRole, PortalRole } from "@/mock";

/** Firm-staff roles, in matrix-column order (Super Admin → Auditor). */
export const FIRM_ROLES: readonly FirmRole[] = [
  "Super Admin",
  "Manager",
  "Accountant",
  "Bookkeeper",
  "Auditor",
] as const;

/** Client-portal roles, most- to least-privileged. */
export const PORTAL_ROLES: readonly PortalRole[] = [
  "Owner",
  "Manager",
  "Viewer",
] as const;

/** Firm-staff capabilities gated by the permission matrix. */
export type Capability =
  | "manageUsersRoles"
  | "createEditClients"
  | "enterEditTransactions"
  | "approveImports"
  | "configureTaxRules"
  | "sendInvoices"
  | "viewAuditLog"
  | "manageIntegrations";

/**
 * The screen-17 matrix, transcribed from the prototype (`permRows`). Each entry
 * lists the firm roles that hold the capability. Order/values are the frozen intent —
 * do not edit without updating the Users & RBAC screen.
 */
export const CAPABILITY_MATRIX: Record<Capability, readonly FirmRole[]> = {
  manageUsersRoles: ["Super Admin"],
  createEditClients: ["Super Admin", "Manager"],
  enterEditTransactions: ["Super Admin", "Manager", "Accountant", "Bookkeeper"],
  approveImports: ["Super Admin", "Manager", "Accountant"],
  configureTaxRules: ["Super Admin", "Manager", "Accountant"],
  sendInvoices: ["Super Admin", "Manager", "Accountant"],
  viewAuditLog: ["Super Admin", "Manager", "Auditor"],
  manageIntegrations: ["Super Admin"],
};

/** Human labels for the matrix rows, in display order (Users & RBAC screen). */
export const CAPABILITY_ROWS: readonly { capability: Capability; label: string }[] = [
  { capability: "manageUsersRoles", label: "Manage firm users & roles" },
  { capability: "createEditClients", label: "Create / edit clients" },
  { capability: "enterEditTransactions", label: "Enter & edit transactions" },
  { capability: "approveImports", label: "Approve imports" },
  { capability: "configureTaxRules", label: "Configure tax rules" },
  { capability: "sendInvoices", label: "Send invoices" },
  { capability: "viewAuditLog", label: "View audit log" },
  { capability: "manageIntegrations", label: "Manage integrations" },
];

/** Does `role` hold `capability`? The single source of truth for firm RBAC checks. */
export function can(role: FirmRole, capability: Capability): boolean {
  return CAPABILITY_MATRIX[capability].includes(role);
}

/* ------------------------------------------------------------------------------------- *
 * Nav visibility
 * ------------------------------------------------------------------------------------- */

/** Stable ids for every sidebar destination (firm + portal). */
export type NavId =
  // firm
  | "dashboard"
  | "clients"
  | "client"
  | "sales"
  | "expenses"
  | "tax"
  | "taxRules"
  | "billing"
  | "filings"
  | "users"
  | "services"
  | "integrations"
  | "audit"
  // portal
  | "pHome"
  | "pSales"
  | "pExpenses"
  | "pTax"
  | "pFilings"
  | "pUsers";

/** The role context a visibility rule is evaluated against. */
export interface NavVisibilityContext {
  firmRole: FirmRole;
  portalRole: PortalRole;
}

const isSuperAdmin = (ctx: NavVisibilityContext): boolean =>
  ctx.firmRole === "Super Admin";
const isOwner = (ctx: NavVisibilityContext): boolean =>
  ctx.portalRole === "Owner";

/**
 * Per-item visibility predicates. Any `NavId` absent from this map is always visible.
 * The Firm Admin group (users/services/integrations/audit) is Super-Admin-only; the
 * portal "Users & Seats" item is Owner-only.
 */
export const NAV_VISIBILITY: Partial<Record<NavId, (ctx: NavVisibilityContext) => boolean>> = {
  users: isSuperAdmin,
  services: isSuperAdmin,
  integrations: isSuperAdmin,
  audit: isSuperAdmin,
  pUsers: isOwner,
};

/** Whether a nav item is visible for the given role context. */
export function isNavVisible(id: NavId, ctx: NavVisibilityContext): boolean {
  const rule = NAV_VISIBILITY[id];
  return rule ? rule(ctx) : true;
}
