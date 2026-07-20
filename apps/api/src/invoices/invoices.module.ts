import { Module } from "@nestjs/common";
import { ClientsModule } from "../clients/clients.module";
import { InvoicesController } from "./invoices.controller";
import { InvoicesService } from "./invoices.service";

@Module({
  imports: [ClientsModule],
  controllers: [InvoicesController],
  providers: [InvoicesService],
  exports: [InvoicesService], // used by the MCP write tools
})
export class InvoicesModule {}
