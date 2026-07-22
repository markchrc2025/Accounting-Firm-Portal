import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { MailModule } from "../mail/mail.module";
import { SettingsModule } from "../settings/settings.module";
import { UsersController } from "./users.controller";
import { UsersService } from "./users.service";

@Module({
  imports: [AuthModule, MailModule, SettingsModule], // PasswordService + role-change email
  controllers: [UsersController],
  providers: [UsersService],
})
export class UsersModule {}
