import { Body, Controller, Get, Param, Patch, Post, Query } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import type { AuthUser } from "../common/auth/auth-user";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { RequirePermissions } from "../common/decorators/require-permissions.decorator";
import { ZodValidationPipe } from "../common/validation/zod-validation.pipe";
import {
  ComputeBirFormInput,
  ComputeBirFormSchema,
  CreateBirFormInput,
  CreateBirFormSchema,
  ListBirFormsQuery,
  ListBirFormsQuerySchema,
  UpdateBirFormInput,
  UpdateBirFormSchema,
} from "./dto/bir-form.schemas";
import { BirFormsService } from "./bir-forms.service";

/**
 * Internal BIR Forms module endpoints. Firm-scoped; reads need BIRForms:Read,
 * writes BIRForms:Create/Update, and generating the fileable XML BIRForms:File.
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

  @Post("compute")
  @RequirePermissions("BIRForms:Read")
  compute(@Body(new ZodValidationPipe(ComputeBirFormSchema)) body: ComputeBirFormInput) {
    return this.birForms.computePreview(body.form, body.data);
  }

  @Get()
  @RequirePermissions("BIRForms:Read")
  list(
    @CurrentUser() user: AuthUser,
    @Query(new ZodValidationPipe(ListBirFormsQuerySchema)) query: ListBirFormsQuery,
  ) {
    return this.birForms.list(user, query.clientId, query.status);
  }

  /** Filed forms + their authoritative key figures (for the client tax view). */
  @Get("filed")
  @RequirePermissions("BIRForms:Read")
  filed(
    @CurrentUser() user: AuthUser,
    @Query(new ZodValidationPipe(ListBirFormsQuerySchema)) query: ListBirFormsQuery,
  ) {
    return this.birForms.listFiled(user, query.clientId);
  }

  @Post()
  @RequirePermissions("BIRForms:Create")
  create(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(CreateBirFormSchema)) body: CreateBirFormInput,
  ) {
    return this.birForms.create(user, body);
  }

  @Get(":id")
  @RequirePermissions("BIRForms:Read")
  getOne(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.birForms.getOne(user, id);
  }

  @Patch(":id")
  @RequirePermissions("BIRForms:Update")
  update(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(UpdateBirFormSchema)) body: UpdateBirFormInput,
  ) {
    return this.birForms.update(user, id, body);
  }

  @Post(":id/export")
  @RequirePermissions("BIRForms:File")
  export(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.birForms.exportForm(user, id);
  }

  @Get(":id/exports/:exportId/url")
  @RequirePermissions("BIRForms:Read")
  exportUrl(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Param("exportId") exportId: string,
  ) {
    return this.birForms.exportUrl(user, id, exportId);
  }
}
