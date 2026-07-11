import { Body, Controller, Get, Param, Patch, Post, Query } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import type { AuthUser } from "../common/auth/auth-user";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { RequirePermissions } from "../common/decorators/require-permissions.decorator";
import { ZodValidationPipe } from "../common/validation/zod-validation.pipe";
import {
  CreateInvoiceInput,
  CreateInvoiceSchema,
  ListInvoicesQuery,
  ListInvoicesQuerySchema,
  UpdateInvoiceInput,
  UpdateInvoiceSchema,
} from "./dto/invoice.schemas";
import { InvoicesService } from "./invoices.service";

@ApiTags("invoices")
@Controller("invoices")
export class InvoicesController {
  constructor(private readonly invoices: InvoicesService) {}

  @Get()
  @RequirePermissions("Billing:Read")
  list(
    @CurrentUser() user: AuthUser,
    @Query(new ZodValidationPipe(ListInvoicesQuerySchema)) query: ListInvoicesQuery,
  ) {
    return this.invoices.list(user, query.clientId);
  }

  @Post()
  @RequirePermissions("Billing:Create")
  create(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(CreateInvoiceSchema)) body: CreateInvoiceInput,
  ) {
    return this.invoices.create(user, body);
  }

  @Get(":id")
  @RequirePermissions("Billing:Read")
  get(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.invoices.get(user, id);
  }

  @Patch(":id")
  @RequirePermissions("Billing:Create")
  update(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(UpdateInvoiceSchema)) body: UpdateInvoiceInput,
  ) {
    return this.invoices.update(user, id, body);
  }

  @Post(":id/send")
  @RequirePermissions("Billing:Send")
  send(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.invoices.send(user, id);
  }
}
