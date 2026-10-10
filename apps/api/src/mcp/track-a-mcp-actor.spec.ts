/**
 * track-a-mcp-actor.spec.ts — MCP writes run as the firm's Super Admin (U4 R3,
 * D15, D41). Hermetic: a real MCP client talks to the real McpServer over an
 * in-memory transport; Prisma is an in-memory stub that answers the user and
 * audit-log queries from a fixture list, and refuses any query shape it does
 * not know (so a changed query fails here loudly instead of passing quietly).
 *
 *   T3  Who MCP acts as:
 *       - one Super Admin, created after a Manager: the Super Admin;
 *       - none: the first refusal, and nothing written;
 *       - two, with the newest connector-key rotation by the second: the second;
 *       - two, with no rotation: the second refusal;
 *       - a deactivated Super Admin, or a client-scoped grant, is never chosen;
 *       - the read tools keep working with no Super Admin at all.
 */
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

const FIRM_ID = "11111111-1111-4111-8111-111111111111";
const CLIENT_ID = "22222222-2222-4222-8222-222222222222";

/** The two refusals, worded exactly as the ruling (R3) gives them. */
const NO_SUPER_ADMIN =
  "MCP acts as the firm's Super Admin, and there is no active Super Admin.";
const SEVERAL_SUPER_ADMINS =
  "More than one active Super Admin. Issue the connector key from the Portal's MCP " +
  "Connector page as the Super Admin Claude should act as.";

interface FixtureUser {
  id: string;
  email: string;
  status: "ACTIVE" | "INVITED" | "DISABLED";
  userType: "FIRM" | "CLIENT";
  createdAt: Date;
  roles: Array<{ name: string; clientScopeId: string | null }>;
}

let seq = 0;
function user(
  key: string,
  roles: FixtureUser["roles"],
  over: Partial<FixtureUser> = {},
): FixtureUser {
  seq += 1;
  return {
    id: `${String(seq).padStart(8, "0")}-0000-4000-8000-${String(seq).padStart(12, "0")}`,
    email: `${key}@example.com`,
    status: "ACTIVE",
    userType: "FIRM",
    createdAt: new Date(Date.UTC(2026, 0, seq)),
    roles,
    ...over,
  };
}
const SUPER = [{ name: "Super Admin", clientScopeId: null }];
const MANAGER = [{ name: "Manager", clientScopeId: null }];

interface Rotation {
  userId: string | null;
  timestamp: Date;
}

/** Throws on a where-key the stub does not model, so a new query shape is noticed. */
function only(where: Record<string, unknown>, keys: string[], what: string): void {
  for (const k of Object.keys(where)) {
    if (!keys.includes(k)) throw new Error(`stub: ${what} does not model where.${k}`);
  }
}

function userMatches(u: FixtureUser, where: Record<string, unknown>): boolean {
  only(where, ["firmId", "userType", "status", "userRoles"], "user");
  if (where.firmId !== undefined && where.firmId !== FIRM_ID) return false;
  if (where.userType !== undefined && u.userType !== where.userType) return false;
  if (where.status !== undefined && u.status !== where.status) return false;
  if (where.userRoles !== undefined) {
    const some = (where.userRoles as { some?: Record<string, unknown> }).some;
    if (!some) throw new Error("stub: user.userRoles supports `some` only");
    only(some, ["clientScopeId", "role"], "userRoles.some");
    const role = (some.role ?? {}) as Record<string, unknown>;
    only(role, ["name", "scope"], "userRoles.some.role");
    return u.roles.some(
      (r) =>
        (!("clientScopeId" in some) || r.clientScopeId === some.clientScopeId) &&
        (role.name === undefined || r.name === role.name) &&
        (role.scope === undefined || role.scope === "FIRM"),
    );
  }
  return true;
}

function byCreatedAt(a: FixtureUser, b: FixtureUser) {
  return a.createdAt.getTime() - b.createdAt.getTime();
}

