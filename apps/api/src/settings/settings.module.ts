import { Module } from "@nestjs/common";
import { SettingsController } from "./settings.controller";
import { EmailSettingsService } from "./email-settings.service";

/** Firm Admin Settings (email/sender configuration). Prisma+Audit are @Global. */
@Module({
  controllers: [SettingsController],
  providers: [EmailSettingsService],
  exports: [EmailSettingsService],
})
export class SettingsModule {}
