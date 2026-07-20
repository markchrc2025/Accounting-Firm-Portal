import { Prisma } from "@prisma/client";
import { IncomeTransactionsService } from "./income-transactions.service";
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
    customer: null,
    description: "Consulting engagement",
    netAmount: new Prisma.Decimal(1000),
    vatClass: "VATABLE_12",
    saleToGovernment: false,
    outputVAT: new Prisma.Decimal(120),
    creditableVATWithheld5pct: null,
    atc: null,
    source: "manual",
    customerTin: null,
    dueDate: null,
    terms: null,
    account: "Service Income",
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
    incomeTransaction: {
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
  const svc = new IncomeTransactionsService(
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
  description: "Consulting engagement",
  netAmount: 1000,
  vatClass: "VATABLE_12",
  outputVAT: 120,
};

describe("IncomeTransactionsService — Account → category resolution", () => {
  it("resolves the per-client category from the chart-account name when no categoryId is sent", async () => {
    const { svc, prisma, categories } = build();
    await svc.create(actor, CLIENT, { ...baseBody, account: "Service Income" });
    expect((categories.resolveByName as jest.Mock).mock.calls[0]).toEqual([
      CLIENT,
      "Service Income",
      "INCOME",
    ]);
    const data = (prisma.incomeTransaction.create as jest.Mock).mock.calls[0]![0].data;
    expect(data.categoryId).toBe("22222222-2222-2222-2222-222222222222");
    expect(data.account).toBe("Service Income");
  });

  it("lets an explicit categoryId win over the account name", async () => {
    const { svc, prisma, categories } = build();
    await svc.create(actor, CLIENT, {
      ...baseBody,
      categoryId: "11111111-1111-1111-1111-111111111111",
      account: "Service Income",
    });
    expect(categories.resolveByName as jest.Mock).not.toHaveBeenCalled();
    const data = (prisma.incomeTransaction.create as jest.Mock).mock.calls[0]![0].data;
    expect(data.categoryId).toBe("11111111-1111-1111-1111-111111111111");
  });

  it("re-resolves the category when an update changes the account", async () => {
    const { svc, prisma, categories } = build();
    await svc.update(actor, CLIENT, "44444444-4444-4444-4444-444444444444", { account: "Rental Income" });
    expect((categories.resolveByName as jest.Mock).mock.calls[0]).toEqual([
      CLIENT,
      "Rental Income",
      "INCOME",
    ]);
    const data = (prisma.incomeTransaction.update as jest.Mock).mock.calls[0]![0].data;
    expect(data.categoryId).toBe("22222222-2222-2222-2222-222222222222");
    expect(data.account).toBe("Rental Income");
  });

  it("keeps the existing category when an update touches neither account nor categoryId", async () => {
    const { svc, prisma, categories } = build();
    await svc.update(actor, CLIENT, "44444444-4444-4444-4444-444444444444", { description: "Renamed" });
    expect(categories.resolveByName as jest.Mock).not.toHaveBeenCalled();
    const data = (prisma.incomeTransaction.update as jest.Mock).mock.calls[0]![0].data;
    expect(data.categoryId).toBe("11111111-1111-1111-1111-111111111111");
  });
});
