import { Module } from "@nestjs/common";
import { CoaController } from "./coa.controller";
import { CoaService } from "./coa.service";

@Module({
  controllers: [CoaController],
  providers: [CoaService],
})
export class CoaModule {}
