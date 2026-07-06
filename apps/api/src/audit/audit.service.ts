import { Injectable, Logger } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";

export interface AuditEntry {
  userId?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  ipAddress?: string | null;
  metadata?: Prisma.InputJsonValue;
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
}
