import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { RbacService } from "../../rbac/rbac.service";
import type { RequestWithUser } from "../auth/auth-user";
import { PERMISSIONS_KEY } from "../decorators/require-permissions.decorator";

/**
 * Enforces @RequirePermissions. Runs after JwtAuthGuard, so `request.user` is
 * present. If the route carries a `:clientId` param, authorization is scoped to
 * that client (assigned-clients / own-organization rules live in RbacService).
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly rbac: RbacService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<string[]>(PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) return true;

    const request = context.switchToHttp().getRequest<RequestWithUser>();
    const user = request.user;
    if (!user) throw new ForbiddenException("Not authenticated");

    const clientId = request.params?.clientId;
    const allowed = await this.rbac.authorize(user, required, clientId);
    if (!allowed) {
      throw new ForbiddenException(
        `Missing permission(s): ${required.join(", ")}${
          clientId ? ` for client ${clientId}` : ""
        }`,
      );
    }
    return true;
  }
}
