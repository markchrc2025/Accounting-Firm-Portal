import { Body, Controller, Get, Param, Patch, Post, Query } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import type { AuthUser, IntegrationPrincipal } from "../common/auth/auth-user";
import { CurrentIntegration } from "../common/decorators/current-integration.decorator";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { RequirePermissions } from "../common/decorators/require-permissions.decorator";
import { RequireScopes } from "../common/decorators/require-scopes.decorator";
import { ZodValidationPipe } from "../common/validation/zod-validation.pipe";
import { ClientsService } from "./clients.service";
import {
  CreateClientInput,
  CreateClientSchema,
  UpdateClientInput,
  UpdateClientSchema,
} from "./dto/client.schemas";

@ApiTags("clients")
@Controller("clients")
export class ClientsController {
  constructor(private readonly clients: ClientsService) {}

  @Post()
  @RequirePermissions("Clients:Create")
  create(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(CreateClientSchema)) body: CreateClientInput,
  ) {
    return this.clients.create(user, body);
  }

  // Dual-auth reads: a firm USER (RBAC-scoped) or the BIR Generator's machine
  // token (firm-scoped, `clients:read`). Exactly one principal is set by the guards.
  @Get()
  @RequirePermissions("Clients:Read")
  @RequireScopes("clients:read")
  list(
    @CurrentUser() user: AuthUser | undefined,
    @CurrentIntegration() integration: IntegrationPrincipal | undefined,
    @Query("query") query?: string,
  ) {
    if (integration) return this.clients.listForFirm(integration.firmId, query);
    return this.clients.listVisible(user as AuthUser);
  }

  @Get(":clientId")
  @RequirePermissions("Clients:Read")
  @RequireScopes("clients:read")
  get(
    @CurrentUser() user: AuthUser | undefined,
    @CurrentIntegration() integration: IntegrationPrincipal | undefined,
    @Param("clientId") clientId: string,
  ) {
    if (integration) return this.clients.getForFirm(integration.firmId, clientId);
    return this.clients.get(user as AuthUser, clientId);
  }

  @Patch(":clientId")
  @RequirePermissions("Clients:Update")
  update(
    @CurrentUser() user: AuthUser,
    @Param("clientId") clientId: string,
    @Body(new ZodValidationPipe(UpdateClientSchema)) body: UpdateClientInput,
  ) {
    return this.clients.update(user, clientId, body);
  }
}
