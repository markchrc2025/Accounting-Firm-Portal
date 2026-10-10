/**
 * track-a-visibility.spec.ts — "can this user see this client?" (U4-A1, D42), the
 * question a read with no permission asks (financial statements). Hermetic: an
 * in-memory Prisma stub with one invented firm and two clients.
 */
import { ForbiddenException } from "@nestjs/common";
import type { AuthUser } from "../common/auth/auth-user";
import { RbacService } from "./rbac.service";

const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const user: AuthUser = {
  id: "u1",
  firmId: "f1",
  userType: "FIRM",
  email: "u1@example.com",
};

function rbac(globalPerms: string[], assignments: string[]) {
  const prisma = {
    userRole: {
      findMany: async () => [
        {
          clientScopeId: null,
          // U9-A1 R2: a grant counts only when its role's scope fits the user.
          role: {
            scope: "FIRM",
            rolePermissions: globalPerms.map((p) => {
              const [resource, action] = p.split(":");
              return { permission: { resource, action } };
            }),
          },
        },
      ],
    },
    firmClientAssignment: {
      findMany: async () => assignments.map((clientId) => ({ clientId })),
    },
    client: {
      findMany: async ({ where }: { where: { id: { in: string[] }; firmId: string } }) =>
        where.firmId === "f1"
          ? where.id.in.filter((i) => [A, B].includes(i)).map((id) => ({ id }))
          : [],
      findFirst: async ({ where }: { where: { id: string; firmId: string } }) =>
        [A, B].includes(where.id) && where.firmId === "f1" ? { id: where.id } : null,
    },
  };
  return new RbacService(
    prisma as unknown as ConstructorParameters<typeof RbacService>[0],
  );
}

describe("U4-A1 · visibility without a permission", () => {
  it("authorize(user, [], client) answers whether the client is visible", async () => {
    const svc = rbac([], [A]);
    expect(await svc.authorize(user, [], A)).toBe(true);
    expect(await svc.authorize(user, [], B)).toBe(false);
  });

  it("Clients:ViewAll sees every client of the firm", async () => {
    const svc = rbac(["Clients:ViewAll"], []);
    expect(await svc.authorize(user, [], B)).toBe(true);
  });

  it("with no client and no permission it still answers true (unchanged)", async () => {
    expect(await rbac([], []).authorize(user, [])).toBe(true);
  });

  it("assertVisibleClient refuses an unseen client, naming what would grant it", async () => {
    const svc = rbac([], [A]);
    await expect(svc.assertVisibleClient(user, A)).resolves.toBeUndefined();
    await expect(svc.assertVisibleClient(user, B)).rejects.toEqual(
      new ForbiddenException(`Missing permission(s): Clients:ViewAll for client ${B}`),
    );
  });

  it("authorizedClients(user, []) lists the visible clients", async () => {
    expect(await rbac([], [A]).authorizedClients(user, [])).toEqual(new Set([A]));
    expect(await rbac(["Clients:ViewAll"], []).authorizedClients(user, [])).toBe("all");
  });
});
