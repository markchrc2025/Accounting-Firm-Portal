/**
 * track-a-scope.db-spec.ts — billings and BIR forms for assigned clients only
 * (U4 R2, D14), proved through the real Nest app over HTTP against the local
 * PostgreSQL.
 *
 * T1  An invented firm with three clients: P (a parent), A (a sub-client billed
 *     to P) and B. Firm users:
 *       - the Super Admin;
 *       - Manager MA, assigned to A only;
 *       - Manager MP, assigned to P only.
 *     Every route under /invoices and /bir-forms that touches a client is called
 *     as MA:
 *       - B's rows never appear in a list;
 *       - every operation on a B record answers 403 with the guard's wording;
 *       - nothing B owns changes, read back through a second, freshly connected
 *         PrismaClient.
 *     A billing for A recorded under P is visible to MA and to MP. The Super Admin
 *     sees every row.
 *
 * The database is truncated once before the file and once after it (U3 R12); the
 * fixtures are built once and read across the tests. Every firm, client and user
 * is invented.
 */
import { randomUUID } from "node:crypto";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { PrismaClient } from "@prisma/client";
import request from "supertest";
import { Client as McpClient } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { ensureFirmRole, truncateAll, truncateOncePerFile } from "./helpers/truncate";
import { AppModule } from "../../src/app.module";
import { TokenService } from "../../src/auth/token.service";
import { McpService } from "../../src/mcp/mcp.service";
import { PrismaService } from "../../src/prisma/prisma.service";

// Super Admin and Manager, with the DEFAULT_ROLES grants, are the reference data
// this file reads (the helper's ensureFirmRole).
truncateOncePerFile({ firmRoles: ["Super Admin", "Manager"] });

const TAG = `track-a-scope-${randomUUID().slice(0, 8)}`;
const API = "/api/v1";