function prismaStub(users: FixtureUser[], rotations: Rotation[] = []) {
  const pick = (u: FixtureUser) => ({ id: u.id, email: u.email });
  return {
    firm: { findFirst: jest.fn(async () => ({ id: FIRM_ID, createdAt: new Date(0) })) },
    user: {
      findFirst: jest.fn(async ({ where }: { where: Record<string, unknown> }) => {
        const hit = users.filter((u) => userMatches(u, where)).sort(byCreatedAt)[0];
        return hit ? pick(hit) : null;
      }),
      findMany: jest.fn(async ({ where }: { where: Record<string, unknown> }) =>
        users
          .filter((u) => userMatches(u, where))
          .sort(byCreatedAt)
          .map(pick),
      ),
    },
    auditLog: {
      findFirst: jest.fn(
        async ({
          where,
          orderBy,
        }: {
          where: Record<string, unknown>;
          orderBy?: { timestamp?: "asc" | "desc" };
        }) => {
          only(where, ["action", "entityType", "entityId"], "auditLog");
          if (where.action !== "mcp.connector.rotate") return null;
          if (where.entityType !== "Firm" || where.entityId !== FIRM_ID) return null;
          // Like the database: rows come back in the order asked for, and in
          // insertion order (oldest first here) when no order is asked for.
          const rows = [...rotations];
          if (orderBy?.timestamp) {
            const sign = orderBy.timestamp === "desc" ? -1 : 1;
            rows.sort((a, b) => sign * (a.timestamp.getTime() - b.timestamp.getTime()));
          }
          const first = rows[0];
          return first ? { userId: first.userId } : null;
        },
      ),
    },
    client: {
      findFirst: jest.fn(async ({ where }: { where: { id: string } }) =>
        where.id === CLIENT_ID
          ? {
              id: CLIENT_ID,
              firmId: FIRM_ID,
              businessName: "Invented Test Client",
              status: "ACTIVE",
              taxType: "PERCENTAGE",
              billingParentId: null,
              billingMethod: "AS_FILING",
            }
          : null,
      ),
    },
    invoice: {
      count: jest.fn(async () => 2),
      findMany: jest.fn(async () =>
        ["BILL-2026-0001", "BILL-2026-0002"].map((number, i) => ({
          id: `inv-${i + 1}`,
          number,
          clientId: CLIENT_ID,
          client: { businessName: "Invented Test Client" },
          billedFor: null,
          description: "",
          issuedDate: new Date("2026-07-01T00:00:00.000Z"),
          dueDate: new Date("2026-07-31T00:00:00.000Z"),
          status: "Draft",
          subtotal: new Prisma.Decimal(1000),
          vat: new Prisma.Decimal(0),
          total: new Prisma.Decimal(1000),
          lineItems: [],
        })),
      ),
    },
    category: { findMany: jest.fn(async () => []) },
    chartAccount: { findMany: jest.fn(async () => []) },
  };
}

function servicesStub() {
  return {
    audit: { record: jest.fn().mockResolvedValue(undefined) },
    invoices: {
      create: jest.fn(async (actor: { id: string }) => ({
        id: "inv-new",
        number: "BILL-2026-0003",
        clientId: CLIENT_ID,
        clientName: "Invented Test Client",
        billedForClientId: null,
        billedForName: null,
        description: "",
        issuedDate: "2026-07-01",
        dueDate: "2026-07-31",
        status: "Draft",
        subtotal: "1000",
        vat: "0",
        total: "1000",
        lineItems: [],
        createdAt: "2026-07-01T00:00:00.000Z",
        updatedAt: "2026-07-01T00:00:00.000Z",
        actorId: actor.id,
      })),
    },
  };
}

async function connect(prisma: ReturnType<typeof prismaStub>, services = servicesStub()) {
  const service = new McpService(
    prisma as unknown as PrismaService,
    services.audit as unknown as AuditService,
    {} as unknown as ClientsService,
    {} as unknown as IncomeTransactionsService,
    {} as unknown as PurchaseTransactionsService,
    services.invoices as unknown as InvoicesService,
  );
  const server = service.buildServer();
  const client = new Client({ name: "u4-actor-test", version: "1.0.0" });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(st), client.connect(ct)]);
  return { client, services };
}

const createInvoice = (client: Client) =>
  client.callTool({
    name: "portal_create_invoice",
    arguments: {
      clientId: CLIENT_ID,
      lineItems: [{ description: "Bookkeeping", qty: 1, rate: 1000 }],
      issuedDate: "2026-07-01",
    },
  });

function text(res: unknown): string {
  return (res as { content?: { text?: string }[] }).content?.[0]?.text ?? "";
}

