/**
 * The RBAC permission catalog and default role definitions (system-design §4).
 * Permissions are granular `resource:action` pairs; roles are named bundles.
 * These seed the data-driven `permissions` / `roles` tables — the guard reads
 * from the database, this file only bootstraps and documents the catalog.
 */

export type RoleScope = "FIRM" | "CLIENT";

/** A single permission as a "Resource:Action" string. */
export function perm(resource: string, action: string): string {
  return `${resource}:${action}`;
}

/**
 * Firm-wide "see every client in the firm" capability. A firm user holding this
 * globally bypasses the per-client assignment check; without it, a firm user
 * can only reach clients they are assigned to (FirmClientAssignment).
 */
export const CLIENTS_VIEW_ALL = "Clients:ViewAll";

// Full firm permission set (resource → actions).
const FIRM_PERMISSIONS: Record<string, string[]> = {
  Users: ["Create", "Read", "Update", "Delete"],
  Roles: ["Read", "Assign", "Configure"],
  Clients: ["Create", "Read", "Update", "Delete", "ViewAll"],
  Categories: ["Create", "Read", "Update", "Delete"],
  Sales: ["Create", "Read", "Update", "Delete", "Import", "Export"],
  Expenses: ["Create", "Read", "Update", "Delete", "Import", "Export"],
  TaxComputation: ["Read", "Run"],
  TaxRules: ["Read", "Configure"],
  Billing: ["Create", "Read", "Send"],
  EmailTemplates: ["Read", "Configure"],
  Invitations: ["Create", "Read", "Revoke"],
  Reports: ["Read", "Export"],
  BIRFiling: ["Read"],
  InputTaxAsset: ["Read"],
  IntegrationClient: ["Create", "Read", "Update", "Delete"],
  AuditLogs: ["Read"],
};

const CLIENT_PERMISSIONS: Record<string, string[]> = {
  ClientUsers: ["Create", "Read", "Update", "Delete"],
  Categories: ["Read"], // client users may select categories, never delete them
  Sales: ["Create", "Read", "Update", "Export"],
  Expenses: ["Create", "Read", "Update", "Export"],
  TaxComputation: ["Read"],
  Reports: ["Read", "Export"],
  BIRFiling: ["Read"],
};

/** Flattened catalog of every permission across both scopes (deduplicated). */
export function allPermissions(): { resource: string; action: string }[] {
  const seen = new Set<string>();
  const out: { resource: string; action: string }[] = [];
  for (const map of [FIRM_PERMISSIONS, CLIENT_PERMISSIONS]) {
    for (const [resource, actions] of Object.entries(map)) {
      for (const action of actions) {
        const key = perm(resource, action);
        if (!seen.has(key)) {
          seen.add(key);
          out.push({ resource, action });
        }
      }
    }
  }
  return out;
}

function expand(map: Record<string, string[]>, resources: string[]): string[] {
  return resources.flatMap((r) => (map[r] ?? []).map((a) => perm(r, a)));
}

function allOf(map: Record<string, string[]>): string[] {
  return Object.keys(map).flatMap((r) => map[r]!.map((a) => perm(r, a)));
}

export interface RoleDefinition {
  name: string;
  scope: RoleScope;
  permissions: string[];
}

/**
 * Default roles seeded on bootstrap. Firm-side roles other than Super Admin do
 * NOT get `Clients:ViewAll` — they operate on assigned clients only.
 */
export const DEFAULT_ROLES: RoleDefinition[] = [
  {
    name: "Super Admin",
    scope: "FIRM",
    permissions: allOf(FIRM_PERMISSIONS), // includes Clients:ViewAll
  },
  {
    name: "Manager",
    scope: "FIRM",
    permissions: [
      ...expand(FIRM_PERMISSIONS, [
        "Clients",
        "Categories",
        "Sales",
        "Expenses",
        "TaxComputation",
        "Billing",
        "Invitations",
        "Reports",
        "BIRFiling",
        "InputTaxAsset",
        "AuditLogs",
      ]).filter((p) => p !== CLIENTS_VIEW_ALL),
    ],
  },
  {
    name: "Accountant",
    scope: "FIRM",
    permissions: expand(FIRM_PERMISSIONS, [
      "Categories",
      "Sales",
      "Expenses",
      "TaxComputation",
      "TaxRules",
      "Billing",
      "Invitations",
      "Reports",
      "BIRFiling",
      "InputTaxAsset",
    ])
      .concat(perm("Clients", "Read"))
      .filter((p) => p !== CLIENTS_VIEW_ALL),
  },
  {
    name: "Staff",
    scope: "FIRM",
    permissions: [
      perm("Clients", "Read"),
      perm("Categories", "Read"),
      perm("Sales", "Create"),
      perm("Sales", "Read"),
      perm("Sales", "Import"),
      perm("Sales", "Export"),
      perm("Expenses", "Create"),
      perm("Expenses", "Read"),
      perm("Expenses", "Import"),
      perm("Expenses", "Export"),
    ],
  },
  {
    name: "Auditor",
    scope: "FIRM",
    permissions: [
      perm("Clients", "Read"),
      perm("Categories", "Read"),
      perm("Sales", "Read"),
      perm("Expenses", "Read"),
      perm("TaxComputation", "Read"),
      perm("Reports", "Read"),
      perm("BIRFiling", "Read"),
      perm("AuditLogs", "Read"),
    ],
  },
  {
    name: "Client Owner",
    scope: "CLIENT",
    permissions: allOf(CLIENT_PERMISSIONS),
  },
  {
    name: "Client Manager",
    scope: "CLIENT",
    permissions: [
      perm("Categories", "Read"),
      perm("Sales", "Read"),
      perm("Sales", "Export"),
      perm("Expenses", "Read"),
      perm("Expenses", "Export"),
      perm("TaxComputation", "Read"),
      perm("Reports", "Read"),
      perm("Reports", "Export"),
      perm("BIRFiling", "Read"),
    ],
  },
  {
    name: "Client Viewer",
    scope: "CLIENT",
    permissions: [
      perm("Categories", "Read"),
      perm("Sales", "Read"),
      perm("Expenses", "Read"),
      perm("TaxComputation", "Read"),
      perm("Reports", "Read"),
      perm("BIRFiling", "Read"),
    ],
  },
];
