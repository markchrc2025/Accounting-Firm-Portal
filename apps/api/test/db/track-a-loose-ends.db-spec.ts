/**
 * track-a-loose-ends.db-spec.ts — U9-A1 against the real Nest app over HTTP and the
 * local PostgreSQL. Every firm, client and user is invented; writes are read back
 * through a second, freshly connected PrismaClient.
 *
 * T1  A role grant that does not fit the user is ignored, never deleted: a portal
 *     user holding an unscoped firm role (as old setRoles could write) cannot reach
 *     a firm-only route, keeps its own client's access, and the boot count logs 1.
 * T2  regimeMix counts active clients only: vat + percentage + exempt equals the
 *     active-client count, with an archived VAT client present.
 * T3  The second step of two-factor sign-in refuses a user disabled between steps.
 * T6  The client invite returns no token; the emailed link still accepts.
 * T7  assign-clients for a portal user answers 400, the same as the read.
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
import { DEFAULT_ROLES } from "../../src/rbac/permissions.constants";

truncateOncePerFile({ firmRoles: ["Super Admin", "Manager"] });

const TAG = `track-a-loose-ends-${randomUUID().slice(0, 8)}`;
const API = "/api/v1";
const BOOT_LINE = "[rbac] 1 role grant(s) ignored: scope does not fit the user";

/** A CLIENT-scope role from DEFAULT_ROLES, with exactly its grants (as the seed). */
async function ensureClientRole(db: PrismaClient, name: string): Promise<string> {
  const def = DEFAULT_ROLES.find((r) => r.name === name && r.scope === "CLIENT");
  if (!def) throw new Error(`No CLIENT role named "${name}" in DEFAULT_ROLES`);
  const role = await db.role.upsert({
    where: { name_scope: { name, scope: "CLIENT" } },
    update: {},
    create: { name, scope: "CLIENT", isSystem: true },
  });
  for (const p of def.permissions) {
    const [resource, action] = p.split(":") as [string, string];
    const permission = await db.permission.upsert({
      where: { resource_action: { resource, action } },
      update: {},
      create: { resource, action },
    });
    await db.rolePermission.upsert({
      where: { roleId_permissionId: { roleId: role.id, permissionId: permission.id } },
      update: {},
      create: { roleId: role.id, permissionId: permission.id },
    });
  }
  return role.id;
}

