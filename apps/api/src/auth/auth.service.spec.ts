import { UnauthorizedException } from "@nestjs/common";
import { AuthService } from "./auth.service";
import type { MfaService } from "./mfa.service";
import type { PasswordService } from "./password.service";
import type { TokenService } from "./token.service";
import type { AuditService } from "../audit/audit.service";
import type { PrismaService } from "../prisma/prisma.service";
import type { RbacService } from "../rbac/rbac.service";

const baseUser = {
  id: "u1",
  email: "a@firm.test",
  fullName: "Ada",
  userType: "FIRM" as const,
  firmId: "f1",
  passwordHash: "hash",
  status: "ACTIVE" as "ACTIVE" | "DISABLED",
  mfaEnabled: false,
  mfaSecret: null as string | null,
  clientProfile: null,
};

function makeService(overrides: {
  user?: Partial<typeof baseUser> | null;
  passwordOk?: boolean;
  mfaOk?: boolean;
}) {
  const user =
    overrides.user === null ? null : { ...baseUser, ...(overrides.user ?? {}) };
  const prisma = {
    user: {
      findUnique: jest.fn().mockResolvedValue(user),
      update: jest.fn().mockResolvedValue(user),
    },
  } as unknown as PrismaService;
  const passwords = {
    verify: jest.fn().mockResolvedValue(overrides.passwordOk ?? true),
  } as unknown as PasswordService;
  const tokens = {
    signAccess: jest.fn().mockReturnValue("access.jwt"),
    signMfa: jest.fn().mockReturnValue("mfa.jwt"),
    verify: jest.fn().mockReturnValue({ sub: "u1", typ: "mfa" }),
  } as unknown as TokenService;
  const mfa = {
    verify: jest.fn().mockReturnValue(overrides.mfaOk ?? true),
  } as unknown as MfaService;
  const rbac = { describe: jest.fn() } as unknown as RbacService;
  const audit = {
    record: jest.fn().mockResolvedValue(undefined),
  } as unknown as AuditService;
  return {
    svc: new AuthService(prisma, passwords, tokens, mfa, rbac, audit),
    prisma,
    tokens,
  };
}

describe("AuthService.login", () => {
  it("returns an access token when MFA is disabled", async () => {
    const { svc } = makeService({});
    const res = await svc.login("a@firm.test", "pw");
    expect(res).toMatchObject({ status: "ok", accessToken: "access.jwt" });
  });

  it("returns an mfa challenge when MFA is enabled", async () => {
    const { svc } = makeService({ user: { mfaEnabled: true, mfaSecret: "S" } });
    const res = await svc.login("a@firm.test", "pw");
    expect(res).toEqual({ status: "mfa_required", mfaToken: "mfa.jwt" });
  });

  it("rejects a wrong password", async () => {
    const { svc } = makeService({ passwordOk: false });
    await expect(svc.login("a@firm.test", "bad")).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it("rejects an inactive account", async () => {
    const { svc } = makeService({ user: { status: "DISABLED" } });
    await expect(svc.login("a@firm.test", "pw")).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it("rejects an unknown account without leaking existence", async () => {
    const { svc } = makeService({ user: null });
    await expect(svc.login("ghost@firm.test", "pw")).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });
});

describe("AuthService.verifyMfa", () => {
  it("issues an access token on a valid code", async () => {
    const { svc } = makeService({
      user: { mfaEnabled: true, mfaSecret: "S" },
      mfaOk: true,
    });
    const res = await svc.verifyMfa("mfa.jwt", "123456");
    expect(res.accessToken).toBe("access.jwt");
  });

  it("rejects an invalid code", async () => {
    const { svc } = makeService({
      user: { mfaEnabled: true, mfaSecret: "S" },
      mfaOk: false,
    });
    await expect(svc.verifyMfa("mfa.jwt", "000000")).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });
});
