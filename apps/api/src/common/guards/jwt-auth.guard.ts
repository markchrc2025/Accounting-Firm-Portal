import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Optional,
  UnauthorizedException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import {
  ApiTokensService,
  TOKEN_INVALID,
  TOKEN_NOT_HERE,
  TOKEN_READ_ONLY,
} from "../../api-tokens/api-tokens.service";
import { TOKEN_PREFIX } from "../../api-tokens/token-format";
import { TokenService } from "../../auth/token.service";
import { PrismaService } from "../../prisma/prisma.service";
import type {
  RequestWithIntegration,
  RequestWithUser,
} from "../auth/auth-user";
import { ACCEPTS_API_TOKEN_KEY } from "../decorators/accepts-api-token.decorator";
import { IS_PUBLIC_KEY } from "../decorators/public.decorator";

/** U9 R1 a (D44): what a user who is not ACTIVE reads, at refresh and on every request. */
export const ACCOUNT_DISABLED_MESSAGE = "This account is disabled.";

/** The longest a user's status may be cached by the guard (R1 a). */
const MAX_STATUS_CACHE_MS = 60_000;

/** The guard's cache window: AUTH_STATUS_CACHE_MS, capped at 60 s (tests set 0). */
function statusCacheMs(): number {
  const raw = Number(process.env.AUTH_STATUS_CACHE_MS ?? MAX_STATUS_CACHE_MS);
  return Number.isFinite(raw) ? Math.min(Math.max(raw, 0), MAX_STATUS_CACHE_MS) : MAX_STATUS_CACHE_MS;
}

/** The most users whose status the guard holds at once (U9-A1 R7). */
const MAX_STATUS_CACHE_ENTRIES = 1_000;

/**
 * U9-A1 R7 (D46): user id → ACTIVE or not, bounded. An entry lives at most
 * statusCacheMs() (≤ 60 s); expired entries are pruned on every write; past
 * 1,000 entries the oldest is dropped. Entries are kept in write order (a rewrite
 * moves the entry to the end), so the oldest is always first.
 */
export class StatusCache {
  private readonly entries = new Map<string, { active: boolean; at: number }>();

  get size(): number {
    return this.entries.size;
  }

  get(userId: string, now: number): boolean | undefined {
    const hit = this.entries.get(userId);
    if (!hit) return undefined;
    if (now - hit.at < statusCacheMs()) return hit.active;
    this.entries.delete(userId);
    return undefined;
  }

  set(userId: string, active: boolean, now: number): void {
    const window = statusCacheMs();
    this.entries.delete(userId);
    for (const [id, e] of this.entries) {
      if (now - e.at < window) break;
      this.entries.delete(id);
    }
    if (window === 0) return;
    while (this.entries.size >= MAX_STATUS_CACHE_ENTRIES) {
      const oldest = this.entries.keys().next().value as string;
      this.entries.delete(oldest);
    }
    this.entries.set(userId, { active, at: now });
  }
}

/**
 * Global authentication guard. Requires a valid bearer token unless the route is
 * marked @Public(). Accepts BOTH kinds of token:
 *  - a user `access` token → populates `request.user` (AuthUser);
 *  - an `integration` (OAuth2 client-credentials) token → populates
 *    `request.integration` (machine principal). Authorization for integration
 *    calls is then enforced by ScopesGuard.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  /** userId → status and when it was read (R1 a: at most 60 s old; R7: bounded). */
  private readonly statusCache = new StatusCache();

  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokenService,
    private readonly prisma: PrismaService,
    /** PA3 (D67): personal API tokens. Optional so a guard built without it still works. */
    @Optional() private readonly apiTokens?: ApiTokensService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context
      .switchToHttp()
      .getRequest<RequestWithUser & RequestWithIntegration>();
    const token = this.extractBearer(request.headers.authorization);
    if (!token) {
      throw new UnauthorizedException("Missing bearer token");
    }

    // PA3 (D67): a personal API token ("ppt_..."), accepted only on routes that opt in.
    if (token.startsWith(TOKEN_PREFIX)) {
      await this.admitApiToken(context, request, token);
      return true;
    }

    try {
      if (this.tokens.peekType(token) === "integration") {
        request.integration = this.tokens.verifyIntegration(token);
        return true;
      }
      const payload = this.tokens.verify(token, "access");
      request.user = TokenService.toAuthUser(payload);
    } catch {
      throw new UnauthorizedException("Invalid or expired token");
    }
    // U9 R1 a (D44): a valid token of a user who is no longer ACTIVE is refused.
    if (!(await this.isActive(request.user.id))) {
      throw new UnauthorizedException(ACCOUNT_DISABLED_MESSAGE);
    }
    return true;
  }

  /**
   * PA3 (D67): sign in with a personal API token. The route must accept tokens; the token must be
   * valid; a call that changes anything needs a token that may write (it was made read_write and
   * its user can change Projects data). The session the caller names with `x-portal-session` is
   * kept only if it is theirs.
   */
  private async admitApiToken(
    context: ExecutionContext,
    request: RequestWithUser & RequestWithIntegration,
    token: string,
  ): Promise<void> {
    const accepts = this.reflector.getAllAndOverride<boolean>(ACCEPTS_API_TOKEN_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!accepts) throw new ForbiddenException(TOKEN_NOT_HERE);
    const principal = this.apiTokens ? await this.apiTokens.authenticate(token) : null;
    if (!principal || !this.apiTokens) throw new UnauthorizedException(TOKEN_INVALID);
    if (!["GET", "HEAD", "OPTIONS"].includes(request.method)) {
      if ((await this.apiTokens.effectiveScope(principal)) === "read") {
        throw new ForbiddenException(TOKEN_READ_ONLY);
      }
    }
    const header = request.headers["x-portal-session"];
    const sessionId = await this.apiTokens.ownSessionId(
      principal.user,
      Array.isArray(header) ? header[0] : header,
    );
    request.user = {
      ...principal.user,
      via: { channel: "api", sessionId, tokenId: principal.tokenId },
    };
    request.apiToken = { id: principal.tokenId };
  }

  /** The user's status, read at most every statusCacheMs() (R1 a: ≤ 60 s). */
  private async isActive(userId: string): Promise<boolean> {
    const now = Date.now();
    const hit = this.statusCache.get(userId, now);
    if (hit !== undefined) return hit;
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { status: true },
    });
    const active = user?.status === "ACTIVE";
    this.statusCache.set(userId, active, now);
    return active;
  }

  private extractBearer(header?: string): string | undefined {
    if (!header) return undefined;
    const [scheme, value] = header.split(" ");
    return scheme?.toLowerCase() === "bearer" && value ? value : undefined;
  }
}
