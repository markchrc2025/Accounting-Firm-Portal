/**
 * track-a-scope-routes.db-spec.ts — every client-owned route obeys assignment
 * (U4-A1 R1, D42), and a user's assignments can be read (R2). The real Nest app
 * over HTTP against the local PostgreSQL; the object store is a fake (this VM
 * has no bucket) holding one COR per client. Every firm, client and user is
 * invented. Writes are read back through a second, freshly connected PrismaClient.
 *
 * T1  Clients A and B of one firm:
 *     - a Manager assigned to A only;
 *     - an Accountant assigned to A only;
 *     - a user holding Roles:Assign without Clients:ViewAll;
 *     - the Super Admin.
 *     Every route U4's A2 listed is called as the assigned users.
 * T2  GET /users/:id/clients, the assign-clients response, and assignedClientCount.
 */
import { randomUUID } from "node:crypto";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { PrismaClient } from "@prisma/client";
import request from "supertest";
import { truncateOncePerFile } from "./helpers/truncate";
import { AppModule } from "../../src/app.module";
import { TokenService } from "../../src/auth/token.service";
import { PrismaService } from "../../src/prisma/prisma.service";
import { StorageService } from "../../src/storage/storage.service";

truncateOncePerFile({ firmRoles: ["Super Admin", "Manager", "Accountant"] });

const TAG = `track-a-routes-${randomUUID().slice(0, 8)}`;
const API = "/api/v1";

