/**
 * track-a-scope.spec.ts — the firm wall (U4 R4) and the client scope of a list
 * (U4 R2), at the RbacService level. Hermetic: an in-memory Prisma stub holds
 * two invented firms. T1 and T2 (track-a-scope.db-spec.ts) prove the same over
 * HTTP against a real database; this file covers the branches they do not reach:
 *   - a scoped grant under Clients:ViewAll;
 *   - a malformed client id;
 *   - a client principal;
 *   - the refusal wording.
 */
import { ForbiddenException } from "@nestjs/common";
import type { AuthUser } from "../common/auth/auth-user";
import { missingPermissionsMessage, RbacService } from "./rbac.service";

const F1_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const F1_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const F2_X = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const CLIENTS: Record<string, string> = { [F1_A]: "f1", [F1_B]: "f1", [F2_X]: "f2" };

function rbac(opts: {
  userRoles: Array<{
    clientScopeId: string | null;
    permissions: string[];
    scope?: "FIRM" | "CLIENT";
  }>;
  assignments?: string[];
}) {
  const findFirst = jest.fn(
    async ({ where }: { where: { id: string; firmId: string } }) =>
      CLIENTS[where.id] === where.firmId ? { id: where.id } : null,
  );
  const findMany = jest.fn(
    async ({ where }: { where: { id: { in: string[] }; firmId: string } }) =>
      where.id.in.filter((id) => CLIENTS[id] === where.firmId).map((id) => ({ id })),
  );
  const prisma = {
    userRole: {
      findMany: async () =>
        opts.userRoles.map((ur) => ({
          clientScopeId: ur.clientScopeId,
          // U9-A1 R2: a grant counts only when its role's scope fits the user.
          role: {
            scope: ur.scope ?? "FIRM",
            rolePermissions: ur.permissions.map((p) => {
              const [resource, action] = p.split(":");
              return { permission: { resource, action } };
            }),
          },
        })),
    },
    firmClientAssignment: {
      findMany: async () => (opts.assignments ?? []).map((clientId) => ({ clientId })),
    },
    client: { findFirst, findMany },
  };
  return {
    svc: new RbacService(
      prisma as unknown as ConstructorParameters<typeof RbacService>[0],
    ),
    findFirst,
  };
}

const firmUser: AuthUser = {
  id: "u1",
  firmId: "f1",
  userType: "FIRM",
  email: "u1@example.com",
};
const SUPER = ["Clients:ViewAll", "Billing:Read", "BIRForms:Read"];

describe("U4 R4 · authorize() refuses a client of another firm", () => {
  it("a Clients:ViewAll user of firm f1 is refused firm f2's client, and keeps its own", async () => {
    const { svc } = rbac({ userRoles: [{ clientScopeId: null, permissions: SUPER }] });
    expect(await svc.authorize(firmUser, ["Billing:Read"], F2_X)).toBe(false);
    expect(await svc.authorize(firmUser, ["Billing:Read"], F1_A)).toBe(true);
  });

  it("a malformed client id is refused without a query", async () => {
    const { svc, findFirst } = rbac({
      userRoles: [{ clientScopeId: null, permissions: SUPER }],
    });
    expect(await svc.authorize(firmUser, ["Billing:Read"], "not-a-uuid")).toBe(false);
    expect(findFirst).not.toHaveBeenCalled();
  });

  it("a firm-level check (no client) does not look up a client", async () => {
    const { svc, findFirst } = rbac({
      userRoles: [{ clientScopeId: null, permissions: SUPER }],
    });
    expect(await svc.authorize(firmUser, ["Billing:Read"])).toBe(true);
    expect(findFirst).not.toHaveBeenCalled();
  });
});

