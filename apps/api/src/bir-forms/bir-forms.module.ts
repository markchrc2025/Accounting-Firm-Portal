import { Module } from "@nestjs/common";
import { ConfirmationModule } from "../bir-confirmation/confirmation.module";
import { ClientsModule } from "../clients/clients.module";
import { BirFormsController } from "./bir-forms.controller";
import { BirFormsService } from "./bir-forms.service";
import { BookFiguresService } from "./book-figures/book-figures.service";

@Module({
  imports: [ClientsModule, ConfirmationModule], // ClientsService.assertInFirm; U18 confirmations
  controllers: [BirFormsController],
  providers: [BirFormsService, BookFiguresService],
  exports: [BirFormsService], // U10: the tax estimate lists the filed forms
})
export class BirFormsModule {}
