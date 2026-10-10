import type { AuthUser } from "../common/auth/auth-user";
import { RbacService } from "./rbac.service";

/**
 * Builds a fake PrismaService returning canned userRoles / assignments so we can
 * exercise the scoping rules without a database.
 */
function fakePrisma(opts: {
  userRoles: {
    clientScopeId: string | null;
    permissions: string[];
    scope?: "FIRM" | "CLIENT";
  }[];
  assignments?: string[];
}) {
  return {
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
    // U4 R4: authorize() first confirms the client is of the caller's firm; both
    // clients here belong to firm f1, the firm of every user in this file.
    client: {
      findFirst: async ({ where }: { where: { id: string; firmId: string } }) =>
        where.firmId === "f1" ? { id: where.id } : null,
    },
  } as unknown as ConstructorParameters<typeof RbacService>[0];
}

const CLIENT_A = "11111111-1111-1111-1111-111111111111";
const CLIENT_B = "22222222-2222-2222-2222-222222222222";

const firmUser: AuthUser = {
  id: "u1",
  firmId: "f1",
  userType: "FIRM",
  email: "a@firm.test",
};

describe("RbacService.authorize", () => {
  it("Super Admin (global + ViewAll) passes firm-level and any-client checks", async () => {
    const svc = new RbacService(
      fakePrisma({
        userRoles: [
          {
            clientScopeId: null,
            permissions: ["Users:Create", "Clients:ViewAll", "Sales:Read"],
          },
        ],
      }),
    );
    expect(await svc.authorize(firmUser, ["Users:Create"])).toBe(true);
    expect(await svc.authorize(firmUser, ["Sales:Read"], CLIENT_A)).toBe(true);
    expect(await svc.authorize(firmUser, ["Sales:Read"], CLIENT_B)).toBe(true);
  });

  it("assigned firm user reaches only assigned clients and no firm-level actions", async () => {
    const svc = new RbacService(
      fakePrisma({
        userRoles: [{ clientScopeId: null, permissions: ["Sales:Read"] }],
        assignments: [CLIENT_A],
      }),
    );
    expect(await svc.authorize(firmUser, ["Sales:Read"], CLIENT_A)).toBe(true);
    expect(await svc.authorize(firmUser, ["Sales:Read"], CLIENT_B)).toBe(false);
    // No global Users:Create → firm-level action denied.
    expect(await svc.authorize(firmUser, ["Users:Create"])).toBe(false);
  });

  it("client user is confined to its own organization", async () => {
    const clientUser: AuthUser = {
      id: "c1",
      firmId: "f1",
      userType: "CLIENT",
      email: "owner@client.test",
      clientId: CLIENT_A,
    };
    const svc = new RbacService(
      fakePrisma({
        userRoles: [
          {
            clientScopeId: CLIENT_A,
            permissions: ["Sales:Read", "ClientUsers:Create"],
            scope: "CLIENT",
          },
        ],
      }),
    );
    expect(await svc.authorize(clientUser, ["Sales:Read"], CLIENT_A)).toBe(true);
    expect(await svc.authorize(clientUser, ["Sales:Read"], CLIENT_B)).toBe(false);
    // Client users cannot perform firm-level (non-client-scoped) actions.
    expect(await svc.authorize(clientUser, ["Users:Create"])).toBe(false);
  });

  it("requires ALL listed permissions (AND semantics)", async () => {
    const svc = new RbacService(
      fakePrisma({
        userRoles: [{ clientScopeId: null, permissions: ["Sales:Read"] }],
        assignments: [CLIENT_A],
      }),
    );
    expect(await svc.authorize(firmUser, ["Sales:Read", "Sales:Update"], CLIENT_A)).toBe(
      false,
    );
  });
});
