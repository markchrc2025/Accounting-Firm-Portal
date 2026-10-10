import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { TokenService } from "../../auth/token.service";
import { PrismaService } from "../../prisma/prisma.service";
import type {
  RequestWithIntegration,
  RequestWithUser,
} from "../auth/auth-user";
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
  /** userId → status and when it was read (R1 a: at most 60 s old). */
  private readonly statusCache = new Map<string, { active: boolean; at: number }>();

  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokenService,
    private readonly prisma: PrismaService,
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

  /** The user's status, read at most every statusCacheMs() (R1 a: ≤ 60 s). */
  private async isActive(userId: string): Promise<boolean> {
    const window = statusCacheMs();
    const now = Date.now();
    const hit = this.statusCache.get(userId);
    if (hit && now - hit.at < window) return hit.active;
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { status: true },
    });
    const active = user?.status === "ACTIVE";
    if (window > 0) this.statusCache.set(userId, { active, at: now });
    return active;
  }

  private extractBearer(header?: string): string | undefined {
    if (!header) return undefined;
    const [scheme, value] = header.split(" ");
    return scheme?.toLowerCase() === "bearer" && value ? value : undefined;
  }
}
