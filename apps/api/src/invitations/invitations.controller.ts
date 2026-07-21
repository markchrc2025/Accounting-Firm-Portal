import { Body, Controller, Get, Param, Post } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import type { AuthUser } from "../common/auth/auth-user";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { Public } from "../common/decorators/public.decorator";
import { RequirePermissions } from "../common/decorators/require-permissions.decorator";
import { ZodValidationPipe } from "../common/validation/zod-validation.pipe";
import {
  AcceptInvitationInput,
  AcceptInvitationSchema,
  CreateFirmInvitationInput,
  CreateFirmInvitationSchema,
  CreateInvitationInput,
  CreateInvitationSchema,
} from "./dto/invitation.schemas";
import { InvitationsService } from "./invitations.service";

/** Client-scoped invitation management (per-client RBAC via the :clientId param). */
@ApiTags("invitations")
@Controller("clients/:clientId/invitations")
export class ClientInvitationsController {
  constructor(private readonly invitations: InvitationsService) {}

  @Post()
  @RequirePermissions("Invitations:Create")
  invite(
    @CurrentUser() user: AuthUser,
    @Param("clientId") clientId: string,
    @Body(new ZodValidationPipe(CreateInvitationSchema)) body: CreateInvitationInput,
  ) {
    return this.invitations.invite(user, clientId, body);
  }

  @Get()
  @RequirePermissions("Invitations:Read")
  list(@CurrentUser() user: AuthUser, @Param("clientId") clientId: string) {
    return this.invitations.list(user, clientId);
  }

  @Post(":invitationId/revoke")
  @RequirePermissions("Invitations:Revoke")
  revoke(
    @CurrentUser() user: AuthUser,
    @Param("clientId") clientId: string,
    @Param("invitationId") invitationId: string,
  ) {
    return this.invitations.revoke(user, clientId, invitationId);
  }
}

/**
 * Firm-staff invitations (Users & Roles). Managing staff accounts is a
 * Users:* capability (Super Admin), not the client-seat Invitations:* one.
 * A distinct path ("firm-invitations") avoids colliding with /users/:id.
 */
@ApiTags("invitations")
@Controller("firm-invitations")
export class FirmInvitationsController {
  constructor(private readonly invitations: InvitationsService) {}

  @Post()
  @RequirePermissions("Users:Create")
  invite(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(CreateFirmInvitationSchema)) body: CreateFirmInvitationInput,
  ) {
    return this.invitations.inviteFirmUser(user, body);
  }

  @Get()
  @RequirePermissions("Users:Read")
  list(@CurrentUser() user: AuthUser) {
    return this.invitations.listFirm(user);
  }

  @Post(":invitationId/resend")
  @RequirePermissions("Users:Create")
  resend(@CurrentUser() user: AuthUser, @Param("invitationId") invitationId: string) {
    return this.invitations.resendFirm(user, invitationId);
  }

  @Post(":invitationId/revoke")
  @RequirePermissions("Users:Create")
  revoke(@CurrentUser() user: AuthUser, @Param("invitationId") invitationId: string) {
    return this.invitations.revokeFirm(user, invitationId);
  }
}

/** Public invitation acceptance (onboarding a client user). */
@ApiTags("invitations")
@Controller("invitations")
export class PublicInvitationsController {
  constructor(private readonly invitations: InvitationsService) {}

  @Public()
  @Post("accept")
  accept(
    @Body(new ZodValidationPipe(AcceptInvitationSchema)) body: AcceptInvitationInput,
  ) {
    return this.invitations.accept(body);
  }
}
