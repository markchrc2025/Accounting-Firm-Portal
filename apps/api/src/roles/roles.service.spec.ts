import { BadRequestException, ConflictException } from "@nestjs/common";
import { RolesService } from "./roles.service";
import type { AuditService } from "../audit/audit.service";
import type { PrismaService } from "../prisma/prisma.service";
import type { AuthUser } from "../common/auth/auth-user";

const actor: AuthUser = { id: "u1", firmId: "f1", userType: "FIRM", email: "a@f.test" };

function roleRow(over: Record<string, unknown> = {}) {
  return {
    id: "r1",
    name: "Bookkeeper",
    isSystem: false,
    scope: "FIRM",
    createdAt: new Date("2026-07-22T00:00:00Z"),
    rolePermissions: [{ permission: { resource: "Sales", action: "Read" } }],
    _count: { userRoles: 0 },
    ...over,
  };
}

function build(over: Record<string, unknown> = {}) {
  const role = {
    findMany: jest.fn().mockResolvedValue([roleRow()]),
    findFirst: jest.fn().mockResolvedValue(roleRow()),
    findUnique: jest.fn().mockResolvedValue(null), // name free by default
    create: jest.fn().mockResolvedValue(roleRow()),
    update: jest.fn().mockResolvedValue(roleRow()),
    delete: jest.fn().mockResolvedValue(roleRow()),
    ...over,
  };
  const permission = {
    findMany: jest.fn().mockResolvedValue([{ id: "p-sales-read" }]),
  };
  const rolePermission = {
    deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
    createMany: jest.fn().mockResolvedValue({ count: 1 }),
  };
  const userRole = { count: jest.fn().mockResolvedValue(0) };
  const prisma = {
    role,
    permission,
    rolePermission,
    userRole,
    $transaction: jest.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({ role, permission, rolePermission }),
    ),
  } as unknown as PrismaService;
  const audit = { record: jest.fn().mockResolvedValue(undefined) } as unknown as AuditService;
  return { svc: new RolesService(prisma, audit), prisma, role, rolePermission, userRole };
}

describe("RolesService", () => {
  it("creates a custom role with validated permissions", async () => {
    const { svc, role } = build();
    await svc.create(actor, { name: "Bookkeeper", permissions: ["Sales:Read"] });
    expect(role.create).toHaveBeenCalled();
    const arg = role.create.mock.calls[0]![0];
    expect(arg.data).toEqual(
      expect.objectContaining({ name: "Bookkeeper", scope: "FIRM", isSystem: false }),
    );
  });

  it("rejects an unknown permission", async () => {
    const { svc } = build();
    await expect(
      svc.create(actor, { name: "X", permissions: ["Sales:Fly"] }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("rejects a duplicate role name", async () => {
    const { svc } = build({ findUnique: jest.fn().mockResolvedValue({ id: "other" }) });
    await expect(
      svc.create(actor, { name: "Bookkeeper", permissions: [] }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it("refuses to edit the Super Admin role", async () => {
    const { svc } = build({
      findFirst: jest.fn().mockResolvedValue(roleRow({ name: "Super Admin", isSystem: true })),
    });
    await expect(
      svc.update(actor, "r1", { permissions: ["Sales:Read"] }),
    ).rejects.toThrow(/Super Admin.*locked/i);
  });

  it("allows editing a built-in role's permissions but not its name", async () => {
    const { svc, rolePermission } = build({
      findFirst: jest.fn().mockResolvedValue(roleRow({ name: "Manager", isSystem: true })),
    });
    await svc.update(actor, "r1", { permissions: ["Sales:Read"] });
    expect(rolePermission.deleteMany).toHaveBeenCalledWith({ where: { roleId: "r1" } });

    await expect(
      svc.update(actor, "r1", { name: "Supervisor" }),
    ).rejects.toThrow(/cannot be renamed/i);
  });

  it("won't delete a built-in role", async () => {
    const { svc } = build({
      findFirst: jest.fn().mockResolvedValue(roleRow({ name: "Staff", isSystem: true })),
    });
    await expect(svc.remove(actor, "r1")).rejects.toThrow(/cannot be deleted/i);
  });

  it("won't delete a custom role that is still assigned", async () => {
    const { svc, userRole } = build();
    userRole.count.mockResolvedValue(2);
    await expect(svc.remove(actor, "r1")).rejects.toThrow(/assigned to 2 users/i);
  });

  it("deletes an unused custom role", async () => {
    const { svc, role } = build();
    await svc.remove(actor, "r1");
    expect(role.delete).toHaveBeenCalledWith({ where: { id: "r1" } });
  });
});
