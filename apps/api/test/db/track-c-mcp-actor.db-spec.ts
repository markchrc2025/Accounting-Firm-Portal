/**
 * track-c-mcp-actor.db-spec.ts — M1 T1: THE DIAGNOSIS of the refused connector writes
 * of 2026-10-11, as evidence. The real Nest app over HTTP against the local
 * PostgreSQL: the MCP endpoint (POST /api/v1/mcp/<key>) and the Integrations page's
 * connector routes. Every firm, user and client is invented.
 *
 * A firm with two active firm-wide Super Admins, A and B, and one VAT client:
 *   (i)   the link from MCP_SHARED_SECRET, never rotated: portal_record_income and
 *         portal_record_expense refuse with the exact D41 sentence; nothing is written.
 *   (ii)  A rotates the link: both succeed through the new link; the service audit
 *         rows carry A, and each write also carries its mcp.<tool> row.
 *   (iii) the issuer A stops being a candidate — loses the role, or is deactivated —
 *         while other Super Admins remain (B and a third, C): both refuse again.
 *   (iv)  and with only one active Super Admin left (B), D41's first rule applies:
 *         the writes act as B, without any rotation.
 *
 * This characterises today: it passes before and after M1's build.
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

const TAG = `track-c-m1-${randomUUID().slice(0, 8)}`;
const API = "/api/v1";
const MCP_ACCEPT = "application/json, text/event-stream";
const ENV_SECRET = `${TAG}-environment-secret-0123456789`; // ≥ 32 characters

type ToolResult = {
  isError?: boolean;
  content: { type: string; text: string }[];
  structuredContent?: Record<string, unknown>;
};

describe("M1 T1 · the connector's write refusal is D41 working as designed (real app over HTTP, db)", () => {
  let app: INestApplication;
  let writer: PrismaService;
  let reader: PrismaClient;
  let prevSecret: string | undefined;
  let rpc = 1;
  const user = { A: "", B: "", C: "" };
  const token = { A: "" };
  let saRoleId = "";
  let clientId = "";
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
  const income = () =>
    tool("portal_record_income", {
      clientId,
      txnDate: "2026-07-15",
      amount: 1000,
      category: `${TAG} Service Income`,
    });
  const expense = () =>
    tool("portal_record_expense", {
      clientId,
      txnDate: "2026-07-16",
      amount: 500,
      category: `${TAG} Office Supplies`,
      vatAmount: 60,
    });
  const counts = async () => ({
    income: await reader.incomeTransaction.count({ where: { clientId } }),
    purchase: await reader.purchaseTransaction.count({ where: { clientId } }),
    mcpRows: await reader.auditLog.count({
      where: { action: { startsWith: "mcp.portal_record" } },
    }),
  });
  async function expectRefusedAndNothingWritten(): Promise<void> {
    const before = await counts();
    for (const r of [await income(), await expense()]) {
      expect(r.isError).toBe(true);
      expect(r.content[0]!.text).toBe(`Error: ${MCP_SEVERAL_SUPER_ADMINS}`);
    }
    expect(await counts()).toEqual(before);
  }
  /** Both writes succeed; their service rows carry `who`; each has its mcp.<tool> row. */
  async function expectWritesAs(who: string): Promise<void> {
    const results = [await income(), await expense()];
    for (const r of results) expect(r.isError).toBeFalsy();
    const [inc, exp] = results.map(
      (r) => (r.structuredContent!.transaction as { id: string }).id,
    ) as [string, string];
    const svcIncome = await reader.auditLog.findFirstOrThrow({
      where: { action: "income.create", entityId: inc },
    });
    const svcPurchase = await reader.auditLog.findFirstOrThrow({
      where: { action: "purchase.create", entityId: exp },
    });
    expect(svcIncome.userId).toBe(who);
    expect(svcPurchase.userId).toBe(who);
    const mcpIncome = await reader.auditLog.findFirstOrThrow({
      where: { action: "mcp.portal_record_income", entityId: inc },
    });
    const mcpExpense = await reader.auditLog.findFirstOrThrow({
      where: { action: "mcp.portal_record_expense", entityId: exp },
    });
    for (const row of [mcpIncome, mcpExpense]) {
      expect((row.metadata as Record<string, unknown>).actor).toBe("Claude (MCP)");
    }
  }

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

    const firm = await writer.firm.create({
      data: { name: `${TAG} Halimbawa Accounting` },
    });
    saRoleId = (
      await writer.role.findUniqueOrThrow({
        where: { name_scope: { name: "Super Admin", scope: "FIRM" } },
      })
    ).id;
    const superAdmin = async (key: "A" | "B") => {
      const u = await writer.user.create({
        data: {
          firmId: firm.id,
          userType: "FIRM",
          fullName: `${TAG} Super Admin ${key}`,
          email: `${TAG}-sa-${key.toLowerCase()}@example.com`,
          status: "ACTIVE",
          firmProfile: { create: { title: "Test" } },
          userRoles: { create: { roleId: saRoleId } },
        },
      });
      user[key] = u.id;
      return tokens.signAccess({
        id: u.id,
        firmId: firm.id,
        userType: "FIRM",
        email: u.email,
      });
    };
    token.A = await superAdmin("A");
    await superAdmin("B");
    clientId = (
      await writer.client.create({
        data: {
          firmId: firm.id,
          businessName: `${TAG} SAMPLE VAT TRADING`,
          tin: "000222333",
          taxType: "VAT",
        },
      })
    ).id;
  });

  afterAll(async () => {
    process.env.MCP_SHARED_SECRET = prevSecret;
    await reader?.$disconnect();
    await app?.close();
  });

  it("(i) the never-rotated MCP_SHARED_SECRET link, two Super Admins: both record tools refuse with the exact sentence, nothing written", async () => {
    expect(
      await reader.auditLog.count({ where: { action: "mcp.connector.rotate" } }),
    ).toBe(0);
    // The same link still reads: a read tool needs no acting user.
    const list = await tool("portal_list_clients", {});
    expect(list.isError).toBeFalsy();
    await expectRefusedAndNothingWritten();
  });

  it("(ii) A rotates from the Integrations page: both succeed through the new link, attributed to A", async () => {
    const res = await http()
      .post(`${API}/mcp-connector/rotate`)
      .set("Authorization", `Bearer ${token.A}`);
    expect(res.status).toBe(201);
    expect(res.body.source).toBe("portal");
    // The old link is dead the moment the new one exists.
    const old = await http()
      .post(`${API}/mcp/${ENV_SECRET}`)
      .set("Accept", MCP_ACCEPT)
      .send({ jsonrpc: "2.0", id: rpc++, method: "tools/list", params: {} });
    expect(old.status).toBe(404);
    link = res.body.secret as string;
    const rotation = await reader.auditLog.findFirstOrThrow({
      where: { action: "mcp.connector.rotate" },
    });
    expect(rotation.userId).toBe(user.A);
    await expectWritesAs(user.A);
  });

  it("(iii) A loses the Super Admin role while B and C remain: both refuse again, nothing written", async () => {
    const c = await writer.user.create({
      data: {
        firmId: (await reader.user.findUniqueOrThrow({ where: { id: user.A } })).firmId,
        userType: "FIRM",
        fullName: `${TAG} Super Admin C`,
        email: `${TAG}-sa-c@example.com`,
        status: "ACTIVE",
        firmProfile: { create: { title: "Test" } },
        userRoles: { create: { roleId: saRoleId } },
      },
    });
    user.C = c.id;
    await writer.userRole.deleteMany({ where: { userId: user.A, roleId: saRoleId } });
    await expectRefusedAndNothingWritten();
  });

  it("(iii) A has the role back but is deactivated, B and C remain: both refuse again, nothing written", async () => {
    await writer.userRole.create({ data: { userId: user.A, roleId: saRoleId } });
    await writer.user.update({ where: { id: user.A }, data: { status: "DISABLED" } });
    await expectRefusedAndNothingWritten();
  });

  it("(iv) only one active Super Admin left (B): the writes act as B, with no rotation", async () => {
    await writer.user.update({ where: { id: user.C }, data: { status: "DISABLED" } });
    await expectWritesAs(user.B);
  });
});
