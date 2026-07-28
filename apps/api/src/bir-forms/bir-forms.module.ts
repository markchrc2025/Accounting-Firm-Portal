import { Module } from "@nestjs/common";
import { BirFormsController } from "./bir-forms.controller";
import { BirFormsService } from "./bir-forms.service";

@Module({
  controllers: [BirFormsController],
  providers: [BirFormsService],
})
export class BirFormsModule {}
