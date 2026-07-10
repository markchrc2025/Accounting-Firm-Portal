import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type {
  RequestWithIntegration,
  RequestWithUser,
} from "../auth/auth-user";
import { PERMISSIONS_KEY } from "../decorators/require-permissions.decorator";
import { SCOPES_KEY } from "../decorators/require-scopes.decorator";

/**
 * Authorizes INTEGRATION (OAuth2 client-credentials) callers and partitions the
 * two auth worlds. Runs alongside PermissionsGuard (which governs user callers):
 *
 *  - Integration caller:
 *      · route has @RequireScopes → all listed scopes must be granted, else 403.
 *      · route has NO @RequireScopes → 403 (machine tokens may only reach
 *        scope-enabled endpoints, never plain user endpoints).
 *  - User / anonymous caller:
 *      · no @RequireScopes → pass (user authz handled by PermissionsGuard).
 *      · @RequireScopes present → allowed ONLY if the route also carries
 *        @RequirePermissions (a dual user+machine endpoint); otherwise 403
 *        (scope-only endpoints are for machines).
 */
@Injectable()
export class ScopesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required =
      this.reflector.getAllAndOverride<string[]>(SCOPES_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) ?? [];
    const request = context
      .switchToHttp()
      .getRequest<RequestWithUser & RequestWithIntegration>();

    if (request.integration) {
      if (required.length === 0) {
        throw new ForbiddenException(
          "Integration tokens may only call integration endpoints.",
        );
      }
      const granted = new Set(request.integration.scopes);
      const missing = required.filter((s) => !granted.has(s));
      if (missing.length > 0) {
        throw new ForbiddenException(`Missing scope(s): ${missing.join(", ")}`);
      }
      return true;
    }

    // User / anonymous caller.
    if (required.length === 0) return true;
    const hasPermissions =
      (this.reflector.getAllAndOverride<string[]>(PERMISSIONS_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) ?? []).length > 0;
    if (request.user && hasPermissions) return true; // dual endpoint; PermissionsGuard governs
    throw new ForbiddenException("This endpoint requires an integration token.");
  }
}
