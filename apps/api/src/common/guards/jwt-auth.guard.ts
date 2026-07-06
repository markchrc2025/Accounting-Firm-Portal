import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { TokenService } from "../../auth/token.service";
import type { RequestWithUser } from "../auth/auth-user";
import { IS_PUBLIC_KEY } from "../decorators/public.decorator";

/**
 * Global authentication guard. Requires a valid `access` bearer token unless the
 * route is marked @Public(). Populates `request.user` with the AuthUser.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokenService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<RequestWithUser>();
    const token = this.extractBearer(request.headers.authorization);
    if (!token) {
      throw new UnauthorizedException("Missing bearer token");
    }

    try {
      const payload = this.tokens.verify(token, "access");
      request.user = TokenService.toAuthUser(payload);
      return true;
    } catch {
      throw new UnauthorizedException("Invalid or expired token");
    }
  }

  private extractBearer(header?: string): string | undefined {
    if (!header) return undefined;
    const [scheme, value] = header.split(" ");
    return scheme?.toLowerCase() === "bearer" && value ? value : undefined;
  }
}
