import { Module } from "@nestjs/common";
import { CategoriesModule } from "../categories/categories.module";
import { ClientsModule } from "../clients/clients.module";
import { FinancialModule } from "../financial/financial.module";
import { IncomeTransactionsController } from "./income-transactions.controller";
import { IncomeTransactionsService } from "./income-transactions.service";

@Module({
  imports: [ClientsModule, CategoriesModule, FinancialModule],
  controllers: [IncomeTransactionsController],
  providers: [IncomeTransactionsService],
})
export class IncomeTransactionsModule {}
