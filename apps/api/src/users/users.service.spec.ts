import { UsersService } from "./users.service";
import type { AuditService } from "../audit/audit.service";
import type { PasswordService } from "../auth/password.service";
import type { MailService } from "../mail/mail.service";
import type { EmailSettingsService } from "../settings/email-settings.service";
import type { PrismaService } from "../prisma/prisma.service";
import type { StorageService } from "../storage/storage.service";
import type { ConfigService } from "@nestjs/config";
import type { AuthUser } from "../common/auth/auth-user";

const actor: AuthUser = { id: "admin", firmId: "f1", userType: "FIRM", email: "a@f.test" };

function userWith(roleName: string) {
  return {
    id: "u2",
    email: "staff@f.test",
    fullName: "Staff Member",
    status: "ACTIVE",
    userRoles: [{ role: { name: roleName }, clientScopeId: null }],
  };
}

function build(beforeRole: string, afterRole: string) {
  const findFirst = jest
    .fn()
    .mockResolvedValueOnce(userWith(beforeRole)) // setRoles: before
    .mockResolvedValueOnce(userWith(afterRole)); // setRoles: after
  const prisma = {
    user: { findFirst },
    role: { findMany: jest.fn().mockResolvedValue([{ id: "r-after", name: afterRole }]) },
    userRole: {
      deleteMany: jest.fn().mockReturnValue({}),
      createMany: jest.fn().mockReturnValue({}),
    },
    $transaction: jest.fn().mockResolvedValue(undefined),
  } as unknown as PrismaService;
  const passwords = {} as PasswordService;
  const audit = { record: jest.fn().mockResolvedValue(undefined) } as unknown as AuditService;
  const storage = {} as StorageService;
  const mail = {
    isEnabled: jest.fn().mockReturnValue(true),
    send: jest.fn().mockResolvedValue({ provider: "postal", messageId: "m1" }),
  } as unknown as MailService;
  const emailSettings = {
    resolveContext: jest.fn().mockResolvedValue({
      theme: { firmName: "MCRC", supportEmail: "s@f.test", buttonAccent: "navy", showBrandLockup: true },
      billingFooterEmail: "b@f.test",
      senderFor: () => ({ fromEmail: "team@f.test", fromName: "MCRC" }),
    }),
  } as unknown as EmailSettingsService;
  const config = { get: jest.fn((_k: string, def?: string) => def) } as unknown as ConfigService;
  const svc = new UsersService(prisma, passwords, audit, storage, mail, emailSettings, config);
  return { svc, mail };
}

describe("UsersService.setRoles notification", () => {
  it("emails the user when their role changes", async () => {
    const { svc, mail } = build("Staff", "Manager");
    await svc.setRoles(actor, "u2", { roleNames: ["Manager"] });
    expect(mail.send).toHaveBeenCalledTimes(1);
    const arg = (mail.send as jest.Mock).mock.calls[0][0];
    expect(arg.to).toBe("staff@f.test");
    expect(arg.subject).toMatch(/role/i);
  });

  it("does not email when the role is unchanged", async () => {
    const { svc, mail } = build("Manager", "Manager");
    await svc.setRoles(actor, "u2", { roleNames: ["Manager"] });
    expect(mail.send).not.toHaveBeenCalled();
  });

  it("never blocks the role change if email is disabled", async () => {
    const { svc, mail } = build("Staff", "Manager");
    (mail.isEnabled as jest.Mock).mockReturnValue(false);
    await expect(svc.setRoles(actor, "u2", { roleNames: ["Manager"] })).resolves.toBeDefined();
    expect(mail.send).not.toHaveBeenCalled();
  });
});
