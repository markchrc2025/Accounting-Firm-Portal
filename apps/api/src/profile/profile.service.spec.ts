import {
  ConflictException,
  ForbiddenException,
  UnauthorizedException,
} from "@nestjs/common";
import { ProfileService } from "./profile.service";
import type { AuditService } from "../audit/audit.service";
import type { PasswordService } from "../auth/password.service";
import type { PrismaService } from "../prisma/prisma.service";
import type { StorageService } from "../storage/storage.service";
import type { AuthUser } from "../common/auth/auth-user";

const actor: AuthUser = { id: "u1", firmId: "f1", userType: "FIRM", email: "a@f.test" };

const baseRecord = {
  id: "u1",
  fullName: "Ada Lovelace",
  email: "a@f.test",
  userType: "FIRM" as const,
  mfaEnabled: false,
  avatarPath: null as string | null,
  passwordHash: "argon2-hash",
};

function build(overrides: {
  user?: Record<string, unknown>;
  storage?: Record<string, unknown>;
  passwords?: Record<string, unknown>;
} = {}) {
  const prisma = {
    user: {
      findUnique: jest.fn().mockResolvedValue(baseRecord),
      update: jest.fn().mockResolvedValue(baseRecord),
      ...overrides.user,
    },
  } as unknown as PrismaService;
  const storage = {
    isEnabled: jest.fn().mockReturnValue(true),
    avatarKey: jest.fn((id: string) => `avatars/${id}`),
    putAvatar: jest.fn().mockResolvedValue(undefined),
    deleteAvatar: jest.fn().mockResolvedValue(undefined),
    signedGetUrl: jest.fn().mockResolvedValue("https://signed.example/avatar"),
    ...overrides.storage,
  } as unknown as StorageService;
  const audit = {
    record: jest.fn().mockResolvedValue(undefined),
  } as unknown as AuditService;
  const passwords = {
    verify: jest.fn().mockResolvedValue(true),
    hash: jest.fn(),
    ...overrides.passwords,
  } as unknown as PasswordService;
  return {
    svc: new ProfileService(prisma, storage, audit, passwords),
    prisma,
    storage,
    audit,
    passwords,
  };
}

describe("ProfileService", () => {
  it("maps fields and returns null avatarUrl when avatarPath is unset", async () => {
    const { svc, storage } = build();
    const dto = await svc.getMe(actor);
    expect(dto).toEqual({
      id: "u1",
      fullName: "Ada Lovelace",
      email: "a@f.test",
      userType: "FIRM",
      mfaEnabled: false,
      avatarUrl: null,
    });
    expect((storage.signedGetUrl as jest.Mock)).not.toHaveBeenCalled();
  });

  it("presigns avatarUrl when avatarPath is set and storage is enabled", async () => {
    const { svc, storage } = build({
      user: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ ...baseRecord, avatarPath: "avatars/u1" }),
      },
    });
    const dto = await svc.getMe(actor);
    expect(dto.avatarUrl).toBe("https://signed.example/avatar");
    expect((storage.signedGetUrl as jest.Mock).mock.calls[0]![0]).toBe("avatars/u1");
  });

  it("returns null avatarUrl when storage is disabled even with a stored path", async () => {
    const { svc } = build({
      user: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ ...baseRecord, avatarPath: "avatars/u1" }),
      },
      storage: { isEnabled: jest.fn().mockReturnValue(false) },
    });
    const dto = await svc.getMe(actor);
    expect(dto.avatarUrl).toBeNull();
  });

  it("updates fullName and returns the mapped profile", async () => {
    const updated = { ...baseRecord, fullName: "Grace Hopper" };
    const { svc, prisma } = build({
      user: {
        findUnique: jest.fn().mockResolvedValue(baseRecord),
        update: jest.fn().mockResolvedValue(updated),
      },
    });
    const dto = await svc.updateMe(actor, { fullName: "Grace Hopper" });
    expect((prisma.user.update as jest.Mock).mock.calls[0]![0]).toEqual({
      where: { id: "u1" },
      data: { fullName: "Grace Hopper" },
      select: {
        id: true,
        fullName: true,
        email: true,
        userType: true,
        mfaEnabled: true,
        avatarPath: true,
      },
    });
    expect(dto.fullName).toBe("Grace Hopper");
    expect(dto.avatarUrl).toBeNull();
  });

  describe("changeEmail", () => {
    const input = { newEmail: "New@Firm.Test", currentPassword: "s3cret" };

    it("rejects client-portal users (firm manages their seat emails)", async () => {
      const { svc, passwords } = build();
      const client: AuthUser = { ...actor, userType: "CLIENT" };
      await expect(svc.changeEmail(client, input)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect((passwords.verify as jest.Mock)).not.toHaveBeenCalled();
    });

    it("rejects when the account has no password set", async () => {
      const { svc } = build({
        user: {
          findUnique: jest
            .fn()
            .mockResolvedValue({ ...baseRecord, passwordHash: null }),
        },
      });
      await expect(svc.changeEmail(actor, input)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });

    it("rejects a wrong current password without touching the record", async () => {
      const { svc, prisma } = build({
        passwords: { verify: jest.fn().mockResolvedValue(false) },
      });
      await expect(svc.changeEmail(actor, input)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
      expect((prisma.user.update as jest.Mock)).not.toHaveBeenCalled();
    });

    it("rejects an email already used by another account", async () => {
      const findUnique = jest
        .fn()
        // 1st call: load the caller's record; 2nd call: uniqueness probe.
        .mockResolvedValueOnce(baseRecord)
        .mockResolvedValueOnce({ id: "other-user" });
      const { svc, prisma } = build({ user: { findUnique } });
      await expect(svc.changeEmail(actor, input)).rejects.toBeInstanceOf(
        ConflictException,
      );
      // The uniqueness probe uses the normalized (lowercased) email.
      expect(findUnique.mock.calls[1]![0]).toEqual({
        where: { email: "new@firm.test" },
      });
      expect((prisma.user.update as jest.Mock)).not.toHaveBeenCalled();
    });

    it("normalizes, updates, and audits the change on success", async () => {
      const updated = { ...baseRecord, email: "new@firm.test" };
      const findUnique = jest
        .fn()
        .mockResolvedValueOnce(baseRecord)
        .mockResolvedValueOnce(null); // email is free
      const { svc, prisma, audit, passwords } = build({
        user: { findUnique, update: jest.fn().mockResolvedValue(updated) },
      });
      const dto = await svc.changeEmail(actor, input);
      expect((passwords.verify as jest.Mock).mock.calls[0]).toEqual([
        "argon2-hash",
        "s3cret",
      ]);
      expect((prisma.user.update as jest.Mock).mock.calls[0]![0]).toMatchObject({
        where: { id: "u1" },
        data: { email: "new@firm.test" },
      });
      expect(dto.email).toBe("new@firm.test");
      expect((audit.record as jest.Mock).mock.calls[0]![0]).toMatchObject({
        action: "profile.email.change",
        entityId: "u1",
        metadata: { from: "a@f.test", to: "new@firm.test" },
      });
    });

    it("skips the uniqueness probe when only the casing changes", async () => {
      const findUnique = jest.fn().mockResolvedValueOnce(baseRecord);
      const updated = { ...baseRecord };
      const { svc } = build({
        user: { findUnique, update: jest.fn().mockResolvedValue(updated) },
      });
      const dto = await svc.changeEmail(actor, {
        newEmail: "A@F.TEST",
        currentPassword: "s3cret",
      });
      expect(findUnique).toHaveBeenCalledTimes(1);
      expect(dto.email).toBe("a@f.test");
    });
  });
});
