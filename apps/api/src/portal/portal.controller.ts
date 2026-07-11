import { Controller, Get } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import type { AuthUser } from "../common/auth/auth-user";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { PortalService } from "./portal.service";

/**
 * Client Portal endpoints. Reachable by ANY authenticated user (no
 * @RequirePermissions): each route returns only the caller's own org, so
 * isolation is inherent. Firm users (no `clientId`) get a 404.
 */
@ApiTags("portal")
@Controller("portal")
export class PortalController {
  constructor(private readonly portal: PortalService) {}

  @Get("context")
  context(@CurrentUser() user: AuthUser) {
    return this.portal.getContext(user);
  }

  @Get("users")
  users(@CurrentUser() user: AuthUser) {
    return this.portal.listUsers(user);
  }
}
