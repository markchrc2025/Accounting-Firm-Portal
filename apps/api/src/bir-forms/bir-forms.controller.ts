import { Controller, Get, Query } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import type { AuthUser } from "../common/auth/auth-user";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { RequirePermissions } from "../common/decorators/require-permissions.decorator";
import { ZodValidationPipe } from "../common/validation/zod-validation.pipe";
import { ListBirFormsQuery, ListBirFormsQuerySchema } from "./dto/bir-form.schemas";
import { BirFormsService } from "./bir-forms.service";

/**
 * Internal BIR Forms module endpoints. Firm-scoped; every route needs a
 * BIRForms permission (held by Super Admin / Manager / Accountant).
 */
@ApiTags("bir-forms")
@Controller("bir-forms")
export class BirFormsController {
  constructor(private readonly birForms: BirFormsService) {}

  @Get("catalog")
  @RequirePermissions("BIRForms:Read")
  catalog() {
    return this.birForms.catalog();
  }

  @Get()
  @RequirePermissions("BIRForms:Read")
  list(
    @CurrentUser() user: AuthUser,
    @Query(new ZodValidationPipe(ListBirFormsQuerySchema)) query: ListBirFormsQuery,
  ) {
    return this.birForms.list(user, query.clientId);
  }
}
