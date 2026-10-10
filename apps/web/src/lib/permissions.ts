// permissions.ts — may the signed-in user do this to THIS client? (W7 R5)
//
// The server answers per client: a permission held globally, or held on that
// client's scope (rbac.service canActOnClient). `hasPermission` answers "on any
// client", which offers a control the server would refuse on this one.

import type { PermissionsView } from "./api";

/** The permission is held globally, or on `clientId`'s own scope. */
export function permittedFor(
  view: PermissionsView | null | undefined,
  permission: string,
  clientId: string | null | undefined,
): boolean {
  if (!view) return false;
  if (view.global.includes(permission)) return true;
  if (!clientId) return false;
  return view.clients.some(
    (c) => c.clientId === clientId && c.permissions.includes(permission),
  );
}
