// mcp-rate-limit.service.ts — PA3 (D67): the Projects MCP's per-token limit, counted in Redis so
// every API instance shares one count. 240 requests a minute for each token (Sentire Projects'
// own number); PROJECTS_MCP_RATE_LIMIT changes it. If Redis cannot be reached an instance counts
// for itself and logs a warning (at most once a minute): the MCP keeps working.
import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { RedisService } from "../redis/redis.service";
import { RateLimiter, RedisRateStore, type RateResult } from "./rate-limiter";

export const DEFAULT_MCP_RATE_LIMIT = 240;
const WINDOW_MS = 60_000;

@Injectable()
export class McpRateLimitService {
  private readonly logger = new Logger(McpRateLimitService.name);
  private readonly limiter: RateLimiter;
  private lastWarning = 0;

  constructor(redis: RedisService, config: ConfigService) {
    const raw = Number(
      config.get<string>("PROJECTS_MCP_RATE_LIMIT", String(DEFAULT_MCP_RATE_LIMIT)),
    );
    const limit = Number.isInteger(raw) && raw > 0 ? raw : DEFAULT_MCP_RATE_LIMIT;
    this.limiter = new RateLimiter(new RedisRateStore(redis.client), {
      limit,
      windowMs: WINDOW_MS,
      onStoreError: (e) => {
        const now = Date.now();
        if (now - this.lastWarning > WINDOW_MS) {
          this.lastWarning = now;
          this.logger.warn(`Rate limit counted in this process only: ${e.message}`);
        }
      },
    });
  }

  hit(tokenId: string): Promise<RateResult> {
    return this.limiter.hit(tokenId);
  }
}
