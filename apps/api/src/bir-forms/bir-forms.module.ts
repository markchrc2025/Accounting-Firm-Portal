import { Module } from "@nestjs/common";
import { ConfirmationModule } from "../bir-confirmation/confirmation.module";
import { ClientsModule } from "../clients/clients.module";
import { AlphalistService } from "./alphalist/alphalist.service";
import { BirDeadlinesController } from "./deadlines/deadlines.controller";
import { BirDeadlinesService } from "./deadlines/deadlines.service";
import { BirFormsController } from "./bir-forms.controller";
import { BirFormsService } from "./bir-forms.service";
import { BookFiguresService } from "./book-figures/book-figures.service";

@Module({
  imports: [ClientsModule, ConfirmationModule], // ClientsService.assertInFirm; U18 confirmations
  controllers: [BirFormsController, BirDeadlinesController],
  providers: [BirFormsService, BookFiguresService, AlphalistService, BirDeadlinesService],
  exports: [BirFormsService, BookFiguresService, AlphalistService], // U10: the tax estimate lists the filed forms; U20: the connector reads the books' figures
})
export class BirFormsModule {}
