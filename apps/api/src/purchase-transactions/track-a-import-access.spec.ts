/**
 * track-a-import-access.spec.ts — U6-A1, hermetic.
 *
 * T1  A client-side principal is refused (403) on the template, the import and
 *     :id/post, at the service AND at the controller (FirmUserGuard declared).
 * T2  The list query schema accepts status / needsReview and rejects any other
 *     value with a 400 that names the parameter; list() and the MCP list tool
 *     hand the filter to Prisma.
 * T3  PATCH cannot change the five server-owned fields — 400 naming the field —
 *     and an allowed edit of a held record never writes status.
 *
 * Written before the amendment existed, so every claim here was seen to fail.
 */
import "reflect-metadata";
import { BadRequestException, ForbiddenException } from "@nestjs/common";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Prisma } from "@prisma/client";
import { FirmUserGuard } from "../common/guards/firm-user.guard";
import { ZodValidationPipe } from "../common/validation/zod-validation.pipe";
import { RegimeValidator } from "../financial/regime-validator";
import { McpService } from "../mcp/mcp.service";
import { PurchaseListQuerySchema, type PurchaseListQuery } from "./dto/purchase-query.schemas";
import { ExpenseImportController } from "./import/expense-import.controller";
import { ExpenseImportService } from "./import/expense-import.service";
import { PurchaseTransactionsService } from "./purchase-transactions.service";
import type { AuditService } from "../audit/audit.service";
import type { AuthUser } from "../common/auth/auth-user";
import type { CategoriesService } from "../categories/categories.service";
import type { ClientsService } from "../clients/clients.service";
import type { IncomeTransactionsService } from "../income-transactions/income-transactions.service";
import type { InvoicesService } from "../invoices/invoices.service";
import type { PrismaService } from "../prisma/prisma.service";
import type { RbacService } from "../rbac/rbac.service";

const FIRM = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CLIENT = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const TXN = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const BATCH = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";

const firmActor: AuthUser = { id: "11111111-1111-4111-8111-111111111111", firmId: FIRM, userType: "FIRM", email: "staff@example.com" };
/** A Client Owner of CLIENT — the role that holds Expenses:Create and Expenses:Update. */
const clientActor: AuthUser = { id: "22222222-2222-4222-8222-222222222222", firmId: FIRM, userType: "CLIENT", email: "owner@example.com", clientId: CLIENT };

const clientRow = { id: CLIENT, firmId: FIRM, businessName: "Invented Co", tin: "000111222", branch: "00000", taxType: "VAT", kind: "non-individual", regName: null };

function heldRow(overrides: Record<string, unknown> = {}) {
  return {
    id: TXN,
    clientId: CLIENT,
    categoryId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    txnDate: new Date("2026-09-02T00:00:00.000Z"),
    referenceNo: null,
    vendor: "Invented Water Delivery",
    description: "Water delivery",
    netAmount: new Prisma.Decimal(500),
    // What the importer writes for a VAT client's no-VAT part (U6, A3); a null
    // category would be rejected by the regime validator on any edit.
    inputVATCategory: "DOMESTIC_NO_INPUT_TAX",
    inputVAT: null,
    isCapitalGood: false,
    capitalGoodAcquisitionCost: null,
    estimatedUsefulLifeMonths: null,
    inputTaxAttribution: null,
    deductible: true,
    source: "import",
    vendorTin: null,
    dueDate: null,
    account: "Test Office Supplies",
    atc: null,
    taxAmount: null,
    whtAmount: null,
    unit: null,
    quantity: null,
    unitPrice: null,
    discount: null,
    status: "held",
    needsReview: true,
    documentType: "DELIVERY_RECEIPT",
    sourceFile: "IMG_0002.jpg",
    remarks: null,
    vendorBranch: null,
    tradeName: null,
    province: null,
    vatClaimable: false,
    importBatchId: BATCH,
    createdAt: new Date("2026-09-02T01:00:00.000Z"),
    updatedAt: new Date("2026-09-02T01:00:00.000Z"),
    ...overrides,
  };
}

/** The import service with every dependency stubbed to ALLOW — so the only
 *  thing that can refuse a client principal is the rule under test. */
function importHarness() {
  const prisma = {
    purchaseTransaction: {
      findFirst: jest.fn(async () => heldRow()),
      update: jest.fn(async ({ data }: { data: Record<string, unknown> }) => heldRow(data)),
      findMany: jest.fn(async () => []),
    },
    chartAccount: { findMany: jest.fn(async () => []) },
  };
  const rbac = { authorize: jest.fn(async () => true) }; // a Client Owner on its own client passes RBAC
  const svc = new ExpenseImportService(
    prisma as unknown as PrismaService,
    { assertInFirm: jest.fn(async () => clientRow) } as unknown as ClientsService,
    {} as CategoriesService,
    new RegimeValidator(),
    { record: jest.fn() } as unknown as AuditService,
    rbac as unknown as RbacService,
  );
  return { svc, prisma, rbac };
}

