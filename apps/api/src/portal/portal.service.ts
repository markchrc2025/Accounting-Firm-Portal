import { Injectable, NotFoundException } from "@nestjs/common";
import type { AuthUser } from "../common/auth/auth-user";
import { PrismaService } from "../prisma/prisma.service";

/**
 * Client Portal read model. Every method returns ONLY the caller's own client
 * organization, so per-client isolation is inherent — no @RequirePermissions is
 * needed. Firm users have no portal org (no `clientId`) and get a 404.
 */
@Injectable()
export class PortalService {
  constructor(private readonly prisma: PrismaService) {}

  /** The caller's own client organization. 404 for firm users / missing org. */
  async getContext(user: AuthUser) {
    if (!user.clientId) throw new NotFoundException("No portal organization");
    const client = await this.prisma.client.findFirst({
      where: { id: user.clientId, firmId: user.firmId },
    });
    if (!client) throw new NotFoundException("Organization not found");
    return {
      id: client.id,
      businessName: client.businessName,
      taxType: client.taxType,
      status: client.status,
      seatLimit: client.seatLimit ?? null,
    };
  }

  /** The client-portal users in the caller's own organization. */
  async listUsers(user: AuthUser) {
    if (!user.clientId) throw new NotFoundException("No portal organization");
    // Client-portal users link to their org via ClientUserProfile.clientId
    // (there is no direct User.clientId column).
    const users = await this.prisma.user.findMany({
      where: {
        userType: "CLIENT",
        clientProfile: { clientId: user.clientId },
      },
      select: {
        id: true,
        fullName: true,
        email: true,
        status: true,
        userRoles: { select: { role: { select: { name: true } } } },
      },
      orderBy: { fullName: "asc" },
    });
    return users.map((u) => ({
      id: u.id,
      fullName: u.fullName,
      email: u.email,
      role: u.userRoles[0]?.role.name ?? "",
      status: u.status,
    }));
  }
}
