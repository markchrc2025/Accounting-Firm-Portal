import {
  BadRequestException,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { ApiConsumes, ApiTags } from "@nestjs/swagger";
import type { Response } from "express";
import type { AuthUser } from "../../common/auth/auth-user";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { FirmUserGuard } from "../../common/guards/firm-user.guard";
import { RequirePermissions } from "../../common/decorators/require-permissions.decorator";
import { ZodValidationPipe } from "../../common/validation/zod-validation.pipe";
import { MAX_UPLOAD_BYTES, XLSX_MIME } from "./expense-import.constants";
import { ExpenseImportService, type UploadedWorkbook } from "./expense-import.service";
import {
  ImportQuery,
  ImportQuerySchema,
  TemplateQuery,
  TemplateQuerySchema,
} from "./dto/expense-import.schemas";

/**
 * Expenses import v2 (U6). Lives at /purchase-transactions (no :clientId route
 * param — the client comes as a query parameter per the contract with Track B),
 * so per-client assignment scope is enforced inside the service.
 *
 * Firm-only (U6-A1, R3): importing and posting are the firm's actions. Client-
 * portal principals are refused at the controller by FirmUserGuard (the same
 * guard the FS Creator and the files module use) and again inside the service,
 * so a caller that bypasses the HTTP layer gets the same answer.
 */
@ApiTags("purchase-transactions")
@Controller("purchase-transactions")
@UseGuards(FirmUserGuard)
export class ExpenseImportController {
  constructor(private readonly imports: ExpenseImportService) {}

  /** The .xlsx template for one client. */
  @Get("import/template")
  @RequirePermissions("Expenses:Create")
  async template(
    @CurrentUser() user: AuthUser,
    @Query(new ZodValidationPipe(TemplateQuerySchema)) query: TemplateQuery,
    @Res() res: Response,
  ): Promise<void> {
    const { buffer, filename } = await this.imports.template(user, query.clientId);
    res
      .status(200)
      .set({
        "Content-Type": XLSX_MIME,
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Content-Length": String(buffer.length),
      })
      .send(buffer);
  }

  /** Validate (dryRun=true) or import (dryRun=false) an uploaded workbook. */
  @Post("import")
  @RequirePermissions("Expenses:Create")
  @ApiConsumes("multipart/form-data")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 } }))
  import(
    @CurrentUser() user: AuthUser,
    @Query(new ZodValidationPipe(ImportQuerySchema)) query: ImportQuery,
    @UploadedFile() file?: UploadedWorkbook,
  ) {
    if (!file?.buffer) {
      throw new BadRequestException('Attach the workbook as the multipart field "file".');
    }
    return this.imports.importFile(user, query.clientId, file, query.dryRun);
  }

  /** Post a held record. */
  @Post(":id/post")
  @RequirePermissions("Expenses:Create")
  post(@CurrentUser() user: AuthUser, @Param("id", ParseUUIDPipe) id: string) {
    return this.imports.postHeld(user, id);
  }
}
