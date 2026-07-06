import { createParamDecorator, ExecutionContext } from "@nestjs/common";
import type { AuthUser, RequestWithUser } from "../auth/auth-user";

/** Injects the authenticated AuthUser (populated by JwtAuthGuard). */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthUser | undefined => {
    const request = ctx.switchToHttp().getRequest<RequestWithUser>();
    return request.user;
  },
);
