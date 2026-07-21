import { randomBytes } from "node:crypto";
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { AuthUser } from "../common/auth/auth-user";
import { AuditService } from "../audit/audit.service";
import { PasswordService } from "../auth/password.service";
import { ClientsService } from "../clients/clients.service";
import { MailService } from "../mail/mail.service";
import {
  clientInviteEmail,
  staffInviteEmail,
  type RenderedEmail,
} from "../mail/email-templates";
import { PrismaService } from "../prisma/prisma.service";
import { EmailSettingsService } from "../settings/email-settings.service";
import {
  AcceptInvitationInput,
  CLIENT_ROLE_NAME,
  ClientRole,
  CreateFirmInvitationInput,
  CreateInvitationInput,
} from "./dto/invitation.schemas";

/** Long-form Manila date for invite expiry copy, e.g. "July 28, 2026". */
function longDate(d: Date): string {
  return d.toLocaleDateString("en-PH", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "Asia/Manila",
  });
}

/** Email-delivery state stored on the invitation row. */
type EmailStatus = "SENT" | "FAILED";

const FIRM_INVITE_SELECT = {
  id: true,
  email: true,
  role: true,
  status: true,
  expiresAt: true,
  createdAt: true,
  emailStatus: true,
  emailError: true,
  invitedByName: true,
} as const;

