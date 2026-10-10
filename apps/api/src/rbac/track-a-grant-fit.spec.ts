/**
 * track-a-grant-fit.spec.ts — a role grant counts only when it fits the user
 * (U9-A1 R2, D46). Hermetic: the rule itself, effective permissions over a fake
 * grant table, and the boot count. track-a-loose-ends.db-spec.ts proves the same
 * over HTTP and the real database.
 */
import type { AuthUser } from "../common/auth/auth-user";
import type { PrismaService } from "../prisma/prisma.service";
import { RbacService, grantFitsUser } from "./rbac.service";

const OWN = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";

describe("U9-A1 R2 · grantFitsUser", () => {
  it.each([
    ["FIRM", undefined, "FIRM", null, true],
    ["FIRM", undefined, "FIRM", OWN, true],
    ["FIRM", undefined, "CLIENT", null, false],
    ["FIRM", undefined, "CLIENT", OWN, false],
    ["CLIENT", OWN, "CLIENT", OWN, true],
    ["CLIENT", OWN, "CLIENT", OTHER, false],
    ["CLIENT", OWN, "CLIENT", null, false],
    ["CLIENT", OWN, "FIRM", null, false],
    ["CLIENT", OWN, "FIRM", OWN, false],
    ["CLIENT", undefined, "CLIENT", OWN, false],
  ] as const)(
    "%s user (client %s) with a %s role scoped to %s → %s",
    (userType, userClientId, roleScope, clientScopeId, fits) => {
      expect(grantFitsUser(userType, userClientId, roleScope, clientScopeId)).toBe(fits);
    },
  );
});

describe("U9-A1 R2 · effective permissions skip grants that do not fit", () => {
  const grant = (scope: string, clientScopeId: string | null, perms: string[]) => ({
    clientScopeId,
    role: {
      scope,
      rolePermissions: perms.map((p) => {
        const [resource, action] = p.split(":");
        return { permission: { resource, action } };
      }),
    },
  });

  it("a portal user keeps its own client role and loses an unscoped firm role", async () => {
    const prisma = {
      userRole: {
        findMany: async () => [
          grant("CLIENT", OWN, ["Expenses:Read"]),
          grant("FIRM", null, ["Clients:Read", "Clients:ViewAll"]),
          grant("CLIENT", OTHER, ["Sales:Read"]),
        ],
      },
      firmClientAssignment: { findMany: async () => [] },
    } as unknown as PrismaService;
    const portal: AuthUser = {
      id: "p1",
      firmId: "f1",
      userType: "CLIENT",
      email: "portal@example.com",
      clientId: OWN,
    };
    const eff = await new RbacService(prisma).getEffectivePermissions(portal);
    expect([...eff.global]).toEqual([]);
    expect(eff.hasViewAll).toBe(false);
    expect([...eff.scoped.keys()]).toEqual([OWN]);
    expect([...eff.scoped.get(OWN)!]).toEqual(["Expenses:Read"]);
  });

  it("a firm user loses a client role", async () => {
    const prisma = {
      userRole: {
        findMany: async () => [
          grant("FIRM", null, ["Sales:Read"]),
          grant("CLIENT", OWN, ["ClientUsers:Create"]),
        ],
      },
      firmClientAssignment: { findMany: async () => [] },
    } as unknown as PrismaService;
    const staff: AuthUser = {
      id: "s1",
      firmId: "f1",
      userType: "FIRM",
      email: "s@example.com",
    };
    const eff = await new RbacService(prisma).getEffectivePermissions(staff);
    expect([...eff.global]).toEqual(["Sales:Read"]);
    expect(eff.scoped.size).toBe(0);
  });
});

describe("U9-A1 R2 · the boot count", () => {
  const row = (
    userType: string,
    ownClient: string | null,
    scope: string,
    clientScopeId: string | null,
  ) => ({
    clientScopeId,
    role: { scope },
    user: { userType, clientProfile: ownClient ? { clientId: ownClient } : null },
  });

  function service(rows: unknown[], connected = true) {
    const prisma = {
      isConnected: connected,
      userRole: { findMany: jest.fn().mockResolvedValue(rows) },
    } as unknown as PrismaService;
    return { svc: new RbacService(prisma), prisma };
  }

  let log: jest.SpyInstance;
  beforeEach(() => {
    log = jest.spyOn(console, "log").mockImplementation(() => undefined);
  });
  afterEach(() => log.mockRestore());

  it("logs one line with the count of grants that do not fit, and no ids", async () => {
    const { svc } = service([
      row("FIRM", null, "FIRM", null),
      row("CLIENT", OWN, "CLIENT", OWN),
      row("CLIENT", OWN, "FIRM", null),
      row("CLIENT", OWN, "CLIENT", OTHER),
      row("FIRM", null, "CLIENT", OWN),
    ]);
    await svc.onApplicationBootstrap();
    expect(log.mock.calls).toEqual([
      ["[rbac] 3 role grant(s) ignored: scope does not fit the user"],
    ]);
  });

  it("logs 0 when every grant fits", async () => {
    const { svc } = service([row("FIRM", null, "FIRM", null)]);
    await svc.onApplicationBootstrap();
    expect(log.mock.calls).toEqual([
      ["[rbac] 0 role grant(s) ignored: scope does not fit the user"],
    ]);
  });

  it("stays silent and reads nothing when the database is unreachable at boot", async () => {
    const { svc, prisma } = service([], false);
    await svc.onApplicationBootstrap();
    expect(log).not.toHaveBeenCalled();
    expect(prisma.userRole.findMany).not.toHaveBeenCalled();
  });
});
