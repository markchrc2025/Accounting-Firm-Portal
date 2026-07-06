import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { ClientsModule } from "../clients/clients.module";
import {
  ClientInvitationsController,
  PublicInvitationsController,
} from "./invitations.controller";
import { InvitationsService } from "./invitations.service";

@Module({
  imports: [AuthModule, ClientsModule], // PasswordService + ClientsService
  controllers: [ClientInvitationsController, PublicInvitationsController],
  providers: [InvitationsService],
})
export class InvitationsModule {}
