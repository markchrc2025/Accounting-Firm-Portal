// Protocol-level test of the MCP server: a real MCP client talks to the real
// McpServer over an in-memory transport; only Prisma is stubbed. This covers
// the same path Claude uses (initialize → tools/list → tools/call) without HTTP.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Prisma } from "@prisma/client";
import { McpService } from "./mcp.service";
import type { PrismaService } from "../prisma/prisma.service";

const FIRM = { id: "11111111-1111-4111-8111-111111111111", createdAt: new Date() };
const CLIENT_ID = "22222222-2222-4222-8222-222222222222";

/** Minimal Prisma stub — only what the registered tools touch. */
function prismaStub() {
  return {
    firm: { findFirst: jest.fn(async () => FIRM) },
    client: {
      findMany: jest.fn(async () => [
        {
          id: CLIENT_ID,
          businessName: "HEBREWS 13-8 MILKTEA SHOP",
          tin: "234968660",
          taxType: "PERCENTAGE",
          status: "ACTIVE",
          city: "Marikina",
          province: "Metro Manila",
          billingParentId: null,
        },
      ]),
      findFirst: jest.fn(async ({ where }: { where: { id: string } }) =>
        where.id === CLIENT_ID
          ? { id: CLIENT_ID, businessName: "HEBREWS 13-8 MILKTEA SHOP" }
          : null,
      ),
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
    incomeTransaction: { count: jest.fn(), findMany: jest.fn(), groupBy: jest.fn() },
    purchaseTransaction: { count: jest.fn(), findMany: jest.fn(), groupBy: jest.fn() },
    category: { findMany: jest.fn(async () => []) },
  };
}

async function connect(prisma: ReturnType<typeof prismaStub>) {
  const service = new McpService(prisma as unknown as PrismaService);
  const server = service.buildServer();
  const client = new Client({ name: "test-client", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return client;
}

describe("McpService — MCP protocol surface", () => {
  it("lists the six read-only portal tools", async () => {
    const client = await connect(prismaStub());
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      "portal_financial_summary",
      "portal_get_client",
      "portal_list_clients",
      "portal_list_expense_transactions",
      "portal_list_income_transactions",
      "portal_list_invoices",
    ]);
    for (const tool of tools) {
      expect(tool.annotations?.readOnlyHint).toBe(true);
      expect(tool.annotations?.destructiveHint).toBe(false);
    }
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
    const text = (res.content as { type: string; text: string }[])[0]?.text;
    expect(text).toMatch(/portal_list_clients/);
  });
});
