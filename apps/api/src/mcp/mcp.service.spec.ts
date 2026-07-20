// Protocol-level test of the MCP server: a real MCP client talks to the real
// McpServer over an in-memory transport; Prisma and the domain services are
// stubbed. This covers the same path Claude uses (initialize → tools/list →
// tools/call) without HTTP.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Prisma } from "@prisma/client";
import { McpService } from "./mcp.service";
import type { AuditService } from "../audit/audit.service";
import type { ClientsService } from "../clients/clients.service";
import type { IncomeTransactionsService } from "../income-transactions/income-transactions.service";
import type { InvoicesService } from "../invoices/invoices.service";
import type { PrismaService } from "../prisma/prisma.service";
import type { PurchaseTransactionsService } from "../purchase-transactions/purchase-transactions.service";

const FIRM = { id: "11111111-1111-4111-8111-111111111111", createdAt: new Date() };
const CLIENT_ID = "22222222-2222-4222-8222-222222222222";
const SUB_ID = "44444444-4444-4444-8444-444444444444";
const TXN_ID = "55555555-5555-4555-8555-555555555555";
const INVOICE_ID = "66666666-6666-4666-8666-666666666666";
const ACTOR = { id: "77777777-7777-4777-8777-777777777777", email: "admin@f.test" };

const ALL_TOOLS = [
  "portal_create_client",
  "portal_create_invoice",
  "portal_delete_transaction",
  "portal_financial_summary",
  "portal_get_client",
  "portal_list_clients",
  "portal_list_expense_transactions",
  "portal_list_income_transactions",
  "portal_list_invoices",
  "portal_list_transaction_categories",
  "portal_record_expense",
  "portal_record_income",
  "portal_set_client_status",
  "portal_update_client",
  "portal_update_invoice",
  "portal_update_invoice_status",
];
const READ_TOOLS = new Set([
  "portal_financial_summary",
  "portal_get_client",
  "portal_list_clients",
  "portal_list_expense_transactions",
  "portal_list_income_transactions",
  "portal_list_invoices",
  "portal_list_transaction_categories",
]);

/** The firm-scoped client row the write tools look up. */
function clientRow(overrides: Record<string, unknown> = {}) {
  return {
    id: CLIENT_ID,
    firmId: FIRM.id,
    businessName: "HEBREWS 13-8 MILKTEA SHOP",
    tin: "234968660",
    taxType: "PERCENTAGE",
    status: "ACTIVE",
    city: "Marikina",
    province: "Metro Manila",
    billingParentId: null,
    billingMethod: "AS_FILING",
    professionalFee: null,
    ...overrides,
  };
}

interface StubOverrides {
  client?: Record<string, unknown>;
  clientRows?: Record<string, unknown>[];
  subClients?: Record<string, unknown>[];
  incomeTxnRow?: Record<string, unknown> | null;
}

/** Minimal Prisma stub — only what the registered tools touch. */
function prismaStub(o: StubOverrides = {}) {
  const row = clientRow(o.client);
  return {
    firm: { findFirst: jest.fn(async () => FIRM) },
    user: { findFirst: jest.fn(async () => ACTOR) },
    client: {
      findMany: jest.fn(
        async ({ where }: { where: Record<string, unknown> }) => {
          if (where.billingParentId) return o.subClients ?? [];
          return o.clientRows ?? [row];
        },
      ),
      findFirst: jest.fn(async ({ where }: { where: { id: string } }) => {
        if (where.id === row.id) return row;
        if (where.id === SUB_ID) {
          return clientRow({
            id: SUB_ID,
            businessName: "SUB BRANCH CO",
            billingParentId: CLIENT_ID,
          });
        }
        return null;
      }),
    },
    invoice: {
      count: jest.fn(async () => 1),
      findMany: jest.fn(async () => [
        {
          id: "inv-1",
          number: "INV-2026-001",
          clientId: CLIENT_ID,
          client: { businessName: "HEBREWS 13-8 MILKTEA SHOP" },
          billedFor: null,
          description: "Q2 2026 engagement fees",
          issuedDate: new Date("2026-07-01T00:00:00.000Z"),
          dueDate: new Date("2026-07-31T00:00:00.000Z"),
          status: "Sent",
          subtotal: new Prisma.Decimal(1000),
          vat: new Prisma.Decimal(120),
          total: new Prisma.Decimal(1120),
          lineItems: [
            {
              description: "Bookkeeping",
              qty: new Prisma.Decimal(1),
              rate: new Prisma.Decimal(1000),
              amount: new Prisma.Decimal(1000),
            },
          ],
        },
      ]),
    },
    incomeTransaction: {
      count: jest.fn(),
      findMany: jest.fn(),
      groupBy: jest.fn(),
      findFirst: jest.fn(async () =>
        o.incomeTxnRow !== undefined
          ? o.incomeTxnRow
          : {
              id: TXN_ID,
              clientId: CLIENT_ID,
              description: "Duplicate entry",
              netAmount: new Prisma.Decimal(500),
            },
      ),
    },
    purchaseTransaction: {
      count: jest.fn(),
      findMany: jest.fn(),
      groupBy: jest.fn(),
      findFirst: jest.fn(async () => null),
    },
    category: { findMany: jest.fn(async () => []) },
    chartAccount: { findMany: jest.fn(async () => []) },
  };
}

