import { Controller, Get } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import type { AuthUser } from "../common/auth/auth-user";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { RequirePermissions } from "../common/decorators/require-permissions.decorator";
import { RbacService } from "../rbac/rbac.service";
import { DashboardService } from "./dashboard.service";

/**
 * Firm-wide dashboard aggregation (KPIs, income-vs-expense trend, recent
 * activity, upcoming filings, regime mix). Scoped to the caller's firm; gated by
 * `Clients:Read` (every firm role that can see clients can see the overview).
 * U4-A1 (D42): without Clients:ViewAll, every figure covers the caller's visible
 * clients only, and the firm's audit activity is not shown.
 */
@ApiTags("dashboard")
@Controller("dashboard")
export class DashboardController {
  constructor(
    private readonly dashboard: DashboardService,
    private readonly rbac: RbacService,
  ) {}

  @Get()
  @RequirePermissions("Clients:Read")
  async overview(@CurrentUser() user: AuthUser) {
    const visible = await this.rbac.authorizedClients(user, ["Clients:Read"]);
    return this.dashboard.firmOverview(user.firmId, visible);
  }
}
