import { Module } from "@nestjs/common";
import { CategoriesModule } from "../categories/categories.module";
import { ClientsModule } from "../clients/clients.module";
import { FinancialModule } from "../financial/financial.module";
import { ExpenseImportController } from "./import/expense-import.controller";
import { ExpenseImportService } from "./import/expense-import.service";
import { PurchaseTransactionsController } from "./purchase-transactions.controller";
import { PurchaseTransactionsService } from "./purchase-transactions.service";

@Module({
  imports: [ClientsModule, CategoriesModule, FinancialModule],
  controllers: [PurchaseTransactionsController, ExpenseImportController],
  providers: [PurchaseTransactionsService, ExpenseImportService],
  // PurchaseTransactionsService: the MCP write tools. ExpenseImportService: the AI
  // receipt reader runs the import's own row rules (U11 R8).
  exports: [PurchaseTransactionsService, ExpenseImportService],
})
export class PurchaseTransactionsModule {}
