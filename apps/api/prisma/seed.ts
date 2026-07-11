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
import { OAUTH_SCOPES } from "@portal/shared";
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
 * Idempotent demo data: ONE clearly-labeled sample client with categories, a few
 * months of income/expense transactions, and a couple of recorded BIR filings, so
 * a fresh install shows a populated firm dashboard. Guarded by the sample client's
 * TIN — re-running never duplicates. The user can delete this client from the UI.
 */
async function seedSampleClient(firmId: string): Promise<void> {
  const SAMPLE_TIN = "010-582-334-000";

  const existing = await prisma.client.findFirst({
    where: { firmId, tin: SAMPLE_TIN },
  });
  if (existing) {
    console.log(`Sample client already present (TIN ${SAMPLE_TIN}); skipping demo data.`);
    return;
  }

  const client = await prisma.client.create({
    data: {
      firmId,
      businessName: "Malaya Trading Corp. (Sample)",
      tin: SAMPLE_TIN,
      taxType: "VAT",
      status: "ACTIVE",
      currency: "PHP",
      kind: "non-individual",
      regName: "Malaya Trading Corporation",
      tradeName: "Malaya Trading",
      branch: "00000",
      address: "1215 Ayala Ave, Makati City",
      city: "Makati City",
      zip: "1226",
      rdo: "047",
      rdoName: "RDO 047 - East Makati",
      incorpDate: new Date("2015-03-01"),
      email: "sample@malayatrading.example",
      phone: "+63 2 8555 0100",
      taxpayerType: "Corporation",
      classification: "Non-Individual",
      taxTypesJson: [
        { type: "Value-Added Tax", form: "2550Q", frequency: "Quarterly", startDate: "2015-03-01" },
        { type: "Income Tax", form: "1701Q", frequency: "Quarterly", startDate: "2015-03-01" },
        { type: "Registration Fee", form: "0605", frequency: "Annual", startDate: "2015-03-01" },
      ],
    },
  });

  // Categories (2 income, 2 expense). Unique on [clientId, type, name].
  const categoryNames = {
    serviceRevenue: "Service Revenue",
    productSales: "Product Sales",
    officeSupplies: "Office Supplies",
    utilities: "Utilities",
  } as const;
  const upsertCategory = (type: "INCOME" | "EXPENSE", name: string) =>
    prisma.category.upsert({
      where: { clientId_type_name: { clientId: client.id, type, name } },
      update: {},
      create: { clientId: client.id, type, name, isDeductible: type === "EXPENSE" },
    });
  const serviceRevenue = await upsertCategory("INCOME", categoryNames.serviceRevenue);
  const productSales = await upsertCategory("INCOME", categoryNames.productSales);
  const officeSupplies = await upsertCategory("EXPENSE", categoryNames.officeSupplies);
  const utilities = await upsertCategory("EXPENSE", categoryNames.utilities);

  // ~6 income transactions across the last ~3 months. Amounts NET of VAT.
  await prisma.incomeTransaction.createMany({
    data: [
      { clientId: client.id, categoryId: serviceRevenue.id, txnDate: new Date("2026-05-08"), description: "Consulting engagement", customer: "Northwind Inc.", netAmount: 85000, vatClass: "VATABLE_12", outputVAT: 10200, source: "manual" },
      { clientId: client.id, categoryId: productSales.id, txnDate: new Date("2026-05-22"), description: "Wholesale goods delivery", customer: "Sari-Sari Depot", netAmount: 120000, vatClass: "VATABLE_12", outputVAT: 14400, source: "manual" },
      { clientId: client.id, categoryId: serviceRevenue.id, txnDate: new Date("2026-06-05"), description: "Export services", customer: "Pacific Freight Ltd.", netAmount: 95000, vatClass: "ZERO_RATED", source: "manual" },
      { clientId: client.id, categoryId: productSales.id, txnDate: new Date("2026-06-18"), description: "Retail counter sales", customer: "Walk-in", netAmount: 64000, vatClass: "VATABLE_12", outputVAT: 7680, source: "manual" },
      { clientId: client.id, categoryId: serviceRevenue.id, txnDate: new Date("2026-07-02"), description: "Educational materials", customer: "Bright Minds Co-op", netAmount: 40000, vatClass: "EXEMPT", source: "manual" },
      { clientId: client.id, categoryId: productSales.id, txnDate: new Date("2026-07-09"), description: "Bulk order fulfillment", customer: "Metro Grocers", netAmount: 150000, vatClass: "VATABLE_12", outputVAT: 18000, source: "manual" },
    ],
  });

  // ~5 purchase transactions across the last ~3 months. Amounts NET of VAT.
  await prisma.purchaseTransaction.createMany({
    data: [
      { clientId: client.id, categoryId: officeSupplies.id, txnDate: new Date("2026-05-10"), description: "Printer & stationery", vendor: "OfficeWarehouse", netAmount: 32000, inputVATCategory: "DOMESTIC_PURCHASES", inputVAT: 3840, deductible: true, source: "manual" },
      { clientId: client.id, categoryId: utilities.id, txnDate: new Date("2026-05-27"), description: "Electricity (Meralco)", vendor: "Meralco", netAmount: 18000, inputVATCategory: "DOMESTIC_PURCHASES", inputVAT: 2160, deductible: true, source: "manual" },
      { clientId: client.id, categoryId: officeSupplies.id, txnDate: new Date("2026-06-12"), description: "Packaging materials", vendor: "PackRight", netAmount: 25000, inputVATCategory: "DOMESTIC_PURCHASES", inputVAT: 3000, deductible: true, source: "manual" },
      { clientId: client.id, categoryId: utilities.id, txnDate: new Date("2026-06-30"), description: "Internet & telecom", vendor: "PLDT", netAmount: 21000, inputVATCategory: "DOMESTIC_PURCHASES", inputVAT: 2520, deductible: true, source: "manual" },
      { clientId: client.id, categoryId: officeSupplies.id, txnDate: new Date("2026-07-07"), description: "Warehouse equipment", vendor: "IndustrialMart", netAmount: 47000, inputVATCategory: "DOMESTIC_PURCHASES", inputVAT: 5640, deductible: true, source: "manual" },
    ],
  });

  // 1-2 recorded BIR filings (as the Generator would push back). xmlBase64 is a
  // placeholder — this is illustrative sample data, not a real eBIRForms artifact.
  const sampleXml = Buffer.from("<sample-filing/>").toString("base64");
  await prisma.bIRFiling.createMany({
    data: [
      {
        clientId: client.id,
        form: "2550Q",
        periodType: "quarter",
        periodStart: new Date("2026-01-01"),
        periodEnd: new Date("2026-03-31"),
        status: "filed",
        xmlFilename: "0105823340000002550Q2026Q1.xml",
        xmlBase64: sampleXml,
        pdfUrl: null,
      },
      {
        clientId: client.id,
        form: "1701Q",
        periodType: "quarter",
        periodStart: new Date("2026-01-01"),
        periodEnd: new Date("2026-03-31"),
        status: "filed",
        xmlFilename: "0105823340000001701Q2026Q1.xml",
        xmlBase64: sampleXml,
        pdfUrl: null,
      },
    ],
  });

  console.log(
    `Seeded sample client "${client.businessName}" (${client.id}): 4 categories, ` +
      `6 income + 5 purchase transactions, 2 BIR filings.`,
  );
}

async function main(): Promise<void> {
  await seedPermissionsAndRoles();
  const firmId = await seedBootstrapAdmin();
  await seedIntegrationClient(firmId);
  await seedSampleClient(firmId);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
