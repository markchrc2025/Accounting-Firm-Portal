import { Injectable } from "@nestjs/common";
import type { AuthUser } from "../common/auth/auth-user";
import { PrismaService } from "../prisma/prisma.service";
import { CLIENTS_VIEW_ALL } from "./permissions.constants";

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
   * `clientId` undefined = a firm-level (non-client-scoped) action.
   */
  async authorize(
    user: AuthUser,
    required: string[],
    clientId?: string,
  ): Promise<boolean> {
    if (required.length === 0) return true;
    const eff = await this.getEffectivePermissions(user);

    if (!clientId) {
      // Firm-level action: must be a firm user holding each permission globally.
      if (user.userType !== "FIRM") return false;
      return required.every((p) => eff.global.has(p));
    }

    if (user.userType === "CLIENT") {
      if (user.clientId !== clientId) return false;
      return required.every((p) => this.hasForClient(eff, clientId, p));
    }

    // Firm user acting on a specific client.
    const canSeeClient = eff.hasViewAll || eff.assignedClientIds.has(clientId);
    if (!canSeeClient) return false;
    return required.every((p) => this.hasForClient(eff, clientId, p));
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