describe("U4-A1 · every client-owned route obeys assignment (real app over HTTP, db)", () => {
  let app: INestApplication;
  let writer: PrismaService;
  let reader: PrismaClient;
  let firmId = "";
  const tok = { sa: "", ma: "", acc: "", assigner: "", reader: "", other: "" };
  const id = { sa: "", ma: "", acc: "", assigner: "", portal: "", otherUser: "" };
  const client = { A: "", B: "", A2: "", other: "" };
  const fs = { A: "", B: "", none: "" };
  let otherFirmTxn = "";
  const signed: string[] = [];

  const http = () => request(app.getHttpServer());
  const call = (
    method: "get" | "post" | "patch" | "put" | "delete",
    path: string,
    token: string,
  ) => http()[method](`${API}${path}`).set("Authorization", `Bearer ${token}`);

  beforeAll(async () => {
    const fakeStorage = {
      isEnabled: () => true,
      listObjects: async (prefix: string) =>
        [client.A, client.B].map((c) => ({
          key: `${prefix}${c}`,
          size: 10,
          lastModified: null,
        })),
      signedGetUrl: async (key: string) => {
        signed.push(key);
        return `https://signed.example/${key}`;
      },
    };
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(StorageService)
      .useValue(fakeStorage)
      .compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix("api/v1");
    await app.init();
    writer = app.get(PrismaService);
    reader = new PrismaClient();
    const tokens = app.get(TokenService);

    const firm = await writer.firm.create({
      data: { name: `${TAG} Halimbawa Accounting` },
    });
    firmId = firm.id;
    const roleId = async (name: string) =>
      (
        await writer.role.findUniqueOrThrow({
          where: { name_scope: { name, scope: "FIRM" } },
        })
      ).id;
    const perm = async (resource: string, action: string) =>
      (
        await writer.permission.findUniqueOrThrow({
          where: { resource_action: { resource, action } },
        })
      ).id;
    // Invented roles: one that assigns clients without Clients:ViewAll, one that
    // reads users without Clients:ViewAll.
    const assignerRole = await writer.role.create({
      data: {
        name: `${TAG} assigner`,
        scope: "FIRM",
        rolePermissions: { create: [{ permissionId: await perm("Roles", "Assign") }] },
      },
    });
    const readerRole = await writer.role.create({
      data: {
        name: `${TAG} user reader`,
        scope: "FIRM",
        rolePermissions: {
          create: [
            { permissionId: await perm("Users", "Read") },
            { permissionId: await perm("Users", "Update") },
            { permissionId: await perm("Users", "Delete") },
          ],
        },
      },
    });
    const firmUser = async (key: string, role: string, firm = firmId) => {
      const u = await writer.user.create({
        data: {
          firmId: firm,
          userType: "FIRM",
          fullName: `${TAG} ${key}`,
          email: `${TAG}-${key}@example.com`,
          status: "ACTIVE",
          firmProfile: { create: { title: "Test" } },
          userRoles: { create: { roleId: role } },
        },
      });
      return {
        id: u.id,
        token: tokens.signAccess({
          id: u.id,
          firmId: firm,
          userType: "FIRM",
          email: u.email,
        }),
      };
    };
    const sa = await firmUser("super-admin", await roleId("Super Admin"));
    const ma = await firmUser("manager", await roleId("Manager"));
    const acc = await firmUser("accountant", await roleId("Accountant"));
    const assigner = await firmUser("assigner", assignerRole.id);
    const usersReader = await firmUser("user-reader", readerRole.id);
    Object.assign(tok, {
      sa: sa.token,
      ma: ma.token,
      acc: acc.token,
      assigner: assigner.token,
      reader: usersReader.token,
    });
    Object.assign(id, { sa: sa.id, ma: ma.id, acc: acc.id, assigner: assigner.id });

    const mk = (firm: string, name: string, tin: string) =>
      writer.client.create({
        data: {
          firmId: firm,
          businessName: `${TAG} ${name}`,
          tin,
          taxType: "PERCENTAGE",
        },
      });
    client.A = (await mk(firmId, "Alpha Assigned Trading", "000000401")).id;
    client.B = (await mk(firmId, "Bravo Unassigned Services", "000000402")).id;
    client.A2 = (await mk(firmId, "Aardvark Second Assigned", "000000403")).id;
    await writer.firmClientAssignment.createMany({
      data: [
        { firmUserId: ma.id, clientId: client.A },
        { firmUserId: acc.id, clientId: client.A },
      ],
    });

    // A client-portal user of B.
    const portal = await writer.user.create({
      data: {
        firmId,
        userType: "CLIENT",
        fullName: `${TAG} portal user`,
        email: `${TAG}-portal@example.com`,
        status: "ACTIVE",
        clientProfile: { create: { clientId: client.B, clientRole: "OWNER" } },
      },
    });
    id.portal = portal.id;

    // Money: A earns 1,000 and spends 300; B earns 5,000 and spends 700.
    for (const [c, inc, exp] of [
      [client.A, 1000, 300],
      [client.B, 5000, 700],
    ] as const) {
      const ic = await writer.category.create({
        data: { clientId: c, type: "INCOME", name: `${TAG} sales` },
      });
      const ec = await writer.category.create({
        data: { clientId: c, type: "EXPENSE", name: `${TAG} supplies` },
      });
      const txnDate = new Date();
      await writer.incomeTransaction.create({
        data: {
          clientId: c,
          categoryId: ic.id,
          txnDate,
          description: "Sale",
          netAmount: inc,
          vatClass: "NON_VAT",
          source: "manual",
        },
      });
      await writer.purchaseTransaction.create({
        data: {
          clientId: c,
          categoryId: ec.id,
          txnDate,
          description: "Supplies",
          netAmount: exp,
          source: "manual",
        },
      });
    }

    // FS reports: one for A, one for B, one linked to no client.
    const report = async (clientId: string | null, name: string) =>
      (
        await writer.fsReport.create({
          data: { firmId, clientId, entityName: `${TAG} ${name}`, createdById: sa.id },
        })
      ).id;
    fs.A = await report(client.A, "Alpha FS");
    fs.B = await report(client.B, "Bravo FS");
    fs.none = await report(null, "Unlinked FS");

    // Another firm: its client, a held expense of it, and its user.
    const other = await writer.firm.create({
      data: { name: `${TAG} Other Invented Firm` },
    });
    client.other = (await mk(other.id, "Other Firm Client", "000000404")).id;
    const oc = await writer.category.create({
      data: { clientId: client.other, type: "EXPENSE", name: `${TAG} x` },
    });
    otherFirmTxn = (
      await writer.purchaseTransaction.create({
        data: {
          clientId: client.other,
          categoryId: oc.id,
          txnDate: new Date("2026-08-01T00:00:00.000Z"),
          description: "Held",
          netAmount: 10,
          source: "import",
          status: "held",
        },
      })
    ).id;
    const otherUser = await firmUser(
      "other-firm-user",
      await roleId("Manager"),
      other.id,
    );
    id.otherUser = otherUser.id;
    tok.other = otherUser.token;
  });

  afterAll(async () => {
    await reader.$disconnect();
    await app.close();
  });

  // --- financial statements ---------------------------------------------------

  it("FS: the Manager's list shows A's report and the unlinked one, none of B's", async () => {
    const res = await call("get", "/fs/reports", tok.ma);
    expect(res.status).toBe(200);
    const ids = (res.body as Array<{ id: string }>).map((r) => r.id).sort();
    expect(ids).toEqual([fs.A, fs.none].sort());
  });

  it("FS: the Manager reading or exporting B's report answers 403; A's answers 200", async () => {
    for (const path of [
      `/fs/reports/${fs.B}`,
      `/fs/reports/${fs.B}/trial-balance`,
      `/fs/reports/${fs.B}/export`,
    ]) {
      const res = await call("get", path, tok.ma);
      expect(res.status).toBe(403);
      expect(res.body.message).toBe(
        `Missing permission(s): Clients:ViewAll for client ${client.B}`,
      );
    }
    expect((await call("get", `/fs/reports/${fs.A}`, tok.ma)).status).toBe(200);
  });

  it("FS: an Accountant assigned to A only gets 403 on writes to B's report, and nothing changes", async () => {
    const before = await reader.fsReport.findUniqueOrThrow({ where: { id: fs.B } });
    const p = await call("patch", `/fs/reports/${fs.B}`, tok.acc).send({
      entityName: "changed",
    });
    expect(p.status).toBe(403);
    expect(p.body.message).toBe(
      `Missing permission(s): FinancialStatements:Manage for client ${client.B}`,
    );
    expect((await call("delete", `/fs/reports/${fs.B}`, tok.acc)).status).toBe(403);
    const created = await call("post", "/fs/reports", tok.acc).send({
      clientId: client.B,
      periods: [{ label: "FY2026", endDate: "2026-12-31" }],
    });
    expect(created.status).toBe(403);
    expect(await reader.fsReport.findUniqueOrThrow({ where: { id: fs.B } })).toEqual(
      before,
    );
    expect(await reader.fsReport.count({ where: { clientId: client.B } })).toBe(1);
    // A's report stays writable for the Accountant.
    const ok = await call("patch", `/fs/reports/${fs.A}`, tok.acc).send({
      entityName: `${TAG} Alpha FS renamed`,
    });
    expect(ok.status).toBe(200);
  });

  // --- COR files --------------------------------------------------------------

  it("GET /files lists A's COR and none of B's; /files/url with B's key answers 403", async () => {
    const list = await call("get", "/files", tok.ma);
    expect(list.status).toBe(200);
    expect(
      (list.body.files as Array<{ clientId: string }>).map((f) => f.clientId),
    ).toEqual([client.A]);
    const keyB = `${firmId}/${client.B}`;
    const url = await call("get", `/files/url?key=${encodeURIComponent(keyB)}`, tok.ma);
    expect(url.status).toBe(403);
    expect(url.body.message).toBe(
      `Missing permission(s): Clients:Read for client ${client.B}`,
    );
    expect(signed).not.toContain(keyB);
    expect(
      (
        await call(
          "get",
          `/files/url?key=${encodeURIComponent(`${firmId}/${client.A}`)}`,
          tok.ma,
        )
      ).status,
    ).toBe(200);
  });

  // --- dashboard --------------------------------------------------------------

  it("GET /dashboard for the Manager: totals are A's alone; no firm activity", async () => {
    const res = await call("get", "/dashboard", tok.ma);
    expect(res.status).toBe(200);
    const kpi = (label: string) =>
      (res.body.kpis as Array<{ label: string; value: number }>).find(
        (k) => k.label === label,
      )?.value;
    expect(kpi("Portfolio income")).toBe(1000);
    expect(kpi("Portfolio expenses")).toBe(300);
    expect(kpi("Active clients")).toBe(1);
    expect(res.body.regimeMix).toEqual({ vat: 0, percentage: 1, exempt: 0 });
    expect(res.body.recentActivity).toEqual([]);
    expect(
      (res.body.upcomingFilings as Array<{ client: string }>).map((f) => f.client),
    ).toEqual([`${TAG} Alpha Assigned Trading`]);
    const sa = await call("get", "/dashboard", tok.sa);
    expect(
      (sa.body.kpis as Array<{ label: string; value: number }>).find(
        (k) => k.label === "Portfolio income",
      )?.value,
    ).toBe(6000);
  });

  // --- audit log --------------------------------------------------------------

  it("GET /audit-logs answers 403 to the Manager and 200 to the Super Admin", async () => {
    const m = await call("get", "/audit-logs", tok.ma);
    expect(m.status).toBe(403);
    expect(m.body.message).toBe("Missing permission(s): AuditLogs:Read, Clients:ViewAll");
    expect((await call("get", "/audit-logs", tok.sa)).status).toBe(200);
  });

  // --- clients and billing parents ---------------------------------------------

  it("POST /clients with billingParentId B answers 403, and no row is written", async () => {
    const name = `${TAG} Charlie Under Bravo`;
    const res = await call("post", "/clients", tok.ma).send({
      businessName: name,
      billingParentId: client.B,
    });
    expect(res.status).toBe(403);
    expect(res.body.message).toBe(
      `Missing permission(s): Clients:Create for client ${client.B}`,
    );
    expect(await reader.client.count({ where: { businessName: name } })).toBe(0);
  });

  it("a client the Manager creates is assigned to them and appears in their GET /clients", async () => {
    const name = `${TAG} Delta Created By Manager`;
    const res = await call("post", "/clients", tok.ma).send({
      businessName: name,
      billingParentId: client.A,
    });
    expect(res.status).toBe(201);
    const created = res.body as { id: string };
    const assignment = await reader.firmClientAssignment.findUnique({
      where: { firmUserId_clientId: { firmUserId: id.ma, clientId: created.id } },
    });
    expect(assignment).not.toBeNull();
    const list = await call("get", "/clients", tok.ma);
    expect((list.body as Array<{ id: string }>).map((c) => c.id)).toContain(created.id);
  });

  it("PATCH /clients/A with billingParentId B answers 403, and A is unchanged", async () => {
    const before = await reader.client.findUniqueOrThrow({ where: { id: client.A } });
    const res = await call("patch", `/clients/${client.A}`, tok.ma).send({
      billingParentId: client.B,
    });
    expect(res.status).toBe(403);
    expect(res.body.message).toBe(
      `Missing permission(s): Clients:Update for client ${client.B}`,
    );
    expect(await reader.client.findUniqueOrThrow({ where: { id: client.A } })).toEqual(
      before,
    );
  });

  // --- users and assignment -----------------------------------------------------

  it("a user holding Roles:Assign without Clients:ViewAll gets 403 from assign-clients, and nothing is written", async () => {
    const res = await call(
      "post",
      `/users/${id.assigner}/assign-clients`,
      tok.assigner,
    ).send({ clientIds: [client.B] });
    expect(res.status).toBe(403);
    expect(res.body.message).toBe("Missing permission(s): Roles:Assign, Clients:ViewAll");
    expect(
      await reader.firmClientAssignment.count({ where: { firmUserId: id.assigner } }),
    ).toBe(0);
  });

  it("a portal user of an unseen client: reading, changing or deleting them answers 403", async () => {
    // The user-reader holds Users:Read, Update and Delete but sees no client, so B's
    // portal user is out of reach on all three; the row is unchanged.
    const before = await reader.user.findUniqueOrThrow({ where: { id: id.portal } });
    const r = await call("get", `/users/${id.portal}`, tok.reader);
    expect(r.status).toBe(403);
    expect(r.body.message).toBe(
      `Missing permission(s): Users:Read for client ${client.B}`,
    );
    const u = await call("patch", `/users/${id.portal}`, tok.reader).send({
      fullName: "changed",
    });
    expect(u.status).toBe(403);
    expect(u.body.message).toBe(
      `Missing permission(s): Users:Update for client ${client.B}`,
    );
    const d = await call("delete", `/users/${id.portal}`, tok.reader);
    expect(d.status).toBe(403);
    expect(d.body.message).toBe(
      `Missing permission(s): Users:Delete for client ${client.B}`,
    );
    expect(await reader.user.findUniqueOrThrow({ where: { id: id.portal } })).toEqual(
      before,
    );
    expect((await call("get", `/users/${id.portal}`, tok.sa)).status).toBe(200);
  });

  // --- postHeld -----------------------------------------------------------------

  it("postHeld with another firm's transaction id answers exactly as a missing id does", async () => {
    const other = await call(
      "post",
      `/purchase-transactions/${otherFirmTxn}/post`,
      tok.sa,
    );
    const missing = await call(
      "post",
      `/purchase-transactions/${randomUUID()}/post`,
      tok.sa,
    );
    expect(missing.status).toBe(404);
    expect(other.status).toBe(missing.status);
    expect(other.body).toEqual(missing.body);
    const back = await reader.purchaseTransaction.findUniqueOrThrow({
      where: { id: otherFirmTxn },
    });
    expect(back.status).toBe("held");
  });

  // --- T2: assignments can be read -------------------------------------------------

  describe("T2 · GET /users/:id/clients, assign-clients, assignedClientCount", () => {
    it("assign-clients (Super Admin) replaces the set and returns { userId, clients } sorted by businessName", async () => {
      const res = await call("post", `/users/${id.acc}/assign-clients`, tok.sa).send({
        clientIds: [client.A, client.A2],
      });
      expect(res.status).toBe(201);
      expect(res.body).toEqual({
        userId: id.acc,
        clients: [
          { id: client.A2, businessName: `${TAG} Aardvark Second Assigned` },
          { id: client.A, businessName: `${TAG} Alpha Assigned Trading` },
        ],
      });
      expect(
        await reader.firmClientAssignment.count({ where: { firmUserId: id.acc } }),
      ).toBe(2);
    });

    it("GET /users/:id/clients has the same shape and order", async () => {
      const res = await call("get", `/users/${id.acc}/clients`, tok.sa);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        userId: id.acc,
        clients: [
          { id: client.A2, businessName: `${TAG} Aardvark Second Assigned` },
          { id: client.A, businessName: `${TAG} Alpha Assigned Trading` },
        ],
      });
    });

    it("GET /users/:id/clients: 403 without Clients:ViewAll, 404 for another firm's user, 400 for a CLIENT user", async () => {
      const denied = await call("get", `/users/${id.acc}/clients`, tok.reader);
      expect(denied.status).toBe(403);
      expect(denied.body.message).toBe(
        "Missing permission(s): Users:Read, Clients:ViewAll",
      );
      expect((await call("get", `/users/${id.otherUser}/clients`, tok.sa)).status).toBe(
        404,
      );
      expect((await call("get", `/users/${randomUUID()}/clients`, tok.sa)).status).toBe(
        404,
      );
      const portal = await call("get", `/users/${id.portal}/clients`, tok.sa);
      expect(portal.status).toBe(400);
      expect(portal.body.message).toBe("Only firm users are assigned clients.");
    });

    it("assign-clients with a client of another firm answers 400 and writes nothing", async () => {
      const before = await reader.firmClientAssignment.findMany({
        where: { firmUserId: id.acc },
        orderBy: { clientId: "asc" },
      });
      const res = await call("post", `/users/${id.acc}/assign-clients`, tok.sa).send({
        clientIds: [client.A, client.other],
      });
      expect(res.status).toBe(400);
      expect(
        await reader.firmClientAssignment.findMany({
          where: { firmUserId: id.acc },
          orderBy: { clientId: "asc" },
        }),
      ).toEqual(before);
    });

    it("GET /users carries assignedClientCount on every firm user", async () => {
      const res = await call("get", "/users", tok.sa);
      expect(res.status).toBe(200);
      const rows = res.body as Array<{ id: string; assignedClientCount: number }>;
      expect(rows.every((r) => typeof r.assignedClientCount === "number")).toBe(true);
      const count = (uid: string) => rows.find((r) => r.id === uid)?.assignedClientCount;
      expect(count(id.acc)).toBe(2);
      expect(count(id.sa)).toBe(0);
      // The Manager created a client above and was assigned to it: A plus that one.
      expect(count(id.ma)).toBe(2);
    });
  });

  // --- from the review: edits keep working, old answers stay, orphans stay reachable ---

  describe("U4-A1 review cases", () => {
    it("a Manager assigned to a sub-client (parent unseen) still saves it when the form re-sends the same parent", async () => {
      const sub = await writer.client.create({
        data: {
          firmId,
          businessName: `${TAG} Echo Sub Of Bravo`,
          tin: "000000405",
          billingParentId: client.B,
        },
      });
      await writer.firmClientAssignment.create({
        data: { firmUserId: id.ma, clientId: sub.id },
      });
      const res = await call("patch", `/clients/${sub.id}`, tok.ma).send({
        businessName: `${TAG} Echo Sub Renamed`,
        billingParentId: client.B,
      });
      expect(res.status).toBe(200);
      expect(
        (await reader.client.findUniqueOrThrow({ where: { id: sub.id } })).businessName,
      ).toBe(`${TAG} Echo Sub Renamed`);
    });

    it("an unknown billing parent or FS client keeps its old answer for the Super Admin (400 / 404, not 403)", async () => {
      const ghost = randomUUID();
      const c = await call("post", "/clients", tok.sa).send({
        businessName: `${TAG} Foxtrot`,
        billingParentId: ghost,
      });
      expect(c.status).toBe(400);
      expect(c.body.message).toBe("The selected main client was not found in this firm.");
      const r = await call("post", "/fs/reports", tok.sa).send({
        clientId: ghost,
        periods: [{ label: "FY2026", endDate: "2026-12-31" }],
      });
      expect(r.status).toBe(404);
    });

    it("an FS report whose client is gone is reachable by the Super Admin (read and delete), not by the Manager", async () => {
      const ghost = randomUUID();
      const orphan = await writer.fsReport.create({
        data: {
          firmId,
          clientId: ghost,
          entityName: `${TAG} Orphan FS`,
          createdById: id.sa,
        },
      });
      const m = await call("get", `/fs/reports/${orphan.id}`, tok.ma);
      expect(m.status).toBe(403);
      expect(m.body.message).toBe(
        `Missing permission(s): Clients:ViewAll for client ${ghost}`,
      );
      expect((await call("get", `/fs/reports/${orphan.id}`, tok.sa)).status).toBe(200);
      expect((await call("delete", `/fs/reports/${orphan.id}`, tok.sa)).status).toBe(200);
      expect(await reader.fsReport.count({ where: { id: orphan.id } })).toBe(0);
    });
  });
});
