/**
 * track-a-exempt.db-spec.ts — a client with no tax regime keeps books (U8, D39).
 *
 * T1: an invented client whose taxType is null (the client form's "None (exempt
 * from business tax)") imports two receipts through the REAL importer, from a
 * workbook whose CLIENT sheet still reads the pre-U8 "NOT SET — …" label (a file
 * generated before this unit must keep importing: the importer compares the client
 * id only). Every read-back goes through a second, freshly connected PrismaClient.
 *
 * The database is truncated before each test (U3 R12); each test seeds only what
 * it needs: the Super Admin role with its grants (the importer authorises through
 * RBAC), one invented firm, user and client, and two invented chart accounts.
 *
 * Needs a local PostgreSQL on DATABASE_URL:  bash scripts/local-db.sh
 * Run with:                                  pnpm --filter api test:db
 */
import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { PrismaClient } from "@prisma/client";
import ExcelJS from "exceljs";
import { AppModule } from "../../src/app.module";
import type { AuthUser } from "../../src/common/auth/auth-user";
import { DashboardService } from "../../src/dashboard/dashboard.service";
import { AggregationService } from "../../src/integration/aggregation.service";
import { IncomeTransactionsService } from "../../src/income-transactions/income-transactions.service";
import { PurchaseTransactionsService } from "../../src/purchase-transactions/purchase-transactions.service";
import { ExpenseImportService } from "../../src/purchase-transactions/import/expense-import.service";
import {
  CLIENT_SHEET_KEYS,
  EXPENSES_HEADERS,
  SHEET,
} from "../../src/purchase-transactions/import/expense-import.constants";
import { ensureFirmRole, truncateBeforeEach } from "./helpers/truncate";

type Header = (typeof EXPENSES_HEADERS)[number];
type RowInput = Partial<Record<Header, unknown>>;

/** The CLIENT sheet's regime label as every template generated before U8 printed it for a null client. */
const PRE_U8_LABEL = "NOT SET — set the client's tax type before importing";

const TAG = `track-a-exempt-${randomUUID().slice(0, 8)}`;
const ACCOUNTS = [
  {
    code: "5998001",
    name: `${TAG} Supplies`,
    class: "Expense",
    accountType: "Operating Expense",
    normalBalance: "debit",
  },
];

/** The mixed supermarket receipt of docs/import-expenses.md (invented). */
const SUPERMARKET: RowInput = {
  Date: new Date(Date.UTC(2026, 7, 14)),
  "Document Type": "SALES_INVOICE",
  "Vendor TIN": "000-222-333-00000",
  "Vendor Registered Name": "Invented Supermart Inc",
  "Reference Number": "00000000000000000012345",
  "Vatable Amount": 2952.01,
  "VAT Amount": 354.24,
  "VAT-Exempt Amount": 887.96,
  "Gross Total": 4194.21,
  Description: "Groceries and supplies",
  "COA Code": "5998001",
  "Source File": "IMG_0001.jpg",
};
/** A slip with no vendor TIN (invented). */
const SLIP_NO_TIN: RowInput = {
  Date: new Date(Date.UTC(2026, 8, 2)),
  "Document Type": "DELIVERY_RECEIPT",
  "Vendor Registered Name": "Invented Water Delivery",
  "Other Non-vatable": 500,
  "Gross Total": 500,
  Description: "Water delivery",
  "COA Code": "5998001",
  "Source File": "IMG_0002.jpg",
};

