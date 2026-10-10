/**
 * track-a-exempt.spec.ts — a client with no tax regime is exempt from business tax
 * and keeps books (U8, D39). Hermetic: the real RegimeValidator, the real frozen
 * @portal/shared schemas and the real services; Prisma and the collaborators mocked.
 *
 *   T2  the validator: null/undefined → EXEMPT; anything else → the new 400; EXEMPT
 *       follows the non-VAT rules for income and purchases; a manual expense and a
 *       manual sale for an EXEMPT client go through the real create paths.
 *   T3  every business-tax site gives an EXEMPT client no VAT and no percentage tax.
 */
import { BadRequestException, ConflictException } from "@nestjs/common";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Prisma } from "@prisma/client";
import type { IncomeTransaction, PurchaseTransaction } from "@portal/shared";
import { RegimeValidator } from "./regime-validator";
import { PurchaseTransactionsService } from "../purchase-transactions/purchase-transactions.service";
import { IncomeTransactionsService } from "../income-transactions/income-transactions.service";
import type { AuditService } from "../audit/audit.service";
import type { CategoriesService } from "../categories/categories.service";
import type { ClientsService } from "../clients/clients.service";
import type { PrismaService } from "../prisma/prisma.service";
import type { AuthUser } from "../common/auth/auth-user";
import { AggregationService } from "../integration/aggregation.service";
import { McpService } from "../mcp/mcp.service";
import type { InvoicesService } from "../invoices/invoices.service";
import { splitRow } from "../purchase-transactions/import/expense-import.rules";
import { regimeLabel } from "../purchase-transactions/import/expense-import.service";

const v = new RegimeValidator();
const NEW_MESSAGE =
  "Unknown tax regime: use VAT, PERCENTAGE, or none for a client exempt from business tax.";
const actor: AuthUser = {
  id: "u1",
  firmId: "f1",
  userType: "FIRM",
  email: "a@example.com",
};
const CLIENT_ID = "11111111-1111-4111-8111-111111111111";
const CATEGORY_ID = "22222222-2222-4222-8222-222222222222";

function income(overrides: Partial<IncomeTransaction> = {}): IncomeTransaction {
  return {
    clientId: CLIENT_ID,
    txnDate: "2026-08-14",
    description: "Sale",
    categoryId: CATEGORY_ID,
    netAmount: 1000,
    vatClass: "NON_VAT",
    saleToGovernment: false,
    source: "manual",
    ...overrides,
  };
}

function purchase(overrides: Partial<PurchaseTransaction> = {}): PurchaseTransaction {
  return {
    clientId: CLIENT_ID,
    txnDate: "2026-08-14",
    description: "Purchase",
    categoryId: CATEGORY_ID,
    netAmount: 1000,
    isCapitalGood: false,
    deductible: true,
    source: "manual",
    ...overrides,
  };
}

/** The message of the first regime error a call raises. */
function regimeError(fn: () => void): string {
  try {
    fn();
  } catch (e) {
    const body = (e as BadRequestException).getResponse() as {
      errors?: Array<{ message: string }>;
    };
    return body.errors?.[0]?.message ?? (e as Error).message;
  }
  return "(no error)";
}

describe("U8 T2 · requireRegime", () => {
  it("null and undefined — the client form's 'None (exempt from business tax)' — resolve to EXEMPT", () => {
    expect(v.requireRegime(null)).toBe("EXEMPT");
    expect(v.requireRegime(undefined)).toBe("EXEMPT");
  });

  it("VAT and PERCENTAGE are unchanged", () => {
    expect(v.requireRegime("VAT")).toBe("VAT");
    expect(v.requireRegime("PERCENTAGE")).toBe("PERCENTAGE");
  });

  it.each(["X", "VATABLE", "vat", "EXEMPT", ""])(
    "%p is refused with the new message (only VAT, PERCENTAGE or null are regimes)",
    (value) => {
      expect(() => v.requireRegime(value)).toThrow(BadRequestException);
      expect(() => v.requireRegime(value)).toThrow(NEW_MESSAGE);
    },
  );
});

