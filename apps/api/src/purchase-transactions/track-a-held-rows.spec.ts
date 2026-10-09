/**
 * track-a-held-rows.spec.ts — R7 of U6, hermetically: every query that SUMS
 * purchase transactions must ask the database for status = "posted" only, and
 * every income query must be left exactly as it was. Lists are not aggregates
 * and keep held rows (with their status) — the db-spec proves that with rows.
 *
 * These tests pin the WHERE clause each service hands Prisma. The db-spec
 * (track-a-import.db-spec.ts, T5) proves the same four queries against real
 * held and posted rows.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Prisma } from "@prisma/client";
import { DashboardService } from "../dashboard/dashboard.service";
import { AggregationService } from "../integration/aggregation.service";
import { McpService } from "../mcp/mcp.service";
import { RegimeValidator } from "../financial/regime-validator";
import { PurchaseTransactionsService } from "./purchase-transactions.service";
import type { AuditService } from "../audit/audit.service";
import type { CategoriesService } from "../categories/categories.service";
import type { ClientsService } from "../clients/clients.service";
import type { IncomeTransactionsService } from "../income-transactions/income-transactions.service";
import type { InvoicesService } from "../invoices/invoices.service";
import type { PrismaService } from "../prisma/prisma.service";
import type { AuthUser } from "../common/auth/auth-user";

const FIRM = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CLIENT = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const actor: AuthUser = { id: "11111111-1111-4111-8111-111111111111", firmId: FIRM, userType: "FIRM", email: "t@example.com" };

const whereOf = (fn: jest.Mock, call = 0): Record<string, unknown> =>
  (fn.mock.calls[call]?.[0] as { where: Record<string, unknown> }).where;

describe("R7 — purchases.summary (the client tax-estimate input)", () => {
  it("asks for status = posted on the total, the by-category and the deductible roll-ups", async () => {
    const prisma = {
      purchaseTransaction: {
        aggregate: jest.fn((args: unknown) => args),
        groupBy: jest.fn((args: unknown) => args),
      },
      $transaction: jest.fn(async () => [
        { _sum: { netAmount: new Prisma.Decimal(0), inputVAT: null }, _count: 0 },
        [],
        [],
      ]),
    };
    const svc = new PurchaseTransactionsService(
      prisma as unknown as PrismaService,
      { assertInFirm: jest.fn(async () => ({ id: CLIENT, firmId: FIRM, taxType: "VAT" })) } as unknown as ClientsService,
      {} as CategoriesService,
      new RegimeValidator(),
      { record: jest.fn() } as unknown as AuditService,
    );
    await svc.summary(actor, CLIENT, {});
    expect(whereOf(prisma.purchaseTransaction.aggregate)).toMatchObject({ clientId: CLIENT, status: "posted" });
    expect(whereOf(prisma.purchaseTransaction.groupBy, 0)).toMatchObject({ status: "posted" });
    expect(whereOf(prisma.purchaseTransaction.groupBy, 1)).toMatchObject({ status: "posted" });
  });
});

describe("R7 — firm dashboard", () => {
  it("excludes held rows from the expense KPI and the monthly series; income is untouched", async () => {
    const prisma = {
      client: { findMany: jest.fn(async () => [{ id: CLIENT, businessName: "Invented Co", taxType: "VAT", status: "ACTIVE" }]) },
      incomeTransaction: {
        aggregate: jest.fn(async () => ({ _sum: { netAmount: new Prisma.Decimal(10) } })),
        findMany: jest.fn(async () => []),
      },
      purchaseTransaction: {
        aggregate: jest.fn(async () => ({ _sum: { netAmount: new Prisma.Decimal(4) } })),
        findMany: jest.fn(async () => []),
      },
      bIRFiling: { count: jest.fn(async () => 0) },
      auditLog: { findMany: jest.fn(async () => []) },
    };
    const svc = new DashboardService(prisma as unknown as PrismaService);
    const d = await svc.firmOverview(FIRM);
    expect(d.kpis.find((k) => k.label === "Portfolio expenses")?.value).toBe(4);
    expect(whereOf(prisma.purchaseTransaction.aggregate)).toEqual({ client: { firmId: FIRM }, status: "posted" });
    expect(whereOf(prisma.purchaseTransaction.findMany)).toMatchObject({ client: { firmId: FIRM }, status: "posted" });
    expect(whereOf(prisma.incomeTransaction.aggregate)).not.toHaveProperty("status");
    expect(whereOf(prisma.incomeTransaction.findMany)).not.toHaveProperty("status");
  });
});

describe("R7 — integration vat-summary (2550Q roll-up)", () => {
  it("reads posted purchases only; income is untouched", async () => {
    const prisma = {
      client: { findFirst: jest.fn(async () => ({ id: CLIENT, firmId: FIRM, tin: "000111222", taxType: "VAT" })) },
      incomeTransaction: { findMany: jest.fn(async () => []) },
      purchaseTransaction: { findMany: jest.fn(async () => []) },
    };
    const svc = new AggregationService(prisma as unknown as PrismaService);
    const v = await svc.vatSummary(FIRM, CLIENT, 2026, 3);
    expect(v.purchases.domesticNoInputTax.net).toBe(0);
    expect(whereOf(prisma.purchaseTransaction.findMany)).toMatchObject({ clientId: CLIENT, status: "posted" });
    expect(whereOf(prisma.incomeTransaction.findMany)).not.toHaveProperty("status");
  });
});

describe("R7 — MCP portal_financial_summary", () => {
  it("groups posted purchases only; the income side is untouched", async () => {
    const prisma = {
      firm: { findFirst: jest.fn(async () => ({ id: FIRM, name: "Invented Firm" })) },
      user: { findFirst: jest.fn(async () => ({ id: actor.id, email: actor.email })) },
      client: {
        findFirst: jest.fn(async () => ({
          id: CLIENT, firmId: FIRM, businessName: "Invented Co", tin: "000111222", taxType: "VAT", status: "ACTIVE",
          city: null, province: null, billingParentId: null, billingMethod: "AS_FILING", professionalFee: null,
        })),
        findMany: jest.fn(async () => []),
      },
      incomeTransaction: { groupBy: jest.fn(async () => []), count: jest.fn(), findMany: jest.fn() },
      purchaseTransaction: { groupBy: jest.fn(async () => []), count: jest.fn(), findMany: jest.fn() },
      category: { findMany: jest.fn(async () => []) },
    };
    const service = new McpService(
      prisma as unknown as PrismaService,
      { record: jest.fn() } as unknown as AuditService,
      {} as ClientsService,
      {} as IncomeTransactionsService,
      {} as PurchaseTransactionsService,
      {} as InvoicesService,
    );
    const server = service.buildServer();
    const client = new Client({ name: "test-client", version: "1.0.0" });
    const [ct, st] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(st), client.connect(ct)]);
    const res = (await client.callTool({ name: "portal_financial_summary", arguments: { clientId: CLIENT } })) as { isError?: boolean };
    expect(res.isError).toBeFalsy();
    expect(whereOf(prisma.purchaseTransaction.groupBy)).toMatchObject({ clientId: CLIENT, status: "posted" });
    expect(whereOf(prisma.incomeTransaction.groupBy)).not.toHaveProperty("status");
    await client.close();
  });
});
