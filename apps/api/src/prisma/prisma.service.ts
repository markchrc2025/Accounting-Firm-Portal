import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";

/**
 * Thin wrapper around the generated Prisma client.
 *
 * `onModuleInit` attempts to connect but does NOT crash the app if the database
 * is unreachable — this keeps the app bootable in hermetic environments (CI unit
 * / e2e without a DB). Readiness is reported separately by the health endpoint.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);
  private connected = false;

  async onModuleInit(): Promise<void> {
    try {
      await this.$connect();
      this.connected = true;
    } catch (err) {
      this.logger.warn(
        `Database not reachable at startup: ${(err as Error).message}. ` +
          "The app will run; readiness will report the DB as down.",
      );
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }

  /** Cheap round-trip used by the readiness probe. */
  async ping(): Promise<boolean> {
    try {
      await this.$queryRaw`SELECT 1`;
      this.connected = true;
      return true;
    } catch {
      this.connected = false;
      return false;
    }
  }

  get isConnected(): boolean {
    return this.connected;
  }
}