describe("U8 T2 · an EXEMPT client follows the non-VAT rules", () => {
  it("income NON_VAT is accepted", () => {
    expect(() => v.validateIncome("EXEMPT", income())).not.toThrow();
  });

  it("income VATABLE_12 is rejected, worded for a non-VAT client", () => {
    expect(
      regimeError(() => v.validateIncome("EXEMPT", income({ vatClass: "VATABLE_12" }))),
    ).toBe("A non-VAT client's income must be classified NON_VAT.");
  });

  it("no output VAT and no 5% government withholding on an EXEMPT sale", () => {
    expect(
      regimeError(() => v.validateIncome("EXEMPT", income({ outputVAT: 120 }))),
    ).toBe("A NON_VAT sale has no output VAT.");
    expect(
      regimeError(() =>
        v.validateIncome("EXEMPT", income({ creditableVATWithheld5pct: 50 })),
      ),
    ).toBe("A non-VAT client has no creditable VAT withheld.");
    expect(
      regimeError(() =>
        v.validateIncome(
          "EXEMPT",
          income({ saleToGovernment: true, creditableVATWithheld5pct: 0 }),
        ),
      ),
    ).toBe(
      "The 5% creditable VAT withholding is VAT-only; it does not apply to a non-VAT client.",
    );
  });

  it("a purchase with an input-VAT category is rejected", () => {
    expect(
      regimeError(() =>
        v.validatePurchase(
          "EXEMPT",
          purchase({ inputVATCategory: "DOMESTIC_PURCHASES" }),
        ),
      ),
    ).toBe("A non-VAT client claims no input VAT; leave the category unset.");
  });

  it("a purchase with creditable input VAT is rejected", () => {
    expect(
      regimeError(() => v.validatePurchase("EXEMPT", purchase({ inputVAT: 120 }))),
    ).toBe("A non-VAT client has no creditable input VAT.");
  });

  it("a purchase with an input-tax attribution is rejected", () => {
    expect(
      regimeError(() =>
        v.validatePurchase("EXEMPT", purchase({ inputTaxAttribution: "VATABLE" })),
      ),
    ).toBe("Input-tax attribution only applies to VAT-registered clients.");
  });

  it("a plain purchase (no category, no input VAT) is accepted", () => {
    expect(() => v.validatePurchase("EXEMPT", purchase())).not.toThrow();
  });

  it("PERCENTAGE gets exactly the same answers (one rule set for both non-VAT regimes)", () => {
    const incomes: Array<Partial<IncomeTransaction>> = [
      {},
      { vatClass: "VATABLE_12" },
      { saleToGovernment: true, creditableVATWithheld5pct: 0 },
      { creditableVATWithheld5pct: 50 },
      { outputVAT: 120 },
    ];
    const purchases: Array<Partial<PurchaseTransaction>> = [
      {},
      { inputVATCategory: "DOMESTIC_PURCHASES" },
      { inputVAT: 120 },
      { inputTaxAttribution: "VATABLE" },
    ];
    for (const o of incomes) {
      const exempt = regimeError(() => v.validateIncome("EXEMPT", income(o)));
      expect(regimeError(() => v.validateIncome("PERCENTAGE", income(o)))).toBe(exempt);
      // Every input but the plain one is refused, so the comparison is not vacuous.
      if (Object.keys(o).length > 0) expect(exempt).not.toBe("(no error)");
    }
    for (const o of purchases) {
      const exempt = regimeError(() => v.validatePurchase("EXEMPT", purchase(o)));
      expect(regimeError(() => v.validatePurchase("PERCENTAGE", purchase(o)))).toBe(
        exempt,
      );
      if (Object.keys(o).length > 0) expect(exempt).not.toBe("(no error)");
    }
  });
});

