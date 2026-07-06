import { BadRequestException, Injectable, UnauthorizedException } from "@nestjs/common";
import type { AuthUser } from "../common/auth/auth-user";
import { AuditService } from "../audit/audit.service";
import { PrismaService } from "../prisma/prisma.service";
import { RbacService } from "../rbac/rbac.service";
import { MfaService } from "./mfa.service";
import { PasswordService } from "./password.service";
import { TokenService } from "./token.service";

export type LoginResult =
  | { status: "ok"; accessToken: string; user: PublicUser }
  | { status: "mfa_required"; mfaToken: string };

export interface PublicUser {
  id: string;
  email: string;
  fullName: string;
  userType: "FIRM" | "CLIENT";
  firmId: string;
  clientId?: string;
  mfaEnabled: boolean;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly tokens: TokenService,
    private readonly mfa: MfaService,
    private readonly rbac: RbacService,
    private readonly audit: AuditService,
  ) {}

  async login(email: string, password: string, ip?: string): Promise<LoginResult> {
    const user = await this.prisma.user.findUnique({
      where: { email: email.toLowerCase() },
      include: { clientProfile: true },
    });

    // Uniform failure to avoid leaking which accounts exist / are active.
    if (!user || !user.passwordHash || user.status !== "ACTIVE") {
      await this.failAudit(email, ip, "user_absent_or_inactive");
      throw new UnauthorizedException("Invalid credentials");
    }

    const ok = await this.passwords.verify(user.passwordHash, password);
    if (!ok) {
      await this.failAudit(email, ip, "bad_password", user.id);
      throw new UnauthorizedException("Invalid credentials");
    }

    const tokenUser = {
      id: user.id,
      firmId: user.firmId,
      userType: user.userType,
      email: user.email,
      clientId: user.clientProfile?.clientId ?? null,
    };

    if (user.mfaEnabled) {
      await this.audit.record({
        userId: user.id,
        action: "auth.login.mfa_challenge",
        entityType: "User",
        entityId: user.id,
        ipAddress: ip,
      });
      return { status: "mfa_required", mfaToken: this.tokens.signMfa(tokenUser) };
    }

    await this.markLoggedIn(user.id, ip);
    return {
      status: "ok",
      accessToken: this.tokens.signAccess(tokenUser),
      user: this.toPublicUser(user),
    };
  }

  async verifyMfa(
    mfaToken: string,
    code: string,
    ip?: string,
  ): Promise<{
    accessToken: string;
    user: PublicUser;
  }> {
    let payload;
    try {
      payload = this.tokens.verify(mfaToken, "mfa");
    } catch {
      throw new UnauthorizedException("Invalid or expired MFA token");
    }

    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      include: { clientProfile: true },
    });
    if (!user || !user.mfaEnabled || !user.mfaSecret) {
      throw new UnauthorizedException("MFA not available for this account");
    }

    if (!this.mfa.verify(user.mfaSecret, code)) {
      await this.audit.record({
        userId: user.id,
        action: "auth.mfa.failed",
        entityType: "User",
        entityId: user.id,
        ipAddress: ip,
      });
      throw new UnauthorizedException("Invalid MFA code");
    }

    await this.markLoggedIn(user.id, ip);
    return {
      accessToken: this.tokens.signAccess({
        id: user.id,
        firmId: user.firmId,
        userType: user.userType,
        email: user.email,
        clientId: user.clientProfile?.clientId ?? null,
      }),
      user: this.toPublicUser(user),
    };
  }

  /** Begin MFA enrollment: store a pending secret and return the provisioning URI. */
  async enrollMfa(user: AuthUser): Promise<{ otpauthUrl: string; secret: string }> {
    const { secret, otpauthUrl } = this.mfa.enroll(user.email);
    // Store the secret but keep mfaEnabled=false until a code is confirmed.
    await this.prisma.user.update({
      where: { id: user.id },
      data: { mfaSecret: secret, mfaEnabled: false },
    });
    return { otpauthUrl, secret };
  }

  /** Confirm MFA enrollment by verifying the first code, then enable MFA. */
  async confirmMfa(user: AuthUser, code: string): Promise<{ mfaEnabled: true }> {
    const record = await this.prisma.user.findUnique({ where: { id: user.id } });
    if (!record?.mfaSecret) {
      throw new BadRequestException("Start MFA enrollment first");
    }
    if (!this.mfa.verify(record.mfaSecret, code)) {
      throw new BadRequestException("Invalid MFA code");
    }
    await this.prisma.user.update({
      where: { id: user.id },
      data: { mfaEnabled: true },
    });
    await this.audit.record({
      userId: user.id,
      action: "auth.mfa.enrolled",
      entityType: "User",
      entityId: user.id,
    });
    return { mfaEnabled: true };
  }

  async me(user: AuthUser): Promise<{
    user: PublicUser;
    permissions: Awaited<ReturnType<RbacService["describe"]>>;
  }> {
    const record = await this.prisma.user.findUnique({
      where: { id: user.id },
      include: { clientProfile: true },
    });
    if (!record) throw new UnauthorizedException("Account no longer exists");
    return {
      user: this.toPublicUser(record),
      permissions: await this.rbac.describe(user),
    };
  }

  private async markLoggedIn(userId: string, ip?: string): Promise<void> {
    await this.prisma.user.update({
      where: { id: userId },
      data: { lastLoginAt: new Date() },
    });
    await this.audit.record({
      userId,
      action: "auth.login.success",
      entityType: "User",
      entityId: userId,
      ipAddress: ip,
    });
  }

  private async failAudit(
    email: string,
    ip: string | undefined,
    reason: string,
    userId?: string,
  ): Promise<void> {
    await this.audit.record({
      userId: userId ?? null,
      action: "auth.login.failed",
      entityType: "User",
      entityId: userId ?? null,
      ipAddress: ip,
      metadata: { email, reason },
    });
  }

  private toPublicUser(user: {
    id: string;
    email: string;
    fullName: string;
    userType: "FIRM" | "CLIENT";
    firmId: string;
    mfaEnabled: boolean;
    clientProfile?: { clientId: string } | null;
  }): PublicUser {
    return {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      userType: user.userType,
      firmId: user.firmId,
      mfaEnabled: user.mfaEnabled,
      ...(user.clientProfile ? { clientId: user.clientProfile.clientId } : {}),
    };
  }
}
