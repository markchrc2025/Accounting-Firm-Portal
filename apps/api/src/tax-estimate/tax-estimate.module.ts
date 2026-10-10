import { Module } from "@nestjs/common";
import { BirFormsModule } from "../bir-forms/bir-forms.module";
import { TaxRulesModule } from "../tax-rules/tax-rules.module";
import { TaxEstimateController } from "./tax-estimate.controller";
import { TaxEstimateService } from "./tax-estimate.service";

@Module({
  imports: [TaxRulesModule, BirFormsModule],
  controllers: [TaxEstimateController],
  providers: [TaxEstimateService],
})
export class TaxEstimateModule {}
