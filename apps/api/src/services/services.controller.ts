import { Body, Controller, Delete, Get, Param, Patch, Post } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import type { AuthUser } from "../common/auth/auth-user";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { RequirePermissions } from "../common/decorators/require-permissions.decorator";
import { ZodValidationPipe } from "../common/validation/zod-validation.pipe";
import {
  CreateServiceInput,
  CreateServiceSchema,
  UpdateServiceInput,
  UpdateServiceSchema,
} from "./dto/service.schemas";
import { ServicesService } from "./services.service";

@ApiTags("services")
@Controller("services")
export class ServicesController {
  constructor(private readonly services: ServicesService) {}

  @Get()
  @RequirePermissions("Services:Read")
  list(@CurrentUser() user: AuthUser) {
    return this.services.list(user);
  }

  @Post()
  @RequirePermissions("Services:Create")
  create(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(CreateServiceSchema)) body: CreateServiceInput,
  ) {
    return this.services.create(user, body);
  }

  @Patch(":id")
  @RequirePermissions("Services:Update")
  update(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(UpdateServiceSchema)) body: UpdateServiceInput,
  ) {
    return this.services.update(user, id, body);
  }

  @Delete(":id")
  @RequirePermissions("Services:Delete")
  remove(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.services.remove(user, id);
  }
}
