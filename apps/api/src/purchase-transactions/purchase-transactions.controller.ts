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

  /**
   * U19 (D59): `GET …/purchase-transactions/payee-details?tin=123-456-789` — the latest
   * saved payee details for that TIN, for prefilling an expense. 200 { found: false } or
   * { found: true, tin, branch, payeeKind, registeredName, lastName, firstName,
   * middleName, vendor }. 400 if the TIN is not 9 digits. Expenses:Read.
   */
  @Get("payee-details")
  @RequirePermissions("Expenses:Read")
  payeeDetails(
    @CurrentUser() user: AuthUser,
    @Param("clientId") clientId: string,
    @Query("tin") tin?: string,
  ) {
    return this.purchases.payeeDetails(user, clientId, tin);
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
