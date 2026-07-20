import { ClientsService } from "./clients.service";
import { UpdateClientSchema } from "./dto/client.schemas";
import type { AuditService } from "../audit/audit.service";
import type { PrismaService } from "../prisma/prisma.service";
import type { RbacService } from "../rbac/rbac.service";
import type { StorageService } from "../storage/storage.service";
import type { AuthUser } from "../common/auth/auth-user";

const actor: AuthUser = { id: "u1", firmId: "f1", userType: "FIRM", email: "a@f.test" };

function build() {
  const prisma = {
    client: {
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({
        id: "c1",
        ...data,
      })),
      update: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({
        id: "c1",
        ...data,
      })),
      findFirst: jest.fn().mockResolvedValue({ id: "c1", firmId: "f1" }),
      count: jest.fn().mockResolvedValue(0),
    },
  } as unknown as PrismaService;
  const rbac = {} as RbacService;
  const audit = { record: jest.fn().mockResolvedValue(undefined) } as unknown as AuditService;
  const storage = {} as StorageService;
  return { svc: new ClientsService(prisma, rbac, audit, storage), prisma };
}

describe("ClientsService tax regime mapping", () => {
  it('stores NULL when taxType is "" (client exempt from business tax)', async () => {
    const { svc, prisma } = build();
    await svc.create(actor, { businessName: "Exempt Co", currency: "PHP", seatLimit: 3, taxType: "" });
    const data = (prisma.client.create as jest.Mock).mock.calls[0]![0].data;
    expect(data.taxType).toBeNull();
  });

  it("passes a real regime through unchanged", async () => {
    const { svc, prisma } = build();
    await svc.create(actor, { businessName: "VAT Co", currency: "PHP", seatLimit: 3, taxType: "VAT" });
    const data = (prisma.client.create as jest.Mock).mock.calls[0]![0].data;
    expect(data.taxType).toBe("VAT");
  });

  it("leaves taxType untouched when the update omits it", async () => {
    const { svc, prisma } = build();
    await svc.update(actor, "c1", { businessName: "Renamed" });
    const data = (prisma.client.update as jest.Mock).mock.calls[0]![0].data;
    expect("taxType" in data).toBe(false);
  });

  it('clears the regime on update when "" is sent', async () => {
    const { svc, prisma } = build();
    await svc.update(actor, "c1", { taxType: "" });
    const data = (prisma.client.update as jest.Mock).mock.calls[0]![0].data;
    expect(data.taxType).toBeNull();
  });
});

describe("UpdateClientSchema taxType", () => {
  it('accepts "", VAT, PERCENTAGE and rejects unknown regimes', () => {
    expect(UpdateClientSchema.safeParse({ taxType: "" }).success).toBe(true);
    expect(UpdateClientSchema.safeParse({ taxType: "VAT" }).success).toBe(true);
    expect(UpdateClientSchema.safeParse({ taxType: "PERCENTAGE" }).success).toBe(true);
    expect(UpdateClientSchema.safeParse({ taxType: "OTHER" }).success).toBe(false);
  });
});
