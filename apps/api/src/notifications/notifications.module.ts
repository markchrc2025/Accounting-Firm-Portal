import { Module } from "@nestjs/common";
import { MailModule } from "../mail/mail.module";
import { SettingsModule } from "../settings/settings.module";
import { NotificationsController } from "./notifications.controller";
import { NotificationsService } from "./notifications.service";

/** PA2 (D66): generic notifications. Other modules call record() in their transaction, deliver() after it. */
@Module({
  imports: [MailModule, SettingsModule],
  controllers: [NotificationsController],
  providers: [NotificationsService],
  exports: [NotificationsService],
})
export class NotificationsModule {}
