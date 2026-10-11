/**
 * track-c-mcp-writes.db-spec.ts — M1 T3 and T4. The real Nest app over HTTP
 * against the local PostgreSQL; every firm, user, client and figure is invented.
 *
 * T3  Every write tool in state (i) — two Super Admins, the never-rotated
 *     MCP_SHARED_SECRET link — refuses with the D41 sentence and writes nothing;
 *     in state (ii) — A rotated the link — succeeds, its service audit rows carry
 *     A and it has its mcp.<tool> row.
 * T4  R6's regime rules for the record tools, the same as the web app: income for
 *     a VAT client in each class, a percentage-tax client and a no-regime client
 *     (D39); expense for a VAT client with and without input VAT, a non-VAT client
 *     and a no-regime client.
 */
import { randomUUID } from "node:crypto";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { PrismaClient } from "@prisma/client";
import request from "supertest";
import { truncateOncePerFile } from "./helpers/truncate";
import { AppModule } from "../../src/app.module";
import { TokenService } from "../../src/auth/token.service";
import { MCP_SEVERAL_SUPER_ADMINS } from "../../src/mcp/mcp.service";
import { PrismaService } from "../../src/prisma/prisma.service";

truncateOncePerFile({ firmRoles: ["Super Admin"], chartOfAccounts: true });

const TAG = `track-c-m1x-${randomUUID().slice(0, 8)}`;
const API = "/api/v1";
const MCP_ACCEPT = "application/json, text/event-stream";
const ENV_SECRET = `${TAG}-environment-secret-0123456789`;

type ToolResult = {
  isError?: boolean;
  content: { type: string; text: string }[];
  structuredContent?: Record<string, unknown>;
};

