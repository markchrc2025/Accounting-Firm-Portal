import {
  ConflictException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import type { AuthUser } from "../common/auth/auth-user";
import { AuditService } from "../audit/audit.service";
import { PasswordService } from "../auth/password.service";
import { PrismaService } from "../prisma/prisma.service";
import { StorageService } from "../storage/storage.service";
import type { ChangeEmailInput, UpdateProfileInput } from "./dto/profile.schemas";

/** The self-service profile shape returned to the authenticated user. */
export interface ProfileDto {
  id: string;
  fullName: string;
  email: string;
  userType: "FIRM" | "CLIENT";
  mfaEnabled: boolean;
  avatarUrl: string | null;
}

/**
 * Self-service account management (FR-03). Every method operates on the caller's
 * OWN account — there is no RBAC here; the JWT identifies the user.
 */
@Injectable()
export class ProfileService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
    private readonly passwords: PasswordService,
  ) {}

  /** Presign the avatar GET url when the key is set AND storage is enabled. */
  private async avatarUrl(avatarPath: string | null): Promise<string | null> {
    if (!avatarPath || !this.storage.isEnabled()) return null;
    return this.storage.signedGetUrl(avatarPath);
  }

  private async toDto(record: {
    id: string;
    fullName: string;
    email: string;
    userType: "FIRM" | "CLIENT";
    mfaEnabled: boolean;
    avatarPath: string | null;
  }): Promise<ProfileDto> {
    return {
      id: record.id,
      fullName: record.fullName,
      email: record.email,
      userType: record.userType,
      mfaEnabled: record.mfaEnabled,
      avatarUrl: await this.avatarUrl(record.avatarPath),
    };
  }

  async getMe(user: AuthUser): Promise<ProfileDto> {
    const record = await this.prisma.user.findUnique({
      where: { id: user.id },
      select: {
        id: true,
        fullName: true,
        email: true,
        userType: true,
        mfaEnabled: true,
        avatarPath: true,
      },
    });
    if (!record) throw new UnauthorizedException("Account no longer exists");
    return this.toDto(record);
  }

  async updateMe(user: AuthUser, input: UpdateProfileInput): Promise<ProfileDto> {
    const record = await this.prisma.user.update({
      where: { id: user.id },
      data: { fullName: input.fullName },
      select: {
        id: true,
        fullName: true,
        email: true,
        userType: true,
        mfaEnabled: true,
        avatarPath: true,
      },
    });
    await this.audit.record({
      userId: user.id,
      action: "profile.update",
      entityType: "User",
      entityId: user.id,
      metadata: { fields: Object.keys(input) },
    });
    return this.toDto(record);
  }

  /**
   * Change the caller's OWN login email. Guarded by a fresh password check
   * (possession of a live session is not enough to rotate the login
   * identifier), firm users only — client-portal seat emails are managed by
   * the firm. The JWT stays valid (it is keyed by user id); the new email
   * applies from the next sign-in.
   */
  async changeEmail(user: AuthUser, input: ChangeEmailInput): Promise<ProfileDto> {
    if (user.userType !== "FIRM") {
      throw new ForbiddenException("Client-portal emails are managed by the firm.");
    }
    const record = await this.prisma.user.findUnique({
      where: { id: user.id },
      select: { id: true, email: true, passwordHash: true },
    });
    if (!record?.passwordHash) throw new UnauthorizedException("Account has no password set");
    const ok = await this.passwords.verify(record.passwordHash, input.currentPassword);
    if (!ok) throw new UnauthorizedException("Incorrect password");

    // Login lowercases the email, so store it normalized (matches AuthService).
    const newEmail = input.newEmail.trim().toLowerCase();
    if (newEmail !== record.email) {
      const taken = await this.prisma.user.findUnique({ where: { email: newEmail } });
      if (taken && taken.id !== user.id) {
        throw new ConflictException("That email is already in use by another account.");
      }
    }
    const updated = await this.prisma.user.update({
      where: { id: user.id },
      data: { email: newEmail },
      select: {
        id: true,
        fullName: true,
        email: true,
        userType: true,
        mfaEnabled: true,
        avatarPath: true,
      },
    });
    await this.audit.record({
      userId: user.id,
      action: "profile.email.change",
      entityType: "User",
      entityId: user.id,
      metadata: { from: record.email, to: newEmail },
    });
    return this.toDto(updated);
  }

  /** Store an uploaded avatar image and record its object key on the user. */
  async uploadAvatar(
    user: AuthUser,
    bytes: Uint8Array,
    contentType: string,
  ): Promise<{ avatarUrl: string }> {
    const key = this.storage.avatarKey(user.id);
    await this.storage.putAvatar(key, bytes, contentType);
    await this.prisma.user.update({
      where: { id: user.id },
      data: { avatarPath: key },
    });
    await this.audit.record({
      userId: user.id,
      action: "profile.avatar.upload",
      entityType: "User",
      entityId: user.id,
    });
    return { avatarUrl: await this.storage.signedGetUrl(key) };
  }

  /** Remove the user's avatar (best-effort object delete + clear the column). */
  async removeAvatar(user: AuthUser): Promise<{ ok: true }> {
    const record = await this.prisma.user.findUnique({
      where: { id: user.id },
      select: { avatarPath: true },
    });
    if (record?.avatarPath) {
      // Best-effort: a transient object-storage failure must not block clearing
      // the reference (else the UI is stuck pointing at an unremovable file).
      try {
        await this.storage.deleteAvatar(record.avatarPath);
      } catch {
        /* swallow — the column is cleared below regardless */
      }
      await this.prisma.user.update({
        where: { id: user.id },
        data: { avatarPath: null },
      });
      await this.audit.record({
        userId: user.id,
        action: "profile.avatar.delete",
        entityType: "User",
        entityId: user.id,
      });
    }
    return { ok: true };
  }
}
