import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Put,
  Query,
} from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { BirFilingPushback, InputTaxAssetHandoff } from "@portal/shared";
import type { IntegrationPrincipal } from "../common/auth/auth-user";
import { CurrentIntegration } from "../common/decorators/current-integration.decorator";
import { RequireScopes } from "../common/decorators/require-scopes.decorator";
import { ZodValidationPipe } from "../common/validation/zod-validation.pipe";
import { AggregationService } from "./aggregation.service";
import { BirFilingsService } from "./bir-filings.service";
import { QuarterQuery, QuarterQuerySchema } from "./dto/period-query.schema";

/**
 * The BIR Form Generator integration surface (bir-integration-spec §6–7). Every
 * route requires an integration (client-credentials) token with the right scope;
 * ScopesGuard blocks user tokens. Per-client visibility is enforced in the
 * services (a client must belong to the token's firm).
 */
@ApiTags("integration")
@Controller("clients/:clientId")
export class IntegrationController {
  constructor(
    private readonly aggregation: AggregationService,
    private readonly filings: BirFilingsService,
  ) {}

  // --- Portal → Generator (read) --------------------------------------------

  @Get("vat-summary")
  @RequireScopes("vat-summary:read")
  vatSummary(
    @CurrentIntegration() integration: IntegrationPrincipal,
    @Param("clientId") clientId: string,
    @Query(new ZodValidationPipe(QuarterQuerySchema)) q: QuarterQuery,
  ) {
    return this.aggregation.vatSummary(
      integration.firmId,
      clientId,
      q.year,
      q.quarter,
    );
  }

  @Get("percentage-tax-summary")
  @RequireScopes("percentage-tax-summary:read")
  percentageTaxSummary(
    @CurrentIntegration() integration: IntegrationPrincipal,
    @Param("clientId") clientId: string,
    @Query(new ZodValidationPipe(QuarterQuerySchema)) q: QuarterQuery,
  ) {
    return this.aggregation.percentageTaxSummary(
      integration.firmId,
      clientId,
      q.year,
      q.quarter,
    );
  }

  // --- Generator → Portal (write, idempotent) -------------------------------

  @Post("bir-filings")
  @RequireScopes("bir-filings:write")
  createFiling(
    @CurrentIntegration() integration: IntegrationPrincipal,
    @Param("clientId") clientId: string,
    @Body(new ZodValidationPipe(BirFilingPushback)) body: BirFilingPushback,
  ) {
    return this.filings.upsertFiling(integration.id, integration.firmId, clientId, body);
  }

  @Put("bir-filings/:ref")
  @RequireScopes("bir-filings:write")
  updateFiling(
    @CurrentIntegration() integration: IntegrationPrincipal,
    @Param("clientId") clientId: string,
    @Param("ref") ref: string,
    @Body(new ZodValidationPipe(BirFilingPushback)) body: BirFilingPushback,
  ) {
    return this.filings.updateFiling(
      integration.id,
      integration.firmId,
      clientId,
      ref,
      body,
    );
  }

  @Get("bir-filings")
  @RequireScopes("bir-filings:read")
  listFilings(
    @CurrentIntegration() integration: IntegrationPrincipal,
    @Param("clientId") clientId: string,
  ) {
    return this.filings.listFilings(integration.firmId, clientId);
  }

  @Post("input-tax-asset")
  @RequireScopes("input-tax-asset:write")
  bookInputTaxAsset(
    @CurrentIntegration() integration: IntegrationPrincipal,
    @Param("clientId") clientId: string,
    @Body(new ZodValidationPipe(InputTaxAssetHandoff)) body: InputTaxAssetHandoff,
  ) {
    return this.filings.bookInputTaxAsset(
      integration.id,
      integration.firmId,
      clientId,
      body,
    );
  }
}
