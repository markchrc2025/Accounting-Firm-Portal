import { ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import type { AuthUser } from "../common/auth/auth-user";
import { AuditService } from "../audit/audit.service";
import { PrismaService } from "../prisma/prisma.service";
import { RbacService } from "../rbac/rbac.service";
import type { CreateClientInput, UpdateClientInput } from "./dto/client.schemas";

@Injectable()
export class ClientsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly rbac: RbacService,
    private readonly audit: AuditService,
  ) {}

  async create(user: AuthUser, input: CreateClientInput) {
    const client = await this.prisma.client.create({
      data: {
        firmId: user.firmId,
        businessName: input.businessName,
        tin: input.tin,
        address: input.address,
        taxType: input.taxType,
        currency: input.currency,
        seatLimit: input.seatLimit,
      },
    });
    await this.audit.record({
      userId: user.id,
      action: "client.create",
      entityType: "Client",
      entityId: client.id,
    });
    return client;
  }

  /** Clients the user is allowed to see (visibility rules from RBAC). */
  async listVisible(user: AuthUser) {
    if (user.userType === "CLIENT") {
      return this.prisma.client.findMany({
        where: { id: user.clientId, firmId: user.firmId },
      });
    }
    const eff = await this.rbac.getEffectivePermissions(user);
    if (eff.hasViewAll) {
      return this.prisma.client.findMany({ where: { firmId: user.firmId } });
    }
    return this.prisma.client.findMany({
      where: { firmId: user.firmId, id: { in: [...eff.assignedClientIds] } },
    });
  }

  async get(user: AuthUser, clientId: string) {
    const client = await this.prisma.client.findFirst({
      where: { id: clientId, firmId: user.firmId },
    });
    if (!client) throw new NotFoundException("Client not found");
    return client;
  }

  async update(user: AuthUser, clientId: string, input: UpdateClientInput) {
    await this.get(user, clientId); // 404 if not in firm
    const client = await this.prisma.client.update({
      where: { id: clientId },
      data: input,
    });
    await this.audit.record({
      userId: user.id,
      action: "client.update",
      entityType: "Client",
      entityId: clientId,
      metadata: input,
    });
    return client;
  }

  /**
   * List all clients in a firm — for the machine (integration) caller, which is
   * firm-scoped. Optional case-insensitive substring match on business name.
   */
  async listForFirm(firmId: string, query?: string) {
    return this.prisma.client.findMany({
      where: {
        firmId,
        ...(query
          ? { businessName: { contains: query, mode: "insensitive" as const } }
          : {}),
      },
      orderBy: { businessName: "asc" },
    });
  }

  /** Read one client scoped to a firm (integration caller); 404 if not in firm. */
  async getForFirm(firmId: string, clientId: string) {
    const client = await this.prisma.client.findFirst({
      where: { id: clientId, firmId },
    });
    if (!client) throw new NotFoundException("Client not found");
    return client;
  }

  /** Guard that a client belongs to the user's firm (used by other modules). */
  async assertInFirm(firmId: string, clientId: string) {
    const client = await this.prisma.client.findFirst({
      where: { id: clientId, firmId },
    });
    if (!client) throw new ForbiddenException("Client not in your firm");
    return client;
  }
}
