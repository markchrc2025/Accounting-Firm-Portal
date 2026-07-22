import { EmailSettingsService } from "./email-settings.service";
import type { AuditService } from "../audit/audit.service";
import type { PrismaService } from "../prisma/prisma.service";
import type { ConfigService } from "@nestjs/config";
import type { AuthUser } from "../common/auth/auth-user";

const actor: AuthUser = { id: "u1", firmId: "f1", userType: "FIRM", email: "a@f.test" };

function build(firm: { name: string; settingsJson?: unknown }) {
  const update = jest.fn().mockResolvedValue(undefined);
  const prisma = {
    firm: {
      findUnique: jest.fn().mockResolvedValue(firm),
      findUniqueOrThrow: jest.fn().mockResolvedValue(firm),
      update,
    },
  } as unknown as PrismaService;
  const audit = { record: jest.fn().mockResolvedValue(undefined) } as unknown as AuditService;
  const config = {
    get: jest.fn((_k: string, def?: string) => def),
  } as unknown as ConfigService;
  return { svc: new EmailSettingsService(prisma, audit, config), prisma, update };
}

describe("EmailSettingsService firm name", () => {
  it("returns the firm's name as firmName", async () => {
    const { svc } = build({ name: "MCRC Tax & Accounting" });
    const settings = await svc.getSettings("f1");
    expect(settings.firmName).toBe("MCRC Tax & Accounting");
  });

  it("persists a new firm name onto the firm row", async () => {
    const { svc, update } = build({ name: "Demo Accounting Firm" });
    await svc.updateSettings(actor, { firmName: "MCRC Tax & Accounting" });
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "f1" },
        data: expect.objectContaining({ name: "MCRC Tax & Accounting" }),
      }),
    );
  });

  it("leaves the firm name untouched when the update omits it", async () => {
    const { svc, update } = build({ name: "Demo Accounting Firm" });
    await svc.updateSettings(actor, { supportEmail: "help@mcrctas.com" });
    const data = update.mock.calls[0]![0].data as Record<string, unknown>;
    expect("name" in data).toBe(false);
  });
});
