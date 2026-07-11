import { Module } from "@nestjs/common";
import { IntegrationModule } from "../integration/integration.module";
import { FilingsController } from "./filings.controller";

/**
 * Firm-facing read module for BIR filings. Imports IntegrationModule to reuse
 * BirFilingsService (exported there) rather than duplicating query logic.
 */
@Module({
  imports: [IntegrationModule],
  controllers: [FilingsController],
})
export class FilingsModule {}
