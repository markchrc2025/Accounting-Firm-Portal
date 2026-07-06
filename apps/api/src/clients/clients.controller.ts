import { Body, Controller, Get, Param, Patch, Post } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import type { AuthUser } from "../common/auth/auth-user";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { RequirePermissions } from "../common/decorators/require-permissions.decorator";
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

  @Get()
  @RequirePermissions("Clients:Read")
  list(@CurrentUser() user: AuthUser) {
    return this.clients.listVisible(user);
  }

  @Get(":clientId")
  @RequirePermissions("Clients:Read")
  get(@CurrentUser() user: AuthUser, @Param("clientId") clientId: string) {
    return this.clients.get(user, clientId);
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
