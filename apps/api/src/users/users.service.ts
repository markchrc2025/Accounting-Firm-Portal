import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { AuthUser } from "../common/auth/auth-user";
import { AuditService } from "../audit/audit.service";
import { PasswordService } from "../auth/password.service";
import { PrismaService } from "../prisma/prisma.service";
import { StorageService } from "../storage/storage.service";
import type {
  AssignClientsInput,
  CreateUserInput,
  SetRolesInput,
  UpdateUserInput,
} from "./dto/user.schemas";

const publicUserSelect = {
  id: true,
  email: true,
  fullName: true,
  userType: true,
  status: true,
  mfaEnabled: true,
  lastLoginAt: true,
  createdAt: true,
  firmProfile: { select: { title: true, employeeId: true } },
  userRoles: { select: { role: { select: { name: true } }, clientScopeId: true } },
} as const;

/** Firm-user management (FR-03). Firm-scoped: all operations are within firmId. */
@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly audit: AuditService,
    private readonly storage: StorageService,
  ) {}

  /** Replace a row's raw `avatarPath` with a short-lived presigned `avatarUrl`. */
  private async withAvatarUrl<T extends { avatarPath: string | null }>(
    row: T,
  ): Promise<Omit<T, "avatarPath"> & { avatarUrl: string | null }> {
    const { avatarPath, ...rest } = row;
    const avatarUrl =
      avatarPath && this.storage.isEnabled()
        ? await this.storage.signedGetUrl(avatarPath)
        : null;
    return { ...rest, avatarUrl };
  }

  async create(actor: AuthUser, input: CreateUserInput) {
    const email = input.email.toLowerCase();
    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) throw new ConflictException("A user with this email already exists");

    const roles = await this.resolveFirmRoles(input.roleNames);
    const passwordHash = await this.passwords.hash(input.password);

    const user = await this.prisma.user.create({
      data: {
        firmId: actor.firmId,
        userType: "FIRM",
        email,
        fullName: input.fullName,
        passwordHash,
        status: "ACTIVE",
        firmProfile: {
          create: { title: input.title, employeeId: input.employeeId },
        },
        userRoles: {
          create: roles.map((r) => ({ roleId: r.id })),
        },
      },
      select: publicUserSelect,
    });

    await this.audit.record({
      userId: actor.id,
      action: "user.create",
      entityType: "User",
      entityId: user.id,
      metadata: { email, roleNames: input.roleNames },
    });
    return user;
  }

  async list(actor: AuthUser) {
    const rows = await this.prisma.user.findMany({
      where: { firmId: actor.firmId, userType: "FIRM" },
      select: { ...publicUserSelect, avatarPath: true },
      orderBy: { createdAt: "asc" },
    });
    return Promise.all(rows.map((row) => this.withAvatarUrl(row)));
  }

  async get(actor: AuthUser, id: string) {
    const user = await this.prisma.user.findFirst({
      where: { id, firmId: actor.firmId },
      select: publicUserSelect,
    });
    if (!user) throw new NotFoundException("User not found");
    return user;
  }

  async update(actor: AuthUser, id: string, input: UpdateUserInput) {
    await this.get(actor, id);
    const user = await this.prisma.user.update({
      where: { id },
      data: {
        fullName: input.fullName,
        status: input.status,
        ...(input.title !== undefined
          ? { firmProfile: { update: { title: input.title } } }
          : {}),
      },
      select: publicUserSelect,
    });
    await this.audit.record({
      userId: actor.id,
      action: "user.update",
      entityType: "User",
      entityId: id,
      metadata: input,
    });
    return user;
  }

  async remove(actor: AuthUser, id: string) {
    if (id === actor.id) {
      throw new BadRequestException("You cannot delete your own account");
    }
    await this.get(actor, id);
    await this.prisma.user.delete({ where: { id } });
    await this.audit.record({
      userId: actor.id,
      action: "user.delete",
      entityType: "User",
      entityId: id,
    });
    return { deleted: true };
  }

  async setRoles(actor: AuthUser, id: string, input: SetRolesInput) {
    await this.get(actor, id);
    const roles = await this.resolveFirmRoles(input.roleNames);
    await this.prisma.$transaction([
      // Replace only firm-wide (unscoped) role grants.
      this.prisma.userRole.deleteMany({ where: { userId: id, clientScopeId: null } }),
      this.prisma.userRole.createMany({
        data: roles.map((r) => ({ userId: id, roleId: r.id })),
      }),
    ]);
    await this.audit.record({
      userId: actor.id,
      action: "user.roles.set",
      entityType: "User",
      entityId: id,
      metadata: { roleNames: input.roleNames },
    });
    return this.get(actor, id);
  }

  async assignClients(actor: AuthUser, id: string, input: AssignClientsInput) {
    const user = await this.prisma.user.findFirst({
      where: { id, firmId: actor.firmId, userType: "FIRM" },
      include: { firmProfile: true },
    });
    if (!user?.firmProfile) throw new NotFoundException("Firm user not found");

    // Only clients within the firm may be assigned.
    const clients = await this.prisma.client.findMany({
      where: { id: { in: input.clientIds }, firmId: actor.firmId },
      select: { id: true },
    });
    const validIds = clients.map((c) => c.id);

    await this.prisma.$transaction([
      this.prisma.firmClientAssignment.deleteMany({ where: { firmUserId: id } }),
      this.prisma.firmClientAssignment.createMany({
        data: validIds.map((clientId) => ({ firmUserId: id, clientId })),
      }),
    ]);
    await this.audit.record({
      userId: actor.id,
      action: "user.clients.assign",
      entityType: "User",
      entityId: id,
      metadata: { clientIds: validIds },
    });
    return { assignedClientIds: validIds };
  }

  private async resolveFirmRoles(roleNames: string[]) {
    if (roleNames.length === 0) return [];
    const roles = await this.prisma.role.findMany({
      where: { name: { in: roleNames }, scope: "FIRM" },
    });
    const found = new Set(roles.map((r) => r.name));
    const missing = roleNames.filter((n) => !found.has(n));
    if (missing.length > 0) {
      throw new BadRequestException(`Unknown firm role(s): ${missing.join(", ")}`);
    }
    return roles;
  }
}
