import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import type { AuthUser } from "../common/auth/auth-user";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { RequirePermissions } from "../common/decorators/require-permissions.decorator";
import { ZodValidationPipe } from "../common/validation/zod-validation.pipe";
import { CoaService } from "./coa.service";
import {
  CreateAccountInput,
  CreateAccountSchema,
  SetMappingInput,
  SetMappingSchema,
  UpdateAccountInput,
  UpdateAccountSchema,
} from "./dto/coa.schemas";

/**
 * Chart of Accounts. Reads are open to any authenticated user (reference data
 * for pickers); writes require ChartOfAccounts:Manage and re-run the full
 * convention validation, so a bad edit is rejected naming the offending code.
 */
@ApiTags("coa")
@Controller("coa")
export class CoaController {
  constructor(private readonly coa: CoaService) {}

  @Get("accounts")
  accounts(@Query("class") cls?: string, @Query("search") search?: string) {
    return this.coa.listAccounts({ class: cls, search });
  }

  @Get("mappings")
  mappings() {
    return this.coa.listMappings();
  }

  @Post("accounts")
  @RequirePermissions("ChartOfAccounts:Manage")
  createAccount(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(CreateAccountSchema)) body: CreateAccountInput,
  ) {
    return this.coa.createAccount(user, body);
  }

  @Patch("accounts/:code")
  @RequirePermissions("ChartOfAccounts:Manage")
  updateAccount(
    @CurrentUser() user: AuthUser,
    @Param("code") code: string,
    @Body(new ZodValidationPipe(UpdateAccountSchema)) body: UpdateAccountInput,
  ) {
    return this.coa.updateAccount(user, code, body);
  }

  @Post("accounts/:code/archive")
  @RequirePermissions("ChartOfAccounts:Manage")
  archive(@CurrentUser() user: AuthUser, @Param("code") code: string) {
    return this.coa.setArchived(user, code, true);
  }

  @Post("accounts/:code/restore")
  @RequirePermissions("ChartOfAccounts:Manage")
  restore(@CurrentUser() user: AuthUser, @Param("code") code: string) {
    return this.coa.setArchived(user, code, false);
  }

  @Put("mappings/:accountCode")
  @RequirePermissions("ChartOfAccounts:Manage")
  setMapping(
    @CurrentUser() user: AuthUser,
    @Param("accountCode") accountCode: string,
    @Body(new ZodValidationPipe(SetMappingSchema)) body: SetMappingInput,
  ) {
    return this.coa.setMapping(user, accountCode, body.taxReturnLine);
  }

  @Delete("mappings/:accountCode")
  @RequirePermissions("ChartOfAccounts:Manage")
  deleteMapping(@CurrentUser() user: AuthUser, @Param("accountCode") accountCode: string) {
    return this.coa.deleteMapping(user, accountCode);
  }
}
