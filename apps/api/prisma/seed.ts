/**
 * Idempotent seed: the RBAC catalog (permissions + default roles) and a bootstrap
 * firm with a Super Admin account. Safe to run repeatedly.
 *
 *   pnpm --filter api db:seed
 *
 * Bootstrap admin credentials come from env (SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD),
 * defaulting to admin@firm.test / ChangeMe123! for local development.
 */
import { PrismaClient } from "@prisma/client";
import * as argon2 from "argon2";
import { allPermissions, DEFAULT_ROLES } from "../src/rbac/permissions.constants";

const prisma = new PrismaClient();

async function seedPermissionsAndRoles(): Promise<void> {
  // Permissions
  for (const { resource, action } of allPermissions()) {
    await prisma.permission.upsert({
      where: { resource_action: { resource, action } },
      update: {},
      create: { resource, action },
    });
  }

  // Roles + their permission grants
  for (const def of DEFAULT_ROLES) {
    const role = await prisma.role.upsert({
      where: { name_scope: { name: def.name, scope: def.scope } },
      update: {},
      create: { name: def.name, scope: def.scope },
    });

    // Reset this role's permission mappings to match the definition.
    await prisma.rolePermission.deleteMany({ where: { roleId: role.id } });
    for (const p of def.permissions) {
      const [resource, action] = p.split(":");
      const permission = await prisma.permission.findUnique({
        where: { resource_action: { resource: resource!, action: action! } },
      });
      if (permission) {
        await prisma.rolePermission.create({
          data: { roleId: role.id, permissionId: permission.id },
        });
      }
    }
  }
  console.log(
    `Seeded ${allPermissions().length} permissions and ${DEFAULT_ROLES.length} roles.`,
  );
}

async function seedBootstrapAdmin(): Promise<void> {
  const firmName = process.env.SEED_FIRM_NAME ?? "Demo Accounting Firm";
  const adminEmail = (process.env.SEED_ADMIN_EMAIL ?? "admin@firm.test").toLowerCase();
  const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? "ChangeMe123!";

  const firm =
    (await prisma.firm.findFirst({ where: { name: firmName } })) ??
    (await prisma.firm.create({ data: { name: firmName } }));

  const superAdmin = await prisma.role.findUnique({
    where: { name_scope: { name: "Super Admin", scope: "FIRM" } },
  });
  if (!superAdmin) throw new Error("Super Admin role missing; seed roles first");

  const existing = await prisma.user.findUnique({ where: { email: adminEmail } });
  if (existing) {
    console.log(`Bootstrap admin already exists: ${adminEmail}`);
    return;
  }

  const passwordHash = await argon2.hash(adminPassword, { type: argon2.argon2id });
  const user = await prisma.user.create({
    data: {
      firmId: firm.id,
      userType: "FIRM",
      email: adminEmail,
      fullName: "Firm Super Admin",
      passwordHash,
      status: "ACTIVE",
      firmProfile: { create: { title: "Administrator" } },
      userRoles: { create: { roleId: superAdmin.id } },
    },
  });
  console.log(
    `Created bootstrap Super Admin ${adminEmail} (firm "${firmName}", user ${user.id}).`,
  );
}

async function main(): Promise<void> {
  await seedPermissionsAndRoles();
  await seedBootstrapAdmin();
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
