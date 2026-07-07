import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import type { AuthUser } from "../common/auth/auth-user";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { RequirePermissions } from "../common/decorators/require-permissions.decorator";
import { ZodValidationPipe } from "../common/validation/zod-validation.pipe";
import {
  IncomeListQuery,
  IncomeListQuerySchema,
  IncomeSummaryQuery,
  IncomeSummaryQuerySchema,
} from "./dto/income-query.schemas";
import { IncomeTransactionsService } from "./income-transactions.service";

@ApiTags("income-transactions")
@Controller("clients/:clientId/income-transactions")
export class IncomeTransactionsController {
  constructor(private readonly income: IncomeTransactionsService) {}

  @Post()
  @RequirePermissions("Sales:Create")
  create(
    @CurrentUser() user: AuthUser,
    @Param("clientId") clientId: string,
    @Body() body: unknown,
  ) {
    return this.income.create(user, clientId, body);
  }

  @Get()
  @RequirePermissions("Sales:Read")
  list(
    @CurrentUser() user: AuthUser,
    @Param("clientId") clientId: string,
    @Query(new ZodValidationPipe(IncomeListQuerySchema)) query: IncomeListQuery,
  ) {
    return this.income.list(user, clientId, query);
  }

  @Get("summary")
  @RequirePermissions("Sales:Read")
  summary(
    @CurrentUser() user: AuthUser,
    @Param("clientId") clientId: string,
    @Query(new ZodValidationPipe(IncomeSummaryQuerySchema)) query: IncomeSummaryQuery,
  ) {
    return this.income.summary(user, clientId, query);
  }

  @Get(":txnId")
  @RequirePermissions("Sales:Read")
  get(
    @CurrentUser() user: AuthUser,
    @Param("clientId") clientId: string,
    @Param("txnId") txnId: string,
  ) {
    return this.income.get(user, clientId, txnId);
  }

  @Patch(":txnId")
  @RequirePermissions("Sales:Update")
  update(
    @CurrentUser() user: AuthUser,
    @Param("clientId") clientId: string,
    @Param("txnId") txnId: string,
    @Body() body: unknown,
  ) {
    return this.income.update(user, clientId, txnId, body);
  }

  @Delete(":txnId")
  @RequirePermissions("Sales:Delete")
  remove(
    @CurrentUser() user: AuthUser,
    @Param("clientId") clientId: string,
    @Param("txnId") txnId: string,
  ) {
    return this.income.remove(user, clientId, txnId);
  }
}
