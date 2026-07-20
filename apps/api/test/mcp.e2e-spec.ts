import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { AppModule } from "../src/app.module";

const SECRET = "e2e-test-secret-0123456789-0123456789"; // ≥32 chars
const MCP_ACCEPT = "application/json, text/event-stream";

const initializeRpc = {
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2025-03-26",
    capabilities: {},
    clientInfo: { name: "e2e", version: "1.0.0" },
  },
};

/**
 * Exercises the real HTTP surface of the MCP endpoint (capability-URL gate +
 * stateless Streamable HTTP JSON-RPC). No DB needed: initialize and tools/list
 * never touch Prisma.
 */
describe("MCP endpoint (e2e)", () => {
  let app: INestApplication;
  let prevSecret: string | undefined;

  beforeAll(async () => {
    prevSecret = process.env.MCP_SHARED_SECRET;
    process.env.MCP_SHARED_SECRET = SECRET;
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix("api/v1");
    await app.init();
  });

  afterAll(async () => {
    process.env.MCP_SHARED_SECRET = prevSecret;
    await app.close();
  });

  it("answers 404 for a wrong key (indistinguishable from no route)", async () => {
    const res = await request(app.getHttpServer())
      .post("/api/v1/mcp/wrong-key-wrong-key-wrong-key-wrong")
      .set("Accept", MCP_ACCEPT)
      .send(initializeRpc);
    expect(res.status).toBe(404);
  });

  it("completes the initialize handshake with the right key", async () => {
    const res = await request(app.getHttpServer())
      .post(`/api/v1/mcp/${SECRET}`)
      .set("Accept", MCP_ACCEPT)
      .send(initializeRpc);
    expect(res.status).toBe(200);
    expect(res.body.result.serverInfo.name).toBe("mcrc-portal-mcp-server");
    expect(res.body.result.protocolVersion).toBeDefined();
  });

  it("serves tools/list statelessly (fresh server per request)", async () => {
    const res = await request(app.getHttpServer())
      .post(`/api/v1/mcp/${SECRET}`)
      .set("Accept", MCP_ACCEPT)
      .send({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
    expect(res.status).toBe(200);
    const names = (res.body.result.tools as { name: string }[]).map((t) => t.name);
    expect(names).toContain("portal_list_clients");
    expect(names).toContain("portal_financial_summary");
    expect(names).toContain("portal_create_client");
    expect(names).toContain("portal_record_income");
    expect(names).toContain("portal_create_invoice");
    expect(names).toHaveLength(16);
  });

  it("answers 405 to GET with the right key (stateless — POST only)", async () => {
    const res = await request(app.getHttpServer()).get(`/api/v1/mcp/${SECRET}`);
    expect(res.status).toBe(405);
  });

  it("keeps answering 404 when the secret is unset (feature off)", async () => {
    delete process.env.MCP_SHARED_SECRET;
    try {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/mcp/${SECRET}`)
        .set("Accept", MCP_ACCEPT)
        .send(initializeRpc);
      expect(res.status).toBe(404);
    } finally {
      process.env.MCP_SHARED_SECRET = SECRET;
    }
  });
});