/** Prisma-shaped row from the data the service writes (Decimals where Prisma has them). */
function rowFrom(data: Record<string, unknown>) {
  const dec = (x: unknown) =>
    x === undefined || x === null ? null : new Prisma.Decimal(x as number);
  return {
    id: "row-1",
    createdAt: new Date(),
    updatedAt: new Date(),
    referenceNo: null,
    vendor: null,
    customer: null,
    vendorTin: null,
    dueDate: null,
    account: null,
    atc: null,
    unit: null,
    documentType: null,
    sourceFile: null,
    remarks: null,
    vendorBranch: null,
    tradeName: null,
    province: null,
    importBatchId: null,
    inputVATCategory: null,
    inputTaxAttribution: null,
    estimatedUsefulLifeMonths: null,
    status: "posted",
    needsReview: false,
    vatClaimable: false,
    ...data,
    txnDate: data.txnDate instanceof Date ? data.txnDate : new Date(String(data.txnDate)),
    netAmount: dec(data.netAmount),
    inputVAT: dec(data.inputVAT),
    outputVAT: dec(data.outputVAT),
    creditableVATWithheld5pct: dec(data.creditableVATWithheld5pct),
    capitalGoodAcquisitionCost: dec(data.capitalGoodAcquisitionCost),
    taxAmount: dec(data.taxAmount),
    whtAmount: dec(data.whtAmount),
    quantity: dec(data.quantity),
    unitPrice: dec(data.unitPrice),
    discount: dec(data.discount),
  };
}

function services() {
  const purchaseTransaction = {
    create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => rowFrom(data)),
  };
  const incomeTransaction = {
    create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => rowFrom(data)),
  };
  const prisma = { purchaseTransaction, incomeTransaction } as unknown as PrismaService;
  const clients = {
    assertInFirm: jest.fn().mockResolvedValue({
      id: CLIENT_ID,
      firmId: "f1",
      businessName: "Invented Exempt Trader",
      taxType: null,
    }),
  } as unknown as ClientsService;
  const categories = {
    resolveByName: jest.fn().mockResolvedValue({ id: CATEGORY_ID, isDeductible: true }),
    resolveForTransaction: jest
      .fn()
      .mockResolvedValue({ id: CATEGORY_ID, isDeductible: true }),
  } as unknown as CategoriesService;
  const audit = {
    record: jest.fn().mockResolvedValue(undefined),
  } as unknown as AuditService;
  return {
    purchases: new PurchaseTransactionsService(
      prisma,
      clients,
      categories,
      new RegimeValidator(),
      audit,
    ),
    incomes: new IncomeTransactionsService(
      prisma,
      clients,
      categories,
      new RegimeValidator(),
      audit,
    ),
    purchaseTransaction,
    incomeTransaction,
  };
}

