import { Controller, Get, Param, Query } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import type { AuthUser } from "../common/auth/auth-user";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { RequirePermissions } from "../common/decorators/require-permissions.decorator";
import { ZodValidationPipe } from "../common/validation/zod-validation.pipe";
import { TaxEstimateQuery, TaxEstimateQuerySchema } from "./dto/tax-estimate.schemas";
import { TaxEstimateService } from "./tax-estimate.service";

@ApiTags("tax-estimate")
@Controller("clients/:clientId/tax-estimate")
export class TaxEstimateController {
  constructor(private readonly estimates: TaxEstimateService) {}

  /**
   * U10 R1: the management tax estimate for a year (to date) or a quarter.
   * Firm and client roles both hold TaxComputation:Read; the guard confines a
   * client principal to its own client and a firm user to its assigned clients.
   */
  @Get()
  @RequirePermissions("TaxComputation:Read")
  get(
    @CurrentUser() user: AuthUser,
    @Param("clientId") clientId: string,
    @Query(new ZodValidationPipe(TaxEstimateQuerySchema)) query: TaxEstimateQuery,
  ) {
    return this.estimates.estimate(user, clientId, query);
  }
}
