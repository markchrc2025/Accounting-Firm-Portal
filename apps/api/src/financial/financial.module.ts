import { Module } from "@nestjs/common";
import { RegimeValidator } from "./regime-validator";

/** Shared financial-capture helpers (regime validation) used by income + purchase. */
@Module({
  providers: [RegimeValidator],
  exports: [RegimeValidator],
})
export class FinancialModule {}
