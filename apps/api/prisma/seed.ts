/**
 * Idempotent seed: the RBAC catalog (permissions + default roles) and a bootstrap
 * firm with a Super Admin account. Safe to run repeatedly.
 *
 *   pnpm --filter api db:seed
 *
 * Bootstrap admin credentials come from env (SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD),
 * defaulting to admin@firm.test / ChangeMe123! for local development.
 */
import * as fs from "fs";
import * as path from "path";
import { PrismaClient } from "@prisma/client";
import * as argon2 from "argon2";
import { OAUTH_SCOPES } from "@portal/shared";
import { allPermissions, DEFAULT_ROLES } from "../src/rbac/permissions.constants";
import { seedChartOfAccounts } from "../src/coa/coa-seed";

const prisma = new PrismaClient();

/** Global BIR tax-code reference data (24 tax types + 228 ATC codes). Loaded
 *  from prisma/data/bir_tax_codes.json and upserted so re-runs stay idempotent
 *  and a refreshed dataset (new revenue issuances) updates in place. */
interface BirTaxTypeRow {
  code: string;
  name: string;
  forms?: string[];
  status?: string;
  notes?: string;
}
interface BirAtcRow {
  atc: string;
  classification: string;
  tax_type_code: string;
  payee_type: string;
  description: string;
  condition?: string;
  rate?: number | null;
  rate_basis?: string | null;
  threshold_amount?: number | null;
  bracket?: string | null;
  forms?: string[];
  certificate?: string | null;
  status?: string;
  notes?: string;
}
async function seedBirTaxCodes(): Promise<void> {
  const file = path.join(__dirname, "data", "bir_tax_codes.json");
  if (!fs.existsSync(file)) {
    console.warn("[seed] bir_tax_codes.json not found — skipping tax-code seed.");
    return;
  }
  const data = JSON.parse(fs.readFileSync(file, "utf8")) as {
    tax_types: BirTaxTypeRow[];
    atc_codes: BirAtcRow[];
  };
  for (const t of data.tax_types) {
    const row = {
      name: t.name,
      forms: t.forms ?? [],
      status: t.status ?? "active",
      notes: t.notes && t.notes.trim() ? t.notes : null,
    };
    await prisma.birTaxType.upsert({
      where: { code: t.code },
      create: { code: t.code, ...row },
      update: row,
    });
  }
  for (const a of data.atc_codes) {
    const row = {
      classification: a.classification,
      taxTypeCode: a.tax_type_code,
      payeeType: a.payee_type,
      description: a.description,
      condition: a.condition && a.condition.trim() ? a.condition : null,
      rate: a.rate ?? null,
      rateBasis: a.rate_basis && a.rate_basis.trim() ? a.rate_basis : null,
      thresholdAmount: a.threshold_amount ?? null,
      bracket: a.bracket && String(a.bracket).trim() ? a.bracket : null,
      forms: a.forms ?? [],
      certificate: a.certificate && a.certificate.trim() ? a.certificate : null,
      status: a.status ?? "active",
      notes: a.notes && a.notes.trim() ? a.notes : null,
    };
    await prisma.birAtcCode.upsert({
      where: { atc: a.atc },
      create: { atc: a.atc, ...row },
      update: row,
    });
  }
  console.log(
    `[seed] BIR tax codes: ${data.tax_types.length} tax types, ${data.atc_codes.length} ATC codes.`,
  );
}

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

async function seedBootstrapAdmin(): Promise<string> {
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
    return firm.id;
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
  return firm.id;
}

/**
 * Idempotent demo OAuth2 client-credentials machine for the BIR Form Generator.
 * Only seeded when SEED_INTEGRATION_CLIENT_KEY + _SECRET are provided (so we never
 * create a machine credential with a default/guessable secret).
 */
async function seedIntegrationClient(firmId: string): Promise<void> {
  const clientKey = process.env.SEED_INTEGRATION_CLIENT_KEY;
  const clientSecret = process.env.SEED_INTEGRATION_CLIENT_SECRET;
  if (!clientKey || !clientSecret) {
    console.log(
      "Skipping integration client seed (set SEED_INTEGRATION_CLIENT_KEY / _SECRET to enable).",
    );
    return;
  }
  const clientSecretHash = await argon2.hash(clientSecret, { type: argon2.argon2id });
  const scopes = [...OAUTH_SCOPES];
  await prisma.integrationClient.upsert({
    where: { clientKey },
    update: { clientSecretHash, grantedScopesJson: scopes, status: "ACTIVE" },
    create: {
      firmId,
      clientKey,
      clientSecretHash,
      grantedScopesJson: scopes,
      status: "ACTIVE",
    },
  });
  console.log(`Seeded integration client "${clientKey}" (${scopes.length} scopes).`);
}

/**
 * One-time cleanup: earlier builds seeded a demo client so a fresh install looked
 * populated. That was wrong — production should show only the firm's REAL data
 * (empty until they add clients). This removes that sample client and all of its
 * data, matched by its EXACT sample name so it can never touch a real client.
 * Idempotent: once the sample is gone, this is a no-op on every future boot.
 */
async function removeSampleClient(firmId: string): Promise<void> {
  const SAMPLE_NAME = "Malaya Trading Corp. (Sample)";
  const sample = await prisma.client.findFirst({
    where: { firmId, businessName: SAMPLE_NAME },
  });
  if (!sample) return;

  // Delete children first (income→category is ON DELETE RESTRICT), then the client.
  await prisma.bIRFiling.deleteMany({ where: { clientId: sample.id } });
  await prisma.incomeTransaction.deleteMany({ where: { clientId: sample.id } });
  await prisma.purchaseTransaction.deleteMany({ where: { clientId: sample.id } });
  await prisma.category.deleteMany({ where: { clientId: sample.id } });
  await prisma.client.delete({ where: { id: sample.id } });
  console.log(`Removed sample client "${SAMPLE_NAME}" (${sample.id}) and all its demo data.`);
}

async function main(): Promise<void> {
  await seedPermissionsAndRoles();
  await seedBirTaxCodes();
  const firmId = await seedBootstrapAdmin();
  await seedIntegrationClient(firmId);
  await removeSampleClient(firmId);
  // LAST on purpose: the Chart of Accounts validates its xlsx and fails loudly.
  // Running it after RBAC/admin seeding means a bad data file can never leave a
  // fresh environment without a Super Admin to log in with.
  const coa = await seedChartOfAccounts(prisma, path.join(__dirname, "data"));
  console.log(
    `[seed] Chart of Accounts: ${coa.accounts} accounts; ` +
      `${coa.mappings} BIR mapping rows (${coa.mapped} mapped).`,
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
