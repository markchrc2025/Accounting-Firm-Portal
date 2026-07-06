import { Injectable } from "@nestjs/common";
import { OAUTH_SCOPES, VatClass } from "@portal/shared";
import { PrismaService } from "../prisma/prisma.service";
import { RedisService } from "../redis/redis.service";

export interface LivenessInfo {
  status: "ok";
  service: string;
  version: string;
  /** Proves the @portal/shared workspace link is live on the API side. */
  shared: {
    vatClasses: readonly string[];
    integrationScopes: readonly string[];
  };
}

export interface ReadinessInfo {
  status: "ok" | "degraded";
  checks: {
    database: "up" | "down";
    redis: "up" | "down";
  };
}

@Injectable()
export class HealthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  getLiveness(): LivenessInfo {
    return {
      status: "ok",
      service: "accounting-firm-portal-api",
      version: "0.1.0",
      shared: {
        // Imported from @portal/shared — never re-declared here (guardrail #2).
        vatClasses: VatClass.options,
        integrationScopes: OAUTH_SCOPES,
      },
    };
  }

  async getReadiness(): Promise<ReadinessInfo> {
    const [dbUp, redisUp] = await Promise.all([this.prisma.ping(), this.redis.ping()]);
    return {
      status: dbUp && redisUp ? "ok" : "degraded",
      checks: {
        database: dbUp ? "up" : "down",
        redis: redisUp ? "up" : "down",
      },
    };
  }
}
