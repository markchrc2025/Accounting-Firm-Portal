// deadlines.controller.ts — PA8 (D70): GET /api/v1/bir/deadlines?from=YYYY-MM&to=YYYY-MM
import { Controller, Get, Query } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import type { AuthUser } from "../../common/auth/auth-user";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { RequirePermissions } from "../../common/decorators/require-permissions.decorator";
import { BIR_FORMS_PERMISSION } from "../bir-forms.service";
import { BirDeadlinesService } from "./deadlines.service";

@ApiTags("bir")
@Controller("bir")
export class BirDeadlinesController {
  constructor(private readonly deadlines: BirDeadlinesService) {}

  /**
   * Due dates in order, each with its forms, the period each covers and, for each form, the active
   * clients who must file it with their status. Needs BIRForms:Read; only clients the caller may see.
   */
  @Get("deadlines")
  @RequirePermissions(BIR_FORMS_PERMISSION.read)
  list(
    @CurrentUser() user: AuthUser,
    @Query("from") from: unknown,
    @Query("to") to: unknown,
  ) {
    return this.deadlines.deadlines(user, from, to);
  }
}
