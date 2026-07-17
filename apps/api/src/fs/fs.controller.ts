import { Body, Controller, Delete, Get, Param, Patch, Post, Put } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import type { AuthUser } from "../common/auth/auth-user";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { RequirePermissions } from "../common/decorators/require-permissions.decorator";
import { ZodValidationPipe } from "../common/validation/zod-validation.pipe";
import { FsService } from "./fs.service";
import {
  AddCustomNoteInput,
  AddCustomNoteSchema,
  CreateAdjustmentInput,
  CreateAdjustmentSchema,
  CreateReportInput,
  CreateReportSchema,
  SetPeriodsInput,
  SetPeriodsSchema,
  SetPolicyNoteInput,
  SetPolicyNoteSchema,
  SetTrialBalanceInput,
  SetTrialBalanceSchema,
  UpdateCustomNoteInput,
  UpdateCustomNoteSchema,
  UpdateReportInput,
  UpdateReportSchema,
} from "./dto/fs.schemas";

/**
 * Financial Statement Creator (standalone). Reads are open to any authenticated
 * firm user; every write requires FinancialStatements:Manage. Trial-balance and
 * adjustment codes are validated against the live Chart of Accounts server-side.
 */
@ApiTags("financial-statements")
@Controller("fs")
export class FsController {
  constructor(private readonly fs: FsService) {}

  @Get("reports")
  list(@CurrentUser() user: AuthUser) {
    return this.fs.listReports(user);
  }

  @Get("reports/:id")
  get(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.fs.getReport(user, id);
  }

  @Get("reports/:id/trial-balance")
  trialBalance(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.fs.getTrialBalance(user, id);
  }

  @Get("reports/:id/adjustments")
  adjustments(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.fs.listAdjustments(user, id);
  }

  @Get("reports/:id/statements")
  statements(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.fs.getStatements(user, id);
  }

  @Get("reports/:id/notes")
  notes(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.fs.getNotes(user, id);
  }

  @Put("reports/:id/notes/policy/:blockKey")
  @RequirePermissions("FinancialStatements:Manage")
  setPolicyNote(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Param("blockKey") blockKey: string,
    @Body(new ZodValidationPipe(SetPolicyNoteSchema)) body: SetPolicyNoteInput,
  ) {
    return this.fs.setPolicyNote(user, id, blockKey, body);
  }

  @Delete("reports/:id/notes/policy/:blockKey")
  @RequirePermissions("FinancialStatements:Manage")
  resetPolicyNote(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Param("blockKey") blockKey: string,
  ) {
    return this.fs.resetPolicyNote(user, id, blockKey);
  }

  @Post("reports/:id/notes/custom")
  @RequirePermissions("FinancialStatements:Manage")
  addCustomNote(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(AddCustomNoteSchema)) body: AddCustomNoteInput,
  ) {
    return this.fs.addCustomNote(user, id, body);
  }

  @Patch("reports/:id/notes/custom/:noteId")
  @RequirePermissions("FinancialStatements:Manage")
  updateCustomNote(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Param("noteId") noteId: string,
    @Body(new ZodValidationPipe(UpdateCustomNoteSchema)) body: UpdateCustomNoteInput,
  ) {
    return this.fs.updateCustomNote(user, id, noteId, body);
  }

  @Delete("reports/:id/notes/custom/:noteId")
  @RequirePermissions("FinancialStatements:Manage")
  deleteCustomNote(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Param("noteId") noteId: string,
  ) {
    return this.fs.deleteCustomNote(user, id, noteId);
  }

  @Post("reports")
  @RequirePermissions("FinancialStatements:Manage")
  create(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(CreateReportSchema)) body: CreateReportInput,
  ) {
    return this.fs.createReport(user, body);
  }

  @Patch("reports/:id")
  @RequirePermissions("FinancialStatements:Manage")
  update(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(UpdateReportSchema)) body: UpdateReportInput,
  ) {
    return this.fs.updateReport(user, id, body);
  }

  @Delete("reports/:id")
  @RequirePermissions("FinancialStatements:Manage")
  remove(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.fs.deleteReport(user, id);
  }

  @Put("reports/:id/periods")
  @RequirePermissions("FinancialStatements:Manage")
  setPeriods(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(SetPeriodsSchema)) body: SetPeriodsInput,
  ) {
    return this.fs.setPeriods(user, id, body);
  }

  @Put("reports/:id/periods/:periodId/trial-balance")
  @RequirePermissions("FinancialStatements:Manage")
  setTrialBalance(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Param("periodId") periodId: string,
    @Body(new ZodValidationPipe(SetTrialBalanceSchema)) body: SetTrialBalanceInput,
  ) {
    return this.fs.setTrialBalance(user, id, periodId, body);
  }

  @Post("reports/:id/adjustments")
  @RequirePermissions("FinancialStatements:Manage")
  createAdjustment(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(CreateAdjustmentSchema)) body: CreateAdjustmentInput,
  ) {
    return this.fs.createAdjustment(user, id, body);
  }

  @Delete("reports/:id/adjustments/:adjustmentId")
  @RequirePermissions("FinancialStatements:Manage")
  deleteAdjustment(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Param("adjustmentId") adjustmentId: string,
  ) {
    return this.fs.deleteAdjustment(user, id, adjustmentId);
  }
}
