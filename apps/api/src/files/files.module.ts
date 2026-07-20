import { Module } from "@nestjs/common";
import { FilesController } from "./files.controller";
import { FilesService } from "./files.service";

/** Firm-level file browser over the object-storage bucket (read-only). */
@Module({
  controllers: [FilesController],
  providers: [FilesService],
})
export class FilesModule {}