const INCOME_DTO = {
  id: TXN_ID,
  clientId: CLIENT_ID,
  txnDate: "2026-07-15",
  netAmount: 1000,
  vatClass: "VATABLE_12",
  description: "Consulting",
};

const INVOICE_DTO = {
  id: INVOICE_ID,
  number: "BILL-2026-0001",
  clientId: CLIENT_ID,
  clientName: "HEBREWS 13-8 MILKTEA SHOP",
  billedForClientId: null as string | null,
  billedForName: null as string | null,
  description: "",
  issuedDate: "2026-07-01",
  dueDate: "2026-07-31",
  status: "Draft",
  subtotal: "1000",
  vat: "120",
  total: "1120",
  lineItems: [{ id: "li-1", description: "Bookkeeping", qty: "1", rate: "1000", amount: "1000" }],
  createdAt: "2026-07-01T00:00:00.000Z",
  updatedAt: "2026-07-01T00:00:00.000Z",
};

/** Domain-service stubs — the write tools call these, never raw inserts. */
function servicesStub() {
  return {
    audit: { record: jest.fn().mockResolvedValue(undefined) },
    clients: {
      create: jest.fn(async (_a: unknown, input: Record<string, unknown>) =>
        clientRow({ id: SUB_ID, ...input }),
      ),
      update: jest.fn(async (_a: unknown, id: string, input: Record<string, unknown>) =>
        clientRow({ id, ...input }),
      ),
    },
    income: {
      create: jest.fn(async (_a: unknown, _clientId: string, _body: Record<string, unknown>) => INCOME_DTO),
      remove: jest.fn(async () => ({ deleted: true })),
    },
    purchases: {
      create: jest.fn(async (_a: unknown, _clientId: string, _body: Record<string, unknown>) => ({
        ...INCOME_DTO,
        inputVAT: undefined,
      })),
      remove: jest.fn(async () => ({ deleted: true })),
    },
    invoices: {
      get: jest.fn(async () => ({ ...INVOICE_DTO })),
      create: jest.fn(async (_a: unknown, _input: Record<string, unknown>) => ({ ...INVOICE_DTO })),
      update: jest.fn(async (_a: unknown, _id: string, input: { status?: string }) => ({
        ...INVOICE_DTO,
        ...(input.status ? { status: input.status } : {}),
      })),
    },
  };
}

