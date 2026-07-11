import { Injectable, UnauthorizedException } from "@nestjs/common";
import type { AuthUser } from "../common/auth/auth-user";
import { AuditService } from "../audit/audit.service";
import { PrismaService } from "../prisma/prisma.service";
import { StorageService } from "../storage/storage.service";
import type { UpdateProfileInput } from "./dto/profile.schemas";

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
