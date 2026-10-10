import { ForbiddenException, Injectable } from "@nestjs/common";
import type { AuthUser } from "../common/auth/auth-user";
import { PrismaService } from "../prisma/prisma.service";
import { CLIENTS_VIEW_ALL } from "./permissions.constants";

/** A client id is a Postgres uuid; any other string names no client of any firm. */
const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The refusal wording, shared by PermissionsGuard and every service-level check. */
export function missingPermissionsMessage(required: string[], clientId?: string): string {
  return `Missing permission(s): ${required.join(", ")}${clientId ? ` for client ${clientId}` : ""}`;
}

/**
 * The clients a caller may act on for a list (U4 R2): `"all"` is every client of
 * the caller's firm; otherwise exactly the ids in the set (possibly none).
 */
export type ClientScope = "all" | Set<string>;

export interface EffectivePermissions {
  /** Permissions granted firm-wide (UserRole.clientScopeId = null). */
  global: Set<string>;
  /** Permissions granted for a specific client (clientScopeId set). */
  scoped: Map<string, Set<string>>;
  /** Clients a firm user is assigned to (FirmClientAssignment). */
  assignedClientIds: Set<string>;
  /** True if the user can see every client in the firm. */
  hasViewAll: boolean;
}

/**
 * Resolves a user's effective permissions from the data-driven RBAC tables and
 * enforces per-client scoping:
 *  - FIRM users act on assigned clients only, unless they hold `Clients:ViewAll`.
 *  - CLIENT users act only within their own organization.
 */
@Injectable()
export class RbacService {
  constructor(private readonly prisma: PrismaService) {}

  async getEffectivePermissions(user: AuthUser): Promise<EffectivePermissions> {
    const userRoles = await this.prisma.userRole.findMany({
      where: { userId: user.id },
      include: {
        role: { include: { rolePermissions: { include: { permission: true } } } },
      },
    });

    const global = new Set<string>();
    const scoped = new Map<string, Set<string>>();

    for (const ur of userRoles) {
      const perms = ur.role.rolePermissions.map(
        (rp) => `${rp.permission.resource}:${rp.permission.action}`,
      );
      if (ur.clientScopeId) {
        const set = scoped.get(ur.clientScopeId) ?? new Set<string>();
        perms.forEach((p) => set.add(p));
        scoped.set(ur.clientScopeId, set);
      } else {
        perms.forEach((p) => global.add(p));
      }
    }

    const assignedClientIds = new Set<string>();
    if (user.userType === "FIRM") {
      const assignments = await this.prisma.firmClientAssignment.findMany({
        where: { firmUserId: user.id },
        select: { clientId: true },
      });
      assignments.forEach((a) => assignedClientIds.add(a.clientId));
    }

    return {
      global,
      scoped,
      assignedClientIds,
      hasViewAll: global.has(CLIENTS_VIEW_ALL),
    };
  }

  /**
   * Returns true iff `user` holds every required permission for the given scope.
   * `clientId` undefined = a firm-level (non-client-scoped) action. With a client
   * and no permission, it answers whether the user can see that client at all
   * (U4-A1: reads that need no permission, e.g. financial statements).
   */
  async authorize(
    user: AuthUser,
    required: string[],
    clientId?: string,
  ): Promise<boolean> {
    if (required.length === 0 && !clientId) return true;
    // U4 R4: two firms never meet. A client outside the caller's firm is refused
    // here, at the guard, as well as by every service's own firmId filter.
    if (clientId && !(await this.isClientOfFirm(user.firmId, clientId))) return false;
    const eff = await this.getEffectivePermissions(user);

    if (!clientId) {
      // Firm-level action: must be a firm user holding each permission globally.
      if (user.userType !== "FIRM") return false;
      return required.every((p) => eff.global.has(p));
    }

    return this.canActOnClient(user, eff, required, clientId);
  }

  /**
   * U4 R2: the question PermissionsGuard asks for a `:clientId` route, asked by a
   * service about the client a record belongs to. Answers 403 in the guard's words.
   */
  async assertClient(
    user: AuthUser,
    required: string[],
    clientId: string,
  ): Promise<void> {
    if (!(await this.authorize(user, required, clientId))) {
      throw new ForbiddenException(missingPermissionsMessage(required, clientId));
    }
  }