describe("U9-A1 · loose ends of sign-in and roles (real app over HTTP, db)", () => {
  let app: INestApplication;
  let writer: PrismaService;
  let reader: PrismaClient;
  let tokens: TokenService;
  let firmId = "";
  let clientId = "";
  let saToken = "";
  let saId = "";
  let portalId = "";
  let portalEmail = "";
  let bootLines: string[] = [];

  const http = () => request(app.getHttpServer());
  const call = (method: "get" | "post", path: string, token: string) =>
    http()[method](`${API}${path}`).set("Authorization", `Bearer ${token}`);

  beforeAll(async () => {
    // Written straight to the tables BEFORE the app boots, so the boot count sees it.
    const seed = new PrismaClient();
    try {
      firmId = (await seed.firm.create({ data: { name: `${TAG} Halimbawa Accounting` } }))
        .id;
      clientId = (
        await seed.client.create({
          data: {
            firmId,
            businessName: `${TAG} Invented Trading`,
            tin: "000000601",
            taxType: "VAT",
          },
        })
      ).id;
      const superAdmin = await seed.role.findUniqueOrThrow({
        where: { name_scope: { name: "Super Admin", scope: "FIRM" } },
      });
      const manager = await seed.role.findUniqueOrThrow({
        where: { name_scope: { name: "Manager", scope: "FIRM" } },
      });
      const viewer = await ensureClientRole(seed, "Client Viewer");
      const sa = await seed.user.create({
        data: {
          firmId,
          userType: "FIRM",
          fullName: `${TAG} super admin`,
          email: `${TAG}-sa@example.com`,
          status: "ACTIVE",
          firmProfile: { create: { title: "Test" } },
          userRoles: { create: { roleId: superAdmin.id } },
        },
      });
      portalEmail = `${TAG}-portal@example.com`;
      const portal = await seed.user.create({
        data: {
          firmId,
          userType: "CLIENT",
          fullName: `${TAG} portal user`,
          email: portalEmail,
          status: "ACTIVE",
          clientProfile: { create: { clientId, clientRole: "VIEWER" } },
          userRoles: {
            create: [
              // Its own, fitting grant: a client role scoped to its own client.
              { roleId: viewer, clientScopeId: clientId },
              // The mismatch old setRoles could leave: an unscoped firm role.
              { roleId: manager.id },
            ],
          },
        },
      });
      portalId = portal.id;
      saId = sa.id; // its token is signed below, once the app's TokenService exists
    } finally {
      await seed.$disconnect();
    }

    const log = jest.spyOn(console, "log");
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix("api/v1");
    await app.init();
    bootLines = log.mock.calls
      .map((c) => String(c[0]))
      .filter((l) => l.startsWith("[rbac]"));
    log.mockRestore();
    writer = app.get(PrismaService);
    reader = new PrismaClient();
    tokens = app.get(TokenService);
    saToken = tokens.signAccess({
      id: saId,
      firmId,
      userType: "FIRM",
      email: `${TAG}-sa@example.com`,
    });
  });

  afterAll(async () => {
    await reader.$disconnect();
    await app.close();
  });

  const portalToken = () =>
    tokens.signAccess({
      id: portalId,
      firmId,
      userType: "CLIENT",
      email: portalEmail,
      clientId,
    });

  // --- T1 -------------------------------------------------------------------------

  describe("T1 · a role grant that does not fit the user is ignored, never deleted", () => {
    it("the boot count logs 1, the count only", () => {
      expect(bootLines).toEqual([BOOT_LINE]);
    });

    it("the portal user cannot reach a firm-only route through its unscoped firm role", async () => {
      // Clients:Read on its own client comes only from the unscoped Manager grant
      // (Client Viewer lacks it), so before R2 this answered 200.
      const res = await call("get", `/clients/${clientId}`, portalToken());
      expect(res.status).toBe(403);
      expect(res.body.message).toBe(
        `Missing permission(s): Clients:Read for client ${clientId}`,
      );
    });

    it("the portal user keeps its own client's access, and the mismatched grant is not deleted", async () => {
      const res = await call(
        "get",
        `/clients/${clientId}/purchase-transactions`,
        portalToken(),
      );
      expect(res.status).toBe(200);
      expect(await reader.userRole.count({ where: { userId: portalId } })).toBe(2);
    });
  });

  // --- T2 -------------------------------------------------------------------------

  it("T2 · vat + percentage + exempt equals the active-client count, with an archived VAT client present", async () => {
    await writer.client.createMany({
      data: [
        {
          firmId,
          businessName: `${TAG} Archived VAT`,
          tin: "000000602",
          taxType: "VAT",
          status: "ARCHIVED",
        },
        {
          firmId,
          businessName: `${TAG} Percentage`,
          tin: "000000603",
          taxType: "PERCENTAGE",
        },
        { firmId, businessName: `${TAG} Exempt`, tin: "000000604", taxType: null },
      ],
    });
    const res = await call("get", "/dashboard", saToken);
    expect(res.status).toBe(200);
    const active = (res.body.kpis as Array<{ label: string; value: number }>).find(
      (k) => k.label === "Active clients",
    )!.value;
    expect(active).toBe(3);
    expect(res.body.regimeMix).toEqual({ vat: 1, percentage: 1, exempt: 1 });
    const mix = res.body.regimeMix as { vat: number; percentage: number; exempt: number };
    expect(mix.vat + mix.percentage + mix.exempt).toBe(active);
  });

  // --- T3 -------------------------------------------------------------------------

  it("T3 · verifyMfa refuses a user disabled between the two steps", async () => {
    const secret = authenticator.generateSecret();
    const u = await writer.user.create({
      data: {
        firmId,
        userType: "FIRM",
        fullName: `${TAG} two-step`,
        email: `${TAG}-two-step@example.com`,
        status: "ACTIVE",
        mfaEnabled: true,
        mfaSecret: secret,
        firmProfile: { create: { title: "Test" } },
      },
    });
    const mfaToken = tokens.signMfa({
      id: u.id,
      firmId,
      userType: "FIRM",
      email: u.email,
    });
    await writer.user.update({ where: { id: u.id }, data: { status: "DISABLED" } });
    const res = await http()
      .post(`${API}/auth/mfa/verify`)
      .send({ mfaToken, code: authenticator.generate(secret) });
    expect(res.status).toBe(401);
    expect(res.body.message).toBe("This account is disabled.");
    expect(res.body.accessToken).toBeUndefined();
  });

  it("T3 · a user disabled, and with two-factor cleared, between the two steps reads the disabled message", async () => {
    const secret = authenticator.generateSecret();
    const u = await writer.user.create({
      data: {
        firmId,
        userType: "FIRM",
        fullName: `${TAG} two-step cleared`,
        email: `${TAG}-two-step-cleared@example.com`,
        status: "ACTIVE",
        mfaEnabled: true,
        mfaSecret: secret,
        firmProfile: { create: { title: "Test" } },
      },
    });
    const mfaToken = tokens.signMfa({
      id: u.id,
      firmId,
      userType: "FIRM",
      email: u.email,
    });
    await writer.user.update({
      where: { id: u.id },
      data: { status: "DISABLED", mfaEnabled: false, mfaSecret: null },
    });
    const res = await http()
      .post(`${API}/auth/mfa/verify`)
      .send({ mfaToken, code: authenticator.generate(secret) });
    expect(res.status).toBe(401);
    expect(res.body.message).toBe("This account is disabled.");
  });

  // --- T6 -------------------------------------------------------------------------

  it("T6 · the client invite returns no token, and the emailed link still accepts", async () => {
    const email = `${TAG}-invitee@example.com`;
    const res = await call("post", `/clients/${clientId}/invitations`, saToken).send({
      email,
      clientRole: "VIEWER",
    });
    expect(res.status).toBe(201);
    expect(res.body).not.toHaveProperty("token");
    expect(JSON.stringify(res.body)).not.toMatch(/[0-9a-f]{64}/);
    // The emailed link carries the stored token; accepting with it still works.
    const stored = await reader.invitation.findFirstOrThrow({ where: { email } });
    const accepted = await http()
      .post(`${API}/invitations/accept`)
      .send({
        token: stored.token,
        fullName: `${TAG} invitee`,
        password: "invented-pass-123",
      });
    expect(accepted.status).toBe(201);
    expect((await reader.user.findFirstOrThrow({ where: { email } })).userType).toBe(
      "CLIENT",
    );
  });

  // --- T7 -------------------------------------------------------------------------

  it("T7 · assign-clients for a portal user answers 400 with the read's message", async () => {
    const res = await call("post", `/users/${portalId}/assign-clients`, saToken).send({
      clientIds: [clientId],
    });
    expect(res.status).toBe(400);
    expect(res.body.message).toBe("Only firm users are assigned clients.");
  });
});
