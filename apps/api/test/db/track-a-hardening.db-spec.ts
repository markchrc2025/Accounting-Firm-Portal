/**
 * track-a-hardening.db-spec.ts — U9 against the real Nest app over HTTP and the
 * local PostgreSQL. Every firm, client and user is invented; writes are read back
 * through a second, freshly connected PrismaClient.
 *
 * T1  A user disabled after signing in: refresh is refused, and an access token
 *     issued before the change is refused on the next request once the status
 *     cache window has passed (the window is 0 here).
 * T2  Two-factor sign-in turns off only with a current code; marking a BIR form
 *     filed needs BIRForms:File; setRoles refuses a role whose scope does not fit.
 * T4  A client principal sees posted purchase records only, whatever it asks for.
 * T8  FS report client names never come from another firm.
 */
import { randomUUID } from "node:crypto";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { PrismaClient } from "@prisma/client";
import { authenticator } from "otplib";
import request from "supertest";
import { truncateOncePerFile } from "./helpers/truncate";
import { AppModule } from "../../src/app.module";
import { TokenService } from "../../src/auth/token.service";
import { PrismaService } from "../../src/prisma/prisma.service";

// R1 a: the guard may cache a user's status for up to 60 s; the test drives it to 0.
process.env.AUTH_STATUS_CACHE_MS = "0";

truncateOncePerFile({ firmRoles: ["Super Admin", "Manager"] });

const TAG = `track-a-hardening-${randomUUID().slice(0, 8)}`;
const API = "/api/v1";
const DISABLED = "This account is disabled.";

