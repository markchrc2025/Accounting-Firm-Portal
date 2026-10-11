import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Res,
  StreamableFile,
} from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import type { Response } from "express";
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
import { attachment } from "../storage/storage.service";
import { BIR_FORMS_PERMISSION, BirFormsService } from "./bir-forms.service";

/**
 * Internal BIR Forms module endpoints. Firm-scoped; reads need BIRForms:Read,
 * writes BIRForms:Create/Update, and generating the fileable XML BIRForms:File.
 * A filed form is sealed (U3): PATCH answers 409; a return is corrected by
 * POST :id/amend (BIRForms:Create, 201), a certificate by issuing a new one.
 */
@ApiTags("bir-forms")
@Controller("bir-forms")
export class BirFormsController {
  constructor(private readonly birForms: BirFormsService) {}

  @Get("catalog")
  @RequirePermissions(BIR_FORMS_PERMISSION.read)
  catalog() {
    return this.birForms.catalog();
  }

  @Post("compute")
  @RequirePermissions(BIR_FORMS_PERMISSION.read)
  compute(@Body(new ZodValidationPipe(ComputeBirFormSchema)) body: ComputeBirFormInput) {
    return this.birForms.computePreview(body.form, body.data);
  }

  @Get()
  @RequirePermissions(BIR_FORMS_PERMISSION.read)
  list(
    @CurrentUser() user: AuthUser,
    @Query(new ZodValidationPipe(ListBirFormsQuerySchema)) query: ListBirFormsQuery,
  ) {
    return this.birForms.list(user, query.clientId, query.status);
  }

  /** Filed forms + their authoritative key figures (for the client tax view). */
  @Get("filed")
  @RequirePermissions(BIR_FORMS_PERMISSION.read)
  filed(
    @CurrentUser() user: AuthUser,
    @Query(new ZodValidationPipe(ListBirFormsQuerySchema)) query: ListBirFormsQuery,
  ) {
    return this.birForms.listFiled(user, query.clientId);
  }

  @Post()
  @RequirePermissions(BIR_FORMS_PERMISSION.create)
  create(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(CreateBirFormSchema)) body: CreateBirFormInput,
  ) {
    return this.birForms.create(user, body);
  }

  @Get(":id")
  @RequirePermissions(BIR_FORMS_PERMISSION.read)
  getOne(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.birForms.getOne(user, id);
  }

  @Patch(":id")
  @RequirePermissions(BIR_FORMS_PERMISSION.update)
  update(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(UpdateBirFormSchema)) body: UpdateBirFormInput,
  ) {
    return this.birForms.update(user, id, body);
  }

  /**
   * U14 (D51): delete a draft return, an amendment draft included. 200
   * { deleted: true, id }. BIRForms:Create, with the same firm and client checks as
   * GET :id. A filed return answers 409.
   */
  @Delete(":id")
  @RequirePermissions(BIR_FORMS_PERMISSION.create)
  remove(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.birForms.remove(user, id);
  }

  /**
   * U3: open a new draft that amends a filed return (D11). Returns
   * { id, status: "draft", sequence, amendsId } with Nest's default 201 for a POST.
   * A certificate (2307, 2316) or an unfiled form answers 400.
   */
  @Post(":id/amend")
  @RequirePermissions(BIR_FORMS_PERMISSION.create)
  amend(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.birForms.amend(user, id);
  }

  @Post(":id/export")
  @RequirePermissions(BIR_FORMS_PERMISSION.file)
  export(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.birForms.exportForm(user, id);
  }

  /**
   * U13 R1 (D50): the client's clear copy — the eBIRForms export printed on the
   * BIR's own blank form. Same permission and checks as :id/export. 201 with
   * { id, kind: "pdf", filename, createdAt }; download through :id/exports/:exportId/url.
   * 409: a draft, a form with no print map yet, or a field the engine cannot print.
   */
  @Post(":id/clear-copy")
  @RequirePermissions(BIR_FORMS_PERMISSION.file)
  clearCopy(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.birForms.clearCopy(user, id);
  }

  /**
   * C3 R2 (D52): "Preview PDF" — a draft return printed on the BIR's own blank
   * form, stamped "DRAFT — NOT FILED". BIRForms:Read, with the same firm and client
   * checks as GET :id. 200 with the PDF itself, an attachment named like the XML
   * with "-DRAFT.pdf". Never stored. 409: a filed return, a form with no print map
   * yet, or a field the builder or the engine refuses (its own words).
   */
  @Post(":id/preview-pdf")
  @HttpCode(200)
  @RequirePermissions(BIR_FORMS_PERMISSION.read)
  async previewPdf(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { pdf, filename } = await this.birForms.previewPdf(user, id);
    res.set({
      "Content-Type": "application/pdf",
      "Content-Disposition": attachment(filename),
      "Cache-Control": "no-store",
    });
    return new StreamableFile(Buffer.from(pdf));
  }

  @Get(":id/exports/:exportId/url")
  @RequirePermissions(BIR_FORMS_PERMISSION.read)
  exportUrl(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Param("exportId") exportId: string,
  ) {
    return this.birForms.exportUrl(user, id, exportId);
  }
}
