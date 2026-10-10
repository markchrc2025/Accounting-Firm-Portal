import { Module } from "@nestjs/common";
import { ClientsModule } from "../clients/clients.module";
import { TaxRulesController } from "./tax-rules.controller";
import { TaxRulesService } from "./tax-rules.service";

@Module({
  imports: [ClientsModule],
  controllers: [TaxRulesController],
  providers: [TaxRulesService],
  exports: [TaxRulesService], // U10: the tax estimate reads the client's rule
})
export class TaxRulesModule {}
