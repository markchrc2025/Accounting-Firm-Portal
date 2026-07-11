import { ProfileService } from "./profile.service";
import type { AuditService } from "../audit/audit.service";
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
};

function build(overrides: {
  user?: Record<string, unknown>;
  storage?: Record<string, unknown>;
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
  return { svc: new ProfileService(prisma, storage, audit), prisma, storage };
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
});
