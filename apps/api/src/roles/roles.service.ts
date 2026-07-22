import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import type { AuthUser } from "../common/auth/auth-user";
import { AuditService } from "../audit/audit.service";
import { PrismaService } from "../prisma/prisma.service";
import { firmPermissionCatalog, isFirmPermission } from "../rbac/permissions.constants";
import type { CreateRoleInput, UpdateRoleInput } from "./dto/role.schemas";

/** The Super Admin role is fully locked — editing it risks a firm lockout. */
const SUPER_ADMIN = "Super Admin";

const roleInclude = {
  rolePermissions: { include: { permission: true } },
  _count: { select: { userRoles: true } },
} satisfies Prisma.RoleInclude;

type RoleRow = Prisma.RoleGetPayload<{ include: typeof roleInclude }>;

/**
 * Firm role management (the "Roles & permissions" editor). Roles are a shared
 * FIRM-scope catalog: the five seeded roles are `isSystem` (Super Admin fully
 * locked, the rest permission-editable but not renamable/deletable), and custom
 * roles created here are fully editable. Every write is gated on Roles:Configure.
 */
@Injectable()
export class RolesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** The FIRM permission catalog (grouped by resource) for the editor. */
  permissionCatalog() {
    return firmPermissionCatalog();
  }

  async list() {
    const roles = await this.prisma.role.findMany({
      where: { scope: "FIRM" },
      include: roleInclude,
      orderBy: [{ isSystem: "desc" }, { createdAt: "asc" }],
    });
    return roles.map(toRoleDto);
  }

  async create(actor: AuthUser, input: CreateRoleInput) {
    const name = input.name.trim();
    await this.assertNameFree(name);
    const permissionIds = await this.resolvePermissionIds(input.permissions);

    const role = await this.prisma.role.create({
      data: {
        name,
        scope: "FIRM",
        isSystem: false,
        rolePermissions: { create: permissionIds.map((permissionId) => ({ permissionId })) },
      },
      include: roleInclude,
    });
    await this.audit.record({
      userId: actor.id,
      action: "role.create",
      entityType: "Role",
      entityId: role.id,
      metadata: { name, permissions: input.permissions.length },
    });
    return toRoleDto(role);
  }

  async update(actor: AuthUser, id: string, input: UpdateRoleInput) {
    const role = await this.getFirmRole(id);
    if (role.name === SUPER_ADMIN) {
      throw new BadRequestException("The Super Admin role is locked and cannot be changed.");
    }

    const data: Prisma.RoleUpdateInput = {};
    if (input.name !== undefined) {
      const name = input.name.trim();
      if (name !== role.name) {
        if (role.isSystem) {
          throw new BadRequestException("Built-in roles cannot be renamed.");
        }
        await this.assertNameFree(name);
        data.name = name;
      }
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      if (input.permissions) {
        const permissionIds = await this.resolvePermissionIds(input.permissions);
        await tx.rolePermission.deleteMany({ where: { roleId: id } });
        if (permissionIds.length > 0) {
          await tx.rolePermission.createMany({
            data: permissionIds.map((permissionId) => ({ roleId: id, permissionId })),
          });
        }
      }
      return tx.role.update({ where: { id }, data, include: roleInclude });
    });
    await this.audit.record({
      userId: actor.id,
      action: "role.update",
      entityType: "Role",
      entityId: id,
      metadata: { fields: Object.keys(input) },
    });
    return toRoleDto(updated);
  }

  async remove(actor: AuthUser, id: string) {
    const role = await this.getFirmRole(id);
    if (role.isSystem) {
      throw new BadRequestException("Built-in roles cannot be deleted.");
    }
    const assigned = await this.prisma.userRole.count({ where: { roleId: id } });
    if (assigned > 0) {
      throw new BadRequestException(
        `"${role.name}" is assigned to ${assigned} user${assigned === 1 ? "" : "s"} — ` +
          "reassign them to another role first.",
      );
    }
    await this.prisma.role.delete({ where: { id } });
    await this.audit.record({
      userId: actor.id,
      action: "role.delete",
      entityType: "Role",
      entityId: id,
      metadata: { name: role.name },
    });
    return { deleted: true as const };
  }

  // --- helpers ---------------------------------------------------------------

  private async getFirmRole(id: string): Promise<RoleRow> {
    const role = await this.prisma.role.findFirst({
      where: { id, scope: "FIRM" },
      include: roleInclude,
    });
    if (!role) throw new NotFoundException("Role not found");
    return role;
  }

  private async assertNameFree(name: string): Promise<void> {
    const existing = await this.prisma.role.findUnique({
      where: { name_scope: { name, scope: "FIRM" } },
      select: { id: true },
    });
    if (existing) throw new ConflictException(`A role named "${name}" already exists.`);
  }

  /** Validate the permission strings against the FIRM catalog and resolve ids. */
  private async resolvePermissionIds(permissions: string[]): Promise<string[]> {
    const unique = [...new Set(permissions)];
    const invalid = unique.filter((p) => !isFirmPermission(p));
    if (invalid.length > 0) {
      throw new BadRequestException(`Unknown permission(s): ${invalid.join(", ")}`);
    }
    if (unique.length === 0) return [];
    const rows = await this.prisma.permission.findMany({
      where: {
        OR: unique.map((p) => {
          const [resource, action] = p.split(":");
          return { resource: resource!, action: action! };
        }),
      },
      select: { id: true },
    });
    return rows.map((r) => r.id);
  }
}

/** Serialize a role row for the editor, with capability flags derived. */
function toRoleDto(role: RoleRow) {
  const isSuperAdmin = role.name === SUPER_ADMIN;
  return {
    id: role.id,
    name: role.name,
    isSystem: role.isSystem,
    /** Super Admin is fully read-only (never editable). */
    locked: isSuperAdmin,
    canEditPermissions: !isSuperAdmin,
    canRename: !role.isSystem,
    canDelete: !role.isSystem,
    assignedUserCount: role._count.userRoles,
    permissions: role.rolePermissions
      .map((rp) => `${rp.permission.resource}:${rp.permission.action}`)
      .sort(),
  };
}
