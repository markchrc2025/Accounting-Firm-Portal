import { Body, Controller, Delete, Get, Param, Patch, Post } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import type { AuthUser } from "../common/auth/auth-user";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { RequirePermissions } from "../common/decorators/require-permissions.decorator";
import { CLIENTS_VIEW_ALL } from "../rbac/permissions.constants";
import { ZodValidationPipe } from "../common/validation/zod-validation.pipe";
import {
  AssignClientsInput,
  AssignClientsSchema,
  CreateUserInput,
  CreateUserSchema,
  SetRolesInput,
  SetRolesSchema,
  UpdateUserInput,
  UpdateUserSchema,
} from "./dto/user.schemas";
import { UsersService } from "./users.service";

@ApiTags("users")
@Controller("users")
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Post()
  @RequirePermissions("Users:Create")
  create(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(CreateUserSchema)) body: CreateUserInput,
  ) {
    return this.users.create(user, body);
  }

  @Get()
  @RequirePermissions("Users:Read")
  list(@CurrentUser() user: AuthUser) {
    return this.users.list(user);
  }

  @Get(":id")
  @RequirePermissions("Users:Read")
  get(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.users.get(user, id);
  }

  @Patch(":id")
  @RequirePermissions("Users:Update")
  update(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(UpdateUserSchema)) body: UpdateUserInput,
  ) {
    return this.users.update(user, id, body);
  }

  @Delete(":id")
  @RequirePermissions("Users:Delete")
  remove(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.users.remove(user, id);
  }

  @Post(":id/roles")
  @RequirePermissions("Roles:Assign")
  setRoles(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(SetRolesSchema)) body: SetRolesInput,
  ) {
    return this.users.setRoles(user, id, body);
  }

  /** U4-A1 (R2): a firm user's assigned clients, for the assignment screen. */
  @Get(":id/clients")
  @RequirePermissions("Users:Read", CLIENTS_VIEW_ALL)
  assignedClients(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.users.assignedClients(user, id);
  }

  /** Replace-all. U4-A1 (D42): assigning clients needs Clients:ViewAll as well. */
  @Post(":id/assign-clients")
  @RequirePermissions("Roles:Assign", CLIENTS_VIEW_ALL)
  assignClients(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(AssignClientsSchema)) body: AssignClientsInput,
  ) {
    return this.users.assignClients(user, id, body);
  }
}
