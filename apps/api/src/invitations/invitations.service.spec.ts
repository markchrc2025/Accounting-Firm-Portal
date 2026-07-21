import { BadRequestException } from "@nestjs/common";
import type { ConfigService } from "@nestjs/config";
import { InvitationsService } from "./invitations.service";
import type { AuditService } from "../audit/audit.service";
import type { PasswordService } from "../auth/password.service";
import type { ClientsService } from "../clients/clients.service";
import type { MailService } from "../mail/mail.service";
import type { EmailSettingsService } from "../settings/email-settings.service";
import type { PrismaService } from "../prisma/prisma.service";
import type { AuthUser } from "../common/auth/auth-user";

const actor: AuthUser = { id: "u1", firmId: "f1", userType: "FIRM", email: "a@f.test" };

function build(
  prismaOverrides: Record<string, unknown> = {},
  mailOverrides: Record<string, unknown> = {},
) {
  const prisma = {
    clientUserProfile: { count: jest.fn().mockResolvedValue(0) },
    invitation: {
      count: jest.fn().mockResolvedValue(0),
      findFirst: jest.fn().mockResolvedValue(null),
      findUnique: jest.fn(),
      findUniqueOrThrow: jest.fn().mockResolvedValue({
        id: "inv1",
        email: "c@x.test",
        role: "Accountant",
        status: "PENDING",
        expiresAt: new Date(1),
        createdAt: new Date(1),
        emailStatus: "SENT",
        emailError: null,
        invitedByName: null,
      }),
      create: jest.fn().mockResolvedValue({
        id: "inv1",
        email: "c@x.test",
        expiresAt: new Date(1),
        status: "PENDING",
      }),
      update: jest.fn().mockResolvedValue({}),
    },
    user: { findUnique: jest.fn().mockResolvedValue(null), create: jest.fn() },
    role: { findFirst: jest.fn(), findMany: jest.fn().mockResolvedValue([]) },
    firm: { findUnique: jest.fn().mockResolvedValue({ name: "MCRC Tax & Accounting" }) },
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
  const mail = {
    isEnabled: jest.fn().mockReturnValue(true),
    send: jest.fn().mockResolvedValue({ provider: "plunk", messageId: "em_1" }),
    ...mailOverrides,
  } as unknown as MailService;
  const emailSettings = {
    resolveContext: jest.fn().mockResolvedValue({
      theme: {
        firmName: "MCRC Tax & Accounting Services",
        supportEmail: "support@mcrctas.com",
        buttonAccent: "navy",
        showBrandLockup: true,
      },
      billingFooterEmail: "billing@mcrctas.com",
      senderFor: () => ({ fromEmail: "invites@mcrctas.com", fromName: "MCRC Tax & Accounting" }),
    }),
  } as unknown as EmailSettingsService;
  const config = { get: jest.fn().mockReturnValue("168") } as unknown as ConfigService;

  return {
    svc: new InvitationsService(prisma, clients, passwords, audit, mail, emailSettings, config),
    prisma,
    mail,
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
        update: jest.fn().mockResolvedValue({}),
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

describe("Invite email delivery", () => {
  it("marks the invitation SENT and stores the provider message id", async () => {
    const { svc, prisma, mail } = build();
    const res = await svc.invite(actor, "c1", { email: "c@x.test", clientRole: "VIEWER" });
    expect(res.emailStatus).toBe("SENT");
    expect((mail.send as jest.Mock).mock.calls[0]![0]).toMatchObject({ to: "c@x.test" });
    expect((prisma.invitation.update as jest.Mock).mock.calls[0]![0]).toMatchObject({
      where: { id: "inv1" },
      data: { emailStatus: "SENT", emailMessageId: "em_1" },
    });
  });

  it("keeps the invitation but marks FAILED when the provider errors (after its one retry)", async () => {
    const { svc, prisma } = build(
      {},
      { send: jest.fn().mockRejectedValue(new Error("Plunk responded 500: boom")) },
    );
    const res = await svc.invite(actor, "c1", { email: "c@x.test", clientRole: "VIEWER" });
    expect(res.emailStatus).toBe("FAILED");
    expect(res.emailError).toMatch(/Plunk/);
    expect((prisma.invitation.update as jest.Mock).mock.calls[0]![0].data.emailStatus).toBe(
      "FAILED",
    );
  });
});

describe("Firm-staff invitations", () => {
  it("creates a FIRM invitation with a valid seeded role and sends the email", async () => {
    const create = jest.fn().mockResolvedValue({
      id: "inv2",
      email: "staff@x.test",
      role: "Accountant",
      status: "PENDING",
      expiresAt: new Date(Date.now() + 1000),
      createdAt: new Date(),
      emailStatus: null,
      emailError: null,
      invitedByName: null,
    });
    const { svc, prisma } = build({
      invitation: {
        findFirst: jest.fn().mockResolvedValue(null),
        create,
        update: jest.fn().mockResolvedValue({}),
      },
      role: {
        findFirst: jest.fn().mockResolvedValue({ id: "r1", name: "Accountant" }),
        findMany: jest.fn(),
      },
    });
    const res = await svc.inviteFirmUser(actor, {
      email: "Staff@X.Test",
      roleName: "Accountant",
    });
    expect(create.mock.calls[0]![0].data).toMatchObject({
      firmId: "f1",
      kind: "FIRM",
      email: "staff@x.test",
      role: "Accountant",
    });
    expect(res.emailStatus).toBe("SENT");
    expect(prisma.invitation.update as jest.Mock).toHaveBeenCalled();
  });

  it("rejects an unknown firm role naming the valid ones", async () => {
    const { svc } = build({
      role: {
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([{ name: "Accountant" }, { name: "Staff" }]),
      },
    });
    await expect(
      svc.inviteFirmUser(actor, { email: "s@x.test", roleName: "Bookkeeper" }),
    ).rejects.toThrow(/Accountant, Staff/);
  });

  it("resend only works for pending, unexpired invitations", async () => {
    const { svc } = build({
      invitation: {
        findFirst: jest.fn().mockResolvedValue({
          id: "inv3",
          email: "s@x.test",
          role: "Staff",
          status: "REVOKED",
          expiresAt: new Date(Date.now() + 1000),
          token: "tok",
          invitedByName: "Mark",
        }),
        update: jest.fn(),
      },
    });
    await expect(svc.resendFirm(actor, "inv3")).rejects.toThrow(/REVOKED/);
  });

  it("accepting a FIRM invitation creates an active firm user with the role", async () => {
    const userCreate = jest.fn().mockResolvedValue({
      id: "u9",
      email: "staff@x.test",
      fullName: "New Staff",
    });
    const { svc } = build({
      invitation: {
        findUnique: jest.fn().mockResolvedValue({
          id: "inv4",
          kind: "FIRM",
          firmId: "f1",
          clientId: null,
          client: null,
          email: "staff@x.test",
          role: "Accountant",
          status: "PENDING",
          expiresAt: new Date(Date.now() + 1000),
        }),
        update: jest.fn().mockResolvedValue({}),
        count: jest.fn().mockResolvedValue(0),
      },
      user: { findUnique: jest.fn().mockResolvedValue(null), create: userCreate },
      role: { findFirst: jest.fn().mockResolvedValue({ id: "r1", name: "Accountant" }) },
    });
    const res = await svc.accept({ token: "t", fullName: "New Staff", password: "password1" });
    expect(res).toEqual({ userId: "u9", email: "staff@x.test", clientId: null });
    const data = userCreate.mock.calls[0]![0].data;
    expect(data.userType).toBe("FIRM");
    expect(data.userRoles.create.roleId).toBe("r1");
    expect(data.firmProfile).toEqual({ create: {} });
  });
});
