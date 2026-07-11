import { Body, Controller, Get, Param, Put } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import type { AuthUser } from "../common/auth/auth-user";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { RequirePermissions } from "../common/decorators/require-permissions.decorator";
import { ZodValidationPipe } from "../common/validation/zod-validation.pipe";
import { TaxRuleInput, TaxRuleSchema } from "./dto/tax-rule.schemas";
import { TaxRulesService } from "./tax-rules.service";

@ApiTags("tax-rules")
@Controller("clients/:clientId/tax-rules")
export class TaxRulesController {
  constructor(private readonly taxRules: TaxRulesService) {}

  @Get()
  @RequirePermissions("TaxRules:Read")
  get(@CurrentUser() user: AuthUser, @Param("clientId") clientId: string) {
    return this.taxRules.get(user, clientId);
  }

  @Put()
  @RequirePermissions("TaxRules:Configure")
  upsert(
    @CurrentUser() user: AuthUser,
    @Param("clientId") clientId: string,
    @Body(new ZodValidationPipe(TaxRuleSchema)) body: TaxRuleInput,
  ) {
    return this.taxRules.upsert(user, clientId, body);
  }
}