describe("U8 T2 · the real create paths for an EXEMPT client", () => {
  it("a manual expense record is accepted and written with no input-VAT category and no input VAT", async () => {
    const { purchases, purchaseTransaction } = services();
    const dto = await purchases.create(actor, CLIENT_ID, {
      txnDate: "2026-08-14",
      description: "Office supplies",
      categoryId: CATEGORY_ID,
      netAmount: 1500,
      isCapitalGood: false,
    });
    expect(purchaseTransaction.create).toHaveBeenCalledTimes(1);
    const data = purchaseTransaction.create.mock.calls[0]![0].data;
    expect(data.inputVATCategory ?? null).toBeNull();
    expect(data.inputVAT ?? null).toBeNull();
    expect(dto.netAmount).toBe(1500);
  });

  it("a manual sale classified NON_VAT is accepted; VATABLE_12 is refused", async () => {
    const { incomes, incomeTransaction } = services();
    await incomes.create(actor, CLIENT_ID, {
      txnDate: "2026-08-14",
      description: "Consulting",
      categoryId: CATEGORY_ID,
      netAmount: 20000,
      vatClass: "NON_VAT",
      saleToGovernment: false,
    });
    expect(incomeTransaction.create).toHaveBeenCalledTimes(1);
    await expect(
      incomes.create(actor, CLIENT_ID, {
        txnDate: "2026-08-14",
        description: "Consulting",
        categoryId: CATEGORY_ID,
        netAmount: 20000,
        vatClass: "VATABLE_12",
        outputVAT: 2400,
        saleToGovernment: false,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(incomeTransaction.create).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// T3 — every business-tax site: an EXEMPT client owes no VAT and no percentage tax
// ---------------------------------------------------------------------------

describe("U8 T3 · the expenses importer (pure rules and the CLIENT sheet label)", () => {
  it("splitRow(EXEMPT): the gross is the expense, the VAT a non-claimable figure, no input-VAT category on any part", () => {
    const parts = splitRow(
      { vatable: 2952.01, vat: 354.24, exempt: 887.96, zeroRated: 0, other: 0 },
      "EXEMPT",
    );
    expect(parts).toEqual([
      {
        classification: "VATABLE",
        netAmount: 3306.25,
        taxAmount: 354.24,
        vatClaimable: false,
        gross: 3306.25,
      },
      {
        classification: "VAT_EXEMPT",
        netAmount: 887.96,
        vatClaimable: false,
        gross: 887.96,
      },
    ]);
    expect(parts).toEqual(
      splitRow(
        { vatable: 2952.01, vat: 354.24, exempt: 887.96, zeroRated: 0, other: 0 },
        "PERCENTAGE",
      ),
    );
  });

  it("regimeLabel(null) is the exempt line; VAT and PERCENTAGE are unchanged", () => {
    expect(regimeLabel(null)).toBe(
      "Exempt from business tax (no VAT, no percentage tax)",
    );
    expect(regimeLabel(undefined)).toBe(
      "Exempt from business tax (no VAT, no percentage tax)",
    );
    expect(regimeLabel("VAT")).toBe("VAT-registered");
    expect(regimeLabel("PERCENTAGE")).toBe("Non-VAT (percentage tax)");
    // An unknown stored value is named as such, never shown as exempt.
    expect(regimeLabel("X")).toBe(
      'Unknown tax regime "X" — fix the client record before importing',
    );
    expect(regimeLabel("")).toBe(
      'Unknown tax regime "" — fix the client record before importing',
    );
  });
});

describe("U8 T3 · the legacy Sales and Expenses template imports (importRows)", () => {
  it("purchases.importRows: a VAT-inclusive amount is not split — no input VAT is backed out or claimed", async () => {
    const { purchases, purchaseTransaction } = services();
    const res = await purchases.importRows(actor, CLIENT_ID, [
      {
        Date: "2026-08-14",
        Description: "Supplies",
        Category: "Supplies",
        Amount: 1120,
        TaxCode: "VT010",
        TaxType: "VAT",
      },
    ]);
    expect(res).toMatchObject({ created: 1 });
    const data = purchaseTransaction.create.mock.calls[0]![0].data;
    expect(Number(data.netAmount)).toBe(1120);
    expect(data.inputVAT ?? null).toBeNull();
    expect(data.inputVATCategory ?? null).toBeNull();
  });

  it("incomes.importRows: a VAT-inclusive amount is booked whole as a NON_VAT sale with no output VAT", async () => {
    const { incomes, incomeTransaction } = services();
    const res = await incomes.importRows(actor, CLIENT_ID, [
      {
        Date: "2026-08-14",
        Description: "Sale",
        Category: "Sales",
        Amount: 1120,
        TaxCode: "VT010",
        TaxType: "VAT",
      },
    ]);
    expect(res).toMatchObject({ created: 1 });
    const data = incomeTransaction.create.mock.calls[0]![0].data;
    expect(data.vatClass).toBe("NON_VAT");
    expect(Number(data.netAmount)).toBe(1120);
    expect(data.outputVAT ?? null).toBeNull();
  });
});

describe("U8 T3 · the integration summaries refuse an EXEMPT client (it files neither return)", () => {
  function aggregation(taxType: string | null) {
    const prisma = {
      client: {
        findFirst: jest.fn().mockResolvedValue({
          id: CLIENT_ID,
          firmId: "f1",
          businessName: "Invented Exempt Trader",
          tin: "000987654",
          taxType,
        }),
      },
      incomeTransaction: {
        findMany: jest.fn().mockResolvedValue([
          {
            netAmount: new Prisma.Decimal(20000),
            vatClass: "NON_VAT",
            atc: null,
            saleToGovernment: false,
            creditableVATWithheld5pct: null,
          },
        ]),
      },
      purchaseTransaction: { findMany: jest.fn().mockResolvedValue([]) },
    };
    return { svc: new AggregationService(prisma as unknown as PrismaService), prisma };
  }

  it("vat-summary: 409 naming the 2550Q, and no transaction is read", async () => {
    const { svc, prisma } = aggregation(null);
    const err = await svc.vatSummary("f1", CLIENT_ID, 2026, 3).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ConflictException);
    expect((err as Error).message).toBe(
      "Invented Exempt Trader has no tax regime: it is exempt from business tax and files no 2550Q, so there is no VAT summary.",
    );
    expect(prisma.incomeTransaction.findMany).not.toHaveBeenCalled();
  });

  it("percentage-tax-summary: 409 naming the 2551Q — no gross-receipts base is handed out — while a PERCENTAGE client still gets its base", async () => {
    const exempt = aggregation(null);
    const err = await exempt.svc
      .percentageTaxSummary("f1", CLIENT_ID, 2026, 3)
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ConflictException);
    expect((err as Error).message).toMatch(
      /files no 2551Q, so there is no percentage-tax summary/,
    );
    expect(exempt.prisma.incomeTransaction.findMany).not.toHaveBeenCalled();
    const pct = aggregation("PERCENTAGE");
    await expect(
      pct.svc.percentageTaxSummary("f1", CLIENT_ID, 2026, 3),
    ).resolves.toMatchObject({ grossReceipts: 20000 });
  });
});

describe("U8 T3 · the MCP record tools for a client with no regime", () => {
  function mcp() {
    const client = {
      id: CLIENT_ID,
      firmId: "f1",
      businessName: "Invented Exempt Trader",
      tin: "000987654",
      taxType: null,
      status: "ACTIVE",
    };
    const prisma = {
      firm: { findFirst: jest.fn(async () => ({ id: "f1", createdAt: new Date() })) },
      user: {
        findFirst: jest.fn(async () => ({ id: "u-mcp", email: "admin@example.com" })),
        // U4 (D41): MCP writes run as the firm's one active Super Admin.
        findMany: jest.fn(async () => [{ id: "u-mcp", email: "admin@example.com" }]),
      },
      client: {
        findFirst: jest.fn(async () => client),
        findMany: jest.fn(async () => [client]),
      },
    };
    // The REAL income and purchase services (regime check, frozen schema, validator)
    // sit behind the tools, so a refusal of the null regime would surface as isError.
    const real = services();
    const svcs = {
      audit: { record: jest.fn().mockResolvedValue(undefined) },
      clients: {},
      invoices: {},
    };
    const service = new McpService(
      prisma as unknown as PrismaService,
      svcs.audit as unknown as AuditService,
      svcs.clients as unknown as ClientsService,
      real.incomes,
      real.purchases,
      svcs.invoices as unknown as InvoicesService,
    );
    return { service, real };
  }
  async function connect(service: McpService) {
    const server = service.buildServer();
    const c = new Client({ name: "u8-test", version: "1.0.0" });
    const [ct, st] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(st), c.connect(ct)]);
    return c;
  }

  it("portal_record_income: NON_VAT with no output VAT", async () => {
    const { service, real } = mcp();
    const c = await connect(service);
    const res = await c.callTool({
      name: "portal_record_income",
      arguments: {
        clientId: CLIENT_ID,
        txnDate: "2026-08-14",
        amount: 1000,
        category: "Sales",
      },
    });
    expect(res.isError).toBeUndefined();
    expect(real.incomeTransaction.create).toHaveBeenCalledTimes(1);
    const data = real.incomeTransaction.create.mock.calls[0]![0].data;
    expect(data.vatClass).toBe("NON_VAT");
    expect(data.outputVAT ?? null).toBeNull();
    expect(data.creditableVATWithheld5pct ?? null).toBeNull();
  });

  it("portal_record_expense: no input-VAT category and no input VAT; a vatAmount is refused", async () => {
    const { service, real } = mcp();
    const c = await connect(service);
    const ok = await c.callTool({
      name: "portal_record_expense",
      arguments: {
        clientId: CLIENT_ID,
        txnDate: "2026-08-14",
        amount: 500,
        category: "Supplies",
      },
    });
    expect(ok.isError).toBeUndefined();
    expect(real.purchaseTransaction.create).toHaveBeenCalledTimes(1);
    const data = real.purchaseTransaction.create.mock.calls[0]![0].data;
    expect(data.inputVATCategory ?? null).toBeNull();
    expect(data.inputVAT ?? null).toBeNull();
    const refused = await c.callTool({
      name: "portal_record_expense",
      arguments: {
        clientId: CLIENT_ID,
        txnDate: "2026-08-14",
        amount: 500,
        category: "Supplies",
        vatAmount: 60,
      },
    });
    expect(refused.isError).toBe(true);
    expect(real.purchaseTransaction.create).toHaveBeenCalledTimes(1);
  });
});
