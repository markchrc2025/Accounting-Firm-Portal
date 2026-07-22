import { Body, Controller, Delete, Get, Param, Patch, Post } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import type { AuthUser } from "../common/auth/auth-user";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { RequirePermissions } from "../common/decorators/require-permissions.decorator";
import { ZodValidationPipe } from "../common/validation/zod-validation.pipe";
import {
  CreateRoleInput,
  CreateRoleSchema,
  UpdateRoleInput,
  UpdateRoleSchema,
} from "./dto/role.schemas";
import { RolesService } from "./roles.service";

/**
 * Firm role management. Reads need Roles:Read; every write needs Roles:Configure
 * (held only by Super Admin). Roles are FIRM-scope; the editor never touches
 * client-portal roles.
 */
@ApiTags("roles")
@Controller("roles")
export class RolesController {
  constructor(private readonly roles: RolesService) {}

  @Get()
  @RequirePermissions("Roles:Read")
  list() {
    return this.roles.list();
  }

  @Get("permission-catalog")
  @RequirePermissions("Roles:Read")
  catalog() {
    return this.roles.permissionCatalog();
  }

  @Post()
  @RequirePermissions("Roles:Configure")
  create(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(CreateRoleSchema)) body: CreateRoleInput,
  ) {
    return this.roles.create(user, body);
  }

  @Patch(":id")
  @RequirePermissions("Roles:Configure")
  update(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(UpdateRoleSchema)) body: UpdateRoleInput,
  ) {
    return this.roles.update(user, id, body);
  }

  @Delete(":id")
  @RequirePermissions("Roles:Configure")
  remove(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.roles.remove(user, id);
  }
}
