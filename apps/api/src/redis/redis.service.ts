import { Inject, Injectable, Logger, OnModuleDestroy } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import Redis from "ioredis";

/**
 * Redis connection holder. Wired now for later BullMQ use (async imports, email,
 * cached aggregates). Uses `lazyConnect` so the app boots without a live Redis;
 * the readiness probe pings on demand.
 */
@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  readonly client: Redis;

  constructor(@Inject(ConfigService) config: ConfigService) {
    const url = config.get<string>("REDIS_URL", "redis://localhost:6379");
    this.client = new Redis(url, {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
    });
    this.client.on("error", (err) => this.logger.warn(`Redis error: ${err.message}`));
  }

  /** Cheap PING used by the readiness probe. */
  async ping(): Promise<boolean> {
    try {
      if (this.client.status === "wait" || this.client.status === "end") {
        await this.client.connect();
      }
      const pong = await this.client.ping();
      return pong === "PONG";
    } catch {
      return false;
    }
  }

  async onModuleDestroy(): Promise<void> {
    this.client.disconnect();
  }
}
