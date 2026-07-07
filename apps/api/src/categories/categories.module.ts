import { Module } from "@nestjs/common";
import { ClientsModule } from "../clients/clients.module";
import { CategoriesController } from "./categories.controller";
import { CategoriesService } from "./categories.service";

@Module({
  imports: [ClientsModule],
  controllers: [CategoriesController],
  providers: [CategoriesService],
  exports: [CategoriesService], // used by the transaction modules for categoryId validation
})
export class CategoriesModule {}