async function connect(
  prisma: ReturnType<typeof prismaStub>,
  services = servicesStub(),
) {
  const service = new McpService(
    prisma as unknown as PrismaService,
    services.audit as unknown as AuditService,
    services.clients as unknown as ClientsService,
    services.income as unknown as IncomeTransactionsService,
    services.purchases as unknown as PurchaseTransactionsService,
    services.invoices as unknown as InvoicesService,
  );
  const server = service.buildServer();
  const client = new Client({ name: "test-client", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return client;
}

function errText(res: unknown): string {
  const content = (res as { content?: { type: string; text?: string }[] }).content;
  return content?.[0]?.text ?? "";
}

describe("McpService — MCP protocol surface", () => {
  it("lists all sixteen portal tools with correct annotations", async () => {
    const client = await connect(prismaStub());
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(ALL_TOOLS);
    for (const tool of tools) {
      expect(tool.annotations?.openWorldHint).toBe(false);
      expect(tool.annotations?.readOnlyHint).toBe(READ_TOOLS.has(tool.name));
    }
    const byName = new Map(tools.map((t) => [t.name, t]));
    // Pure creates are non-destructive; mutations/deletes are destructive.
    expect(byName.get("portal_create_client")?.annotations?.destructiveHint).toBe(false);
    expect(byName.get("portal_record_income")?.annotations?.destructiveHint).toBe(false);
    expect(byName.get("portal_delete_transaction")?.annotations?.destructiveHint).toBe(true);
    expect(byName.get("portal_set_client_status")?.annotations?.idempotentHint).toBe(true);
    expect(byName.get("portal_update_invoice_status")?.annotations?.idempotentHint).toBe(true);
  });

  it("portal_list_clients returns firm clients as structured content", async () => {
    const prisma = prismaStub();
    const client = await connect(prisma);
    const res = await client.callTool({ name: "portal_list_clients", arguments: {} });
    const data = res.structuredContent as { count: number; clients: { id: string }[] };
    expect(data.count).toBe(1);
    expect(data.clients[0]?.id).toBe(CLIENT_ID);
    // Firm-scoped and active-only by default.
    expect(prisma.client.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ firmId: FIRM.id, status: "ACTIVE" }),
      }),
    );
  });

  it("portal_list_invoices serializes Decimals to numbers and dates to ISO", async () => {
    const client = await connect(prismaStub());
    const res = await client.callTool({ name: "portal_list_invoices", arguments: {} });
    const data = res.structuredContent as {
      invoices: { total: number; issuedDate: string; lineItems: { amount: number }[] }[];
    };
    expect(data.invoices[0]?.total).toBe(1120);
    expect(data.invoices[0]?.issuedDate).toBe("2026-07-01");
    expect(data.invoices[0]?.lineItems[0]?.amount).toBe(1000);
  });

  it("returns an actionable in-band error for an unknown client id", async () => {
    const client = await connect(prismaStub());
    const res = await client.callTool({
      name: "portal_list_income_transactions",
      arguments: { clientId: "33333333-3333-4333-8333-333333333333" },
    });
    expect(res.isError).toBe(true);
    expect(errText(res)).toMatch(/portal_list_clients/);
  });
});

describe("McpService — client write tools", () => {
  it("creates a client with a normalized TIN through ClientsService", async () => {
    const services = servicesStub();
    const client = await connect(prismaStub(), services);
    const res = await client.callTool({
      name: "portal_create_client",
      arguments: { businessName: "NEW TRADING CO", tin: "111-222-333" },
    });
    expect(res.isError).toBeUndefined();
    const input = services.clients.create.mock.calls[0]![1] as { tin: string };
    expect(input.tin).toBe("111222333");
    const data = res.structuredContent as { client: { businessName: string } };
    expect(data.client.businessName).toBe("NEW TRADING CO");
  });

  it("rejects a duplicate TIN naming the existing client", async () => {
    const services = servicesStub();
    const client = await connect(prismaStub(), services);
    const res = await client.callTool({
      name: "portal_create_client",
      arguments: { businessName: "COPYCAT CO", tin: "234-968-660" },
    });
    expect(res.isError).toBe(true);
    expect(errText(res)).toContain("HEBREWS 13-8 MILKTEA SHOP");
    expect(errText(res)).toContain(CLIENT_ID);
    expect(services.clients.create).not.toHaveBeenCalled();
  });

  it("rejects a malformed TIN with guidance about the branch code", async () => {
    const client = await connect(prismaStub());
    const res = await client.callTool({
      name: "portal_create_client",
      arguments: { businessName: "X CO", tin: "234-968-660-00000" },
    });
    expect(res.isError).toBe(true);
    expect(errText(res)).toMatch(/9 digits/);
    expect(errText(res)).toMatch(/branch/);
  });

  it("enforces the billingMethod ↔ professionalFee coupling", async () => {
    const client = await connect(prismaStub());
    const res = await client.callTool({
      name: "portal_create_client",
      arguments: { businessName: "X CO", tin: "111222333", billingMethod: "MONTHLY" },
    });
    expect(res.isError).toBe(true);
    expect(errText(res)).toMatch(/professionalFee/);
  });

  it("rejects an empty update patch with a helpful message", async () => {
    const services = servicesStub();
    const client = await connect(prismaStub(), services);
    const res = await client.callTool({
      name: "portal_update_client",
      arguments: { clientId: CLIENT_ID },
    });
    expect(res.isError).toBe(true);
    expect(errText(res)).toMatch(/Empty update/);
    expect(services.clients.update).not.toHaveBeenCalled();
  });

  it("blocks archiving a billing parent with ACTIVE sub-clients, listing them", async () => {
    const services = servicesStub();
    const client = await connect(
      prismaStub({ subClients: [{ id: SUB_ID, businessName: "SUB BRANCH CO" }] }),
      services,
    );
    const res = await client.callTool({
      name: "portal_set_client_status",
      arguments: { clientId: CLIENT_ID, status: "ARCHIVED" },
    });
    expect(res.isError).toBe(true);
    expect(errText(res)).toContain("SUB BRANCH CO");
    expect(errText(res)).toMatch(/billingParentId/);
    expect(services.clients.update).not.toHaveBeenCalled();
  });

  it("re-applying the current status is a no-op", async () => {
    const services = servicesStub();
    const client = await connect(prismaStub(), services);
    const res = await client.callTool({
      name: "portal_set_client_status",
      arguments: { clientId: CLIENT_ID, status: "ACTIVE" },
    });
    expect(res.isError).toBeUndefined();
    expect((res.structuredContent as { note?: string }).note).toMatch(/already ACTIVE/);
    expect(services.clients.update).not.toHaveBeenCalled();
  });
});

