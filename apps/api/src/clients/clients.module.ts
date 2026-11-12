import { Module } from "@nestjs/common";
import { ClientsController } from "./clients.controller";
import { ClientsService } from "./clients.service";
import { ClientDeleteService } from "./client-delete.service";

@Module({
  controllers: [ClientsController],
  providers: [ClientsService, ClientDeleteService],
  exports: [ClientsService],
})
export class ClientsModule {}
