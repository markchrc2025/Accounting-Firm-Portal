import { Body, Controller, HttpCode, Post } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { Public } from "../common/decorators/public.decorator";
import { ZodValidationPipe } from "../common/validation/zod-validation.pipe";
import { IntegrationClientService } from "./integration-client.service";
import {
  OAuthTokenRequest,
  OAuthTokenRequestSchema,
  OAuthTokenResponse,
} from "./dto/oauth-token.schema";

/**
 * OAuth2 token endpoint for server-to-server integration (client-credentials).
 * @Public because the request carries its own client_id/client_secret rather
 * than a bearer token. Successful requests receive a short-lived scoped token.
 */
@ApiTags("integration")
@Controller("oauth")
export class OAuthController {
  constructor(private readonly integrationClients: IntegrationClientService) {}

  @Post("token")
  @Public()
  @HttpCode(200)
  token(
    @Body(new ZodValidationPipe(OAuthTokenRequestSchema)) body: OAuthTokenRequest,
  ): Promise<OAuthTokenResponse> {
    return this.integrationClients.issueToken(
      body.client_id,
      body.client_secret,
      body.scope,
    );
  }
}