describe("U4 T1 · billings and BIR forms for assigned clients only (real app over HTTP, db)", () => {
  let app: INestApplication;
  let writer: PrismaService;
  let reader: PrismaClient;
  const tok = { sa: "", ma: "", mp: "", portal: "" };
  const client = { P: "", A: "", B: "" };
  const inv = { A: "", P: "", B: "" };
  const form = { draftA: "", draftB: "", filedA: "", filedB: "", exportB: "" };

  const http = () => request(app.getHttpServer());
  const get = (path: string, token: string) =>
    http().get(`${API}${path}`).set("Authorization", `Bearer ${token}`);
  const post = (path: string, token: string, body: object = {}) =>
    http().post(`${API}${path}`).set("Authorization", `Bearer ${token}`).send(body);
  const patch = (path: string, token: string, body: object) =>
    http().patch(`${API}${path}`).set("Authorization", `Bearer ${token}`).send(body);
  const ids = (body: unknown) => (body as Array<{ id: string }>).map((r) => r.id).sort();
  const denied = (perm: string, clientId: string) =>
    `Missing permission(s): ${perm} for client ${clientId}`;

  beforeAll(async () => {
    if (!process.env.DATABASE_URL) {
      throw new Error("DATABASE_URL is not set. Run `bash scripts/local-db.sh` first.");
    }
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
    const role = async (name: string) =>
      writer.role.findUniqueOrThrow({ where: { name_scope: { name, scope: "FIRM" } } });
    const superAdmin = await role("Super Admin");
    const manager = await role("Manager");
    const firmUser = async (key: string, roleId: string) => {
      const u = await writer.user.create({
        data: {
          firmId: firm.id,
          userType: "FIRM",
          fullName: `${TAG} ${key}`,
          email: `${TAG}-${key}@example.com`,
          status: "ACTIVE",
          firmProfile: { create: { title: "Test" } },
          userRoles: { create: { roleId } },
        },
      });
      return {
        id: u.id,
        token: tokens.signAccess({
          id: u.id,
          firmId: firm.id,
          userType: "FIRM",
          email: u.email,
        }),
      };
    };
    const sa = await firmUser("super-admin", superAdmin.id);
    const ma = await firmUser("manager-a", manager.id);
    const mp = await firmUser("manager-p", manager.id);
    tok.sa = sa.token;
    tok.ma = ma.token;
    tok.mp = mp.token;

    const mk = (name: string, tin: string, billingParentId?: string) =>
      writer.client.create({
        data: {
          firmId: firm.id,
          businessName: `${TAG} ${name}`,
          tin,
          taxType: "PERCENTAGE",
          ...(billingParentId ? { billingParentId } : {}),
        },
      });
    client.P = (await mk("Parent Holdings", "000000101")).id;
    client.A = (await mk("Sub-client Trading", "000000102", client.P)).id;
    client.B = (await mk("Unassigned Services", "000000103")).id;
    await writer.firmClientAssignment.createMany({
      data: [
        { firmUserId: ma.id, clientId: client.A },
        { firmUserId: mp.id, clientId: client.P },
      ],
    });

    // A client-portal user of A who HOLDS Billing:Read and BIRForms:Read (an invented
    // role), so only the CLIENT-principal refusal can stop it.
    const perm = (resource: string, action: string) =>
      writer.permission.findUniqueOrThrow({
        where: { resource_action: { resource, action } },
      });
    const portalRole = await writer.role.create({
      data: {
        name: `${TAG} portal reader`,
        scope: "CLIENT",
        rolePermissions: {
          create: [
            { permissionId: (await perm("Billing", "Read")).id },
            { permissionId: (await perm("BIRForms", "Read")).id },
          ],
        },
      },
    });
    const portalUser = await writer.user.create({
      data: {
        firmId: firm.id,
        userType: "CLIENT",
        fullName: `${TAG} portal user`,
        email: `${TAG}-portal@example.com`,
        status: "ACTIVE",
        // Unscoped, as POST /users/:id/roles can grant it (A5): only the CLIENT check stops it.
        userRoles: { create: { roleId: portalRole.id } },
      },
    });
    tok.portal = tokens.signAccess({
      id: portalUser.id,
      firmId: firm.id,
      userType: "CLIENT",
      email: portalUser.email,
      clientId: client.A,
    });

    // Billings, written through the API as the Super Admin. The clients carry no
    // email address, so nothing is ever mailed.
    const bill = async (clientId: string) => {
      const res = await post("/invoices", tok.sa, {
        clientId,
        description: "Monthly bookkeeping",
        issuedDate: "2026-08-01",
        dueDate: "2026-08-31",
        lineItems: [{ description: "Bookkeeping", qty: 1, rate: 5000, taxCode: "NONE" }],
      });
      expect(res.status).toBe(201);
      return res.body as {
        id: string;
        clientId: string;
        billedForClientId: string | null;
      };
    };
    const billA = await bill(client.A);
    // A sub-client's billing is recorded under its parent, billed for A.
    expect(billA).toMatchObject({ clientId: client.P, billedForClientId: client.A });
    inv.A = billA.id;
    inv.P = (await bill(client.P)).id;
    inv.B = (await bill(client.B)).id;

    // BIR forms: a draft of A and B through the API; a filed one of each written
    // directly (filing needs the full form), and one export of B's filed form.
    const draft = async (clientId: string) => {
      const res = await post("/bir-forms", tok.sa, {
        clientId,
        form: "2551Q",
        period: "2026-Q3",
        data: {},
      });
      expect(res.status).toBe(201);
      return (res.body as { id: string }).id;
    };
    form.draftA = await draft(client.A);
    form.draftB = await draft(client.B);
    const filed = (clientId: string) =>
      writer.birForm.create({
        data: {
          firmId: firm.id,
          clientId,
          form: "2551Q",
          period: "2026-Q2",
          status: "filed",
          filedAt: new Date("2026-07-20T02:00:00.000Z"),
          dataJson: {},
        },
      });
    form.filedA = (await filed(client.A)).id;
    form.filedB = (await filed(client.B)).id;
    form.exportB = (
      await writer.birFormExport.create({
        data: {
          birFormId: form.filedB,
          kind: "xml",
          storageKey: `test/${TAG}/2551Q.xml`,
          filename: "2551Q.xml",
        },
      })
    ).id;
  });

  afterAll(async () => {
    await reader.$disconnect();
    await app.close();
  });

  // --- billings ----------------------------------------------------------------

  it("GET /invoices as Manager A: A's billing (recorded under parent P), none of B's, not P's own", async () => {
    const res = await get("/invoices", tok.ma);
    expect(res.status).toBe(200);
    expect(ids(res.body)).toEqual([inv.A]);
  });

  it("GET /invoices?clientId=B as Manager A answers 403", async () => {
    const res = await get(`/invoices?clientId=${client.B}`, tok.ma);
    expect(res.status).toBe(403);
    expect(res.body.message).toBe(denied("Billing:Read", client.B));
  });

  it("GET /invoices/:id of B's billing as Manager A answers 403", async () => {
    const res = await get(`/invoices/${inv.B}`, tok.ma);
    expect(res.status).toBe(403);
    expect(res.body.message).toBe(denied("Billing:Read", client.B));
  });

  it("PATCH and POST /send on B's billing as Manager A answer 403, and the row is unchanged (fresh PrismaClient)", async () => {
    const before = await reader.invoice.findUniqueOrThrow({
      where: { id: inv.B },
      include: { lineItems: true },
    });
    const p = await patch(`/invoices/${inv.B}`, tok.ma, {
      description: "changed by an unassigned manager",
      lineItems: [{ description: "Changed", qty: 9, rate: 9, taxCode: "VAT12" }],
    });
    expect(p.status).toBe(403);
    expect(p.body.message).toBe(denied("Billing:Create", client.B));
    const s = await post(`/invoices/${inv.B}/send`, tok.ma);
    expect(s.status).toBe(403);
    expect(s.body.message).toBe(denied("Billing:Send", client.B));
    const after = await reader.invoice.findUniqueOrThrow({
      where: { id: inv.B },
      include: { lineItems: true },
    });
    expect(after).toEqual(before);
    expect(after.status).toBe("Draft");
  });

  it("POST /invoices for B as Manager A answers 403 and writes no row", async () => {
    const count = () => reader.invoice.count({ where: { clientId: client.B } });
    const n = await count();
    const res = await post("/invoices", tok.ma, {
      clientId: client.B,
      issuedDate: "2026-09-01",
      dueDate: "2026-09-30",
      lineItems: [{ description: "Bookkeeping", qty: 1, rate: 100 }],
    });
    expect(res.status).toBe(403);
    expect(res.body.message).toBe(denied("Billing:Create", client.B));
    expect(await count()).toBe(n);
  });

  it("a billing for sub-client A billed to parent P is visible to a Manager assigned only to A and to one assigned only to P", async () => {
    expect((await get(`/invoices/${inv.A}`, tok.ma)).status).toBe(200);
    expect((await get(`/invoices/${inv.A}`, tok.mp)).status).toBe(200);
    const mp = await get("/invoices", tok.mp);
    expect(mp.status).toBe(200);
    expect(ids(mp.body)).toEqual([inv.A, inv.P].sort());
    const maOfA = await get(`/invoices?clientId=${client.A}`, tok.ma);
    expect(ids(maOfA.body)).toEqual([inv.A]);
    // P's own billing is not A's: Manager A is refused it.
    const own = await get(`/invoices/${inv.P}`, tok.ma);
    expect(own.status).toBe(403);
    expect(own.body.message).toBe(denied("Billing:Read", client.P));
  });

  it("the Super Admin sees every billing", async () => {
    const res = await get("/invoices", tok.sa);
    expect(res.status).toBe(200);
    expect(ids(res.body)).toEqual([inv.A, inv.P, inv.B].sort());
    expect((await get(`/invoices/${inv.B}`, tok.sa)).status).toBe(200);
  });

  // --- BIR forms -----------------------------------------------------------------

  it("GET /bir-forms and /bir-forms/filed as Manager A: A's forms only", async () => {
    const list = await get("/bir-forms", tok.ma);
    expect(list.status).toBe(200);
    expect(ids(list.body)).toEqual([form.draftA, form.filedA].sort());
    const filed = await get("/bir-forms/filed", tok.ma);
    expect(filed.status).toBe(200);
    expect(ids(filed.body)).toEqual([form.filedA]);
  });

  it("GET /bir-forms?clientId=B and /bir-forms/filed?clientId=B as Manager A answer 403", async () => {
    for (const path of [
      `/bir-forms?clientId=${client.B}`,
      `/bir-forms/filed?clientId=${client.B}`,
    ]) {
      const res = await get(path, tok.ma);
      expect(res.status).toBe(403);
      expect(res.body.message).toBe(denied("BIRForms:Read", client.B));
    }
  });

  it("GET /bir-forms/:id of B's form as Manager A answers 403", async () => {
    const res = await get(`/bir-forms/${form.draftB}`, tok.ma);
    expect(res.status).toBe(403);
    expect(res.body.message).toBe(denied("BIRForms:Read", client.B));
  });

  it("POST /bir-forms for B as Manager A answers 403 and writes no row", async () => {
    const count = () => reader.birForm.count({ where: { clientId: client.B } });
    const n = await count();
    const res = await post("/bir-forms", tok.ma, {
      clientId: client.B,
      form: "2551Q",
      period: "2026-Q4",
    });
    expect(res.status).toBe(403);
    expect(res.body.message).toBe(denied("BIRForms:Create", client.B));
    expect(await count()).toBe(n);
  });

  it("PATCH B's draft as Manager A answers 403 and the row is unchanged (fresh PrismaClient)", async () => {
    const before = await reader.birForm.findUniqueOrThrow({ where: { id: form.draftB } });
    const res = await patch(`/bir-forms/${form.draftB}`, tok.ma, {
      period: "2026-Q1",
      data: { changed: true },
    });
    expect(res.status).toBe(403);
    expect(res.body.message).toBe(denied("BIRForms:Update", client.B));
    expect(
      await reader.birForm.findUniqueOrThrow({ where: { id: form.draftB } }),
    ).toEqual(before);
  });

  it("POST /bir-forms/:id/amend of B's filed return as Manager A answers 403 and creates no amendment", async () => {
    const res = await post(`/bir-forms/${form.filedB}/amend`, tok.ma);
    expect(res.status).toBe(403);
    expect(res.body.message).toBe(denied("BIRForms:Create", client.B));
    expect(await reader.birForm.count({ where: { amendsId: form.filedB } })).toBe(0);
  });

  it("POST /bir-forms/:id/export of B's form as Manager A answers 403 and stores no export", async () => {
    const count = () =>
      reader.birFormExport.count({
        where: { birFormId: { in: [form.draftB, form.filedB] } },
      });
    const n = await count();
    for (const id of [form.draftB, form.filedB]) {
      const res = await post(`/bir-forms/${id}/export`, tok.ma);
      expect(res.status).toBe(403);
      expect(res.body.message).toBe(denied("BIRForms:File", client.B));
    }
    expect(await count()).toBe(n);
  });

  it("GET the export URL of B's export as Manager A answers 403", async () => {
    const res = await get(
      `/bir-forms/${form.filedB}/exports/${form.exportB}/url`,
      tok.ma,
    );
    expect(res.status).toBe(403);
    expect(res.body.message).toBe(denied("BIRForms:Read", client.B));
  });

  it("Manager A still works on A: reads A's form and saves its draft", async () => {
    expect((await get(`/bir-forms/${form.filedA}`, tok.ma)).status).toBe(200);
    const res = await patch(`/bir-forms/${form.draftA}`, tok.ma, {
      data: { note: "edited by A's manager" },
    });
    expect(res.status).toBe(200);
    const back = await reader.birForm.findUniqueOrThrow({ where: { id: form.draftA } });
    expect(back.dataJson).toEqual({ note: "edited by A's manager" });
  });

  it("the Super Admin sees every BIR form", async () => {
    const list = await get("/bir-forms", tok.sa);
    expect(ids(list.body)).toEqual(
      [form.draftA, form.draftB, form.filedA, form.filedB].sort(),
    );
    const filed = await get("/bir-forms/filed", tok.sa);
    expect(ids(filed.body)).toEqual([form.filedA, form.filedB].sort());
    expect((await get(`/bir-forms/${form.draftB}`, tok.sa)).status).toBe(200);
  });

  it("a client-portal user stays refused on both resources (firm-level check)", async () => {
    for (const path of [
      "/invoices",
      "/bir-forms",
      `/invoices/${inv.A}`,
      `/bir-forms/${form.draftA}`,
    ]) {
      expect((await get(path, tok.portal)).status).toBe(403);
    }
  });
});

