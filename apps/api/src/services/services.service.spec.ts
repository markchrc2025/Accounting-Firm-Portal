import { NotFoundException } from "@nestjs/common";
import { ServicesService } from "./services.service";
import type { AuditService } from "../audit/audit.service";
import type { PrismaService } from "../prisma/prisma.service";
import type { AuthUser } from "../common/auth/auth-user";

const actor: AuthUser = { id: "u1", firmId: "f1", userType: "FIRM", email: "a@f.test" };

const row = {
  id: "s1",
  firmId: "f1",
  name: "VAT Filing",
  description: "",
  defaultFee: "1500.00",
  billingMethod: "Quarterly",
  linkedForm: "2550Q",
  status: "Active",
};

function build(overrides: Record<string, unknown> = {}) {
  const prisma = {
    service: {
      findMany: jest.fn().mockResolvedValue([row]),
      findFirst: jest.fn().mockResolvedValue(row),
      create: jest.fn().mockResolvedValue(row),
      update: jest.fn().mockResolvedValue(row),
      delete: jest.fn().mockResolvedValue(row),
      ...overrides,
    },
  } as unknown as PrismaService;
  const audit = {
    record: jest.fn().mockResolvedValue(undefined),
  } as unknown as AuditService;
  return { svc: new ServicesService(prisma, audit), prisma };
}

describe("ServicesService", () => {
  it("lists only the actor's firm services, ordered by createdAt", async () => {
    const { svc, prisma } = build();
    const res = await svc.list(actor);
    expect(prisma.service.findMany).toHaveBeenCalledWith({
      where: { firmId: "f1" },
      orderBy: { createdAt: "asc" },
    });
    // DTO omits firmId / timestamps.
    expect(res[0]).toEqual({
      id: "s1",
      name: "VAT Filing",
      description: "",
      defaultFee: "1500.00",
      billingMethod: "Quarterly",
      linkedForm: "2550Q",
      status: "Active",
    });
  });

  it("stamps the actor's firmId on create", async () => {
    const { svc, prisma } = build();
    await svc.create(actor, {
      name: "VAT Filing",
      description: "",
      defaultFee: 1500,
      billingMethod: "Quarterly",
      linkedForm: "2550Q",
      status: "Active",
    });
    expect(prisma.service.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ firmId: "f1" }) }),
    );
  });

  it("404s when updating a service outside the firm", async () => {
    const { svc } = build({ findFirst: jest.fn().mockResolvedValue(null) });
    await expect(
      svc.update(actor, "other", { name: "x" }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it("404s when deleting a service outside the firm", async () => {
    const { svc, prisma } = build({ findFirst: jest.fn().mockResolvedValue(null) });
    await expect(svc.remove(actor, "other")).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.service.delete).not.toHaveBeenCalled();
  });
});