describe("U4 R2 · the client scope of a list (authorizedClients)", () => {
  it("Clients:ViewAll with the permission firm-wide: every client of the firm", async () => {
    const { svc } = rbac({ userRoles: [{ clientScopeId: null, permissions: SUPER }] });
    expect(await svc.authorizedClients(firmUser, ["Billing:Read"])).toBe("all");
  });

  it("a Manager: the assigned clients of the firm, never another firm's", async () => {
    const { svc } = rbac({
      userRoles: [{ clientScopeId: null, permissions: ["Billing:Read"] }],
      assignments: [F1_A, F2_X],
    });
    expect(await svc.authorizedClients(firmUser, ["Billing:Read"])).toEqual(
      new Set([F1_A]),
    );
  });

  it("a Manager with the permission granted for one assigned client only: that client", async () => {
    const { svc } = rbac({
      userRoles: [{ clientScopeId: F1_B, permissions: ["Billing:Read"] }],
      assignments: [F1_A, F1_B],
    });
    expect(await svc.authorizedClients(firmUser, ["Billing:Read"])).toEqual(
      new Set([F1_B]),
    );
  });

  it("Clients:ViewAll with the permission granted for one client only: that client", async () => {
    const { svc } = rbac({
      userRoles: [
        { clientScopeId: null, permissions: ["Clients:ViewAll"] },
        { clientScopeId: F1_B, permissions: ["Billing:Read"] },
      ],
    });
    expect(await svc.authorizedClients(firmUser, ["Billing:Read"])).toEqual(
      new Set([F1_B]),
    );
  });

  it("no assignment: no client", async () => {
    const { svc } = rbac({
      userRoles: [{ clientScopeId: null, permissions: ["Billing:Read"] }],
    });
    expect(await svc.authorizedClients(firmUser, ["Billing:Read"])).toEqual(new Set());
  });

  it("a client principal: its own client when it holds the permission", async () => {
    const portal: AuthUser = { ...firmUser, userType: "CLIENT", clientId: F1_A };
    const { svc } = rbac({
      userRoles: [{ clientScopeId: F1_A, permissions: ["Sales:Read"], scope: "CLIENT" }],
    });
    expect(await svc.authorizedClients(portal, ["Sales:Read"])).toEqual(new Set([F1_A]));
    expect(await svc.authorizedClients(portal, ["Billing:Read"])).toEqual(new Set());
  });
});

describe("U4 R2 · assertClient / assertAnyClient answer 403 in the guard's words", () => {
  it("the message is the guard's", () => {
    expect(missingPermissionsMessage(["Billing:Read"], F1_A)).toBe(
      `Missing permission(s): Billing:Read for client ${F1_A}`,
    );
    expect(missingPermissionsMessage(["Billing:Read", "Billing:Send"])).toBe(
      "Missing permission(s): Billing:Read, Billing:Send",
    );
  });

  it("assertClient refuses an unassigned client and passes an assigned one", async () => {
    const { svc } = rbac({
      userRoles: [{ clientScopeId: null, permissions: ["Billing:Read"] }],
      assignments: [F1_A],
    });
    await expect(
      svc.assertClient(firmUser, ["Billing:Read"], F1_A),
    ).resolves.toBeUndefined();
    await expect(svc.assertClient(firmUser, ["Billing:Read"], F1_B)).rejects.toEqual(
      new ForbiddenException(`Missing permission(s): Billing:Read for client ${F1_B}`),
    );
  });

  it("assertAnyClient: either client of a two-client billing is enough; none names the first", async () => {
    const { svc } = rbac({
      userRoles: [{ clientScopeId: null, permissions: ["Billing:Read"] }],
      assignments: [F1_B],
    });
    await expect(
      svc.assertAnyClient(firmUser, ["Billing:Read"], [F1_A, F1_B]),
    ).resolves.toBeUndefined();
    await expect(
      svc.assertAnyClient(firmUser, ["Billing:Read"], [F1_A, null]),
    ).rejects.toEqual(
      new ForbiddenException(`Missing permission(s): Billing:Read for client ${F1_A}`),
    );
  });
});
