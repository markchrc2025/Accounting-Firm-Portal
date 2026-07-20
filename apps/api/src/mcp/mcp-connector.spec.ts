// Connector-secret management: portal-stored secret wins, env var is the
// pre-portal fallback, disable beats both, and rotation is audited.
import { McpService } from "./mcp.service";
import type { AuditService } from "../audit/audit.service";
import type { ClientsService } from "../clients/clients.service";
import type { IncomeTransactionsService } from "../income-transactions/income-transactions.service";
import type { InvoicesService } from "../invoices/invoices.service";
import type { PrismaService } from "../prisma/prisma.service";
import type { PurchaseTransactionsService } from "../purchase-transactions/purchase-transactions.service";
import type { AuthUser } from "../common/auth/auth-user";

const FIRM_ID = "11111111-1111-4111-8111-111111111111";
const ADMIN: AuthUser = { id: "u1", firmId: FIRM_ID, userType: "FIRM", email: "a@f.test" };
const STRONG = "portal-secret-0123456789-0123456789"; // ≥32 chars

function build(settingsJson: unknown) {
  const prisma = {
    firm: {
      findFirst: jest.fn(async () => ({ id: FIRM_ID, settingsJson })),
      findUniqueOrThrow: jest.fn(async () => ({ settingsJson })),
      update: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({
        id: FIRM_ID,
        ...data,
      })),
    },
  } as unknown as PrismaService;
  const audit = { record: jest.fn().mockResolvedValue(undefined) } as unknown as AuditService;
  const svc = new McpService(
    prisma,
    audit,
    {} as ClientsService,
    {} as IncomeTransactionsService,
    {} as PurchaseTransactionsService,
    {} as InvoicesService,
  );
  return { svc, prisma, audit };
}

describe("McpService — connector secret management", () => {
  const prevEnv = process.env.MCP_SHARED_SECRET;
  afterEach(() => {
    if (prevEnv === undefined) delete process.env.MCP_SHARED_SECRET;
    else process.env.MCP_SHARED_SECRET = prevEnv;
  });

  it("prefers the portal-stored secret over the env var", async () => {
    process.env.MCP_SHARED_SECRET = "env-secret-0123456789-0123456789-xx";
    const { svc } = build({ mcpSecret: STRONG });
    expect(await svc.resolveSecret()).toBe(STRONG);
    const dto = await svc.getConnector();
    expect(dto).toEqual({ enabled: true, source: "portal", secret: STRONG });
  });

  it("falls back to the env var when nothing is stored", async () => {
    process.env.MCP_SHARED_SECRET = "env-secret-0123456789-0123456789-xx";
    const { svc } = build({});
    expect(await svc.resolveSecret()).toBe(process.env.MCP_SHARED_SECRET);
    const dto = await svc.getConnector();
    expect(dto.enabled).toBe(true);
    expect(dto.source).toBe("environment");
  });

  it("a stored null disables the connector even with the env var set", async () => {
    process.env.MCP_SHARED_SECRET = "env-secret-0123456789-0123456789-xx";
    const { svc } = build({ mcpSecret: null });
    expect(await svc.resolveSecret()).toBeUndefined();
    expect(await svc.getConnector()).toEqual({ enabled: false, source: null, secret: null });
  });

  it("reports disabled when neither source has a strong secret", async () => {
    delete process.env.MCP_SHARED_SECRET;
    const { svc } = build({});
    expect((await svc.getConnector()).enabled).toBe(false);
  });

  it("rotate mints a strong secret, preserves other settings, and audits", async () => {
    const { svc, prisma, audit } = build({ theme: "navy" });
    const dto = await svc.rotateConnector(ADMIN);
    expect(dto.enabled).toBe(true);
    expect(dto.source).toBe("portal");
    expect(dto.secret!.length).toBeGreaterThanOrEqual(32);
    const written = (prisma.firm.update as jest.Mock).mock.calls[0]![0].data.settingsJson;
    expect(written.theme).toBe("navy"); // untouched sibling setting
    expect(written.mcpSecret).toBe(dto.secret);
    expect((audit.record as jest.Mock).mock.calls[0]![0]).toMatchObject({
      action: "mcp.connector.rotate",
      userId: "u1",
    });
  });

  it("disable stores null and audits", async () => {
    const { svc, prisma, audit } = build({ mcpSecret: STRONG });
    const dto = await svc.disableConnector(ADMIN);
    expect(dto).toEqual({ enabled: false, source: null, secret: null });
    const written = (prisma.firm.update as jest.Mock).mock.calls[0]![0].data.settingsJson;
    expect(written.mcpSecret).toBeNull();
    expect((audit.record as jest.Mock).mock.calls[0]![0]).toMatchObject({
      action: "mcp.connector.disable",
    });
  });

  it("swallows a DB failure and falls back to the env var (hermetic boot)", async () => {
    process.env.MCP_SHARED_SECRET = "env-secret-0123456789-0123456789-xx";
    const { svc, prisma } = build({});
    (prisma.firm.findFirst as jest.Mock).mockRejectedValue(new Error("no db"));
    expect(await svc.resolveSecret()).toBe(process.env.MCP_SHARED_SECRET);
  });
});
