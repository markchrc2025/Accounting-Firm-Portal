// userClients.ts — which clients a firm user sees, as Settings → Users names
// it (W8 R1, D14, D42).

import type { FirmUserSummary } from "./api";

/** The role that sees every client of the firm. */
export const SUPER_ADMIN = "Super Admin";

/** Holds the Super Admin role, firm-wide. */
export function isSuperAdmin(u: Pick<FirmUserSummary, "userRoles">): boolean {
  return u.userRoles.some((r) => r.role.name === SUPER_ADMIN && r.clientScopeId === null);
}

/** A firm user (staff), not a client-portal user. */
export function isFirmUser(u: Pick<FirmUserSummary, "userType">): boolean {
  return (u.userType ?? "FIRM") === "FIRM";
}

/**
 * The Clients column: "All clients" for a Super Admin; for any other firm user
 * "No clients", "1 client" or "N clients" from assignedClientCount; nothing for
 * a portal user (or when the count is not known).
 */
export function clientsLabel(
  u: Pick<FirmUserSummary, "userRoles" | "userType" | "assignedClientCount">,
): string {
  if (!isFirmUser(u)) return "";
  if (isSuperAdmin(u)) return "All clients";
  const n = u.assignedClientCount;
  if (n === undefined || n === null) return "";
  if (n === 0) return "No clients";
  return n === 1 ? "1 client" : `${n} clients`;
}

/** The clients a search shows: by name or TIN, case- and dash-insensitive. */
export function matchesClientSearch(
  c: { businessName: string; tin?: string | null },
  query: string,
): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  if (c.businessName.toLowerCase().includes(q)) return true;
  const digits = q.replace(/\D/g, "");
  return digits.length > 0 && (c.tin ?? "").replace(/\D/g, "").includes(digits);
}
