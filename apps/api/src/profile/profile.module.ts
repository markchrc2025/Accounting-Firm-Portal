import { Module } from "@nestjs/common";
import { ProfileController } from "./profile.controller";
import { ProfileService } from "./profile.service";

// StorageModule and AuditModule are @Global — no need to import them here.
@Module({
  controllers: [ProfileController],
  providers: [ProfileService],
})
export class ProfileModule {}
