import { createParamDecorator, ExecutionContext } from "@nestjs/common";
import type {
  IntegrationPrincipal,
  RequestWithIntegration,
} from "../auth/auth-user";

/** Injects the machine IntegrationPrincipal (populated by JwtAuthGuard). */
export const CurrentIntegration = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): IntegrationPrincipal | undefined => {
    const request = ctx.switchToHttp().getRequest<RequestWithIntegration>();
    return request.integration;
  },
);
