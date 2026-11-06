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
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { ApiConsumes, ApiTags } from "@nestjs/swagger";
import type { Response } from "express";
import type { AuthUser } from "../common/auth/auth-user";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { RequirePermissions } from "../common/decorators/require-permissions.decorator";
import { FirmUserGuard } from "../common/guards/firm-user.guard";
import { ZodValidationPipe } from "../common/validation/zod-validation.pipe";
import {
  BookFiguresQuery,
  BookFiguresQuerySchema,
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
import { UPLOAD_CEILING_BYTES } from "../bir-confirmation/confirmation-forms";
import {
  BIR_FORMS_PERMISSION,
  BirFormsService,
  type UploadedPdf,
} from "./bir-forms.service";
import { BookFiguresService } from "./book-figures/book-figures.service";

/**
 * Internal BIR Forms module endpoints. Firm-scoped; reads need BIRForms:Read,
 * writes BIRForms:Create/Update, and generating the fileable XML BIRForms:File.
 * A filed form is sealed (U3): PATCH answers 409; a return is corrected by
 * POST :id/amend (BIRForms:Create, 201), a certificate by issuing a new one.
 */
@ApiTags("bir-forms")
@Controller("bir-forms")
export class BirFormsController {
  constructor(
    private readonly birForms: BirFormsService,
    private readonly bookFigures: BookFiguresService,
  ) {}

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

  /**
   * U15 (D54): the figures the client's posted records give a 2551Q or 2550Q, in the
   * draft's own data keys. Firm staff assigned to the client; nothing is saved.
   * Declared before ":id" so "book-figures" is never read as a form id.
   */
  @Get("book-figures")
  @UseGuards(FirmUserGuard)
  @RequirePermissions(BIR_FORMS_PERMISSION.read)
  bookFiguresFor(
    @CurrentUser() user: AuthUser,
    @Query(new ZodValidationPipe(BookFiguresQuerySchema)) query: BookFiguresQuery,
  ) {
    return this.bookFigures.figures(user, query);
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

  /**
   * U18 (D58): check an uploaded BIR confirmation e-mail (a Gmail print saved as PDF)
   * against this return, with NO side effects. Multipart field "file". 200 with
   * { ok, checks: [{ n, id, status: "ok"|"error"|"warning"|"skipped", message }], errors,
   * warnings, parsed, filedOn, sha256 }; a wrong confirmation is still 200 with ok false.
   * 400: no file, or a form with no confirmation (1601C, 2307, 2316). BIRForms:File.
   */
  @Post(":id/confirmation/check")
  @HttpCode(200)
  @RequirePermissions(BIR_FORMS_PERMISSION.file)
  @ApiConsumes("multipart/form-data")
  @UseInterceptors(
    FileInterceptor("file", { limits: { fileSize: UPLOAD_CEILING_BYTES, files: 1 } }),
  )
  confirmationCheck(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @UploadedFile() file?: UploadedPdf,
  ) {
    return this.birForms.confirmationCheck(user, id, file);
  }

  /**
   * U18 (D58): Mark as filed, for the nine returns that have a BIR confirmation. Multipart:
   * the PDF in "file", OR "overrideReason" (a Super Admin, at least 10 characters) in
   * place of it. The filed date becomes the date the BIR received the return. 200 with the
   * return (status "filed", `confirmation`). 409: a check failed (body: { message, ok,
   * checks, errors, warnings, parsed, filedOn }), or the return is already filed.
   * PATCH :id with status "filed" answers 409 for these forms. BIRForms:File.
   */
  @Post(":id/mark-filed")
  @HttpCode(200)
  @RequirePermissions(BIR_FORMS_PERMISSION.file)
  @ApiConsumes("multipart/form-data")
  @UseInterceptors(
    FileInterceptor("file", { limits: { fileSize: UPLOAD_CEILING_BYTES, files: 1 } }),
  )
  markFiled(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Body() body: { overrideReason?: unknown } | undefined,
    @UploadedFile() file?: UploadedPdf,
  ) {
    return this.birForms.markFiled(user, id, {
      file,
      overrideReason: asText(body?.overrideReason),
    });
  }

  /**
   * U18 (D58): attach the confirmation (or an override) to a return ALREADY filed; the
   * filed date and snapshot are untouched. Once only: a second attach is 409; "replace"
   * ("true") is a Super Admin's and keeps the old row, superseded. 200 with the return.
   */
  @Post(":id/confirmation")
  @HttpCode(200)
  @RequirePermissions(BIR_FORMS_PERMISSION.file)
  @ApiConsumes("multipart/form-data")
  @UseInterceptors(
    FileInterceptor("file", { limits: { fileSize: UPLOAD_CEILING_BYTES, files: 1 } }),
  )
  attachConfirmation(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Body() body: { overrideReason?: unknown; replace?: unknown } | undefined,
    @UploadedFile() file?: UploadedPdf,
  ) {
    return this.birForms.attachConfirmation(user, id, {
      file,
      overrideReason: asText(body?.overrideReason),
      replace: String(body?.replace ?? "").toLowerCase() === "true",
    });
  }

  /** U18 (D58): { url } — a signed link to the kept PDF (404 if there is none). BIRForms:Read. */
  @Get(":id/confirmation/url")
  @RequirePermissions(BIR_FORMS_PERMISSION.read)
  confirmationUrl(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.birForms.confirmationUrl(user, id);
  }

  /**
   * U19 (D59): the 1601-EQ alphalist as the BIR's QAP .DAT file (text/plain, an
   * attachment named <agent TIN 9><branch 4><MMYYYY>1601EQ.DAT). Same permissions as
   * Preview PDF. For a filed return the rows stored at filing; for a draft the client's
   * posted expense records. 409: not a 1601-EQ ("The alphalist file is only made for the
   * 1601-EQ."), a filed return with no stored rows, or any rule the BIR Validation
   * program would fail (body: { message: the first, refusals: all }).
   */
  @Get(":id/alphalist")
  @RequirePermissions(BIR_FORMS_PERMISSION.read)
  async alphalist(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { text, fileName } = await this.birForms.alphalistFile(user, id);
    res.set({
      "Content-Type": "text/plain",
      "Content-Disposition": attachment(fileName),
      "Cache-Control": "no-store",
    });
    return new StreamableFile(Buffer.from(text, "ascii"));
  }

  /**
   * U19 (D59): the alphalist check, with no file. 200 { ok, source: "books"|"stored"|"none",
   * fileName, refusals[], notes[], schedule1: { rows, income, tax }, schedule2: { rows,
   * income }, returnTotal (the return's Item 19) }. Usable on a draft before filing.
   */
  @Get(":id/alphalist/check")
  @RequirePermissions(BIR_FORMS_PERMISSION.read)
  alphalistCheck(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.birForms.alphalistCheck(user, id);
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

/** A multipart text field as a string; undefined when it was not sent. */
function asText(v: unknown): string | undefined {
  return v === undefined || v === null ? undefined : String(v);
}
