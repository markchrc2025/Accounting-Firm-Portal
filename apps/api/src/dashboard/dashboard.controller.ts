import { Controller, Get } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import type { AuthUser } from "../common/auth/auth-user";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { RequirePermissions } from "../common/decorators/require-permissions.decorator";
import { DashboardService } from "./dashboard.service";

/**
 * Firm-wide dashboard aggregation (KPIs, income-vs-expense trend, recent
 * activity, upcoming filings, regime mix). Scoped to the caller's firm; gated by
 * `Clients:Read` (every firm role that can see clients can see the overview).
 */
@ApiTags("dashboard")
@Controller("dashboard")
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get()
  @RequirePermissions("Clients:Read")
  overview(@CurrentUser() user: AuthUser) {
    return this.dashboard.firmOverview(user.firmId);
  }
}
