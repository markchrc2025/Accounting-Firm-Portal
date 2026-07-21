import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { ClientsModule } from "../clients/clients.module";
import { MailModule } from "../mail/mail.module";
import {
  ClientInvitationsController,
  FirmInvitationsController,
  PublicInvitationsController,
} from "./invitations.controller";
import { InvitationsService } from "./invitations.service";

@Module({
  // PasswordService + ClientsService + MailService (invite emails)
  imports: [AuthModule, ClientsModule, MailModule],
  controllers: [
    ClientInvitationsController,
    FirmInvitationsController,
    PublicInvitationsController,
  ],
  providers: [InvitationsService],
})
export class InvitationsModule {}