/**
 * T2  Two firms never meet (U4 R4). Firm F2's Super Admin (Clients:ViewAll) calls
 *     every route whose path carries :clientId — enumerated from the running app's
 *     router, not from a list kept here — with a client of firm F1:
 *       - each answers 403 or 404;
 *       - every table's row count is the same before and after.
 *     F1's billing and BIR form, asked for by id, answer 404.
 */
describe("U4 T2 · two firms never meet (real app over HTTP, db)", () => {
  let app: INestApplication;
  let writer: PrismaService;
  let token = "";
  const f1 = { client: "", invoice: "", form: "" };
  /** Any other path parameter: an id that names no row. */
  const OTHER_ID = "99999999-9999-4999-8999-999999999999";

  const http = () => request(app.getHttpServer());

  /** Every route of the running app, as Express registered it. */
  function routes(): Array<{ method: string; path: string }> {
    const instance = app.getHttpAdapter().getInstance() as {
      _router?: { stack: unknown[] };
      router?: { stack: unknown[] };
    };
    const stack = (instance._router ?? instance.router)?.stack ?? [];
    const out: Array<{ method: string; path: string }> = [];
    for (const layer of stack as Array<{
      route?: { path: string; methods: Record<string, boolean> };
    }>) {
      if (!layer.route) continue;
      for (const [m, on] of Object.entries(layer.route.methods)) {
        if (on && m !== "_all")
          out.push({ method: m.toUpperCase(), path: layer.route.path });
      }
    }
    return out;
  }

  /** Row count of every table but _prisma_migrations. */
  async function rowCounts(): Promise<Record<string, number>> {
    const tables = await writer.$queryRawUnsafe<Array<{ relname: string }>>(
      `SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind IN ('r','p') AND c.relname <> '_prisma_migrations'
        ORDER BY c.relname`,
    );
    const out: Record<string, number> = {};
    for (const { relname } of tables) {
      const [row] = await writer.$queryRawUnsafe<Array<{ n: bigint }>>(
        `SELECT COUNT(*)::bigint AS n FROM "${relname.replace(/"/g, '""')}"`,
      );
      out[relname] = Number(row?.n ?? 0);
    }
    return out;
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix("api/v1");
    await app.init();
    writer = app.get(PrismaService);
    const superAdmin = await writer.role.findUniqueOrThrow({
      where: { name_scope: { name: "Super Admin", scope: "FIRM" } },
    });

    // F1: a client with a billing and a BIR form. Nobody of F1 makes a call.
    const firm1 = await writer.firm.create({
      data: { name: `${TAG} First Invented Firm` },
    });
    const c1 = await writer.client.create({
      data: {
        firmId: firm1.id,
        businessName: `${TAG} F1 Client`,
        tin: "000000201",
        taxType: "VAT",
      },
    });
    f1.client = c1.id;
    f1.invoice = (
      await writer.invoice.create({
        data: {
          firmId: firm1.id,
          clientId: c1.id,
          number: `BILL-2026-${TAG.slice(-4)}`,
          issuedDate: new Date("2026-08-01T00:00:00.000Z"),
          dueDate: new Date("2026-08-31T00:00:00.000Z"),
          subtotal: 1000,
          vat: 0,
          total: 1000,
        },
      })
    ).id;
    f1.form = (
      await writer.birForm.create({
        data: {
          firmId: firm1.id,
          clientId: c1.id,
          form: "2550Q",
          period: "2026-Q3",
          dataJson: {},
        },
      })
    ).id;

    // F2: its Super Admin is the caller.
    const firm2 = await writer.firm.create({
      data: { name: `${TAG} Second Invented Firm` },
    });
    const sa2 = await writer.user.create({
      data: {
        firmId: firm2.id,
        userType: "FIRM",
        fullName: `${TAG} F2 super admin`,
        email: `${TAG}-f2-admin@example.com`,
        status: "ACTIVE",
        firmProfile: { create: { title: "Test" } },
        userRoles: { create: { roleId: superAdmin.id } },
      },
    });
    token = app.get(TokenService).signAccess({
      id: sa2.id,
      firmId: firm2.id,
      userType: "FIRM",
      email: sa2.email,
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it("every :clientId route, called by F2's Super Admin with F1's client, answers 403 or 404 and changes no row", async () => {
    const targets = routes().filter((r) => r.path.includes(":clientId"));
    expect(targets.length).toBeGreaterThan(0);
    const before = await rowCounts();
    const results: string[] = [];
    for (const r of targets) {
      const url = r.path
        .replace(/:clientId\b/g, f1.client)
        .replace(/:[A-Za-z_]+/g, OTHER_ID);
      const req = http()
        [r.method.toLowerCase() as "get" | "post" | "patch" | "put" | "delete"](url)
        .set("Authorization", `Bearer ${token}`);
      const res = ["POST", "PATCH", "PUT"].includes(r.method)
        ? await req.send({})
        : await req;
      results.push(`${res.status} ${r.method} ${r.path}`);
    }
    // The enumerated list and each answer, for the report.
    console.log(`T2: ${targets.length} routes carry :clientId\n${results.join("\n")}`);
    const after = await rowCounts();
    expect(after).toEqual(before);
    const wrong = results.filter((line) => !/^(403|404) /.test(line));
    expect(wrong).toEqual([]);
  });

  it("GET /invoices/:id and GET /bir-forms/:id with F1's ids answer 404 to F2's Super Admin", async () => {
    const inv = await http()
      .get(`${API}/invoices/${f1.invoice}`)
      .set("Authorization", `Bearer ${token}`);
    expect(inv.status).toBe(404);
    const form = await http()
      .get(`${API}/bir-forms/${f1.form}`)
      .set("Authorization", `Bearer ${token}`);
    expect(form.status).toBe(404);
  });
});

/**
 * T3 (db cross-check) — T3 itself is hermetic (src/mcp/track-a-mcp-actor.spec.ts);
 * this runs MCP's choice of principal against PostgreSQL, so the role filter and
 * the newest-rotation lookup are proved on the real schema. MCP serves the first
 * firm by creation (D4), so this block starts from an empty database of its own.
 */
describe("U4 T3 (db cross-check) · MCP writes run as the Super Admin", () => {
  let app: INestApplication;
  let writer: PrismaService;
  let mcp: McpService;
  let firmId = "";
  let clientId = "";
  const users = { manager: "", admin1: "", admin2: "" };

  async function createInvoice(): Promise<{ isError?: boolean; text: string }> {
    const server = mcp.buildServer();
    const client = new McpClient({ name: "u4-db-check", version: "1.0.0" });
    const [ct, st] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(st), client.connect(ct)]);
    const res = await client.callTool({
      name: "portal_create_invoice",
      arguments: {
        clientId,
        lineItems: [{ description: "Bookkeeping", qty: 1, rate: 1000 }],
        issuedDate: "2026-09-01",
      },
    });
    await client.close();
    const content = res.content as Array<{ text?: string }>;
    return { isError: res.isError as boolean | undefined, text: content[0]?.text ?? "" };
  }

  /** The user the newest invoice.create audit row is attributed to. */
  async function lastInvoiceAuthor(): Promise<string | null> {
    const row = await writer.auditLog.findFirst({
      where: { action: "invoice.create" },
      orderBy: { timestamp: "desc" },
      select: { userId: true },
    });
    return row?.userId ?? null;
  }

  beforeAll(async () => {
    await truncateAll();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    writer = app.get(PrismaService);
    mcp = app.get(McpService);
    await ensureFirmRole("Super Admin");
    await ensureFirmRole("Manager");
    const role = async (name: string) =>
      writer.role.findUniqueOrThrow({ where: { name_scope: { name, scope: "FIRM" } } });
    const firm = await writer.firm.create({ data: { name: `${TAG} MCP Invented Firm` } });
    firmId = firm.id;
    const mk = async (key: string, roleName: string, createdAt: string) =>
      (
        await writer.user.create({
          data: {
            firmId,
            userType: "FIRM",
            fullName: `${TAG} ${key}`,
            email: `${TAG}-mcp-${key}@example.com`,
            status: "ACTIVE",
            createdAt: new Date(createdAt),
            firmProfile: { create: { title: "Test" } },
            userRoles: { create: { roleId: (await role(roleName)).id } },
          },
        })
      ).id;
    // The Manager is the earliest-created active firm user; the Super Admin came later.
    users.manager = await mk("manager", "Manager", "2026-01-01T00:00:00.000Z");
    users.admin1 = await mk("admin-1", "Super Admin", "2026-02-01T00:00:00.000Z");
    clientId = (
      await writer.client.create({
        data: {
          firmId,
          businessName: `${TAG} MCP Client`,
          tin: "000000301",
          taxType: "VAT",
        },
      })
    ).id;
  });

  afterAll(async () => {
    await app.close();
  });

  it("one Super Admin, created after a Manager: the billing's audit row is the Super Admin's", async () => {
    const res = await createInvoice();
    expect(res.isError).toBeUndefined();
    expect(await lastInvoiceAuthor()).toBe(users.admin1);
  });

  it("a second Super Admin and no rotation: refused, nothing written; the newest rotation decides: the second, then the first after it rotates again", async () => {
    const superAdmin = await writer.role.findUniqueOrThrow({
      where: { name_scope: { name: "Super Admin", scope: "FIRM" } },
    });
    users.admin2 = (
      await writer.user.create({
        data: {
          firmId,
          userType: "FIRM",
          fullName: `${TAG} admin-2`,
          email: `${TAG}-mcp-admin-2@example.com`,
          status: "ACTIVE",
          firmProfile: { create: { title: "Test" } },
          userRoles: { create: { roleId: superAdmin.id } },
        },
      })
    ).id;
    const count = () => writer.invoice.count({ where: { firmId } });
    const n = await count();
    const refused = await createInvoice();
    expect(refused.isError).toBe(true);
    expect(refused.text).toBe(
      "Error: More than one active Super Admin. Issue the connector key from the Portal's " +
        "MCP Connector page as the Super Admin Claude should act as.",
    );
    expect(await count()).toBe(n);

    await mcp.rotateConnector({
      id: users.admin2,
      firmId,
      userType: "FIRM",
      email: `${TAG}-mcp-admin-2@example.com`,
    });
    const res = await createInvoice();
    expect(res.isError).toBeUndefined();
    expect(await lastInvoiceAuthor()).toBe(users.admin2);

    // Two rotation rows now: the NEWEST decides. admin-1 rotates after admin-2.
    await new Promise((r) => setTimeout(r, 20));
    await mcp.rotateConnector({
      id: users.admin1,
      firmId,
      userType: "FIRM",
      email: `${TAG}-mcp-admin-1@example.com`,
    });
    expect(
      await writer.auditLog.count({
        where: { action: "mcp.connector.rotate", entityId: firmId },
      }),
    ).toBe(2);
    expect((await createInvoice()).isError).toBeUndefined();
    expect(await lastInvoiceAuthor()).toBe(users.admin1);
  });

  it("every Super Admin deactivated: the first refusal", async () => {
    await writer.user.updateMany({
      where: { id: { in: [users.admin1, users.admin2] } },
      data: { status: "DISABLED" },
    });
    const res = await createInvoice();
    expect(res.text).toBe(
      "Error: MCP acts as the firm's Super Admin, and there is no active Super Admin.",
    );
  });
});
