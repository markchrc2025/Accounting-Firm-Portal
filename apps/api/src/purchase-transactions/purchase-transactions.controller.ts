import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import type { AuthUser } from "../common/auth/auth-user";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { RequirePermissions } from "../common/decorators/require-permissions.decorator";
import { ZodValidationPipe } from "../common/validation/zod-validation.pipe";
import {
  PurchaseListQuery,
  PurchaseListQuerySchema,
  PurchaseSummaryQuery,
  PurchaseSummaryQuerySchema,
} from "./dto/purchase-query.schemas";
import { PurchaseTransactionsService } from "./purchase-transactions.service";

@ApiTags("purchase-transactions")
@Controller("clients/:clientId/purchase-transactions")
export class PurchaseTransactionsController {
  constructor(private readonly purchases: PurchaseTransactionsService) {}

  @Post()
  @RequirePermissions("Expenses:Create")
  create(
    @CurrentUser() user: AuthUser,
    @Param("clientId") clientId: string,
    @Body() body: unknown,
  ) {
    return this.purchases.create(user, clientId, body);
  }

  @Post("import")
  @RequirePermissions("Expenses:Create")
  import(
    @CurrentUser() user: AuthUser,
    @Param("clientId") clientId: string,
    @Body() body: { rows?: unknown[] },
  ) {
    return this.purchases.importRows(user, clientId, Array.isArray(body?.rows) ? body.rows : []);
  }

  @Get()
  @RequirePermissions("Expenses:Read")
  list(
    @CurrentUser() user: AuthUser,
    @Param("clientId") clientId: string,
    @Query(new ZodValidationPipe(PurchaseListQuerySchema)) query: PurchaseListQuery,
  ) {
    return this.purchases.list(user, clientId, query);
  }

  @Get("summary")
  @RequirePermissions("Expenses:Read")
  summary(
    @CurrentUser() user: AuthUser,
    @Param("clientId") clientId: string,
    @Query(new ZodValidationPipe(PurchaseSummaryQuerySchema))
    query: PurchaseSummaryQuery,
  ) {
    return this.purchases.summary(user, clientId, query);
  }

  @Get(":txnId")
  @RequirePermissions("Expenses:Read")
  get(
    @CurrentUser() user: AuthUser,
    @Param("clientId") clientId: string,
    @Param("txnId") txnId: string,
  ) {
    return this.purchases.get(user, clientId, txnId);
  }

  @Patch(":txnId")
  @RequirePermissions("Expenses:Update")
  update(
    @CurrentUser() user: AuthUser,
    @Param("clientId") clientId: string,
    @Param("txnId") txnId: string,
    @Body() body: unknown,
  ) {
    return this.purchases.update(user, clientId, txnId, body);
  }

  @Delete(":txnId")
  @RequirePermissions("Expenses:Delete")
  remove(
    @CurrentUser() user: AuthUser,
    @Param("clientId") clientId: string,
    @Param("txnId") txnId: string,
  ) {
    return this.purchases.remove(user, clientId, txnId);
  }
}