describe("McpService — bookkeeping write tools", () => {
  it("records income for a VAT client with the 12% output VAT computed server-side", async () => {
    const services = servicesStub();
    const client = await connect(prismaStub({ client: { taxType: "VAT" } }), services);
    const res = await client.callTool({
      name: "portal_record_income",
      arguments: {
        clientId: CLIENT_ID,
        txnDate: "2026-07-15",
        amount: 1000,
        category: "Service Income",
      },
    });
    expect(res.isError).toBeUndefined();
    const body = services.income.create.mock.calls[0]![2] as Record<string, unknown>;
    expect(body.vatClass).toBe("VATABLE_12");
    expect(body.outputVAT).toBe(120);
    expect(body.netAmount).toBe(1000);
    expect(body.account).toBe("Service Income");
  });

  it("records NON_VAT income for a percentage client and rejects a vatClass override", async () => {
    const services = servicesStub();
    const client = await connect(prismaStub(), services); // PERCENTAGE client
    const res = await client.callTool({
      name: "portal_record_income",
      arguments: {
        clientId: CLIENT_ID,
        txnDate: "2026-07-15",
        amount: 500,
        category: "Sales",
        vatClass: "VATABLE_12",
      },
    });
    expect(res.isError).toBe(true);
    expect(errText(res)).toMatch(/NON_VAT/);
    expect(services.income.create).not.toHaveBeenCalled();
  });

  it("rejects input VAT on a percentage client's expense", async () => {
    const services = servicesStub();
    const client = await connect(prismaStub(), services);
    const res = await client.callTool({
      name: "portal_record_expense",
      arguments: {
        clientId: CLIENT_ID,
        txnDate: "2026-07-15",
        amount: 500,
        category: "Office Supplies",
        vatAmount: 60,
      },
    });
    expect(res.isError).toBe(true);
    expect(errText(res)).toMatch(/input VAT/i);
    expect(services.purchases.create).not.toHaveBeenCalled();
  });

  it("rejects impossible calendar dates", async () => {
    const client = await connect(prismaStub());
    const res = await client.callTool({
      name: "portal_record_income",
      arguments: {
        clientId: CLIENT_ID,
        txnDate: "2026-02-30",
        amount: 100,
        category: "Sales",
      },
    });
    expect(res.isError).toBe(true);
    expect(errText(res)).toMatch(/not a real calendar date/);
  });

  it("rejects zero/negative amounts at the schema layer", async () => {
    const client = await connect(prismaStub());
    const res = await client.callTool({
      name: "portal_record_income",
      arguments: { clientId: CLIENT_ID, txnDate: "2026-07-15", amount: -5, category: "Sales" },
    });
    expect(res.isError).toBe(true);
  });

  it("deletes a transaction through the service after a firm-scoped lookup", async () => {
    const services = servicesStub();
    const prisma = prismaStub();
    const client = await connect(prisma, services);
    const res = await client.callTool({
      name: "portal_delete_transaction",
      arguments: { kind: "income", transactionId: TXN_ID, reason: "duplicate entry" },
    });
    expect(res.isError).toBeUndefined();
    expect(services.income.remove).toHaveBeenCalledWith(expect.anything(), CLIENT_ID, TXN_ID);
    expect(prisma.incomeTransaction.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ client: { firmId: FIRM.id } }),
      }),
    );
    expect((res.structuredContent as { deleted: boolean }).deleted).toBe(true);
  });

  it("reads as not-found for an unknown (or cross-firm) transaction id", async () => {
    const services = servicesStub();
    const client = await connect(prismaStub({ incomeTxnRow: null }), services);
    const res = await client.callTool({
      name: "portal_delete_transaction",
      arguments: { kind: "income", transactionId: TXN_ID },
    });
    expect(res.isError).toBe(true);
    expect(services.income.remove).not.toHaveBeenCalled();
  });
});

