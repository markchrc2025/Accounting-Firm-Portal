/**
 * track-a-import-filters.db-spec.ts — U6-A1 against a real PostgreSQL.
 *
 * T2  With two posted, one held and one held-needs-review record: status=held
 *     returns the two held, status=posted the two posted, needsReview=true the
 *     one, no parameter all four; status=foo is a 400 naming the parameter.
 * T4  An allowed edit of a held record, read back through a second fresh
 *     PrismaClient: status still held, needsReview and importBatchId unchanged,
 *     the edited field changed.
 *
 * Fixtures are invented (R8) and deleted in afterAll.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { BadRequestException, INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { PrismaClient } from "@prisma/client";
import { AppModule } from "../../src/app.module";
import { PrismaService } from "../../src/prisma/prisma.service";
import { ZodValidationPipe } from "../../src/common/validation/zod-validation.pipe";
import { PurchaseListQuerySchema, type PurchaseListQuery } from "../../src/purchase-transactions/dto/purchase-query.schemas";
import { PurchaseTransactionsService } from "../../src/purchase-transactions/purchase-transactions.service";
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

const TAG = `track-a-filters-${randomUUID().slice(0, 8)}`;
const BATCH = randomUUID();
const LIST: PurchaseListQuery = { sortBy: "txnDate", sortDir: "desc", page: 1, pageSize: 200 };

describe("expense list filters and server-owned fields (db)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let reader: PrismaClient;
  let purchases: PurchaseTransactionsService;
  let firmId = "";
  let clientId = "";
  let actor: AuthUser;
  const ids: Record<"posted1" | "posted2" | "held" | "heldReview", string> = { posted1: "", posted2: "", held: "", heldReview: "" };

  beforeAll(async () => {
    if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set. Run `bash scripts/local-db.sh` first.");
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    purchases = app.get(PurchaseTransactionsService);
    reader = new PrismaClient();

    const firm = await prisma.firm.create({ data: { name: `${TAG} firm` } });
    firmId = firm.id;
    const superAdmin = await prisma.role.findUnique({ where: { name_scope: { name: "Super Admin", scope: "FIRM" } } });
    if (!superAdmin) throw new Error("Super Admin role missing — run db:seed first.");
    const user = await prisma.user.create({
      data: {
        firmId, userType: "FIRM", fullName: `${TAG} accountant`, email: `${TAG}@example.com`, status: "ACTIVE",
        firmProfile: { create: { title: "Test" } },
        userRoles: { create: { roleId: superAdmin.id } },
      },
    });
    actor = { id: user.id, firmId, userType: "FIRM", email: user.email };
    const client = await prisma.client.create({ data: { firmId, businessName: `${TAG} Co`, tin: "000111222", taxType: "VAT" } });
    clientId = client.id;
    const category = await prisma.category.create({ data: { clientId, type: "EXPENSE", name: `${TAG} supplies` } });

    const base = {
      clientId, categoryId: category.id, description: "fixture", source: "import", account: `${TAG} supplies`,
      inputVATCategory: "DOMESTIC_NO_INPUT_TAX", vatClaimable: false, importBatchId: BATCH,
    };
    ids.posted1 = (await prisma.purchaseTransaction.create({ data: { ...base, txnDate: new Date("2026-07-01T00:00:00.000Z"), netAmount: 100, status: "posted" } })).id;
    ids.posted2 = (await prisma.purchaseTransaction.create({ data: { ...base, txnDate: new Date("2026-07-02T00:00:00.000Z"), netAmount: 200, status: "posted" } })).id;
    ids.held = (await prisma.purchaseTransaction.create({ data: { ...base, txnDate: new Date("2026-07-03T00:00:00.000Z"), netAmount: 300, status: "held", documentType: "DELIVERY_RECEIPT" } })).id;
    ids.heldReview = (await prisma.purchaseTransaction.create({ data: { ...base, txnDate: new Date("2026-07-04T00:00:00.000Z"), netAmount: 400, status: "held", needsReview: true, sourceFile: "IMG_0004.jpg" } })).id;
  });

  afterAll(async () => {
    await prisma.auditLog.deleteMany({ where: { userId: actor.id } });
    await prisma.client.deleteMany({ where: { firmId } });
    await prisma.user.deleteMany({ where: { firmId } });
    await prisma.firm.deleteMany({ where: { id: firmId } });
    await reader.$disconnect();
    await app.close();
  });

  const idsOf = async (q: Partial<PurchaseListQuery>) =>
    (await purchases.list(actor, clientId, { ...LIST, ...q } as PurchaseListQuery)).data.map((d) => d.id).sort();

  it("T2: status=held returns the two held records", async () => {
    expect(await idsOf({ status: "held" })).toEqual([ids.held, ids.heldReview].sort());
    const back = await reader.purchaseTransaction.findMany({ where: { id: { in: [ids.held, ids.heldReview] } } });
    expect(back.every((r) => r.status === "held")).toBe(true);
  });

  it("T2: status=posted returns the two posted records", async () => {
    expect(await idsOf({ status: "posted" })).toEqual([ids.posted1, ids.posted2].sort());
  });

  it("T2: needsReview=true returns the one flagged record", async () => {
    expect(await idsOf({ needsReview: true })).toEqual([ids.heldReview]);
    expect(await idsOf({ needsReview: false })).toEqual([ids.posted1, ids.posted2, ids.held].sort());
  });

  it("T2: no parameter returns all four, each with its status", async () => {
    const all = await purchases.list(actor, clientId, LIST);
    expect(all.data.map((d) => d.id).sort()).toEqual(Object.values(ids).sort());
    const byId = Object.fromEntries(all.data.map((d) => [d.id, d.status]));
    expect(byId[ids.held]).toBe("held");
    expect(byId[ids.posted1]).toBe("posted");
  });

  it("T2: status=foo → 400 naming the parameter", () => {
    const pipe = new ZodValidationPipe(PurchaseListQuerySchema);
    let err: unknown;
    try { pipe.transform({ status: "foo" }); } catch (e) { err = e; }
    expect(err).toBeInstanceOf(BadRequestException);
    expect(((err as BadRequestException).getResponse() as { errors: { path: string }[] }).errors.map((e) => e.path)).toContain("status");
  });

  it("T4: an allowed edit of a held record leaves status, needsReview and importBatchId as they were", async () => {
    const before = await reader.purchaseTransaction.findUniqueOrThrow({ where: { id: ids.heldReview } });
    await purchases.update(actor, clientId, ids.heldReview, { description: "fixture (edited)" });
    const after = await reader.purchaseTransaction.findUniqueOrThrow({ where: { id: ids.heldReview } });
    expect(after.description).toBe("fixture (edited)");
    expect(after.status).toBe("held");
    expect(after.needsReview).toBe(before.needsReview);
    expect(after.importBatchId).toBe(before.importBatchId);
    expect(after.sourceFile).toBe(before.sourceFile);
    expect(after.vatClaimable).toBe(before.vatClaimable);
  });

  it("T4: an edit that carries status is refused and writes nothing", async () => {
    const before = await reader.purchaseTransaction.findUniqueOrThrow({ where: { id: ids.held } });
    await expect(purchases.update(actor, clientId, ids.held, { status: "posted", description: "should not land" })).rejects.toThrow(BadRequestException);
    const after = await reader.purchaseTransaction.findUniqueOrThrow({ where: { id: ids.held } });
    expect(after).toEqual(before);
  });
});