describe("U8 · a client with no tax regime keeps books (db)", () => {
  truncateBeforeEach();

  let app: INestApplication;
  let svc: ExpenseImportService;
  let dashboard: DashboardService;
  let aggregation: AggregationService;
  let incomes: IncomeTransactionsService;
  let purchases: PurchaseTransactionsService;
  let writer: PrismaClient;
  let actor: AuthUser;
  let clientId = "";

  beforeAll(async () => {
    if (!process.env.DATABASE_URL)
      throw new Error("DATABASE_URL is not set. Run `bash scripts/local-db.sh` first.");
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    svc = app.get(ExpenseImportService);
    dashboard = app.get(DashboardService);
    aggregation = app.get(AggregationService);
    incomes = app.get(IncomeTransactionsService);
    purchases = app.get(PurchaseTransactionsService);
    writer = new PrismaClient();
  });
  afterAll(async () => {
    await writer.$disconnect();
    await app.close();
  });

  beforeEach(async () => {
    await ensureFirmRole("Super Admin", writer);
    const role = await writer.role.findUniqueOrThrow({
      where: { name_scope: { name: "Super Admin", scope: "FIRM" } },
    });
    const firm = await writer.firm.create({ data: { name: `${TAG} firm` } });
    const user = await writer.user.create({
      data: {
        firmId: firm.id,
        userType: "FIRM",
        fullName: `${TAG} accountant`,
        email: `${TAG}@example.com`,
        status: "ACTIVE",
        firmProfile: { create: { title: "Test" } },
        userRoles: { create: { roleId: role.id } },
      },
    });
    actor = { id: user.id, firmId: firm.id, userType: "FIRM", email: user.email };
    // Invented: an individual who owes no business tax — the client form's "None".
    const client = await writer.client.create({
      data: {
        firmId: firm.id,
        businessName: "HALIMBAWA, JUANA SUBOK",
        kind: "individual",
        lastName: "HALIMBAWA",
        firstName: "JUANA",
        middleName: "SUBOK",
        tin: "000987654",
        taxType: null,
      },
    });
    clientId = client.id;
    for (const a of ACCOUNTS)
      await writer.chartAccount.create({ data: { ...a, source: "custom" } });
  });

  async function makeFile(
    rows: RowInput[],
    regimeLabel?: string,
  ): Promise<{ buffer: Buffer; label: string }> {
    const { buffer } = await svc.template(actor, clientId);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer as unknown as ArrayBuffer);
    const cs = wb.getWorksheet(SHEET.CLIENT)!;
    let label = "";
    cs.eachRow((r) => {
      const k = String(r.getCell(1).value);
      if (k === CLIENT_SHEET_KEYS.periodFrom) r.getCell(2).value = "2026-07-01";
      if (k === CLIENT_SHEET_KEYS.periodTo) r.getCell(2).value = "2026-09-30";
      if (k === CLIENT_SHEET_KEYS.regime) {
        if (regimeLabel !== undefined) r.getCell(2).value = regimeLabel;
        label = String(r.getCell(2).value);
      }
    });
    const ws = wb.getWorksheet(SHEET.EXPENSES)!;
    for (const row of rows)
      ws.addRow(
        EXPENSES_HEADERS.map((h) =>
          row[h] === undefined ? null : row[h],
        ) as ExcelJS.CellValue[],
      );
    return { buffer: Buffer.from(await wb.xlsx.writeBuffer()), label };
  }
  const upload = (buffer: Buffer) => ({
    buffer,
    originalname: "expenses.xlsx",
    mimetype: "application/octet-stream",
    size: buffer.length,
  });

  it("T1: a pre-U8 file (CLIENT sheet 'NOT SET — …') for a client with no tax regime imports: three posted records, the gross is the expense, no VAT claimed, the slip flagged", async () => {
    const { buffer, label } = await makeFile([SUPERMARKET, SLIP_NO_TIN], PRE_U8_LABEL);
    expect(label).toBe(PRE_U8_LABEL);

    const res = await svc.importFile(actor, clientId, upload(buffer), false);
    expect(res.totals).toMatchObject({ rows: 2, posted: 2, held: 0, rejected: 0 });

    const reader = new PrismaClient();
    try {
      const rows = await reader.purchaseTransaction.findMany({
        where: { clientId },
        orderBy: { netAmount: "desc" },
      });
      expect(
        rows.map((r) => ({
          net: r.netAmount.toNumber(),
          tax: r.taxAmount?.toNumber() ?? null,
          inputVAT: r.inputVAT?.toNumber() ?? null,
          category: r.inputVATCategory,
          claimable: r.vatClaimable,
          status: r.status,
          review: r.needsReview,
        })),
      ).toEqual([
        {
          net: 3306.25,
          tax: 354.24,
          inputVAT: null,
          category: null,
          claimable: false,
          status: "posted",
          review: false,
        },
        {
          net: 887.96,
          tax: null,
          inputVAT: null,
          category: null,
          claimable: false,
          status: "posted",
          review: false,
        },
        {
          net: 500,
          tax: null,
          inputVAT: null,
          category: null,
          claimable: false,
          status: "posted",
          review: true,
        },
      ]);
      // The client is untouched: still no tax regime (nothing new is stored).
      expect(
        (await reader.client.findUniqueOrThrow({ where: { id: clientId } })).taxType,
      ).toBeNull();
    } finally {
      await reader.$disconnect();
    }
  });

  it("T1: a template generated now labels the client 'Exempt from business tax (no VAT, no percentage tax)'", async () => {
    const { label } = await makeFile([]);
    expect(label).toBe("Exempt from business tax (no VAT, no percentage tax)");
  });

  describe("T3: nothing computes a business tax for the exempt client (real services, real database)", () => {
    let controlId = "";
    beforeEach(async () => {
      // A percentage-tax control client in the same firm: the dashboard and the
      // integration summaries must tell the two apart.
      const control = await writer.client.create({
        data: {
          firmId: actor.firmId,
          businessName: `${TAG} Percentage Control`,
          tin: "000111333",
          taxType: "PERCENTAGE",
        },
      });
      controlId = control.id;
      for (const id of [clientId, controlId]) {
        const cat = await writer.category.create({
          data: { clientId: id, type: "INCOME", name: `${TAG} sales` },
        });
        await writer.incomeTransaction.create({
          data: {
            clientId: id,
            categoryId: cat.id,
            txnDate: new Date("2026-08-14T00:00:00.000Z"),
            description: "Sale",
            netAmount: 20000,
            vatClass: "NON_VAT",
            source: "manual",
          },
        });
      }
    });

    it("dashboard: the exempt client is counted in neither regime and gets no 2550Q or 2551Q in upcoming filings", async () => {
      const overview = await dashboard.firmOverview(actor.firmId);
      expect(overview.regimeMix).toEqual({ vat: 0, percentage: 1 });
      const names = overview.upcomingFilings.map((f) => f.client);
      expect(names).toContain(`${TAG} Percentage Control`);
      expect(names).not.toContain("HALIMBAWA, JUANA SUBOK");
    });

    it("income summary (the web's estimate input): a sale through the real create path is NON_VAT, a VAT sale is refused, and the total output VAT is 0", async () => {
      // The summary sums what is stored, so the sale goes through the real create
      // path (regime, frozen schema, validator); were the null regime read as VAT,
      // the NON_VAT sale would be refused and the VAT one written.
      const cat = await writer.category.findFirstOrThrow({
        where: { clientId, type: "INCOME" },
      });
      await incomes.create(actor, clientId, {
        txnDate: "2026-08-20",
        description: "Consulting",
        categoryId: cat.id,
        netAmount: 5000,
        vatClass: "NON_VAT",
        saleToGovernment: false,
      });
      await expect(
        incomes.create(actor, clientId, {
          txnDate: "2026-08-21",
          description: "Consulting",
          categoryId: cat.id,
          netAmount: 5000,
          vatClass: "VATABLE_12",
          outputVAT: 600,
          saleToGovernment: false,
        }),
      ).rejects.toMatchObject({ status: 400 });
      const sum = await incomes.summary(actor, clientId, {});
      expect(sum).toMatchObject({ totalNet: 25000, totalOutputVAT: 0 });
    });

    it("purchase summary: a manual expense through the real create path is written and the total input VAT is 0", async () => {
      const cat = await writer.category.create({
        data: { clientId, type: "EXPENSE", name: `${TAG} supplies` },
      });
      await purchases.create(actor, clientId, {
        txnDate: "2026-08-15",
        description: "Supplies",
        categoryId: cat.id,
        netAmount: 1500,
        isCapitalGood: false,
      });
      const sum = await purchases.summary(actor, clientId, {});
      expect(sum).toMatchObject({ totalNet: 1500, totalInputVAT: 0 });
    });

    it("integration vat-summary: 409 for the exempt client", async () => {
      await expect(
        aggregation.vatSummary(actor.firmId, clientId, 2026, 3),
      ).rejects.toMatchObject({ status: 409 });
    });

    it("integration percentage-tax-summary: 409 for the exempt client; the control client gets its gross receipts", async () => {
      await expect(
        aggregation.percentageTaxSummary(actor.firmId, clientId, 2026, 3),
      ).rejects.toMatchObject({ status: 409 });
      await expect(
        aggregation.percentageTaxSummary(actor.firmId, controlId, 2026, 3),
      ).resolves.toMatchObject({ grossReceipts: 20000 });
    });
  });
});