describe("McpService — invoice write tools", () => {
  it("creates a Draft invoice for a sub-client engagement via the paying client", async () => {
    const services = servicesStub();
    const client = await connect(prismaStub(), services);
    const res = await client.callTool({
      name: "portal_create_invoice",
      arguments: {
        clientId: CLIENT_ID,
        billedForClientId: SUB_ID,
        lineItems: [{ description: "Monthly bookkeeping", qty: 1, rate: 1000 }],
      },
    });
    expect(res.isError).toBeUndefined();
    // The service receives the SUB-client id and re-routes to the payer itself.
    const input = services.invoices.create.mock.calls[0]![1] as {
      clientId: string;
      status: string;
    };
    expect(input.clientId).toBe(SUB_ID);
    expect(input.status).toBe("Draft");
    const data = res.structuredContent as { invoice: { total: number } };
    expect(data.invoice.total).toBe(1120); // Decimal-ish strings → numbers
  });

  it("rejects billedForClientId that is not billed under the paying client", async () => {
    const services = servicesStub();
    // SUB_ID's parent is CLIENT_ID; use a payer that is not its parent.
    const prisma = prismaStub();
    prisma.client.findFirst = jest.fn(async ({ where }: { where: { id: string } }) => {
      if (where.id === CLIENT_ID) return clientRow();
      if (where.id === SUB_ID) {
        return clientRow({
          id: SUB_ID,
          businessName: "SUB BRANCH CO",
          billingParentId: "99999999-9999-4999-8999-999999999999",
        });
      }
      return null;
    }) as never;
    const client = await connect(prisma, services);
    const res = await client.callTool({
      name: "portal_create_invoice",
      arguments: {
        clientId: CLIENT_ID,
        billedForClientId: SUB_ID,
        lineItems: [{ description: "Bookkeeping", qty: 1, rate: 1000 }],
      },
    });
    expect(res.isError).toBe(true);
    expect(errText(res)).toMatch(/not billed under/);
    expect(services.invoices.create).not.toHaveBeenCalled();
  });

  it("enforces the status lifecycle (Draft→Sent ok; leaving Paid is blocked)", async () => {
    const services = servicesStub();
    const client = await connect(prismaStub(), services);

    const sent = await client.callTool({
      name: "portal_update_invoice_status",
      arguments: { invoiceId: INVOICE_ID, status: "Sent" },
    });
    expect(sent.isError).toBeUndefined();
    expect(services.invoices.update).toHaveBeenCalledWith(expect.anything(), INVOICE_ID, {
      status: "Sent",
    });

    services.invoices.get.mockResolvedValueOnce({ ...INVOICE_DTO, status: "Paid" });
    const reopen = await client.callTool({
      name: "portal_update_invoice_status",
      arguments: { invoiceId: INVOICE_ID, status: "Sent" },
    });
    expect(reopen.isError).toBe(true);
    expect(errText(reopen)).toMatch(/Paid is final/);
  });

  it("never allows a status back to Draft and treats a repeat as a no-op", async () => {
    const services = servicesStub();
    const client = await connect(prismaStub(), services);

    services.invoices.get.mockResolvedValueOnce({ ...INVOICE_DTO, status: "Sent" });
    const back = await client.callTool({
      name: "portal_update_invoice_status",
      arguments: { invoiceId: INVOICE_ID, status: "Draft" },
    });
    expect(back.isError).toBe(true);

    const same = await client.callTool({
      name: "portal_update_invoice_status",
      arguments: { invoiceId: INVOICE_ID, status: "Draft" }, // current stub status IS Draft
    });
    expect(same.isError).toBeUndefined();
    expect((same.structuredContent as { note?: string }).note).toMatch(/already Draft/);
  });

  it("only Draft invoices can be edited", async () => {
    const services = servicesStub();
    const client = await connect(prismaStub(), services);
    services.invoices.get.mockResolvedValueOnce({ ...INVOICE_DTO, status: "Sent" });
    const res = await client.callTool({
      name: "portal_update_invoice",
      arguments: {
        invoiceId: INVOICE_ID,
        lineItems: [{ description: "Adjusted", qty: 1, rate: 900 }],
      },
    });
    expect(res.isError).toBe(true);
    expect(errText(res)).toMatch(/portal_update_invoice_status/);
    expect(services.invoices.update).not.toHaveBeenCalled();
  });
});
