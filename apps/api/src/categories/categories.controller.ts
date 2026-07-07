import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import type { AuthUser } from "../common/auth/auth-user";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { RequirePermissions } from "../common/decorators/require-permissions.decorator";
import { ZodValidationPipe } from "../common/validation/zod-validation.pipe";
import { CategoriesService } from "./categories.service";
import {
  CategoryListQuery,
  CategoryListQuerySchema,
  CreateCategoryInput,
  CreateCategorySchema,
  UpdateCategoryInput,
  UpdateCategorySchema,
} from "./dto/category.schemas";

@ApiTags("categories")
@Controller("clients/:clientId/categories")
export class CategoriesController {
  constructor(private readonly categories: CategoriesService) {}

  @Post()
  @RequirePermissions("Categories:Create")
  create(
    @CurrentUser() user: AuthUser,
    @Param("clientId") clientId: string,
    @Body(new ZodValidationPipe(CreateCategorySchema)) body: CreateCategoryInput,
  ) {
    return this.categories.create(user, clientId, body);
  }

  @Get()
  @RequirePermissions("Categories:Read")
  list(
    @CurrentUser() user: AuthUser,
    @Param("clientId") clientId: string,
    @Query(new ZodValidationPipe(CategoryListQuerySchema)) query: CategoryListQuery,
  ) {
    return this.categories.list(user, clientId, query);
  }

  @Get(":categoryId")
  @RequirePermissions("Categories:Read")
  get(
    @CurrentUser() user: AuthUser,
    @Param("clientId") clientId: string,
    @Param("categoryId") categoryId: string,
  ) {
    return this.categories.get(user, clientId, categoryId);
  }

  @Patch(":categoryId")
  @RequirePermissions("Categories:Update")
  update(
    @CurrentUser() user: AuthUser,
    @Param("clientId") clientId: string,
    @Param("categoryId") categoryId: string,
    @Body(new ZodValidationPipe(UpdateCategorySchema)) body: UpdateCategoryInput,
  ) {
    return this.categories.update(user, clientId, categoryId, body);
  }

  @Delete(":categoryId")
  @RequirePermissions("Categories:Delete")
  remove(
    @CurrentUser() user: AuthUser,
    @Param("clientId") clientId: string,
    @Param("categoryId") categoryId: string,
  ) {
    return this.categories.remove(user, clientId, categoryId);
  }
}