describe("U9 · sign-in hardened; posted records for clients (real app over HTTP, db)", () => {
  let app: INestApplication;
  let writer: PrismaService;
  let reader: PrismaClient;
  let tokens: TokenService;
  let firmId = "";
  let clientId = "";
  let saToken = "";
  let saId = "";

  const http = () => request(app.getHttpServer());
  const call = (method: "get" | "post" | "patch", path: string, token: string) =>
    http()[method](`${API}${path}`).set("Authorization", `Bearer ${token}`);
  const roleId = async (name: string, scope: "FIRM" | "CLIENT" = "FIRM") =>
    (await writer.role.findUniqueOrThrow({ where: { name_scope: { name, scope } } })).id;
  const perm = async (resource: string, action: string) =>
    (
      await writer.permission.findUniqueOrThrow({
        where: { resource_action: { resource, action } },
      })
    ).id;

  async function firmUser(
    key: string,
    role: string,
    extra: Record<string, unknown> = {},
  ) {
    const u = await writer.user.create({
      data: {
        firmId,
        userType: "FIRM",
        fullName: `${TAG} ${key}`,
        email: `${TAG}-${key}@example.com`,
        status: "ACTIVE",
        firmProfile: { create: { title: "Test" } },
        userRoles: { create: { roleId: role } },
        ...extra,
      },
    });
    return {
      id: u.id,
      token: tokens.signAccess({ id: u.id, firmId, userType: "FIRM", email: u.email }),
    };
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix("api/v1");
    await app.init();
    writer = app.get(PrismaService);
    reader = new PrismaClient();
    tokens = app.get(TokenService);
    firmId = (await writer.firm.create({ data: { name: `${TAG} Halimbawa Accounting` } }))
      .id;
    const sa = await firmUser("super-admin", await roleId("Super Admin"));
    saToken = sa.token;
    saId = sa.id;
    clientId = (
      await writer.client.create({
        data: {
          firmId,
          businessName: `${TAG} Invented Trading`,
          tin: "000000501",
          taxType: "VAT",
        },
      })
    ).id;
  });

  afterAll(async () => {
    await reader.$disconnect();
    await app.close();
  });

  // --- T1 -------------------------------------------------------------------------

  describe("T1 · a user disabled after signing in", () => {
    it("is refused at refresh and on the next request with an old token", async () => {
      const u = await firmUser("soon-disabled", await roleId("Manager"));
      expect((await call("get", "/auth/me", u.token)).status).toBe(200);
      await writer.user.update({ where: { id: u.id }, data: { status: "DISABLED" } });

      const refresh = await call("post", "/auth/refresh", u.token);
      expect(refresh.status).toBe(401);
      expect(refresh.body.message).toBe(DISABLED);
      expect(refresh.body.accessToken).toBeUndefined();

      const next = await call("get", "/auth/me", u.token);
      expect(next.status).toBe(401);
      expect(next.body.message).toBe(DISABLED);
      expect((await call("get", "/clients", u.token)).status).toBe(401);
    });

    it("an ACTIVE user is unaffected", async () => {
      expect((await call("post", "/auth/refresh", saToken)).status).toBe(201);
      expect((await call("get", "/auth/me", saToken)).status).toBe(200);
    });
  });

  // --- T2 -------------------------------------------------------------------------

  describe("T2 · MFA off needs a code; filing needs BIRForms:File; setRoles fits the user", () => {
    it("turning two-factor sign-in off without a code answers 400; with a current code it succeeds", async () => {
      const secret = authenticator.generateSecret();
      const u = await firmUser("mfa-user", await roleId("Manager"), {
        mfaEnabled: true,
        mfaSecret: secret,
      });
      const MSG =
        "Enter a current code from your authenticator to turn off two-factor sign-in.";
      for (const path of ["/auth/mfa/enroll", "/auth/mfa/disable"]) {
        const res = await call("post", path, u.token).send({});
        expect(res.status).toBe(400);
        expect(res.body.message).toBe(MSG);
        const wrong = await call("post", path, u.token).send({
          code: "000000" === authenticator.generate(secret) ? "111111" : "000000",
        });
        expect(wrong.status).toBe(400);
      }
      expect(
        (await reader.user.findUniqueOrThrow({ where: { id: u.id } })).mfaEnabled,
      ).toBe(true);
      const ok = await call("post", "/auth/mfa/disable", u.token).send({
        code: authenticator.generate(secret),
      });
      expect(ok.status).toBe(201);
      const back = await reader.user.findUniqueOrThrow({ where: { id: u.id } });
      expect(back.mfaEnabled).toBe(false);
      expect(back.mfaSecret).toBeNull();
    });

    it("re-enrolling while two-factor is on needs a current code too", async () => {
      const secret = authenticator.generateSecret();
      const u = await firmUser("mfa-reenrol", await roleId("Manager"), {
        mfaEnabled: true,
        mfaSecret: secret,
      });
      const ok = await call("post", "/auth/mfa/enroll", u.token).send({
        code: authenticator.generate(secret),
      });
      expect(ok.status).toBe(201);
      expect(typeof ok.body.secret).toBe("string");
    });

    it("a role with BIRForms:Update but not BIRForms:File cannot mark a form filed; with File it can", async () => {
      const make = async (name: string, actions: string[]) =>
        writer.role.create({
          data: {
            name: `${TAG} ${name}`,
            scope: "FIRM",
            rolePermissions: {
              create: [
                { permissionId: await perm("Clients", "ViewAll") },
                ...(await Promise.all(
                  actions.map(async (a) => ({ permissionId: await perm("BIRForms", a) })),
                )),
              ],
            },
          },
        });
      const noFile = await firmUser(
        "preparer",
        (await make("preparer", ["Read", "Update"])).id,
      );
      const withFile = await firmUser(
        "filer",
        (await make("filer", ["Read", "Update", "File"])).id,
      );
      const form = await writer.birForm.create({
        data: { firmId, clientId, form: "2550Q", period: "2026-Q3", dataJson: {} },
      });
      const denied = await call("patch", `/bir-forms/${form.id}`, noFile.token).send({
        status: "filed",
      });
      expect(denied.status).toBe(403);
      expect(denied.body.message).toBe(
        `Missing permission(s): BIRForms:File for client ${clientId}`,
      );
      expect(
        (await reader.birForm.findUniqueOrThrow({ where: { id: form.id } })).status,
      ).toBe("draft");
      // A draft save without filing still works for the preparer.
      expect(
        (
          await call("patch", `/bir-forms/${form.id}`, noFile.token).send({
            data: { x: 1 },
          })
        ).status,
      ).toBe(200);
      const filed = await call("patch", `/bir-forms/${form.id}`, withFile.token).send({
        status: "filed",
      });
      expect(filed.status).toBe(200);
      expect(
        (await reader.birForm.findUniqueOrThrow({ where: { id: form.id } })).status,
      ).toBe("filed");
    });

    it("setRoles answers 400 for each mismatch and scopes a client role to the user's own client", async () => {
      const owner = await writer.role.create({
        data: { name: "Client Owner", scope: "CLIENT", isSystem: true },
      });
      const firmTarget = await firmUser("role-target", await roleId("Manager"));
      const portal = await writer.user.create({
        data: {
          firmId,
          userType: "CLIENT",
          fullName: `${TAG} portal user`,
          email: `${TAG}-portal-roles@example.com`,
          status: "ACTIVE",
          clientProfile: { create: { clientId, clientRole: "OWNER" } },
        },
      });
      const a = await call("post", `/users/${firmTarget.id}/roles`, saToken).send({
        roleNames: ["Client Owner"],
      });
      expect(a.status).toBe(400);
      expect(a.body.message).toBe("A CLIENT role cannot be given to a FIRM user.");
      const b = await call("post", `/users/${portal.id}/roles`, saToken).send({
        roleNames: ["Manager"],
      });
      expect(b.status).toBe(400);
      expect(b.body.message).toBe("A FIRM role cannot be given to a CLIENT user.");
      expect(await reader.userRole.count({ where: { userId: portal.id } })).toBe(0);
      const ok = await call("post", `/users/${portal.id}/roles`, saToken).send({
        roleNames: ["Client Owner"],
      });
      expect(ok.status).toBe(201);
      const grants = await reader.userRole.findMany({ where: { userId: portal.id } });
      expect(grants).toEqual([
        expect.objectContaining({ roleId: owner.id, clientScopeId: clientId }),
      ]);
    });
  });

  // --- T4 -------------------------------------------------------------------------

  describe("T4 · a client principal sees posted records only", () => {
    let portalToken = "";
    const ids = { p1: "", p2: "", held: "" };

    beforeAll(async () => {
      const reader2 = await writer.role.create({
        data: {
          name: `${TAG} portal expenses reader`,
          scope: "CLIENT",
          rolePermissions: { create: [{ permissionId: await perm("Expenses", "Read") }] },
        },
      });
      const portal = await writer.user.create({
        data: {
          firmId,
          userType: "CLIENT",
          fullName: `${TAG} portal reader`,
          email: `${TAG}-portal-reader@example.com`,
          status: "ACTIVE",
          clientProfile: { create: { clientId, clientRole: "VIEWER" } },
          userRoles: { create: { roleId: reader2.id, clientScopeId: clientId } },
        },
      });
      portalToken = tokens.signAccess({
        id: portal.id,
        firmId,
        userType: "CLIENT",
        email: portal.email,
        clientId,
      });
      const cat = await writer.category.create({
        data: { clientId, type: "EXPENSE", name: `${TAG} supplies` },
      });
      const row = (n: number, status: "posted" | "held") =>
        writer.purchaseTransaction.create({
          data: {
            clientId,
            categoryId: cat.id,
            txnDate: new Date(`2026-08-0${n}T00:00:00.000Z`),
            description: `Receipt ${n}`,
            netAmount: 100 * n,
            source: "import",
            status,
          },
        });
      ids.p1 = (await row(1, "posted")).id;
      ids.p2 = (await row(2, "posted")).id;
      ids.held = (await row(3, "held")).id;
    });

    it("asking for status=held, the client principal gets posted records only, and the count equals the posted count", async () => {
      const res = await call(
        "get",
        `/clients/${clientId}/purchase-transactions?status=held`,
        portalToken,
      );
      expect(res.status).toBe(200);
      const rows = res.body.data as Array<{ id: string; status: string }>;
      expect(rows.every((r) => r.status === "posted")).toBe(true);
      expect(res.body.total).toBe(2);
      expect(rows.map((r) => r.id).sort()).toEqual([ids.p1, ids.p2].sort());
      const all = await call(
        "get",
        `/clients/${clientId}/purchase-transactions`,
        portalToken,
      );
      expect((all.body.data as Array<{ id: string }>).map((r) => r.id)).not.toContain(
        ids.held,
      );
      expect(all.body.total).toBe(2);
    });

    it("a held record by id answers 404 to the client principal", async () => {
      expect(
        (
          await call(
            "get",
            `/clients/${clientId}/purchase-transactions/${ids.held}`,
            portalToken,
          )
        ).status,
      ).toBe(404);
      expect(
        (
          await call(
            "get",
            `/clients/${clientId}/purchase-transactions/${ids.p1}`,
            portalToken,
          )
        ).status,
      ).toBe(200);
    });

    it("a firm user still gets the held ones", async () => {
      const res = await call(
        "get",
        `/clients/${clientId}/purchase-transactions?status=held`,
        saToken,
      );
      expect((res.body.data as Array<{ id: string }>).map((r) => r.id)).toEqual([
        ids.held,
      ]);
      expect(
        (
          await call(
            "get",
            `/clients/${clientId}/purchase-transactions/${ids.held}`,
            saToken,
          )
        ).status,
      ).toBe(200);
    });
  });

  // --- T8 -------------------------------------------------------------------------

  it("T8 · an FS report's client name never comes from another firm", async () => {
    const other = await writer.firm.create({
      data: { name: `${TAG} Other Invented Firm` },
    });
    const foreign = await writer.client.create({
      data: { firmId: other.id, businessName: `${TAG} Foreign Client`, tin: "000000502" },
    });
    const report = await writer.fsReport.create({
      data: {
        firmId,
        clientId: foreign.id,
        entityName: `${TAG} Report`,
        createdById: saId,
      },
    });
    const res = await call("get", "/fs/reports", saToken);
    const row = (res.body as Array<{ id: string; clientName: string | null }>).find(
      (r) => r.id === report.id,
    );
    expect(row).toBeDefined();
    expect(row?.clientName ?? null).toBeNull();
  });
});
