import { Body, Controller, Get, Param, Post } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import type { AuthUser } from "../common/auth/auth-user";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { RequirePermissions } from "../common/decorators/require-permissions.decorator";
import { ZodValidationPipe } from "../common/validation/zod-validation.pipe";
import {
  CreateIntegrationInput,
  CreateIntegrationSchema,
} from "./dto/integration-mgmt.schemas";
import { IntegrationClientService } from "./integration-client.service";

/**
 * Firm-facing management of OAuth2 machine clients (the BIR Form Generator
 * connector). Distinct from the machine-to-machine `IntegrationController`: this
 * surface is guarded by user RBAC (`IntegrationClient:*`, Super Admin only) and
 * is firm-scoped via the authenticated user's `firmId`. Create and rotate return
 * a reveal-once plaintext secret; list/revoke never expose secrets.
 */
@ApiTags("integrations")
@Controller("integrations")
export class IntegrationsController {
  constructor(private readonly clients: IntegrationClientService) {}

  @Get()
  @RequirePermissions("IntegrationClient:Read")
  list(@CurrentUser() user: AuthUser) {
    return this.clients.listForFirm(user.firmId);
  }

  @Post()
  @RequirePermissions("IntegrationClient:Create")
  create(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(CreateIntegrationSchema))
    body: CreateIntegrationInput,
  ) {
    return this.clients.createForFirm(user.firmId, body);
  }

  @Post(":id/rotate")
  @RequirePermissions("IntegrationClient:Update")
  rotate(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.clients.rotateForFirm(user.firmId, id);
  }

  @Post(":id/revoke")
  @RequirePermissions("IntegrationClient:Delete")
  revoke(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.clients.revokeForFirm(user.firmId, id);
  }
}
