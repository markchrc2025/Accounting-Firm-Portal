import { Module } from "@nestjs/common";
import { CategoriesModule } from "../categories/categories.module";
import { ClientsModule } from "../clients/clients.module";
import { FinancialModule } from "../financial/financial.module";
import { PurchaseTransactionsController } from "./purchase-transactions.controller";
import { PurchaseTransactionsService } from "./purchase-transactions.service";

@Module({
  imports: [ClientsModule, CategoriesModule, FinancialModule],
  controllers: [PurchaseTransactionsController],
  providers: [PurchaseTransactionsService],
})
export class PurchaseTransactionsModule {}