@Injectable()
export class InvitationsService {
  private readonly ttlHours: number;
  private readonly webAppUrl: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly clients: ClientsService,
    private readonly passwords: PasswordService,
    private readonly audit: AuditService,
    private readonly mail: MailService,
    private readonly emailSettings: EmailSettingsService,
    config: ConfigService,
  ) {
    this.ttlHours = Number(config.get<string>("INVITE_TTL_HOURS", "168")); // 7 days
    this.webAppUrl = (
      config.get<string>("WEB_APP_URL", "https://acctgfirm.mcrctas.com") ?? ""
    ).replace(/\/+$/, "");
  }

  // --- Invite email delivery -------------------------------------------------

  private acceptUrl(token: string): string {
    return `${this.webAppUrl}/accept?token=${token}`;
  }

  /** The inviter's display name (snapshotted onto the row for the email). */
  private async inviterName(actorId: string): Promise<string> {
    const user = await this.prisma.user.findUnique({
      where: { id: actorId },
      select: { fullName: true },
    });
    return user?.fullName ?? "Your accountant";
  }

  /**
   * Render (design-handoff templates) + send the invite email, recording the
   * outcome on the row. MailService performs exactly one retry internally; a
   * second failure lands here and becomes a visible "FAILED" state with a
   * Resend button — never an exception (the invitation row stays valid).
   */
  private async deliverInviteEmail(p: {
    invitationId: string;
    to: string;
    firmId: string;
    kind: "FIRM" | "CLIENT";
    inviterName: string;
    roleLabel: string;
    token: string;
    expiresAt: Date;
  }): Promise<{ emailStatus: EmailStatus; emailError: string | null }> {
    let emailStatus: EmailStatus;
    let emailMessageId: string | null = null;
    let emailError: string | null = null;
    try {
      const ctx = await this.emailSettings.resolveContext(p.firmId);
      const rendered: RenderedEmail =
        p.kind === "FIRM"
          ? staffInviteEmail(
              {
                inviterName: p.inviterName,
                role: p.roleLabel,
                acceptUrl: this.acceptUrl(p.token),
                expiryDate: longDate(p.expiresAt),
              },
              ctx.theme,
            )
          : clientInviteEmail({ setupUrl: this.acceptUrl(p.token) }, ctx.theme);
      const result = await this.mail.send({
        to: p.to,
        subject: rendered.subject,
        html: rendered.html,
        text: rendered.text,
        ...ctx.senderFor(rendered.stream),
      });
      emailStatus = "SENT";
      emailMessageId = result.messageId;
    } catch (err) {
      emailStatus = "FAILED";
      emailError = err instanceof Error ? err.message : String(err);
    }
    await this.prisma.invitation.update({
      where: { id: p.invitationId },
      data: { emailStatus, emailMessageId, emailError },
    });
    return { emailStatus, emailError };
  }

  /** Create a client-user invitation, enforcing the client's seat limit (FR-17). */
  async invite(actor: AuthUser, clientId: string, input: CreateInvitationInput) {
    const client = await this.clients.assertInFirm(actor.firmId, clientId);
    const email = input.email.toLowerCase();

    await this.assertSeatAvailable(client.id, client.seatLimit);

    const alreadyPending = await this.prisma.invitation.findFirst({
      where: { clientId, email, status: "PENDING" },
    });
    if (alreadyPending) {
      throw new ConflictException("A pending invitation already exists for this email");
    }

    const token = randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + this.ttlHours * 3600 * 1000);
    const invitedByName = await this.inviterName(actor.id);

    const invitation = await this.prisma.invitation.create({
      data: {
        clientId,
        firmId: client.firmId,
        kind: "CLIENT",
        email,
        role: input.clientRole,
        token,
        expiresAt,
        status: "PENDING",
        invitedByName,
      },
    });
    await this.audit.record({
      userId: actor.id,
      action: "invitation.create",
      entityType: "Invitation",
      entityId: invitation.id,
      metadata: { email, clientRole: input.clientRole, clientId },
    });

    const { emailStatus, emailError } = await this.deliverInviteEmail({
      invitationId: invitation.id,
      to: email,
      firmId: client.firmId,
      kind: "CLIENT",
      inviterName: invitedByName,
      roleLabel: CLIENT_ROLE_NAME[input.clientRole],
      token,
      expiresAt,
    });

    // The token is also returned so the caller can surface the activation link
    // directly (e.g. copy-paste when email is down). Not persisted elsewhere.
    return {
      id: invitation.id,
      email: invitation.email,
      clientRole: input.clientRole,
      expiresAt: invitation.expiresAt,
      status: invitation.status,
      token,
      emailStatus,
      emailError,
    };
  }

  // --- Firm-staff invitations (Users & Roles) --------------------------------

  /** Invite a firm staff member by email + FIRM-scope role. */
  async inviteFirmUser(actor: AuthUser, input: CreateFirmInvitationInput) {
    const email = input.email.toLowerCase();

    const existingUser = await this.prisma.user.findUnique({ where: { email } });
    if (existingUser) {
      throw new ConflictException("A user with this email already exists.");
    }
    const alreadyPending = await this.prisma.invitation.findFirst({
      where: { firmId: actor.firmId, kind: "FIRM", email, status: "PENDING" },
    });
    if (alreadyPending) {
      throw new ConflictException(
        "A pending invitation already exists for this email — resend or revoke it instead.",
      );
    }
    const role = await this.prisma.role.findFirst({
      where: { name: input.roleName, scope: "FIRM" },
    });
    if (!role) {
      const valid = await this.prisma.role.findMany({
        where: { scope: "FIRM" },
        select: { name: true },
        orderBy: { name: "asc" },
      });
      throw new BadRequestException(
        `Unknown firm role "${input.roleName}". Valid roles: ${valid
          .map((r) => r.name)
          .join(", ")}.`,
      );
    }

    const token = randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + this.ttlHours * 3600 * 1000);
    const invitedByName = await this.inviterName(actor.id);

    const invitation = await this.prisma.invitation.create({
      data: {
        firmId: actor.firmId,
        kind: "FIRM",
        email,
        role: role.name,
        token,
        expiresAt,
        status: "PENDING",
        invitedByName,
      },
      select: FIRM_INVITE_SELECT,
    });
    await this.audit.record({
      userId: actor.id,
      action: "invitation.create",
      entityType: "Invitation",
      entityId: invitation.id,
      metadata: { email, kind: "FIRM", roleName: role.name },
    });

    const { emailStatus, emailError } = await this.deliverInviteEmail({
      invitationId: invitation.id,
      to: email,
      firmId: actor.firmId,
      kind: "FIRM",
      inviterName: invitedByName,
      roleLabel: role.name,
      token,
      expiresAt,
    });
    return { ...invitation, emailStatus, emailError };
  }

  async listFirm(actor: AuthUser) {
    return this.prisma.invitation.findMany({
      where: { firmId: actor.firmId, kind: "FIRM" },
      select: FIRM_INVITE_SELECT,
      orderBy: { createdAt: "desc" },
    });
  }

  /** Re-send the invite email for a still-pending firm invitation. */
  async resendFirm(actor: AuthUser, invitationId: string) {
    const invitation = await this.prisma.invitation.findFirst({
      where: { id: invitationId, firmId: actor.firmId, kind: "FIRM" },
    });
    if (!invitation) throw new NotFoundException("Invitation not found");
    if (invitation.status !== "PENDING") {
      throw new BadRequestException(
        `Only pending invitations can be resent (this one is ${invitation.status}).`,
      );
    }
    if (invitation.expiresAt.getTime() < Date.now()) {
      await this.prisma.invitation.update({
        where: { id: invitation.id },
        data: { status: "EXPIRED" },
      });
      throw new BadRequestException(
        "This invitation has expired — revoke it and send a new one.",
      );
    }
    await this.audit.record({
      userId: actor.id,
      action: "invitation.resend",
      entityType: "Invitation",
      entityId: invitation.id,
      metadata: { email: invitation.email, kind: "FIRM" },
    });
    const { emailStatus, emailError } = await this.deliverInviteEmail({
      invitationId: invitation.id,
      to: invitation.email,
      firmId: actor.firmId,
      kind: "FIRM",
      inviterName: invitation.invitedByName ?? (await this.inviterName(actor.id)),
      roleLabel: invitation.role,
      token: invitation.token,
      expiresAt: invitation.expiresAt,
    });
    const fresh = await this.prisma.invitation.findUniqueOrThrow({
      where: { id: invitation.id },
      select: FIRM_INVITE_SELECT,
    });
    return { ...fresh, emailStatus, emailError };
  }

  async revokeFirm(actor: AuthUser, invitationId: string) {
    const invitation = await this.prisma.invitation.findFirst({
      where: { id: invitationId, firmId: actor.firmId, kind: "FIRM" },
    });
    if (!invitation) throw new NotFoundException("Invitation not found");
    if (invitation.status !== "PENDING") {
      throw new BadRequestException("Only pending invitations can be revoked");
    }
    await this.prisma.invitation.update({
      where: { id: invitationId },
      data: { status: "REVOKED" },
    });
    await this.audit.record({
      userId: actor.id,
      action: "invitation.revoke",
      entityType: "Invitation",
      entityId: invitationId,
      metadata: { kind: "FIRM" },
    });
    return { revoked: true };
  }

  async list(actor: AuthUser, clientId: string) {
    await this.clients.assertInFirm(actor.firmId, clientId);
    return this.prisma.invitation.findMany({
      where: { clientId },
      select: {
        id: true,
        email: true,
        role: true,
        status: true,
        expiresAt: true,
        createdAt: true,
      },
      orderBy: { createdAt: "desc" },
    });
  }

  async revoke(actor: AuthUser, clientId: string, invitationId: string) {
    await this.clients.assertInFirm(actor.firmId, clientId);
    const invitation = await this.prisma.invitation.findFirst({
      where: { id: invitationId, clientId },
    });
    if (!invitation) throw new NotFoundException("Invitation not found");
    if (invitation.status !== "PENDING") {
      throw new BadRequestException("Only pending invitations can be revoked");
    }
    await this.prisma.invitation.update({
      where: { id: invitationId },
      data: { status: "REVOKED" },
    });
    await this.audit.record({
      userId: actor.id,
      action: "invitation.revoke",
      entityType: "Invitation",
      entityId: invitationId,
    });
    return { revoked: true };
  }

  /** Public: accept an invitation, creating an active client user. */
  async accept(input: AcceptInvitationInput) {
    const invitation = await this.prisma.invitation.findUnique({
      where: { token: input.token },
      include: { client: true },
    });
    if (!invitation || invitation.status !== "PENDING") {
      throw new BadRequestException("Invitation is invalid or already used");
    }
    if (invitation.expiresAt.getTime() < Date.now()) {
      // Best-effort mark as expired for hygiene.
      await this.prisma.invitation.update({
        where: { id: invitation.id },
        data: { status: "EXPIRED" },
      });
      throw new BadRequestException("Invitation has expired");
    }

    const existing = await this.prisma.user.findUnique({
      where: { email: invitation.email },
    });
    if (existing) {
      throw new ConflictException("An account with this email already exists");
    }

    // Firm-staff invitations create a FIRM user instead of a client seat.
    if (invitation.kind === "FIRM") {
      return this.acceptFirm(
        invitation as { id: string; email: string; role: string; firmId: string | null },
        input,
      );
    }

    if (!invitation.client || !invitation.clientId) {
      throw new BadRequestException("Invitation is invalid or already used");
    }

    // Re-check the seat limit at acceptance time (a seat may have filled since).
    await this.assertSeatAvailable(invitation.clientId, invitation.client.seatLimit, {
      excludeInvitationId: invitation.id,
    });

    const role = await this.prisma.role.findFirst({
      where: {
        name: CLIENT_ROLE_NAME[invitation.role as ClientRole],
        scope: "CLIENT",
      },
    });
    if (!role) {
      throw new BadRequestException("Client role is not configured; run the seed");
    }

    const passwordHash = await this.passwords.hash(input.password);

    const user = await this.prisma.user.create({
      data: {
        firmId: invitation.client.firmId,
        userType: "CLIENT",
        email: invitation.email,
        fullName: input.fullName,
        passwordHash,
        status: "ACTIVE",
        clientProfile: {
          create: { clientId: invitation.clientId, clientRole: invitation.role },
        },
        userRoles: {
          create: { roleId: role.id, clientScopeId: invitation.clientId },
        },
      },
      select: { id: true, email: true, fullName: true },
    });

    await this.prisma.invitation.update({
      where: { id: invitation.id },
      data: { status: "ACCEPTED" },
    });
    await this.audit.record({
      userId: user.id,
      action: "invitation.accept",
      entityType: "User",
      entityId: user.id,
      metadata: { clientId: invitation.clientId, clientRole: invitation.role },
    });

    return { userId: user.id, email: user.email, clientId: invitation.clientId };
  }

  /** Accept a FIRM-staff invitation: create an active firm user with the role. */
  private async acceptFirm(
    invitation: { id: string; email: string; role: string; firmId: string | null },
    input: AcceptInvitationInput,
  ) {
    if (!invitation.firmId) {
      throw new BadRequestException("Invitation is invalid or already used");
    }
    const role = await this.prisma.role.findFirst({
      where: { name: invitation.role, scope: "FIRM" },
    });
    if (!role) {
      throw new BadRequestException("Firm role is not configured; run the seed");
    }
    const passwordHash = await this.passwords.hash(input.password);
    const user = await this.prisma.user.create({
      data: {
        firmId: invitation.firmId,
        userType: "FIRM",
        email: invitation.email,
        fullName: input.fullName,
        passwordHash,
        status: "ACTIVE",
        firmProfile: { create: {} },
        userRoles: { create: { roleId: role.id } },
      },
      select: { id: true, email: true, fullName: true },
    });
    await this.prisma.invitation.update({
      where: { id: invitation.id },
      data: { status: "ACCEPTED" },
    });
    await this.audit.record({
      userId: user.id,
      action: "invitation.accept",
      entityType: "User",
      entityId: user.id,
      metadata: { kind: "FIRM", roleName: invitation.role },
    });
    return { userId: user.id, email: user.email, clientId: null };
  }

  /**
   * Throws if the client has no free seat. A seat is consumed by each active
   * client user and each still-pending invitation.
   */
  private async assertSeatAvailable(
    clientId: string,
    seatLimit: number,
    opts: { excludeInvitationId?: string } = {},
  ) {
    const [members, pending] = await Promise.all([
      this.prisma.clientUserProfile.count({ where: { clientId } }),
      this.prisma.invitation.count({
        where: {
          clientId,
          status: "PENDING",
          ...(opts.excludeInvitationId ? { id: { not: opts.excludeInvitationId } } : {}),
        },
      }),
    ]);
    if (members + pending >= seatLimit) {
      throw new BadRequestException(
        `Seat limit reached (${seatLimit}). Raise the client's seat limit to invite more users.`,
      );
    }
  }
}
