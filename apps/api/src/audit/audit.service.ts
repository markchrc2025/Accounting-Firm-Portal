import { Injectable, Logger } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import type { AuditQuery } from "./dto/audit-query.schemas";

export interface AuditEntry {
  userId?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  ipAddress?: string | null;
  metadata?: Prisma.InputJsonValue;
}

/** Firm-facing audit row (never exposes raw metadata). */
export interface AuditLogDto {
  id: string;
  timestamp: string;
  actor: string;
  action: string;
  entityType: string;
  entityId: string | null;
  ipAddress: string | null;
}

/** Cap on rows returned by a single audit-log read (FR-32). */
const AUDIT_LIST_LIMIT = 200;

/** Best-effort extraction of a system/integration actor label from metadata. */
function metadataActor(metadata: Prisma.JsonValue): string | undefined {
  if (metadata && typeof metadata === "object" && !Array.isArray(metadata)) {
    const actor = (metadata as Prisma.JsonObject).actor;
    if (typeof actor === "string") return actor;
  }
  return undefined;
}

/**
 * Append-only audit trail (FR-32). Writes are best-effort: a failure to record
 * an audit entry must never break the underlying action, so errors are logged
 * and swallowed.
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  async record(entry: AuditEntry): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          userId: entry.userId ?? null,
          action: entry.action,
          entityType: entry.entityType,
          entityId: entry.entityId ?? null,
          ipAddress: entry.ipAddress ?? null,
          metadata: entry.metadata ?? {},
        },
      });
    } catch (err) {
      this.logger.warn(
        `Failed to write audit log (${entry.action}): ${(err as Error).message}`,
      );
    }
  }

  /**
   * Firm-scoped, read-only audit trail (FR-32). Because AuditLog has no firmId
   * column, rows are scoped either through the acting user's firm or via a
   * `firmId` stamped into metadata by integration/system actions (userId null).
   * Ordered newest-first and capped; raw metadata is never returned.
   */
  async list(firmId: string, filters: AuditQuery = {}): Promise<AuditLogDto[]> {
    const and: Prisma.AuditLogWhereInput[] = [];
    if (filters.actor) {
      and.push({
        user: { is: { fullName: { contains: filters.actor, mode: "insensitive" } } },
      });
    }
    if (filters.action) and.push({ action: filters.action });
    if (filters.entity) {
      and.push({ entityType: { contains: filters.entity, mode: "insensitive" } });
    }
    if (filters.from || filters.to) {
      and.push({
        timestamp: {
          ...(filters.from ? { gte: new Date(filters.from) } : {}),
          ...(filters.to ? { lte: new Date(filters.to) } : {}),
        },
      });
    }

    const rows = await this.prisma.auditLog.findMany({
      where: {
        AND: [
          ...and,
          {
            OR: [
              { user: { is: { firmId } } },
              { metadata: { path: ["firmId"], equals: firmId } },
            ],
          },
        ],
      },
      select: {
        id: true,
        timestamp: true,
        action: true,
        entityType: true,
        entityId: true,
        ipAddress: true,
        metadata: true,
        user: { select: { fullName: true } },
      },
      orderBy: { timestamp: "desc" },
      take: AUDIT_LIST_LIMIT,
    });

    return rows.map((r) => ({
      id: r.id,
      timestamp: r.timestamp.toISOString(),
      actor: r.user?.fullName ?? metadataActor(r.metadata) ?? "System",
      action: r.action,
      entityType: r.entityType,
      entityId: r.entityId,
      ipAddress: r.ipAddress,
    }));
  }
}
