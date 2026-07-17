import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from "@nestjs/common";
import type { RequestWithUser } from "../auth/auth-user";

/**
 * Restricts a controller/route to FIRM staff accounts. Client-portal tokens
 * carry the managing firm's firmId (their visibility is scoped per client), so
 * firm-internal resources that are only firmId-scoped — e.g. the Financial
 * Statement Creator — must also reject CLIENT principals outright. Runs after
 * the global JwtAuthGuard, which populates req.user.
 */
@Injectable()
export class FirmUserGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<RequestWithUser>();
    if (req.user?.userType !== "FIRM") {
      throw new ForbiddenException("This resource is available to firm staff only.");
    }
    return true;
  }
}
