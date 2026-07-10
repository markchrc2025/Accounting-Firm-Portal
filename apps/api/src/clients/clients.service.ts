import { ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import type { AuthUser } from "../common/auth/auth-user";
import { AuditService } from "../audit/audit.service";
import { PrismaService } from "../prisma/prisma.service";
import { RbacService } from "../rbac/rbac.service";
import { StorageService } from "../storage/storage.service";
import type { CreateClientInput, UpdateClientInput } from "./dto/client.schemas";

/** Writable client columns (excludes server-managed + caller-provided keys). */
type ClientWritable = Omit<
  Prisma.ClientUncheckedCreateInput,
  "id" | "firmId" | "businessName" | "createdAt" | "updatedAt"
>;

@Injectable()
export class ClientsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly rbac: RbacService,
    private readonly audit: AuditService,
    private readonly storage: StorageService,
  ) {}

  /**
   * Map the validated DTO onto Prisma columns: `taxTypes` → `taxTypesJson`,
   * ISO date strings → Date, everything else passes through. `businessName` and
   * `firmId` are handled by the callers. The return is the writable subset of the
   * create input (all-optional), so it spreads cleanly into both create & update.
   */
  private toClientData(
    input: Partial<CreateClientInput & UpdateClientInput>,
  ): ClientWritable {
    const { businessName: _bn, taxTypes, birthdate, incorpDate, ...rest } = input;
    return {
      ...(rest as ClientWritable),
      ...(taxTypes !== undefined ? { taxTypesJson: taxTypes as Prisma.InputJsonValue } : {}),
      ...(birthdate !== undefined ? { birthdate: birthdate ? new Date(birthdate) : null } : {}),
      ...(incorpDate !== undefined
        ? { incorpDate: incorpDate ? new Date(incorpDate) : null }
        : {}),
    };
  }

  async create(user: AuthUser, input: CreateClientInput) {
    const client = await this.prisma.client.create({
      data: {
        firmId: user.firmId,
        businessName: input.businessName,
        ...this.toClientData(input),
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
      data: {
        ...(input.businessName !== undefined ? { businessName: input.businessName } : {}),
        ...this.toClientData(input),
      },
    });
    await this.audit.record({
      userId: user.id,
      action: "client.update",
      entityType: "Client",
      entityId: clientId,
      metadata: { fields: Object.keys(input) },
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

  // --- COR file storage ------------------------------------------------------

  /**
   * Store an uploaded COR file in object storage under `<firmId>/<clientId>` and
   * record the key on the client. Per-client firm scoping via assertInFirm.
   */
  async uploadCor(
    user: AuthUser,
    clientId: string,
    bytes: Uint8Array,
    contentType: string,
  ) {
    await this.assertInFirm(user.firmId, clientId);
    const key = this.storage.corKey(user.firmId, clientId);
    await this.storage.putCor(key, bytes, contentType);
    await this.prisma.client.update({
      where: { id: clientId },
      data: { corPath: key },
    });
    await this.audit.record({
      userId: user.id,
      action: "client.cor.upload",
      entityType: "Client",
      entityId: clientId,
    });
    return { corPath: key };
  }

  /** A short-lived signed URL for the client's stored COR, or `null` if none. */
  async corSignedUrl(user: AuthUser, clientId: string): Promise<{ url: string | null }> {
    const client = await this.assertInFirm(user.firmId, clientId);
    if (!client.corPath) return { url: null };
    return { url: await this.storage.corSignedUrl(client.corPath) };
  }

  /** Remove the client's stored COR (best-effort delete + clear the column). */
  async removeCor(user: AuthUser, clientId: string): Promise<{ ok: true }> {
    const client = await this.assertInFirm(user.firmId, clientId);
    if (client.corPath) {
      // Best-effort: a transient object-storage failure must not block clearing
      // the reference (else the UI is stuck pointing at an unremovable file).
      try {
        await this.storage.deleteCor(client.corPath);
      } catch {
        /* swallow — the column is cleared below regardless */
      }
      await this.prisma.client.update({
        where: { id: clientId },
        data: { corPath: null },
      });
      await this.audit.record({
        userId: user.id,
        action: "client.cor.delete",
        entityType: "Client",
        entityId: clientId,
      });
    }
    return { ok: true };
  }
}
