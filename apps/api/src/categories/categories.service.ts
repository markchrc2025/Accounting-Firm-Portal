import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { AuthUser } from "../common/auth/auth-user";
import { AuditService } from "../audit/audit.service";
import { ClientsService } from "../clients/clients.service";
import { PrismaService } from "../prisma/prisma.service";
import { toCategoryDto } from "../financial/serialization";
import type {
  CategoryListQuery,
  CategoryType,
  CreateCategoryInput,
  UpdateCategoryInput,
} from "./dto/category.schemas";

@Injectable()
export class CategoriesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clients: ClientsService,
    private readonly audit: AuditService,
  ) {}

  async create(user: AuthUser, clientId: string, input: CreateCategoryInput) {
    await this.clients.assertInFirm(user.firmId, clientId);
    try {
      const category = await this.prisma.category.create({
        data: {
          clientId,
          type: input.type,
          name: input.name,
          isDeductible: input.isDeductible,
        },
      });
      await this.audit.record({
        userId: user.id,
        action: "category.create",
        entityType: "Category",
        entityId: category.id,
        metadata: { clientId, type: input.type, name: input.name },
      });
      return toCategoryDto(category);
    } catch (err) {
      throw this.mapWriteError(err, input.name);
    }
  }

  async list(user: AuthUser, clientId: string, query: CategoryListQuery) {
    await this.clients.assertInFirm(user.firmId, clientId);
    const rows = await this.prisma.category.findMany({
      where: {
        clientId,
        type: query.type,
        ...(query.search
          ? { name: { contains: query.search, mode: "insensitive" } }
          : {}),
      },
      orderBy: [{ type: "asc" }, { name: "asc" }],
    });
    return rows.map(toCategoryDto);
  }

  async get(user: AuthUser, clientId: string, categoryId: string) {
    await this.clients.assertInFirm(user.firmId, clientId);
    return toCategoryDto(await this.loadOwned(clientId, categoryId));
  }

  async update(
    user: AuthUser,
    clientId: string,
    categoryId: string,
    input: UpdateCategoryInput,
  ) {
    await this.clients.assertInFirm(user.firmId, clientId);
    await this.loadOwned(clientId, categoryId);
    try {
      const category = await this.prisma.category.update({
        where: { id: categoryId },
        data: { name: input.name, isDeductible: input.isDeductible },
      });
      await this.audit.record({
        userId: user.id,
        action: "category.update",
        entityType: "Category",
        entityId: categoryId,
        metadata: input,
      });
      return toCategoryDto(category);
    } catch (err) {
      throw this.mapWriteError(err, input.name ?? "");
    }
  }

  async remove(user: AuthUser, clientId: string, categoryId: string) {
    await this.clients.assertInFirm(user.firmId, clientId);
    await this.loadOwned(clientId, categoryId);
    try {
      await this.prisma.category.delete({ where: { id: categoryId } });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2003") {
        throw new ConflictException(
          "Category is in use by transactions and cannot be deleted.",
        );
      }
      throw err;
    }
    await this.audit.record({
      userId: user.id,
      action: "category.delete",
      entityType: "Category",
      entityId: categoryId,
    });
    return { deleted: true };
  }

  /**
   * Resolve a category that must belong to `clientId` and (optionally) be of a
   * given type. Used by the transaction services to close the cross-tenant
   * categoryId hole — a category from another client is rejected.
   */
  /** Find a category by (case-insensitive) name for the client + type, creating
   *  it when absent. Used by bulk import to map the template's Category column to
   *  a categoryId without pre-seeding categories. */
  async resolveByName(clientId: string, name: string, type: CategoryType) {
    const trimmed = name.trim();
    const existing = await this.prisma.category.findFirst({
      where: { clientId, type, name: { equals: trimmed, mode: "insensitive" } },
    });
    if (existing) return existing;
    return this.prisma.category.create({
      data: { clientId, type, name: trimmed, isDeductible: true },
    });
  }

  async resolveForTransaction(
    clientId: string,
    categoryId: string,
    expectedType: CategoryType,
  ) {
    const category = await this.prisma.category.findFirst({
      where: { id: categoryId, clientId },
    });
    if (!category) {
      throw new BadRequestException(
        "categoryId does not reference a category for this client.",
      );
    }
    if (category.type !== expectedType) {
      throw new BadRequestException(
        `Category "${category.name}" is a ${category.type} category; expected ${expectedType}.`,
      );
    }
    return category;
  }

  private async loadOwned(clientId: string, categoryId: string) {
    const category = await this.prisma.category.findFirst({
      where: { id: categoryId, clientId },
    });
    if (!category) throw new NotFoundException("Category not found");
    return category;
  }

  private mapWriteError(err: unknown, name: string) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return new ConflictException(
        `A category named "${name}" already exists for this client and type.`,
      );
    }
    return err instanceof Error ? err : new Error(String(err));
  }
}
