import { SetMetadata } from "@nestjs/common";

export const PERMISSIONS_KEY = "requiredPermissions";

/**
 * Declares the permissions (as `resource:action`, e.g. `Users:Create`) a route
 * requires. All listed permissions must be held (AND). PermissionsGuard also
 * enforces per-client scoping when the route carries a `:clientId` param.
 */
export const RequirePermissions = (...permissions: string[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);