  /**
   * U4-A1 (D42): the caller must be able to see this client — every client with
   * Clients:ViewAll, otherwise the assigned ones — for a read that needs no
   * permission. The refusal names what would grant it.
   */
  async assertVisibleClient(user: AuthUser, clientId: string): Promise<void> {
    if (!(await this.authorize(user, [], clientId))) {
      throw new ForbiddenException(
        missingPermissionsMessage([CLIENTS_VIEW_ALL], clientId),
      );
    }
  }

  /**
   * As assertClient, for a record that belongs to more than one client (a billing
   * recorded under a parent for a sub-client): being authorized for any one of
   * them is enough. The refusal names the first.
   */
  async assertAnyClient(
    user: AuthUser,
    required: string[],
    clientIds: Array<string | null | undefined>,
  ): Promise<void> {
    const ids = clientIds.filter((id): id is string => Boolean(id));
    for (const id of ids) {
      if (await this.authorize(user, required, id)) return;
    }
    throw new ForbiddenException(missingPermissionsMessage(required, ids[0]));
  }

  /**
   * U4 R2: the clients of the caller's firm a list may show — the same question
   * authorize() answers for one client, asked of every client at once. A firm user
   * holding Clients:ViewAll and each permission firm-wide gets "all"; anyone else
   * gets the clients they may act on (assigned, or scoped grants under ViewAll).
   */
  async authorizedClients(user: AuthUser, required: string[]): Promise<ClientScope> {
    const eff = await this.getEffectivePermissions(user);
    if (
      user.userType === "FIRM" &&
      eff.hasViewAll &&
      required.every((p) => eff.global.has(p))
    ) {
      return "all";
    }
    const candidates =
      user.userType === "CLIENT"
        ? user.clientId
          ? [user.clientId]
          : []
        : eff.hasViewAll
          ? [...eff.scoped.keys()]
          : [...eff.assignedClientIds];
    const allowed = candidates.filter((id) =>
      this.canActOnClient(user, eff, required, id),
    );
    if (allowed.length === 0) return new Set();
    const inFirm = await this.prisma.client.findMany({
      where: { id: { in: allowed }, firmId: user.firmId },
      select: { id: true },
    });
    return new Set(inFirm.map((c) => c.id));
  }

  /** The per-client rule shared by authorize() and authorizedClients(). */
  private canActOnClient(
    user: AuthUser,
    eff: EffectivePermissions,
    required: string[],
    clientId: string,
  ): boolean {
    if (user.userType === "CLIENT") {
      if (user.clientId !== clientId) return false;
      return required.every((p) => this.hasForClient(eff, clientId, p));
    }

    // Firm user acting on a specific client.
    const canSeeClient = eff.hasViewAll || eff.assignedClientIds.has(clientId);
    if (!canSeeClient) return false;
    return required.every((p) => this.hasForClient(eff, clientId, p));
  }

  /** One indexed lookup: does this client belong to the caller's firm? */
  private async isClientOfFirm(firmId: string, clientId: string): Promise<boolean> {
    if (!UUID_SHAPE.test(clientId)) return false;
    const client = await this.prisma.client.findFirst({
      where: { id: clientId, firmId },
      select: { id: true },
    });
    return client !== null;
  }

  private hasForClient(eff: EffectivePermissions, clientId: string, p: string): boolean {
    return eff.global.has(p) || (eff.scoped.get(clientId)?.has(p) ?? false);
  }

  /** Flat view of a user's permissions for the client (`/auth/me`, UI gating). */
  async describe(user: AuthUser): Promise<{
    global: string[];
    clients: { clientId: string; permissions: string[] }[];
    assignedClientIds: string[];
    canViewAllClients: boolean;
  }> {
    const eff = await this.getEffectivePermissions(user);
    return {
      global: [...eff.global].sort(),
      clients: [...eff.scoped.entries()].map(([clientId, perms]) => ({
        clientId,
        permissions: [...perms].sort(),
      })),
      assignedClientIds: [...eff.assignedClientIds],
      canViewAllClients: eff.hasViewAll,
    };
  }
}
