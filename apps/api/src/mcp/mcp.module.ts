import { Module } from "@nestjs/common";
import { ClientsModule } from "../clients/clients.module";
import { IncomeTransactionsModule } from "../income-transactions/income-transactions.module";
import { InvoicesModule } from "../invoices/invoices.module";
import { PurchaseTransactionsModule } from "../purchase-transactions/purchase-transactions.module";
import { McpConnectorController } from "./mcp-connector.controller";
import { McpController } from "./mcp.controller";
import { McpService } from "./mcp.service";

/**
 * MCP (Model Context Protocol) endpoint — Portal data + writes for Claude.
 * The write tools reuse the domain services (same validation/audit as the UI);
 * PrismaModule and AuditModule are @Global.
 */
@Module({
  imports: [
    ClientsModule,
    IncomeTransactionsModule,
    PurchaseTransactionsModule,
    InvoicesModule,
  ],
  controllers: [McpController, McpConnectorController],
  providers: [McpService],
})
export class McpModule {}