describe("M1 T3 and T4 · every connector write, and the regime rules (real app over HTTP, db)", () => {
  let app: INestApplication;
  let writer: PrismaService;
  let reader: PrismaClient;
  let prevSecret: string | undefined;
  let rpc = 1;
  let firmId = "";
  const sa = { A: "", B: "", tokenA: "" };
  const client = { vat: "", percentage: "", exempt: "" };
  let link = ENV_SECRET;

  const http = () => request(app.getHttpServer());
  async function tool(name: string, args: Record<string, unknown>): Promise<ToolResult> {
    const res = await http()
      .post(`${API}/mcp/${link}`)
      .set("Accept", MCP_ACCEPT)
      .send({
        jsonrpc: "2.0",
        id: rpc++,
        method: "tools/call",
        params: { name, arguments: args },
      });
    expect(res.status).toBe(200);
    return res.body.result as ToolResult;
  }
  const body = (r: ToolResult) => r.structuredContent as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any -- test reads tool JSON

  beforeAll(async () => {
    prevSecret = process.env.MCP_SHARED_SECRET;
    process.env.MCP_SHARED_SECRET = ENV_SECRET;
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix("api/v1");
    await app.init();
    writer = app.get(PrismaService);
    reader = new PrismaClient();
    const tokens = app.get(TokenService);
    firmId = (await writer.firm.create({ data: { name: `${TAG} Halimbawa Accounting` } }))
      .id;
    const roleId = (
      await writer.role.findUniqueOrThrow({
        where: { name_scope: { name: "Super Admin", scope: "FIRM" } },
      })
    ).id;
    for (const key of ["A", "B"] as const) {
      const u = await writer.user.create({
        data: {
          firmId,
          userType: "FIRM",
          fullName: `${TAG} Super Admin ${key}`,
          email: `${TAG}-sa-${key.toLowerCase()}@example.com`,
          status: "ACTIVE",
          firmProfile: { create: { title: "Test" } },
          userRoles: { create: { roleId } },
        },
      });
      sa[key] = u.id;
      if (key === "A") {
        sa.tokenA = tokens.signAccess({
          id: u.id,
          firmId,
          userType: "FIRM",
          email: u.email,
        });
      }
    }
    const mk = async (name: string, tin: string, taxType: string | null) =>
      (
        await writer.client.create({
          data: { firmId, businessName: `${TAG} ${name}`, tin, taxType },
        })
      ).id;
    client.vat = await mk("SAMPLE VAT TRADING", "000555111", "VAT");
    client.percentage = await mk("SAMPLE PERCENTAGE STORE", "000555222", "PERCENTAGE");
    client.exempt = await mk("SAMPLE EXEMPT COOPERATIVE", "000555333", null);
  });

  afterAll(async () => {
    process.env.MCP_SHARED_SECRET = prevSecret;
    await reader?.$disconnect();
    await app?.close();
  });

  // ------------------------------------------------------------------ T3
  // Ids made in state (ii), read by the later tools of the same state.
  const made = { client: "", income: "", invoice: "" };
  const fake = randomUUID();
  /** Every write tool, with arguments valid in state (ii). In (i) the refusal comes first. */
  const WRITES: { tool: string; args: () => Record<string, unknown> }[] = [
    {
      tool: "portal_create_client",
      args: () => ({
        businessName: `${TAG} SAMPLE NEW CLIENT`,
        tin: "000-555-444",
        taxType: "VAT",
      }),
    },
    {
      tool: "portal_update_client",
      args: () => ({ clientId: made.client || fake, city: "SAMPLE CITY" }),
    },
    {
      tool: "portal_set_client_status",
      args: () => ({ clientId: made.client || fake, status: "ARCHIVED" }),
    },
    {
      tool: "portal_record_income",
      args: () => ({
        clientId: client.vat,
        txnDate: "2026-07-15",
        amount: 1000,
        category: `${TAG} Sales`,
      }),
    },
    {
      tool: "portal_record_expense",
      args: () => ({
        clientId: client.vat,
        txnDate: "2026-07-16",
        amount: 500,
        category: `${TAG} Supplies`,
        vatAmount: 60,
      }),
    },
    {
      tool: "portal_delete_transaction",
      args: () => ({
        kind: "income",
        transactionId: made.income || fake,
        reason: "M1 T3 test",
      }),
    },
    {
      tool: "portal_create_invoice",
      args: () => ({
        clientId: client.vat,
        lineItems: [
          { description: "Monthly bookkeeping — invented", qty: 1, rate: 5000 },
        ],
        issuedDate: "2026-07-31",
      }),
    },
    {
      tool: "portal_update_invoice",
      args: () => ({ invoiceId: made.invoice || fake, description: "Invented memo" }),
    },
    {
      tool: "portal_update_invoice_status",
      args: () => ({ invoiceId: made.invoice || fake, status: "Sent" }),
    },
  ];

  describe("T3 (i) two Super Admins, the never-rotated MCP_SHARED_SECRET link", () => {
    it.each(WRITES.map((w) => [w.tool, w] as const))(
      "%s refuses with the D41 sentence and writes nothing",
      async (_n, w) => {
        const before = await reader.auditLog.count();
        const r = await tool(w.tool, w.args());
        expect(r.isError).toBe(true);
        expect(r.content[0]!.text).toBe(`Error: ${MCP_SEVERAL_SUPER_ADMINS}`);
        expect(await reader.auditLog.count()).toBe(before);
      },
    );
  });

  describe("T3 (ii) A rotated the link", () => {
    beforeAll(async () => {
      const res = await http()
        .post(`${API}/mcp-connector/rotate`)
        .set("Authorization", `Bearer ${sa.tokenA}`);
      expect(res.status).toBe(201);
      link = res.body.secret as string;
    });

    it.each(WRITES.map((w) => [w.tool, w] as const))(
      "%s succeeds, attributed to A, with its mcp.<tool> row",
      async (_n, w) => {
        const start = new Date();
        const r = await tool(w.tool, w.args());
        expect(r.content[0]!.text).not.toMatch(/^Error/);
        expect(r.isError).toBeFalsy();
        const b = body(r);
        if (w.tool === "portal_create_client") made.client = b.client.id;
        if (w.tool === "portal_record_income") made.income = b.id;
        if (w.tool === "portal_create_invoice") made.invoice = b.invoice.id;
        const rows = await reader.auditLog.findMany({
          where: { timestamp: { gte: start } },
        });
        const service = rows.filter((x) => !x.action.startsWith("mcp."));
        const connector = rows.filter((x) => x.action === `mcp.${w.tool}`);
        expect(service.length).toBeGreaterThan(0);
        expect(service.map((x) => x.userId)).toEqual(service.map(() => sa.A));
        expect(connector).toHaveLength(1);
        expect((connector[0]!.metadata as Record<string, unknown>).actor).toBe(
          "Claude (MCP)",
        );
      },
    );
  });

  // ------------------------------------------------------------------ T4
  describe("T4 R6 · income, as the web app records it", () => {
    const record = async (clientId: string, extra: Record<string, unknown> = {}) => {
      const r = await tool("portal_record_income", {
        clientId,
        txnDate: "2026-08-01",
        amount: 1000,
        category: `${TAG} Sales`,
        ...extra,
      });
      return {
        r,
        row: r.isError
          ? null
          : await reader.incomeTransaction.findUniqueOrThrow({
              where: { id: body(r).id },
            }),
      };
    };

    it("a VAT client, no class given: VATABLE_12 with 12% output VAT", async () => {
      const { row } = await record(client.vat);
      expect(row!.vatClass).toBe("VATABLE_12");
      expect(Number(row!.outputVAT)).toBe(120);
      expect(Number(row!.netAmount)).toBe(1000);
    });

    it("a VAT client, VATABLE_12 given: 12% output VAT", async () => {
      const { row } = await record(client.vat, { vatClass: "VATABLE_12" });
      expect(row!.vatClass).toBe("VATABLE_12");
      expect(Number(row!.outputVAT)).toBe(120);
    });

    it.each(["ZERO_RATED", "EXEMPT"])(
      "a VAT client, %s: no output VAT",
      async (vatClass) => {
        const { row } = await record(client.vat, { vatClass });
        expect(row!.vatClass).toBe(vatClass);
        expect(Number(row!.outputVAT ?? 0)).toBe(0);
      },
    );

    it.each([
      ["a percentage-tax client", "percentage"],
      ["a client with no regime (exempt, D39)", "exempt"],
    ] as const)("%s: NON_VAT, nothing added, accepted", async (_l, key) => {
      const { r, row } = await record(client[key]);
      expect(r.isError).toBeFalsy();
      expect(row!.vatClass).toBe("NON_VAT");
      expect(Number(row!.outputVAT ?? 0)).toBe(0);
      expect(Number(row!.netAmount)).toBe(1000);
    });
  });

  describe("T4 R6 · expense, as the web app records it (W8)", () => {
    const record = async (clientId: string, extra: Record<string, unknown> = {}) => {
      const r = await tool("portal_record_expense", {
        clientId,
        txnDate: "2026-08-02",
        amount: 500,
        category: `${TAG} Supplies`,
        ...extra,
      });
      expect(r.isError).toBeFalsy();
      return reader.purchaseTransaction.findUniqueOrThrow({ where: { id: body(r).id } });
    };

    it("a VAT client with input VAT: DOMESTIC_PURCHASES carrying it", async () => {
      const row = await record(client.vat, { vatAmount: 60 });
      expect(row.inputVATCategory).toBe("DOMESTIC_PURCHASES");
      expect(Number(row.inputVAT)).toBe(60);
    });

    it("a VAT client without input VAT: DOMESTIC_NO_INPUT_TAX, no input VAT", async () => {
      const row = await record(client.vat);
      expect(row.inputVATCategory).toBe("DOMESTIC_NO_INPUT_TAX");
      expect(Number(row.inputVAT ?? 0)).toBe(0);
    });

    it("a VAT client with input VAT 0: DOMESTIC_NO_INPUT_TAX, no input VAT", async () => {
      const row = await record(client.vat, { vatAmount: 0 });
      expect(row.inputVATCategory).toBe("DOMESTIC_NO_INPUT_TAX");
      expect(Number(row.inputVAT ?? 0)).toBe(0);
    });

    it.each([
      ["a non-VAT (percentage-tax) client", "percentage"],
      ["a client with no regime (exempt, D39)", "exempt"],
    ] as const)("%s: accepted, no category, no input VAT", async (_l, key) => {
      const row = await record(client[key]);
      expect(row.inputVATCategory).toBeNull();
      expect(Number(row.inputVAT ?? 0)).toBe(0);
      expect(Number(row.netAmount)).toBe(500);
    });
  });
});
