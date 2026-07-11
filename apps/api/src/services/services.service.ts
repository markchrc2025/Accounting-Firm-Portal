import { Injectable, NotFoundException } from "@nestjs/common";
import type { Service as ServiceRow } from "@prisma/client";
import type { AuthUser } from "../common/auth/auth-user";
import { AuditService } from "../audit/audit.service";
import { PrismaService } from "../prisma/prisma.service";
import type { CreateServiceInput, UpdateServiceInput } from "./dto/service.schemas";

/** The row shape returned to the firm UI. Decimal `defaultFee` serializes to a
 *  string over JSON; the web client accepts string | number. */
function toServiceDto(s: ServiceRow) {
  return {
    id: s.id,
    name: s.name,
    description: s.description,
    defaultFee: s.defaultFee,
    billingMethod: s.billingMethod,
    linkedForm: s.linkedForm,
    status: s.status,
  };
}

/** Firm's service-offering catalog (Portal-only). Firm-scoped: every operation
 *  is confined to the actor's firmId — there is no clientId. */
@Injectable()
export class ServicesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(user: AuthUser) {
    const rows = await this.prisma.service.findMany({
      where: { firmId: user.firmId },
      orderBy: { createdAt: "asc" },
    });
    return rows.map(toServiceDto);
  }

  async create(user: AuthUser, input: CreateServiceInput) {
    const service = await this.prisma.service.create({
      data: {
        firmId: user.firmId,
        name: input.name,
        description: input.description,
        defaultFee: input.defaultFee,
        billingMethod: input.billingMethod,
        linkedForm: input.linkedForm ?? null,
        status: input.status,
      },
    });
    await this.audit.record({
      userId: user.id,
      action: "service.create",
      entityType: "Service",
      entityId: service.id,
      metadata: { name: input.name, billingMethod: input.billingMethod },
    });
    return toServiceDto(service);
  }

  async update(user: AuthUser, id: string, input: UpdateServiceInput) {
    await this.loadOwned(user.firmId, id);
    const service = await this.prisma.service.update({
      where: { id },
      data: {
        name: input.name,
        description: input.description,
        defaultFee: input.defaultFee,
        billingMethod: input.billingMethod,
        ...(input.linkedForm !== undefined ? { linkedForm: input.linkedForm } : {}),
        status: input.status,
      },
    });
    await this.audit.record({
      userId: user.id,
      action: "service.update",
      entityType: "Service",
      entityId: id,
      metadata: input,
    });
    return toServiceDto(service);
  }

  async remove(user: AuthUser, id: string) {
    await this.loadOwned(user.firmId, id);
    await this.prisma.service.delete({ where: { id } });
    await this.audit.record({
      userId: user.id,
      action: "service.delete",
      entityType: "Service",
      entityId: id,
    });
    return { deleted: true };
  }

  /** Resolve a service that must belong to `firmId`; 404 otherwise. */
  private async loadOwned(firmId: string, id: string) {
    const service = await this.prisma.service.findFirst({ where: { id, firmId } });
    if (!service) throw new NotFoundException("Service not found");
    return service;
  }
}
