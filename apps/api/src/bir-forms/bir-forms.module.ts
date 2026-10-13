import { Module } from "@nestjs/common";
import { ClientsModule } from "../clients/clients.module";
import { BirFormsController } from "./bir-forms.controller";
import { BirFormsService } from "./bir-forms.service";
import { BookFiguresService } from "./book-figures/book-figures.service";

@Module({
  imports: [ClientsModule], // ClientsService.assertInFirm
  controllers: [BirFormsController],
  providers: [BirFormsService, BookFiguresService],
  exports: [BirFormsService], // U10: the tax estimate lists the filed forms
})
export class BirFormsModule {}
