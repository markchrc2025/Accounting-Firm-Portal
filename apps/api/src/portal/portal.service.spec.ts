import { NotFoundException } from "@nestjs/common";
import { PortalService } from "./portal.service";
import type { PrismaService } from "../prisma/prisma.service";
import type { AuthUser } from "../common/auth/auth-user";

const clientUser: AuthUser = {
  id: "u1",
  firmId: "f1",
  userType: "CLIENT",
  email: "owner@acme.test",
  clientId: "c1",
};

const firmUser: AuthUser = {
  id: "u2",
  firmId: "f1",
  userType: "FIRM",
  email: "staff@firm.test",
};

// The stored row carries more columns than the DTO exposes.
const clientRow = {
  id: "c1",
  firmId: "f1",
  businessName: "Acme Corp",
  taxType: "VAT",
  status: "ACTIVE",
  seatLimit: 5,
  tin: "123-456",
  address: "Somewhere",
};

const userRows = [
  {
    id: "u1",
    fullName: "Ada Owner",
    email: "owner@acme.test",
    status: "ACTIVE",
    userRoles: [{ role: { name: "Client Owner" } }],
  },
  {
    id: "u3",
    fullName: "Ben Viewer",
    email: "ben@acme.test",
    status: "INVITED",
    userRoles: [],
  },
];

function build(overrides: Record<string, unknown> = {}) {
  const prisma = {
    client: {
      findFirst: jest.fn().mockResolvedValue(clientRow),
      ...((overrides.client as object) ?? {}),
    },
    user: {
      findMany: jest.fn().mockResolvedValue(userRows),
      ...((overrides.user as object) ?? {}),
    },
  } as unknown as PrismaService;
  return { svc: new PortalService(prisma), prisma };
}

describe("PortalService", () => {
  describe("getContext", () => {
    it("returns only the caller's own-org fields, scoped by id + firmId", async () => {
      const { svc, prisma } = build();
      const res = await svc.getContext(clientUser);
      expect(prisma.client.findFirst).toHaveBeenCalledWith({
        where: { id: "c1", firmId: "f1" },
      });
      // DTO drops firmId / tin / address.
      expect(res).toEqual({
        id: "c1",
        businessName: "Acme Corp",
        taxType: "VAT",
        status: "ACTIVE",
        seatLimit: 5,
      });
    });

    it("returns null seatLimit / taxType when unset", async () => {
      const { svc } = build({
        client: {
          findFirst: jest
            .fn()
            .mockResolvedValue({ ...clientRow, seatLimit: null, taxType: null }),
        },
      });
      const res = await svc.getContext(clientUser);
      expect(res.seatLimit).toBeNull();
      expect(res.taxType).toBeNull();
    });

    it("404s for a firm user with no clientId (no portal org)", async () => {
      const { svc, prisma } = build();
      await expect(svc.getContext(firmUser)).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.client.findFirst).not.toHaveBeenCalled();
    });

    it("404s when the org row is not found", async () => {
      const { svc } = build({ client: { findFirst: jest.fn().mockResolvedValue(null) } });
      await expect(svc.getContext(clientUser)).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe("listUsers", () => {
    it("filters to the caller's org and maps role from the first userRole", async () => {
      const { svc, prisma } = build();
      const res = await svc.listUsers(clientUser);
      expect(prisma.user.findMany).toHaveBeenCalledWith({
        where: { userType: "CLIENT", clientProfile: { clientId: "c1" } },
        select: {
          id: true,
          fullName: true,
          email: true,
          status: true,
          userRoles: { select: { role: { select: { name: true } } } },
        },
        orderBy: { fullName: "asc" },
      });
      expect(res[0]!).toEqual({
        id: "u1",
        fullName: "Ada Owner",
        email: "owner@acme.test",
        role: "Client Owner",
        status: "ACTIVE",
      });
      // No roles → empty-string role.
      expect(res[1]!.role).toBe("");
    });

    it("404s for a firm user with no clientId", async () => {
      const { svc, prisma } = build();
      await expect(svc.listUsers(firmUser)).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.user.findMany).not.toHaveBeenCalled();
    });
  });
});
