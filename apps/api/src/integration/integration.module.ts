import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { AggregationService } from "./aggregation.service";
import { BirFilingsService } from "./bir-filings.service";
import { IntegrationClientService } from "./integration-client.service";
import { IntegrationController } from "./integration.controller";
import { IntegrationsController } from "./integrations.controller";
import { OAuthController } from "./oauth.controller";

/**
 * BIR Form Generator integration (Phase 6/7). Exposes the OAuth2 token endpoint,
 * the read aggregation endpoints (vat-summary, percentage-tax-summary), and the
 * push-back receivers (bir-filings, input-tax-asset). AuthModule provides
 * TokenService + PasswordService.
 */
@Module({
  imports: [AuthModule],
  controllers: [OAuthController, IntegrationController, IntegrationsController],
  providers: [IntegrationClientService, AggregationService, BirFilingsService],
  exports: [IntegrationClientService, BirFilingsService],
})
export class IntegrationModule {}
