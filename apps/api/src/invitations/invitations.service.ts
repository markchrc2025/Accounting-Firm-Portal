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
import { PrismaService } from "../prisma/prisma.service";
import {
  AcceptInvitationInput,
  CLIENT_ROLE_NAME,
  ClientRole,
  CreateInvitationInput,
} from "./dto/invitation.schemas";

@Injectable()
export class InvitationsService {
  private readonly ttlHours: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly clients: ClientsService,
    private readonly passwords: PasswordService,
    private readonly audit: AuditService,
    config: ConfigService,
  ) {
    this.ttlHours = Number(config.get<string>("INVITE_TTL_HOURS", "168")); // 7 days
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

    const invitation = await this.prisma.invitation.create({
      data: {
        clientId,
        email,
        role: input.clientRole,
        token,
        expiresAt,
        status: "PENDING",
      },
    });
    await this.audit.record({
      userId: actor.id,
      action: "invitation.create",
      entityType: "Invitation",
      entityId: invitation.id,
      metadata: { email, clientRole: input.clientRole, clientId },
    });

    // The token is returned so the caller (email service, later phase) can send
    // the activation link. It is not persisted anywhere else in plaintext form.
    return {
      id: invitation.id,
      email: invitation.email,
      clientRole: input.clientRole,
      expiresAt: invitation.expiresAt,
      status: invitation.status,
      token,
    };
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
