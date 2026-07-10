import { SetMetadata } from "@nestjs/common";

export const SCOPES_KEY = "requiredScopes";

/**
 * Declares the OAuth2 scopes (e.g. `vat-summary:read`) an INTEGRATION endpoint
 * requires. Marking a route with @RequireScopes makes it callable by a machine
 * (client-credentials) token that holds all listed scopes. ScopesGuard also
 * blocks user tokens from scope-only endpoints; a route may carry BOTH
 * @RequirePermissions and @RequireScopes to serve users and machines.
 */
export const RequireScopes = (...scopes: string[]) =>
  SetMetadata(SCOPES_KEY, scopes);
