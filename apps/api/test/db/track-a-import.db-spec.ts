/**
 * track-a-import.db-spec.ts — the Expenses import v2 against a real PostgreSQL.
 *
 * Boots the real Nest application (the same module graph production runs) so
 * the importer, the category resolver, the regime validator, RBAC and the audit
 * log are all the real thing. Every read-back goes through a SECOND, fresh
 * PrismaClient so the assertion proves what landed in the database, not what
 * the writer still had in hand.
 *
 * Fixtures are invented (R8): a throwaway firm, two clients, three chart rows.
 * Everything is deleted in afterAll.
 *
 * Needs a local PostgreSQL on DATABASE_URL:  bash scripts/local-db.sh
 * Run with:                                  pnpm --filter api test:db
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { BadRequestException, ConflictException, INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { PrismaClient } from "@prisma/client";
import * as ExcelJS from "exceljs";
import { AppModule } from "../../src/app.module";
import { PrismaService } from "../../src/prisma/prisma.service";
import { DashboardService } from "../../src/dashboard/dashboard.service";
import { AggregationService } from "../../src/integration/aggregation.service";
import { PurchaseTransactionsService } from "../../src/purchase-transactions/purchase-transactions.service";
import { ExpenseImportService } from "../../src/purchase-transactions/import/expense-import.service";
import { CLIENT_SHEET_KEYS, EXPENSES_HEADERS, SHEET } from "../../src/purchase-transactions/import/expense-import.constants";
import type { AuthUser } from "../../src/common/auth/auth-user";

function loadRootEnv(): void {
  if (process.env.DATABASE_URL) return;
  const envPath = join(__dirname, "..", "..", "..", "..", ".env");
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const m = /^\s*DATABASE_URL\s*=\s*(.*)$/.exec(line);
    if (m && m[1]) {
      process.env.DATABASE_URL = m[1].trim().replace(/^["']|["']$/g, "");
      return;
    }
  }
}
loadRootEnv();

type Header = (typeof EXPENSES_HEADERS)[number];
type RowInput = Partial<Record<Header, unknown>>;

const TAG = `track-a-import-${randomUUID().slice(0, 8)}`;
const ACCOUNTS = [
  { code: "5999001", name: `${TAG} Office Supplies`, class: "Expense", accountType: "Operating Expense", normalBalance: "debit" },
  { code: "5999002", name: `${TAG} Owner's Personal Expenses`, class: "Expense", accountType: "Other Expense", normalBalance: "debit" },
  { code: "1999001", name: `${TAG} Asset`, class: "Asset", accountType: "Current Asset", normalBalance: "debit" },
];

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
  "COA Code": "5999001",
  "Source File": "IMG_0001.jpg",
};
const DELIVERY_NO_TIN: RowInput = {
  Date: new Date(Date.UTC(2026, 8, 2)),
  "Document Type": "DELIVERY_RECEIPT",
  "Vendor Registered Name": "Invented Water Delivery",
  "Other Non-vatable": 500,
  "Gross Total": 500,
  Description: "Water delivery",
  "COA Code": "5999001",
  "Source File": "IMG_0002.jpg",
};
const PLAIN_INVOICE: RowInput = {
  Date: new Date(Date.UTC(2026, 6, 20)),
  "Document Type": "SERVICE_INVOICE",
  "Vendor TIN": "000-444-555",
  "Vendor Lastname": "Dela Cruz",
  "Vendor Firstname": "Juan",
  "Reference Number": "SI-0007",
  "Other Non-vatable": 1200,
  "Gross Total": 1200,
  Description: "Aircon cleaning",
  "COA Code": "5999001",
};

describe("expenses import v2 (db)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let reader: PrismaClient;
  let svc: ExpenseImportService;
  let purchases: PurchaseTransactionsService;
  let dashboard: DashboardService;
  let aggregation: AggregationService;
  let firmId = "";
  let actor: AuthUser;
  let vatClientId = "";
  let nonVatClientId = "";

  beforeAll(async () => {
    if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set. Run `bash scripts/local-db.sh` first.");
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    svc = app.get(ExpenseImportService);
    purchases = app.get(PurchaseTransactionsService);
    dashboard = app.get(DashboardService);
    aggregation = app.get(AggregationService);
    reader = new PrismaClient();

    const firm = await prisma.firm.create({ data: { name: `${TAG} firm` } });
    firmId = firm.id;
    const superAdmin = await prisma.role.findUnique({ where: { name_scope: { name: "Super Admin", scope: "FIRM" } } });
    if (!superAdmin) throw new Error("Super Admin role missing — run db:seed first (scripts/local-db.sh does).");
    const user = await prisma.user.create({
      data: {
        firmId,
        userType: "FIRM",
        fullName: `${TAG} accountant`,
        email: `${TAG}@example.com`,
        status: "ACTIVE",
        firmProfile: { create: { title: "Test" } },
        userRoles: { create: { roleId: superAdmin.id } },
      },
    });
    actor = { id: user.id, firmId, userType: "FIRM", email: user.email };
    const vat = await prisma.client.create({ data: { firmId, businessName: `${TAG} VAT Trading Co`, tin: "000111222", taxType: "VAT" } });
    const nonVat = await prisma.client.create({ data: { firmId, businessName: `${TAG} Sari-Sari Store`, tin: "000111333", taxType: "PERCENTAGE" } });
    vatClientId = vat.id;
    nonVatClientId = nonVat.id;
    for (const a of ACCOUNTS) await prisma.chartAccount.create({ data: { ...a, source: "custom" } });
  });

  afterAll(async () => {
    await prisma.auditLog.deleteMany({ where: { userId: actor.id } });
    await prisma.client.deleteMany({ where: { firmId } }); // cascades purchases + categories
    await prisma.user.deleteMany({ where: { firmId } });
    await prisma.firm.deleteMany({ where: { id: firmId } });
    await prisma.chartAccount.deleteMany({ where: { code: { in: ACCOUNTS.map((a) => a.code) } } });
    await reader.$disconnect();
    await app.close();
  });

  async function makeFile(clientId: string, rows: RowInput[]): Promise<Buffer> {
    const { buffer } = await svc.template(actor, clientId);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer as unknown as ArrayBuffer);
    const cs = wb.getWorksheet(SHEET.CLIENT)!;
    cs.eachRow((r) => {
      const k = String(r.getCell(1).value);
      if (k === CLIENT_SHEET_KEYS.periodFrom) r.getCell(2).value = "2026-07-01";
      if (k === CLIENT_SHEET_KEYS.periodTo) r.getCell(2).value = "2026-09-30";
    });
    const ws = wb.getWorksheet(SHEET.EXPENSES)!;
    for (const row of rows) ws.addRow(EXPENSES_HEADERS.map((h) => (row[h] === undefined ? null : row[h])) as ExcelJS.CellValue[]);
    return Buffer.from(await wb.xlsx.writeBuffer());
  }
  const upload = (buffer: Buffer, name = "expenses.xlsx") => ({ buffer, originalname: name, mimetype: "application/octet-stream", size: buffer.length });

  // ------------------------------------------------------------------ T1
  it("T1: the same file imported twice — the second run posts nothing and rejects every row as a duplicate naming the first run's records", async () => {
    const file = await makeFile(vatClientId, [SUPERMARKET, DELIVERY_NO_TIN, PLAIN_INVOICE]);
    const first = await svc.importFile(actor, vatClientId, upload(file), false);
    expect(first.totals).toMatchObject({ rows: 3, posted: 3, held: 0, rejected: 0 }); // U6-A2: the slip posts
    const firstIds = first.rows.flatMap((r) => r.records.map((x) => x.id as string));
    expect(firstIds).toHaveLength(4);

    const second = await svc.importFile(actor, vatClientId, upload(file), false);
    expect(second.totals).toMatchObject({ rows: 3, posted: 0, held: 0, rejected: 3 });
    for (const [i, r] of second.rows.entries()) {
      expect(r.outcome).toBe("rejected");
      const expectIds = first.rows[i]!.records.map((x) => x.id as string);
      for (const id of expectIds) expect(r.messages.join(" ")).toContain(id);
    }
    const count = await reader.purchaseTransaction.count({ where: { clientId: vatClientId } });
    expect(count).toBe(4);
  });

  // ------------------------------------------------------------------ T2
  it("T2: a mixed receipt for a non-VAT client becomes 3,306.25 (vatAmount 354.24, vatClaimable false) and 887.96", async () => {
    const res = await svc.importFile(actor, nonVatClientId, upload(await makeFile(nonVatClientId, [SUPERMARKET])), false);
    const ids = res.rows[0]!.records.map((x) => x.id as string);
    const rows = await reader.purchaseTransaction.findMany({ where: { id: { in: ids } }, orderBy: { netAmount: "desc" } });
    expect(rows.map((r) => ({ net: r.netAmount.toNumber(), tax: r.taxAmount?.toNumber() ?? null, inputVAT: r.inputVAT, claim: r.vatClaimable, cat: r.inputVATCategory }))).toEqual([
      { net: 3306.25, tax: 354.24, inputVAT: null, claim: false, cat: null },
      { net: 887.96, tax: null, inputVAT: null, claim: false, cat: null },
    ]);
  });

  it("T2: the same receipt for a VAT client becomes 2,952.01 (vatAmount 354.24, vatClaimable true) and 887.96", async () => {
    const res = await svc.importFile(actor, vatClientId, upload(await makeFile(vatClientId, [{ ...SUPERMARKET, "Reference Number": "VAT-SPLIT-1" }])), false);
    const ids = res.rows[0]!.records.map((x) => x.id as string);
    const rows = await reader.purchaseTransaction.findMany({ where: { id: { in: ids } }, orderBy: { netAmount: "desc" } });
    expect(rows.map((r) => ({ net: r.netAmount.toNumber(), inputVAT: r.inputVAT?.toNumber() ?? null, claim: r.vatClaimable, cat: r.inputVATCategory, status: r.status }))).toEqual([
      { net: 2952.01, inputVAT: 354.24, claim: true, cat: "DOMESTIC_PURCHASES", status: "posted" },
      { net: 887.96, inputVAT: null, claim: false, cat: "DOMESTIC_NO_INPUT_TAX", status: "posted" },
    ]);
  });

  it("T2: a delivery receipt with no TIN becomes one posted record with needsReview true (U6-A2)", async () => {
    const res = await svc.importFile(actor, nonVatClientId, upload(await makeFile(nonVatClientId, [{ ...DELIVERY_NO_TIN, Date: new Date(Date.UTC(2026, 8, 3)) }])), false);
    const id = res.rows[0]!.records[0]!.id as string;
    const row = await reader.purchaseTransaction.findUniqueOrThrow({ where: { id } });
    expect(row).toMatchObject({ status: "posted", needsReview: true, vendorTin: null, documentType: "DELIVERY_RECEIPT", vatClaimable: false, sourceFile: "IMG_0002.jpg", deductible: true });
    expect(row.netAmount.toNumber()).toBe(500);
  });

  it("T2: a blank COA Code holds the row; posting it changes status and nothing else", async () => {
    const res = await svc.importFile(actor, nonVatClientId, upload(await makeFile(nonVatClientId, [{ ...PLAIN_INVOICE, "COA Code": undefined, "Reference Number": "SI-BLANK-COA" }])), false);
    expect(res.rows[0]!.outcome).toBe("held");
    const id = res.rows[0]!.records[0]!.id as string;
    const before = await reader.purchaseTransaction.findUniqueOrThrow({ where: { id } });
    expect(before).toMatchObject({ status: "held", account: null });
    // Cannot post without an account (R4).
    await expect(svc.postHeld(actor, id)).rejects.toThrow(BadRequestException);
    // The accountant assigns the account through the existing update path, then posts.
    await purchases.update(actor, nonVatClientId, id, { account: `${TAG} Office Supplies` });
    const posted = await svc.postHeld(actor, id);
    expect(posted.status).toBe("posted");
    const after = await reader.purchaseTransaction.findUniqueOrThrow({ where: { id } });
    const { status: s1, account: _a1, categoryId: c1, updatedAt: u1, ...restBefore } = before;
    const { status: s2, account: a2, categoryId: c2, updatedAt: u2, ...restAfter } = after;
    expect([s1, s2]).toEqual(["held", "posted"]);
    expect(a2).toBe(`${TAG} Office Supplies`);
    expect(c2).not.toBe(c1);
    expect(u2.getTime()).toBeGreaterThanOrEqual(u1.getTime());
    expect(restAfter).toEqual(restBefore);
    // A second post is refused.
    await expect(svc.postHeld(actor, id)).rejects.toThrow(ConflictException);
  });

  it("T2: dryRun leaves the table unchanged", async () => {
    const before = await reader.purchaseTransaction.count({ where: { clientId: nonVatClientId } });
    const res = await svc.importFile(actor, nonVatClientId, upload(await makeFile(nonVatClientId, [{ ...PLAIN_INVOICE, "Reference Number": "DRY-1" }])), true);
    expect(res.rows[0]).toMatchObject({ outcome: "posted" });
    expect(res.rows[0]!.records[0]!.id).toBeNull();
    const after = await reader.purchaseTransaction.count({ where: { clientId: nonVatClientId } });
    expect(after).toBe(before);
  });

  it("T2: the import audit row carries the batch counts and every record points at the batch", async () => {
    const res = await svc.importFile(actor, nonVatClientId, upload(await makeFile(nonVatClientId, [{ ...PLAIN_INVOICE, "Reference Number": "AUD-1" }, { ...DELIVERY_NO_TIN, Date: new Date(Date.UTC(2026, 8, 4)) }]), "july-sept.xlsx"), false);
    const ids = res.rows.flatMap((r) => r.records.map((x) => x.id as string));
    const rows = await reader.purchaseTransaction.findMany({ where: { id: { in: ids } } });
    const batchIds = new Set(rows.map((r) => r.importBatchId));
    expect(batchIds.size).toBe(1);
    const [batchId] = [...batchIds];
    const batch = await reader.auditLog.findFirst({ where: { action: "purchase.import.batch", entityId: batchId! } });
    expect(batch?.metadata).toMatchObject({ clientId: nonVatClientId, fileName: "july-sept.xlsx", totals: { rows: 2, posted: 2, held: 0, rejected: 0 } });
    const perRecord = await reader.auditLog.count({ where: { action: "purchase.import.record", entityId: { in: ids } } });
    expect(perRecord).toBe(ids.length);
  });

  // ------------------------------------------------------------------ T4
  describe("T4: CHECK purchase_transactions_status_check, NULL coverage", () => {
    let categoryId = "";
    beforeAll(async () => {
      const cat = await prisma.category.create({ data: { clientId: nonVatClientId, type: "EXPENSE", name: `${TAG} check-cat` } });
      categoryId = cat.id;
    });
    const insert = (status: string | null) =>
      prisma.$executeRawUnsafe(
        `INSERT INTO purchase_transactions (id, "clientId", "categoryId", "txnDate", description, "netAmount", status, "createdAt", "updatedAt")
         VALUES ($1::uuid, $2::uuid, $3::uuid, '2026-07-01', 'check', 1.00, $4, now(), now())`,
        randomUUID(), nonVatClientId, categoryId, status,
      );
    it("'posted' and 'held' are accepted", async () => {
      await expect(insert("posted")).resolves.toBe(1);
      await expect(insert("held")).resolves.toBe(1);
    });
    /** Prisma puts the PostgreSQL message in `meta`, not always in `message`. */
    const pgText = async (p: Promise<unknown>): Promise<string> => {
      try { await p; return "RESOLVED"; } catch (e) {
        const err = e as { message?: string; meta?: unknown; code?: string };
        return `${err.code ?? ""} ${err.message ?? ""} ${JSON.stringify(err.meta ?? {})}`;
      }
    };
    it("NULL is rejected (by NOT NULL — the CHECK alone would let NULL through)", async () => {
      expect(await pgText(insert(null))).toMatch(/null value in column "status"|23502/);
    });
    it("any other value is rejected by the CHECK", async () => {
      expect(await pgText(insert("draft"))).toMatch(/purchase_transactions_status_check|23514/);
    });
  });

  // ------------------------------------------------------------------ T5 (db)
  describe("T5: held rows are excluded from every aggregate and present in lists", () => {
    let heldId = "";
    let postedId = "";
    beforeAll(async () => {
      // Dates no other test uses, so the sums below are exactly these two rows.
      const res = await svc.importFile(actor, vatClientId, upload(await makeFile(vatClientId, [
        { ...PLAIN_INVOICE, Date: new Date(Date.UTC(2026, 8, 10)), "Vendor TIN": "000-777-888", "Reference Number": "AGG-POSTED", "Other Non-vatable": 111, "Gross Total": 111 },
        // U6-A2: a document type no longer holds; a blank COA Code is the one hold left.
        { ...DELIVERY_NO_TIN, Date: new Date(Date.UTC(2026, 8, 11)), "COA Code": undefined, "Other Non-vatable": 999, "Gross Total": 999 },
      ])), false);
      postedId = res.rows[0]!.records[0]!.id as string;
      heldId = res.rows[1]!.records[0]!.id as string;
    });
    it("purchases.summary (the tax-estimate input) counts the posted 111, not the held 999", async () => {
      const heldDay = await purchases.summary(actor, vatClientId, { dateFrom: "2026-09-11", dateTo: "2026-09-11" });
      expect(heldDay.totalNet).toBe(0); // the held 999 does not count
      const postedDay = await purchases.summary(actor, vatClientId, { dateFrom: "2026-09-10", dateTo: "2026-09-10" });
      expect(postedDay.totalNet).toBe(111);
      const both = await purchases.summary(actor, vatClientId, { dateFrom: "2026-09-10", dateTo: "2026-09-11" });
      expect(both.totalNet).toBe(111);
      expect(both.count).toBe(1);
    });
    it("purchases.list shows both, each with its status", async () => {
      const l = await purchases.list(actor, vatClientId, { sortBy: "txnDate", sortDir: "desc", page: 1, pageSize: 200 });
      const byId = Object.fromEntries(l.data.map((d) => [d.id, d.status]));
      expect(byId[heldId]).toBe("held");
      expect(byId[postedId]).toBe("posted");
    });
    it("the firm dashboard expense total excludes the held 999", async () => {
      const d = await dashboard.firmOverview(firmId);
      const expenses = d.kpis.find((k) => k.label === "Portfolio expenses")!.value;
      const posted = await reader.purchaseTransaction.aggregate({ where: { client: { firmId }, status: "posted" }, _sum: { netAmount: true } });
      expect(expenses).toBe(posted._sum.netAmount!.toNumber());
      const all = await reader.purchaseTransaction.aggregate({ where: { client: { firmId } }, _sum: { netAmount: true } });
      expect(all._sum.netAmount!.toNumber()).toBeGreaterThan(expenses);
    });
    it("the integration vat-summary excludes the held row", async () => {
      const v = await aggregation.vatSummary(firmId, vatClientId, 2026, 3);
      // Item 48 (amount only) is where every no-input-VAT record of a VAT client lands.
      // It must equal the POSTED no-input rows of Q3 and must not contain the held 999.
      const q3 = { gte: new Date("2026-07-01T00:00:00.000Z"), lte: new Date("2026-09-30T00:00:00.000Z") };
      const posted = await reader.purchaseTransaction.aggregate({
        where: { clientId: vatClientId, txnDate: q3, inputVATCategory: "DOMESTIC_NO_INPUT_TAX", status: "posted" },
        _sum: { netAmount: true },
      });
      const all = await reader.purchaseTransaction.aggregate({
        where: { clientId: vatClientId, txnDate: q3, inputVATCategory: "DOMESTIC_NO_INPUT_TAX" },
        _sum: { netAmount: true },
      });
      const held = await reader.purchaseTransaction.aggregate({
        where: { clientId: vatClientId, txnDate: q3, inputVATCategory: "DOMESTIC_NO_INPUT_TAX", status: "held" },
        _sum: { netAmount: true },
      });
      expect(v.purchases.domesticNoInputTax.net).toBe(posted._sum.netAmount!.toNumber());
      expect(held._sum.netAmount!.toNumber()).toBeGreaterThanOrEqual(999); // this test's 999 (nothing else of this client's is held after U6-A2)
      expect(all._sum.netAmount!.toNumber()).toBe(posted._sum.netAmount!.toNumber() + held._sum.netAmount!.toNumber());
    });
  });

  // ------------------------------------------------------------------ T6 (db)
  it("T6: the template generates against the real chart and marks only expense-class accounts allowed", async () => {
    const { buffer, filename } = await svc.template(actor, vatClientId);
    expect(filename).toMatch(new RegExp(`^expenses-import-${vatClientId}-\\d{8}\\.xlsx$`));
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer as unknown as ArrayBuffer);
    expect(wb.worksheets.map((s) => s.name)).toEqual([SHEET.INSTRUCTIONS, SHEET.CLIENT, SHEET.EXPENSES, SHEET.REFERENCE, SHEET.COA]);
    const coa = wb.getWorksheet(SHEET.COA)!;
    const allowed: Record<string, string> = {};
    coa.eachRow((r, n) => { if (n > 1) allowed[String(r.getCell(1).value)] = String(r.getCell(6).value); });
    expect(allowed["5999001"]).toBe("Y");
    expect(allowed["1999001"]).toBe("N");
    expect(allowed["5001001"]).toBe("Y"); // a seeded operating expense
    expect(wb.getWorksheet(SHEET.EXPENSES)!.actualRowCount).toBe(1);
  });

  // ------------------------------------------------------------------ U6-A2 T1
  it("U6-A2 T1: a delivery receipt with no vendor TIN and no reference, on an allowed account, imports as ONE posted record with needsReview true", async () => {
    const slip = { ...DELIVERY_NO_TIN, Date: new Date(Date.UTC(2026, 8, 20)), "Other Non-vatable": 250, "Gross Total": 250 };
    const res = await svc.importFile(actor, nonVatClientId, upload(await makeFile(nonVatClientId, [slip])), false);
    expect(res.rows[0]).toMatchObject({ outcome: "posted", needsReview: true, messages: [expect.stringMatching(/no Vendor TIN/i)] });
    expect(res.rows[0]!.messages).toHaveLength(1);
    expect(res.rows[0]!.records).toHaveLength(1);
    const id = res.rows[0]!.records[0]!.id as string;
    const row = await reader.purchaseTransaction.findUniqueOrThrow({ where: { id } });
    expect(row).toMatchObject({ status: "posted", needsReview: true, vendorTin: null, referenceNo: null, documentType: "DELIVERY_RECEIPT", deductible: true, vatClaimable: false });
    expect(row.account).toBe(`${TAG} Office Supplies`);
    expect(row.netAmount.toNumber()).toBe(250);
    expect(res.totals).toEqual({ rows: 1, posted: 1, held: 0, rejected: 0, grossAmount: 250 });
  });

  // ------------------------------------------------------------------ U6-A2 T4
  it("U6-A2 T4: the three worked examples imported for real — two posted records per supermarket receipt, one posted flagged record for the slip; audit counts 3 rows, 3 posted, 0 held, 0 rejected", async () => {
    // References distinct from the earlier tests' so the ledger duplicate rule does not fire.
    const nonVat = await svc.importFile(actor, nonVatClientId, upload(await makeFile(nonVatClientId, [
      { ...SUPERMARKET, "Reference Number": "A2-NONVAT-12345" },
      { ...DELIVERY_NO_TIN, Date: new Date(Date.UTC(2026, 8, 21)) },
    ]), "examples-nonvat.xlsx"), false);
    const vat = await svc.importFile(actor, vatClientId, upload(await makeFile(vatClientId, [
      { ...SUPERMARKET, "Reference Number": "A2-VAT-12345" },
    ]), "examples-vat.xlsx"), false);

    expect(nonVat.rows.map((r) => r.outcome)).toEqual(["posted", "posted"]);
    expect(nonVat.rows[1]).toMatchObject({ needsReview: true });
    expect(vat.rows.map((r) => r.outcome)).toEqual(["posted"]);

    const back = async (ids: string[]) => reader.purchaseTransaction.findMany({ where: { id: { in: ids } }, orderBy: { netAmount: "desc" } });
    const ex1 = await back(nonVat.rows[0]!.records.map((x) => x.id as string));
    expect(ex1.map((r) => [r.netAmount.toNumber(), r.taxAmount?.toNumber() ?? null, r.vatClaimable, r.status])).toEqual([[3306.25, 354.24, false, "posted"], [887.96, null, false, "posted"]]);
    const ex3 = await back(nonVat.rows[1]!.records.map((x) => x.id as string));
    expect(ex3.map((r) => [r.netAmount.toNumber(), r.needsReview, r.status, r.vendorTin])).toEqual([[500, true, "posted", null]]);
    const ex2 = await back(vat.rows[0]!.records.map((x) => x.id as string));
    expect(ex2.map((r) => [r.netAmount.toNumber(), r.inputVAT?.toNumber() ?? null, r.vatClaimable, r.status])).toEqual([[2952.01, 354.24, true, "posted"], [887.96, null, false, "posted"]]);

    const batchTotals = async (recordId: string) => {
      const rec = await reader.purchaseTransaction.findUniqueOrThrow({ where: { id: recordId } });
      const audit = await reader.auditLog.findFirstOrThrow({ where: { action: "purchase.import.batch", entityId: rec.importBatchId! } });
      return (audit.metadata as { totals: { rows: number; posted: number; held: number; rejected: number } }).totals;
    };
    const t1 = await batchTotals(ex1[0]!.id);
    const t2 = await batchTotals(ex2[0]!.id);
    expect(t1).toMatchObject({ rows: 2, posted: 2, held: 0, rejected: 0 });
    expect(t2).toMatchObject({ rows: 1, posted: 1, held: 0, rejected: 0 });
    expect([t1.rows + t2.rows, t1.posted + t2.posted, t1.held + t2.held, t1.rejected + t2.rejected]).toEqual([3, 3, 0, 0]);
  });
});
