import { Module } from "@nestjs/common";
import { BirController } from "./bir.controller";
import { BirService } from "./bir.service";

@Module({
  controllers: [BirController],
  providers: [BirService],
})
export class BirModule {}