describe("U4 T3 · MCP writes run as the firm's Super Admin", () => {
  it("the earliest-created active firm user is a Manager and the Super Admin came later: the write runs as the Super Admin and is attributed to them", async () => {
    const manager = user("manager", MANAGER);
    const admin = user("admin", SUPER);
    const { client, services } = await connect(prismaStub([manager, admin]));
    const res = await createInvoice(client);
    expect(res.isError).toBeUndefined();
    expect(services.invoices.create).toHaveBeenCalledTimes(1);
    const actor = services.invoices.create.mock.calls[0]![0] as {
      id: string;
      email: string;
    };
    // The service writes its own audit row with this actor's id (invoice.create).
    expect(actor).toMatchObject({
      id: admin.id,
      email: admin.email,
      userType: "FIRM",
      firmId: FIRM_ID,
    });
    expect(actor.id).not.toBe(manager.id);
  });

  it("no active Super Admin: the first refusal, as a tool error, and nothing written", async () => {
    const { client, services } = await connect(prismaStub([user("manager", MANAGER)]));
    const res = await createInvoice(client);
    expect(res.isError).toBe(true);
    expect(text(res)).toBe(`Error: ${NO_SUPER_ADMIN}`);
    expect(services.invoices.create).not.toHaveBeenCalled();
    expect(services.audit.record).not.toHaveBeenCalled();
  });

  it("two Super Admins, the newest connector-key rotation by the second: the second", async () => {
    const first = user("admin-1", SUPER);
    const second = user("admin-2", SUPER);
    const rotations = [
      { userId: first.id, timestamp: new Date("2026-09-01T00:00:00.000Z") },
      { userId: second.id, timestamp: new Date("2026-10-01T00:00:00.000Z") },
    ];
    const { client, services } = await connect(prismaStub([first, second], rotations));
    const res = await createInvoice(client);
    expect(res.isError).toBeUndefined();
    expect((services.invoices.create.mock.calls[0]![0] as { id: string }).id).toBe(
      second.id,
    );
  });

  it("two Super Admins and no rotation: the second refusal, and nothing written", async () => {
    const { client, services } = await connect(
      prismaStub([user("admin-1", SUPER), user("admin-2", SUPER)]),
    );
    const res = await createInvoice(client);
    expect(res.isError).toBe(true);
    expect(text(res)).toBe(`Error: ${SEVERAL_SUPER_ADMINS}`);
    expect(services.invoices.create).not.toHaveBeenCalled();
  });

  it("a deactivated Super Admin is never chosen", async () => {
    // Earliest, and on the newest rotation, but disabled: the active one is chosen.
    const disabled = user("admin-old", SUPER, { status: "DISABLED" });
    const active = user("admin-now", SUPER);
    const a = await connect(
      prismaStub(
        [disabled, active],
        [{ userId: disabled.id, timestamp: new Date("2026-10-01T00:00:00.000Z") }],
      ),
    );
    expect((await createInvoice(a.client)).isError).toBeUndefined();
    expect((a.services.invoices.create.mock.calls[0]![0] as { id: string }).id).toBe(
      active.id,
    );

    // Two active Super Admins and the newest rotation by the disabled one: refused,
    // never the disabled one.
    const b = await connect(
      prismaStub(
        [disabled, user("admin-x", SUPER), user("admin-y", SUPER)],
        [{ userId: disabled.id, timestamp: new Date("2026-10-01T00:00:00.000Z") }],
      ),
    );
    const res = await createInvoice(b.client);
    expect(text(res)).toBe(`Error: ${SEVERAL_SUPER_ADMINS}`);
    expect(b.services.invoices.create).not.toHaveBeenCalled();

    // Alone and disabled: no active Super Admin.
    const c = await connect(prismaStub([disabled, user("manager", MANAGER)]));
    expect(text(await createInvoice(c.client))).toBe(`Error: ${NO_SUPER_ADMIN}`);
  });

  it("a Super Admin grant scoped to one client is not a firm Super Admin", async () => {
    const scoped = user("scoped-admin", [
      { name: "Super Admin", clientScopeId: CLIENT_ID },
    ]);
    const { client } = await connect(prismaStub([scoped, user("manager", MANAGER)]));
    expect(text(await createInvoice(client))).toBe(`Error: ${NO_SUPER_ADMIN}`);
  });

  it("portal_list_invoices still returns every billing of the firm, even with no Super Admin", async () => {
    const { client } = await connect(prismaStub([user("manager", MANAGER)]));
    const res = await client.callTool({ name: "portal_list_invoices", arguments: {} });
    expect(res.isError).toBeUndefined();
    const body = res.structuredContent as { invoices: Array<{ number: string }> };
    expect(body.invoices.map((i) => i.number)).toEqual([
      "BILL-2026-0001",
      "BILL-2026-0002",
    ]);
  });

  it("portal_list_transaction_categories (a read tool) keeps working with no Super Admin", async () => {
    const { client } = await connect(prismaStub([user("manager", MANAGER)]));
    const res = await client.callTool({
      name: "portal_list_transaction_categories",
      arguments: { clientId: CLIENT_ID },
    });
    expect(res.isError).toBeUndefined();
  });
});