function purchasesHarness(existing = heldRow()) {
  const prisma = {
    purchaseTransaction: {
      findFirst: jest.fn(async () => existing),
      findMany: jest.fn(async () => []),
      count: jest.fn(async () => 0),
      // toDb() hands Prisma a plain number; the row Prisma returns carries a Decimal.
      update: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({
        ...existing,
        ...data,
        netAmount: new Prisma.Decimal(data.netAmount as number),
      })),
    },
    $transaction: jest.fn(async (ops: unknown[]) => Promise.all(ops as Promise<unknown>[])),
  };
  const svc = new PurchaseTransactionsService(
    prisma as unknown as PrismaService,
    { assertInFirm: jest.fn(async () => clientRow) } as unknown as ClientsService,
    { resolveByName: jest.fn(), resolveForTransaction: jest.fn() } as unknown as CategoriesService,
    new RegimeValidator(),
    { record: jest.fn() } as unknown as AuditService,
  );
  return { svc, prisma };
}

const upload = (buffer: Buffer) => ({ buffer, originalname: "x.xlsx" });

/** The `where` a stubbed Prisma method was called with (jest types an argless mock's calls as []). */
const whereOf = (fn: unknown, call = 0): Record<string, unknown> =>
  ((fn as jest.Mock).mock.calls[call]?.[0] as { where: Record<string, unknown> }).where;

// ---------------------------------------------------------------------------
// T1 — firm-only
// ---------------------------------------------------------------------------

describe("T1: a client-side principal is refused on the import surface (R3)", () => {
  it("postHeld on a held record → 403 saying the action belongs to the firm", async () => {
    const { svc, prisma } = importHarness();
    await expect(svc.postHeld(clientActor, TXN)).rejects.toThrow(ForbiddenException);
    await expect(svc.postHeld(clientActor, TXN)).rejects.toThrow(/belong(s)? to the firm/i);
    expect(prisma.purchaseTransaction.update).not.toHaveBeenCalled();
  });

  it("the template → 403", async () => {
    const { svc } = importHarness();
    await expect(svc.template(clientActor, CLIENT)).rejects.toThrow(ForbiddenException);
  });

  it("the import → 403, before the file is even parsed", async () => {
    const { svc } = importHarness();
    // Not a workbook: if the firm-only rule did not fire first, this would be a 400.
    await expect(svc.importFile(clientActor, CLIENT, upload(Buffer.from("garbage")), true)).rejects.toThrow(ForbiddenException);
  });

  it("the controller declares FirmUserGuard, so the refusal also happens before the handler", () => {
    // Nest stores @UseGuards under the "__guards__" metadata key (GUARDS_METADATA).
    const guards = (Reflect.getMetadata("__guards__", ExpenseImportController) ?? []) as unknown[];
    expect(guards).toContain(FirmUserGuard);
  });

  it("a FIRM principal still posts a held record", async () => {
    const { svc, prisma } = importHarness();
    const dto = await svc.postHeld(firmActor, TXN);
    expect(dto.status).toBe("posted");
    expect(prisma.purchaseTransaction.update).toHaveBeenCalledWith({ where: { id: TXN }, data: { status: "posted" } });
  });
});

// ---------------------------------------------------------------------------
// T2 — list filters: the query schema and the two list callers
// ---------------------------------------------------------------------------

