import { BadRequestException } from "@nestjs/common";
import type { ConfigService } from "@nestjs/config";
import { InvitationsService } from "./invitations.service";
import type { AuditService } from "../audit/audit.service";
import type { PasswordService } from "../auth/password.service";
import type { ClientsService } from "../clients/clients.service";
import type { PrismaService } from "../prisma/prisma.service";
import type { AuthUser } from "../common/auth/auth-user";

const actor: AuthUser = { id: "u1", firmId: "f1", userType: "FIRM", email: "a@f.test" };

function build(prismaOverrides: Record<string, unknown>) {
  const prisma = {
    clientUserProfile: { count: jest.fn().mockResolvedValue(0) },
    invitation: {
      count: jest.fn().mockResolvedValue(0),
      findFirst: jest.fn().mockResolvedValue(null),
      findUnique: jest.fn(),
      create: jest.fn().mockResolvedValue({
        id: "inv1",
        email: "c@x.test",
        expiresAt: new Date(1),
        status: "PENDING",
      }),
      update: jest.fn().mockResolvedValue({}),
    },
    user: { findUnique: jest.fn().mockResolvedValue(null), create: jest.fn() },
    role: { findFirst: jest.fn() },
    ...prismaOverrides,
  } as unknown as PrismaService;

  const clients = {
    assertInFirm: jest.fn().mockResolvedValue({ id: "c1", seatLimit: 3, firmId: "f1" }),
  } as unknown as ClientsService;
  const passwords = {
    hash: jest.fn().mockResolvedValue("hash"),
  } as unknown as PasswordService;
  const audit = {
    record: jest.fn().mockResolvedValue(undefined),
  } as unknown as AuditService;
  const config = { get: jest.fn().mockReturnValue("168") } as unknown as ConfigService;

  return {
    svc: new InvitationsService(prisma, clients, passwords, audit, config),
    prisma,
  };
}

describe("InvitationsService.invite (seat limit)", () => {
  it("blocks when members + pending invitations fill the seat limit", async () => {
    const { svc } = build({
      clientUserProfile: { count: jest.fn().mockResolvedValue(2) },
      invitation: {
        count: jest.fn().mockResolvedValue(1), // 2 + 1 >= seatLimit(3)
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn(),
      },
    });
    await expect(
      svc.invite(actor, "c1", { email: "c@x.test", clientRole: "VIEWER" }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("issues a token when a seat is available", async () => {
    const { svc } = build({
      clientUserProfile: { count: jest.fn().mockResolvedValue(1) },
      invitation: {
        count: jest.fn().mockResolvedValue(0),
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({
          id: "inv1",
          email: "c@x.test",
          expiresAt: new Date(Date.now() + 1000),
          status: "PENDING",
        }),
      },
    });
    const res = await svc.invite(actor, "c1", { email: "c@x.test", clientRole: "OWNER" });
    expect(res.token).toHaveLength(64);
    expect(res.status).toBe("PENDING");
  });
});

describe("InvitationsService.accept (expiry)", () => {
  it("rejects and marks an expired invitation", async () => {
    const update = jest.fn().mockResolvedValue({});
    const { svc } = build({
      invitation: {
        findUnique: jest.fn().mockResolvedValue({
          id: "inv1",
          status: "PENDING",
          expiresAt: new Date(Date.now() - 1000), // expired
          clientId: "c1",
          role: "VIEWER",
          client: { firmId: "f1", seatLimit: 3 },
        }),
        update,
        count: jest.fn().mockResolvedValue(0),
      },
    });
    await expect(
      svc.accept({ token: "t", fullName: "Bob", password: "password1" }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: "EXPIRED" } }),
    );
  });

  it("rejects an unknown / already-used token", async () => {
    const { svc } = build({
      invitation: { findUnique: jest.fn().mockResolvedValue(null) },
    });
    await expect(
      svc.accept({ token: "nope", fullName: "Bob", password: "password1" }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
