import { Prisma } from "@prisma/client";
import { PurchaseTransactionsService } from "./purchase-transactions.service";
import { RegimeValidator } from "../financial/regime-validator";
import type { AuditService } from "../audit/audit.service";
import type { CategoriesService } from "../categories/categories.service";
import type { ClientsService } from "../clients/clients.service";
import type { PrismaService } from "../prisma/prisma.service";
import type { AuthUser } from "../common/auth/auth-user";

const CLIENT = "33333333-3333-3333-3333-333333333333";

const actor: AuthUser = { id: "u1", firmId: "f1", userType: "FIRM", email: "a@f.test" };

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: "44444444-4444-4444-4444-444444444444",
    clientId: CLIENT,
    categoryId: "11111111-1111-1111-1111-111111111111",
    txnDate: new Date("2026-01-15T00:00:00.000Z"),
    referenceNo: null,
    vendor: null,
    description: "Office supplies run",
    netAmount: new Prisma.Decimal(500),
    inputVATCategory: "DOMESTIC_PURCHASES",
    inputVAT: new Prisma.Decimal(60),
    isCapitalGood: false,
    capitalGoodAcquisitionCost: null,
    estimatedUsefulLifeMonths: null,
    inputTaxAttribution: null,
    deductible: true,
    source: "manual",
    vendorTin: null,
    dueDate: null,
    account: "Office Supplies",
    atc: null,
    taxAmount: null,
    unit: null,
    quantity: null,
    unitPrice: null,
    discount: null,
    createdAt: new Date("2026-01-15T01:00:00.000Z"),
    updatedAt: new Date("2026-01-15T01:00:00.000Z"),
    ...overrides,
  };
}

function build() {
  const prisma = {
    purchaseTransaction: {
      create: jest.fn().mockResolvedValue(row()),
      update: jest.fn().mockResolvedValue(row()),
      findFirst: jest.fn().mockResolvedValue(row()),
    },
  } as unknown as PrismaService;
  const clients = {
    assertInFirm: jest.fn().mockResolvedValue({ id: CLIENT, firmId: "f1", taxType: "VAT" }),
  } as unknown as ClientsService;
  const categories = {
    resolveByName: jest
      .fn()
      .mockResolvedValue({ id: "22222222-2222-2222-2222-222222222222", isDeductible: true }),
    resolveForTransaction: jest
      .fn()
      .mockResolvedValue({ id: "11111111-1111-1111-1111-111111111111", isDeductible: true }),
  } as unknown as CategoriesService;
  const audit = { record: jest.fn().mockResolvedValue(undefined) } as unknown as AuditService;
  const svc = new PurchaseTransactionsService(
    prisma,
    clients,
    categories,
    new RegimeValidator(),
    audit,
  );
  return { svc, prisma, categories };
}

const baseBody = {
  txnDate: "2026-01-15",
  description: "Office supplies run",
  netAmount: 500,
  inputVATCategory: "DOMESTIC_PURCHASES",
  inputVAT: 60,
};

describe("PurchaseTransactionsService — Account → category resolution", () => {
  it("resolves the per-client EXPENSE category from the chart-account name", async () => {
    const { svc, prisma, categories } = build();
    await svc.create(actor, CLIENT, { ...baseBody, account: "Office Supplies" });
    expect((categories.resolveByName as jest.Mock).mock.calls[0]).toEqual([
      CLIENT,
      "Office Supplies",
      "EXPENSE",
    ]);
    const data = (prisma.purchaseTransaction.create as jest.Mock).mock.calls[0]![0].data;
    expect(data.categoryId).toBe("22222222-2222-2222-2222-222222222222");
    expect(data.account).toBe("Office Supplies");
  });

  it("lets an explicit categoryId win over the account name", async () => {
    const { svc, prisma, categories } = build();
    await svc.create(actor, CLIENT, {
      ...baseBody,
      categoryId: "11111111-1111-1111-1111-111111111111",
      account: "Office Supplies",
    });
    expect(categories.resolveByName as jest.Mock).not.toHaveBeenCalled();
    const data = (prisma.purchaseTransaction.create as jest.Mock).mock.calls[0]![0].data;
    expect(data.categoryId).toBe("11111111-1111-1111-1111-111111111111");
  });

  it("re-resolves the category when an update changes the account", async () => {
    const { svc, prisma, categories } = build();
    await svc.update(actor, CLIENT, "44444444-4444-4444-4444-444444444444", { account: "Rent Expense" });
    expect((categories.resolveByName as jest.Mock).mock.calls[0]).toEqual([
      CLIENT,
      "Rent Expense",
      "EXPENSE",
    ]);
    const data = (prisma.purchaseTransaction.update as jest.Mock).mock.calls[0]![0].data;
    expect(data.categoryId).toBe("22222222-2222-2222-2222-222222222222");
  });
});