describe("T2: list query validation (R2)", () => {
  const pipe = new ZodValidationPipe(PurchaseListQuerySchema);

  it("accepts status=posted|held and needsReview=true|false", () => {
    expect(pipe.transform({ status: "held" })).toMatchObject({ status: "held" });
    expect(pipe.transform({ status: "posted" })).toMatchObject({ status: "posted" });
    expect(pipe.transform({ needsReview: "true" })).toMatchObject({ needsReview: true });
    expect(pipe.transform({ needsReview: "false" })).toMatchObject({ needsReview: false });
  });

  it("absent → neither filter is present", () => {
    const q = pipe.transform({});
    expect(q).not.toHaveProperty("status");
    expect(q).not.toHaveProperty("needsReview");
  });

  it("status=foo → 400 naming the parameter", () => {
    let err: unknown;
    try { pipe.transform({ status: "foo" }); } catch (e) { err = e; }
    expect(err).toBeInstanceOf(BadRequestException);
    const body = (err as BadRequestException).getResponse() as { errors: { path: string }[] };
    expect(body.errors.map((e) => e.path)).toContain("status");
  });

  it("needsReview=maybe → 400 naming the parameter", () => {
    let err: unknown;
    try { pipe.transform({ needsReview: "maybe" }); } catch (e) { err = e; }
    expect(err).toBeInstanceOf(BadRequestException);
    const body = (err as BadRequestException).getResponse() as { errors: { path: string }[] };
    expect(body.errors.map((e) => e.path)).toContain("needsReview");
  });

  it("list() hands status and needsReview to Prisma", async () => {
    const { svc, prisma } = purchasesHarness();
    const base = { sortBy: "txnDate", sortDir: "desc", page: 1, pageSize: 50 };
    await svc.list(firmActor, CLIENT, { ...base, status: "held", needsReview: true } as unknown as PurchaseListQuery);
    const where = whereOf(prisma.purchaseTransaction.findMany, 0);
    expect(where).toMatchObject({ clientId: CLIENT, status: "held", needsReview: true });
    await svc.list(firmActor, CLIENT, base as unknown as PurchaseListQuery);
    const whereAll = whereOf(prisma.purchaseTransaction.findMany, 1);
    expect(whereAll).not.toHaveProperty("status");
    expect(whereAll).not.toHaveProperty("needsReview");
  });

  it("MCP portal_list_expense_transactions honours the same two filters", async () => {
    const prisma = {
      firm: { findFirst: jest.fn(async () => ({ id: FIRM })) },
      user: { findFirst: jest.fn(async () => ({ id: firmActor.id, email: firmActor.email })) },
      client: { findFirst: jest.fn(async () => ({ id: CLIENT, firmId: FIRM, businessName: "Invented Co" })), findMany: jest.fn(async () => []) },
      incomeTransaction: { count: jest.fn(), findMany: jest.fn(), groupBy: jest.fn() },
      purchaseTransaction: { count: jest.fn(async () => 0), findMany: jest.fn(async () => []), groupBy: jest.fn() },
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
    const res = (await client.callTool({ name: "portal_list_expense_transactions", arguments: { clientId: CLIENT, status: "held", needsReview: true } })) as { isError?: boolean };
    expect(res.isError).toBeFalsy();
    const where = whereOf(prisma.purchaseTransaction.findMany, 0);
    expect(where).toMatchObject({ clientId: CLIENT, status: "held", needsReview: true });
    await client.close();
  });
});

// ---------------------------------------------------------------------------
// T3 — server-owned fields on PATCH
// ---------------------------------------------------------------------------

describe("T3: PATCH cannot change the server-owned fields (R4)", () => {
  it.each([
    ["status", "posted"],
    ["needsReview", false],
    ["vatClaimable", true],
    ["importBatchId", "ffffffff-ffff-4fff-8fff-ffffffffffff"],
    ["sourceFile", "IMG_9999.jpg"],
  ])("a body carrying %s → 400 naming the field, nothing written", async (field, value) => {
    const { svc, prisma } = purchasesHarness();
    let err: unknown;
    try { await svc.update(firmActor, CLIENT, TXN, { [field]: value }); } catch (e) { err = e; }
    expect(err).toBeInstanceOf(BadRequestException);
    const body = (err as BadRequestException).getResponse() as { errors: { path: string; message: string }[] };
    expect(body.errors.map((e) => e.path)).toEqual([field]);
    expect(prisma.purchaseTransaction.update).not.toHaveBeenCalled();
  });

  it("a body carrying two of them names both", async () => {
    const { svc } = purchasesHarness();
    let err: unknown;
    try { await svc.update(firmActor, CLIENT, TXN, { status: "posted", sourceFile: "x", description: "ok" }); } catch (e) { err = e; }
    const body = (err as BadRequestException).getResponse() as { errors: { path: string }[] };
    expect(body.errors.map((e) => e.path).sort()).toEqual(["sourceFile", "status"]);
  });

  it("an allowed edit of a held record leaves it held, with needsReview and importBatchId untouched", async () => {
    const { svc, prisma } = purchasesHarness();
    let dto: Awaited<ReturnType<typeof svc.update>>;
    try {
      dto = await svc.update(firmActor, CLIENT, TXN, { description: "Water delivery (edited)" });
    } catch (e) {
      // Surface the validation body, not just the exception name.
      const body = e instanceof BadRequestException ? JSON.stringify(e.getResponse()) : String(e);
      throw new Error(`update of a held record was rejected: ${body}`);
    }
    const data = (prisma.purchaseTransaction.update.mock.calls[0]?.[0] as { data: Record<string, unknown> }).data;
    expect(data.description).toBe("Water delivery (edited)");
    for (const k of ["status", "needsReview", "vatClaimable", "importBatchId", "sourceFile"]) {
      expect(data).not.toHaveProperty(k);
    }
    expect(dto).toMatchObject({ status: "held", needsReview: true, importBatchId: BATCH, sourceFile: "IMG_0002.jpg" });
  });
});
