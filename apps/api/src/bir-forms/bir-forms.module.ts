import { Module } from "@nestjs/common";
import { ClientsModule } from "../clients/clients.module";
import { BirFormsController } from "./bir-forms.controller";
import { BirFormsService } from "./bir-forms.service";

@Module({
  imports: [ClientsModule], // ClientsService.assertInFirm
  controllers: [BirFormsController],
  providers: [BirFormsService],
})
export class BirFormsModule {}
