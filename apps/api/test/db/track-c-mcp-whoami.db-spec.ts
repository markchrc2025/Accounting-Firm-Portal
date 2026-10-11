/**
 * track-c-mcp-whoami.db-spec.ts — M1 T2 (seen to fail first): the connector says who
 * Claude acts as. The real Nest app over HTTP against the local PostgreSQL; every
 * firm, user and client is invented.
 *
 * In the three states of T1 — (i) two Super Admins and the never-rotated
 * MCP_SHARED_SECRET link; (ii) A rotates; (iii) A loses the role while B and C
 * remain — it checks:
 *   - portal_whoami (R4);
 *   - the Integrations card's fields from GET /mcp-connector (R3), read as B;
 *   - the record tools' top-level id (R5);
 *   - a VAT client's purchase with no input VAT saved as DOMESTIC_NO_INPUT_TAX (R6, W8).
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

const TAG = `track-c-m1w-${randomUUID().slice(0, 8)}`;
const API = "/api/v1";
const MCP_ACCEPT = "application/json, text/event-stream";
const ENV_SECRET = `${TAG}-environment-secret-0123456789`;

type ToolResult = {
  isError?: boolean;
  content: { type: string; text: string }[];
  structuredContent?: Record<string, unknown>;
};

describe("M1 T2 · the connector says who Claude acts as (real app over HTTP, db)", () => {
  let app: INestApplication;
  let writer: PrismaService;
  let reader: PrismaClient;
  let prevSecret: string | undefined;
  let rpc = 1;
  let firmId = "";
  let saRoleId = "";
  let clientId = "";
  let link = ENV_SECRET;
  const sa = {
    A: {
      id: "",
      name: `${TAG} Super Admin A`,
      email: `${TAG}-sa-a@example.com`,
      token: "",
    },
    B: {
      id: "",
      name: `${TAG} Super Admin B`,
      email: `${TAG}-sa-b@example.com`,
      token: "",
    },
  };
  let issuedAt = "";

  const http = () => request(app.getHttpServer());
  async function tool(
    name: string,
    args: Record<string, unknown> = {},
  ): Promise<ToolResult> {
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
  async function card(): Promise<Record<string, unknown>> {
    const res = await http()
      .get(`${API}/mcp-connector`)
      .set("Authorization", `Bearer ${sa.B.token}`);
    expect(res.status).toBe(200);
    return res.body as Record<string, unknown>;
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
    firmId = (await writer.firm.create({ data: { name: `${TAG} Halimbawa Accounting` } }))
      .id;
    saRoleId = (
      await writer.role.findUniqueOrThrow({
        where: { name_scope: { name: "Super Admin", scope: "FIRM" } },
      })
    ).id;
    for (const who of [sa.A, sa.B]) {
      const u = await writer.user.create({
        data: {
          firmId,
          userType: "FIRM",
          fullName: who.name,
          email: who.email,
          status: "ACTIVE",
          firmProfile: { create: { title: "Test" } },
          userRoles: { create: { roleId: saRoleId } },
        },
      });
      who.id = u.id;
      who.token = tokens.signAccess({
        id: u.id,
        firmId,
        userType: "FIRM",
        email: u.email,
      });
    }
    clientId = (
      await writer.client.create({
        data: {
          firmId,
          businessName: `${TAG} SAMPLE VAT TRADING`,
          tin: "000444555",
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

  describe("(i) two Super Admins, the never-rotated MCP_SHARED_SECRET link", () => {
    it("portal_whoami: no one, writes not allowed, the refusal sentence, no issuer", async () => {
      const r = await tool("portal_whoami");
      expect(r.isError).toBeFalsy();
      expect(r.structuredContent).toEqual({
        actingAs: null,
        writesAllowed: false,
        problem: MCP_SEVERAL_SUPER_ADMINS,
        connectorIssuedBy: null,
        connectorIssuedAt: null,
      });
    });

    it("the card: the environment link, no issuer, no one acting, the refusal sentence", async () => {
      expect(await card()).toEqual({
        enabled: true,
        source: "environment",
        secret: ENV_SECRET,
        issuedBy: null,
        issuedAt: null,
        actingAs: null,
        actingProblem: MCP_SEVERAL_SUPER_ADMINS,
      });
    });
  });

  describe("(ii) A rotates the link", () => {
    let rotated: Record<string, unknown> = {};
    beforeAll(async () => {
      const res = await http()
        .post(`${API}/mcp-connector/rotate`)
        .set("Authorization", `Bearer ${sa.A.token}`);
      expect(res.status).toBe(201);
      rotated = res.body as Record<string, unknown>;
      link = res.body.secret as string;
      issuedAt = (
        await reader.auditLog.findFirstOrThrow({
          where: { action: "mcp.connector.rotate" },
        })
      ).timestamp.toISOString();
    });

    it("the rotate response already carries the new issuer and actor", () => {
      expect(rotated).toEqual({
        enabled: true,
        source: "portal",
        secret: link,
        issuedBy: { name: sa.A.name, email: sa.A.email },
        issuedAt,
        actingAs: { name: sa.A.name, email: sa.A.email },
        actingProblem: null,
      });
    });

    it("portal_whoami: Claude acts as A, writes allowed, issued by A", async () => {
      const r = await tool("portal_whoami");
      expect(r.structuredContent).toEqual({
        actingAs: { name: sa.A.name, email: sa.A.email, role: "Super Admin" },
        writesAllowed: true,
        problem: null,
        connectorIssuedBy: { name: sa.A.name, email: sa.A.email },
        connectorIssuedAt: issuedAt,
      });
    });

    it("the card: issued by A, Claude acts as A, no problem", async () => {
      expect(await card()).toEqual({
        enabled: true,
        source: "portal",
        secret: link,
        issuedBy: { name: sa.A.name, email: sa.A.email },
        issuedAt,
        actingAs: { name: sa.A.name, email: sa.A.email },
        actingProblem: null,
      });
    });

    it("portal_record_income and portal_record_expense return the new record's id at the top level", async () => {
      const inc = await tool("portal_record_income", {
        clientId,
        txnDate: "2026-07-15",
        amount: 1000,
        category: `${TAG} Service Income`,
      });
      const exp = await tool("portal_record_expense", {
        clientId,
        txnDate: "2026-07-16",
        amount: 500,
        category: `${TAG} Office Supplies`,
        vatAmount: 60,
      });
      for (const r of [inc, exp]) {
        expect(r.isError).toBeFalsy();
        const body = r.structuredContent as { id: string; transaction: { id: string } };
        expect(body.id).toMatch(/^[0-9a-f-]{36}$/);
        expect(body.id).toBe(body.transaction.id);
      }
      const incId = (inc.structuredContent as { id: string }).id;
      const expId = (exp.structuredContent as { id: string }).id;
      expect(await reader.incomeTransaction.count({ where: { id: incId } })).toBe(1);
      expect(await reader.purchaseTransaction.count({ where: { id: expId } })).toBe(1);
    });

    it("a VAT client's purchase with no input VAT is saved as DOMESTIC_NO_INPUT_TAX, with no input VAT (W8)", async () => {
      const r = await tool("portal_record_expense", {
        clientId,
        txnDate: "2026-07-17",
        amount: 300,
        category: `${TAG} Transportation`,
      });
      expect(r.isError).toBeFalsy();
      const row = await reader.purchaseTransaction.findUniqueOrThrow({
        where: {
          id: (r.structuredContent as { transaction: { id: string } }).transaction.id,
        },
      });
      expect(row.inputVATCategory).toBe("DOMESTIC_NO_INPUT_TAX");
      expect(Number(row.inputVAT ?? 0)).toBe(0);
      expect(Number(row.netAmount)).toBe(300);
    });
  });

  describe("(iii) A loses the Super Admin role while B and C remain", () => {
    beforeAll(async () => {
      await writer.user.create({
        data: {
          firmId,
          userType: "FIRM",
          fullName: `${TAG} Super Admin C`,
          email: `${TAG}-sa-c@example.com`,
          status: "ACTIVE",
          firmProfile: { create: { title: "Test" } },
          userRoles: { create: { roleId: saRoleId } },
        },
      });
      await writer.userRole.deleteMany({ where: { userId: sa.A.id, roleId: saRoleId } });
    });

    it("portal_whoami: no one, writes not allowed, the refusal sentence; the link was still issued by A", async () => {
      const r = await tool("portal_whoami");
      expect(r.structuredContent).toEqual({
        actingAs: null,
        writesAllowed: false,
        problem: MCP_SEVERAL_SUPER_ADMINS,
        connectorIssuedBy: { name: sa.A.name, email: sa.A.email },
        connectorIssuedAt: issuedAt,
      });
    });

    it("the card: issued by A, no one acting, the refusal sentence", async () => {
      expect(await card()).toEqual({
        enabled: true,
        source: "portal",
        secret: link,
        issuedBy: { name: sa.A.name, email: sa.A.email },
        issuedAt,
        actingAs: null,
        actingProblem: MCP_SEVERAL_SUPER_ADMINS,
      });
    });
  });
});
