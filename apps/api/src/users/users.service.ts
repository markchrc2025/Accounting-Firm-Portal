import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { AuthUser } from "../common/auth/auth-user";
import { AuditService } from "../audit/audit.service";
import { PasswordService } from "../auth/password.service";
import { roleChangedEmail } from "../mail/email-templates";
import { MailService } from "../mail/mail.service";
import { PrismaService } from "../prisma/prisma.service";
import { RbacService } from "../rbac/rbac.service";
import { EmailSettingsService } from "../settings/email-settings.service";
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
  private readonly logger = new Logger(UsersService.name);
  private readonly webAppUrl: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly audit: AuditService,
    private readonly storage: StorageService,
    private readonly mail: MailService,
    private readonly emailSettings: EmailSettingsService,
    config: ConfigService,
    private readonly rbac: RbacService,
  ) {
    this.webAppUrl = (
      config.get<string>("WEB_APP_URL", "https://acctgfirm.mcrctas.com") ?? ""
    ).replace(/\/+$/, "");
  }

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
    // U4-A1 (R2): how many clients each firm user is assigned to (additive field).
    const counts = await this.prisma.firmClientAssignment.groupBy({
      by: ["firmUserId"],
      where: { firmUserId: { in: rows.map((r) => r.id) } },
      _count: { _all: true },
    });
    const countOf = new Map(counts.map((c) => [c.firmUserId, c._count._all]));
    return Promise.all(
      rows.map(async (row) => ({
        ...(await this.withAvatarUrl(row)),
        assignedClientCount: countOf.get(row.id) ?? 0,
      })),
    );
  }

  async get(actor: AuthUser, id: string) {
    return this.loadScoped(actor, id, "Users:Read");
  }

  /** A user of the actor's firm, or 404. No client scope: see loadScoped. */
  private async load(actor: AuthUser, id: string) {
    const user = await this.prisma.user.findFirst({
      where: { id, firmId: actor.firmId },
      select: { ...publicUserSelect, clientProfile: { select: { clientId: true } } },
    });
    if (!user) throw new NotFoundException("User not found");
    const { clientProfile, ...rest } = user;
    return { user: rest, clientId: clientProfile?.clientId ?? null };
  }

  /**
   * U4-A1 (D42): a portal (CLIENT) user belongs to one client; reading, changing or
   * deleting them needs that client to be one the actor can act on with the
   * route's permission (403 in the guard's words). Firm users are unchanged.
   */
  private async loadScoped(actor: AuthUser, id: string, permission: string) {
    const { user, clientId } = await this.load(actor, id);
    if (user.userType === "CLIENT" && clientId) {
      await this.rbac.assertClient(actor, [permission], clientId);
    }
    return user;
  }

  async update(actor: AuthUser, id: string, input: UpdateUserInput) {
    await this.loadScoped(actor, id, "Users:Update");
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
    await this.loadScoped(actor, id, "Users:Delete");
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
    const { user: before, clientId } = await this.load(actor, id);
    // U9 R1 d (D44): a role's scope must fit the user — FIRM roles for firm users,
    // CLIENT roles for portal users and scoped to that user's own client.
    const roles = await this.resolveRolesFor(input.roleNames, before.userType);
    if (before.userType === "CLIENT" && !clientId) {
      throw new BadRequestException("This portal user belongs to no client.");
    }
    // A client-scoped grant is written only by someone who may assign roles for
    // that client (D14 assignment, as for the portal user's other routes).
    if (before.userType === "CLIENT" && clientId) {
      await this.rbac.assertClient(actor, ["Roles:Assign"], clientId);
    }
    await this.prisma.$transaction(
      before.userType === "FIRM"
        ? [
            // Replace only firm-wide (unscoped) role grants.
            this.prisma.userRole.deleteMany({ where: { userId: id, clientScopeId: null } }),
            this.prisma.userRole.createMany({
              data: roles.map((r) => ({ userId: id, roleId: r.id })),
            }),
          ]
        : [
            // A portal user holds only grants scoped to their own client.
            this.prisma.userRole.deleteMany({ where: { userId: id } }),
            this.prisma.userRole.createMany({
              data: roles.map((r) => ({ userId: id, roleId: r.id, clientScopeId: clientId })),
            }),
          ],
    );
    await this.audit.record({
      userId: actor.id,
      action: "user.roles.set",
      entityType: "User",
      entityId: id,
      metadata: { roleNames: input.roleNames },
    });
    const after = (await this.load(actor, id)).user;
    // Notify the affected user their role changed (best-effort; never blocks).
    await this.notifyRoleChange(
      actor.firmId,
      { email: after.email, status: after.status },
      firstRoleName(before.userRoles),
      firstRoleName(after.userRoles),
    );
    return after;
  }

  /**
   * Email the affected user that their role changed. Best-effort: a mail failure
   * (or mail being unconfigured) never blocks the role change. Skipped when the
   * role is unchanged or the account hasn't finished accepting its invite.
   */
  private async notifyRoleChange(
    firmId: string,
    user: { email: string; status: string },
    oldRole: string,
    newRole: string,
  ): Promise<void> {
    try {
      if (oldRole === newRole) return;
      if (!user.email || !this.mail.isEnabled()) return;
      const ctx = await this.emailSettings.resolveContext(firmId);
      const rendered = roleChangedEmail(
        { oldRole, newRole, permissionsUrl: this.webAppUrl },
        ctx.theme,
      );
      await this.mail.send({
        to: user.email,
        subject: rendered.subject,
        html: rendered.html,
        text: rendered.text,
        ...ctx.senderFor(rendered.stream),
      });
    } catch (err) {
      this.logger.warn(`Role-change email to ${user.email} failed: ${(err as Error).message}`);
    }
  }

  /**
   * U4-A1 (R2): a firm user's assigned clients, `{ userId, clients }` sorted by
   * businessName. 404 for an unknown user or one of another firm; 400 for a
   * portal (CLIENT) user, who is never assigned clients.
   */
  async assignedClients(actor: AuthUser, id: string) {
    const user = await this.prisma.user.findFirst({
      where: { id, firmId: actor.firmId },
      select: { id: true, userType: true },
    });
    if (!user) throw new NotFoundException("User not found");
    if (user.userType !== "FIRM") {
      throw new BadRequestException("Only firm users are assigned clients.");
    }
    const rows = await this.prisma.firmClientAssignment.findMany({
      where: { firmUserId: id },
      select: { client: { select: { id: true, businessName: true } } },
      orderBy: [{ client: { businessName: "asc" } }, { clientId: "asc" }],
    });
    return { userId: id, clients: rows.map((r) => r.client) };
  }

  async assignClients(actor: AuthUser, id: string, input: AssignClientsInput) {
    const user = await this.prisma.user.findFirst({
      where: { id, firmId: actor.firmId, userType: "FIRM" },
      include: { firmProfile: true },
    });
    if (!user?.firmProfile) throw new NotFoundException("Firm user not found");

    // U4-A1 (D42): every client must belong to the firm; otherwise 400, nothing written.
    const wanted = [...new Set(input.clientIds)];
    const clients = await this.prisma.client.findMany({
      where: { id: { in: wanted }, firmId: actor.firmId },
      select: { id: true },
    });
    const found = new Set(clients.map((c) => c.id));
    const unknown = wanted.filter((c) => !found.has(c));
    if (unknown.length > 0) {
      throw new BadRequestException(`Not clients of this firm: ${unknown.join(", ")}`);
    }
    const validIds = wanted;

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
    return this.assignedClients(actor, id);
  }

  /** Roles by name for a user of `userType`; 400 when a named role's scope does not fit. */
  private async resolveRolesFor(roleNames: string[], userType: "FIRM" | "CLIENT") {
    if (roleNames.length === 0) return [];
    const all = await this.prisma.role.findMany({ where: { name: { in: roleNames } } });
    const out: typeof all = [];
    const unknown: string[] = [];
    for (const name of new Set(roleNames)) {
      const fit = all.find((r) => r.name === name && r.scope === userType);
      if (fit) {
        out.push(fit);
        continue;
      }
      const other = all.find((r) => r.name === name);
      if (other) {
        throw new BadRequestException(
          `A ${other.scope} role cannot be given to a ${userType} user.`,
        );
      }
      unknown.push(name);
    }
    if (unknown.length > 0) {
      throw new BadRequestException(
        `Unknown ${userType === "FIRM" ? "firm" : "client"} role(s): ${unknown.join(", ")}`,
      );
    }
    return out;
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

/** The user's primary firm-wide role name (clientScopeId null), or "None". */
function firstRoleName(
  userRoles: { role: { name: string }; clientScopeId: string | null }[],
): string {
  const firmWide = userRoles.find((r) => r.clientScopeId === null);
  return firmWide?.role.name ?? userRoles[0]?.role.name ?? "None";
}
