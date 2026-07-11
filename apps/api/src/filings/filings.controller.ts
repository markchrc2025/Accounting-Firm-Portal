import { Controller, Get, Param } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import type { AuthUser } from "../common/auth/auth-user";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { RequirePermissions } from "../common/decorators/require-permissions.decorator";
import { BirFilingsService } from "../integration/bir-filings.service";

/**
 * Firm-user-facing read surface for stored BIR filings. The parallel integration
 * route (GET clients/:clientId/bir-filings) is machine-to-machine only (scope-gated
 * by ScopesGuard). This route serves the firm web UI (user JWT): it is gated by
 * RBAC (BIRFiling:Read) and per-client authorization via the :clientId param
 * (PermissionsGuard), and reuses BirFilingsService.listFilings — metadata only,
 * no XML payload.
 */
@ApiTags("filings")
@Controller("clients/:clientId/filings")
export class FilingsController {
  constructor(private readonly filings: BirFilingsService) {}

  @Get()
  @RequirePermissions("BIRFiling:Read")
  list(@CurrentUser() user: AuthUser, @Param("clientId") clientId: string) {
    return this.filings.listFilings(user.firmId, clientId);
  }
}
