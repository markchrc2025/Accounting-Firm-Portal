/**
 * track-a-draft-delete.db-spec.ts — U14 contract A, over HTTP against the real Nest
 * app and the local PostgreSQL, with an in-memory object store. Every firm, client
 * and figure is invented.
 *
 * T2  A draft return can be deleted, with its exports and their stored files, and an
 *     audit row keeping its data; a filed return cannot (409), not even by raw SQL;
 *     deleting an amendment draft leaves its original amendable; a client principal
 *     and an unassigned user get 403.
 * T5  Both export links download under the export's name; list rows carry
 *     clearCopyAvailable and canDelete.
 */
import { randomUUID } from "node:crypto";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { truncateOncePerFile } from "./helpers/truncate";
import { AppModule } from "../../src/app.module";
import { TokenService } from "../../src/auth/token.service";
import { PrismaService } from "../../src/prisma/prisma.service";
import { StorageService } from "../../src/storage/storage.service";

truncateOncePerFile({ firmRoles: ["Super Admin", "Manager"] });

const TAG = `track-a-draft-delete-${randomUUID().slice(0, 8)}`;
const API = "/api/v1";

/** In-memory object storage standing in for S3. */
class FakeStorage {
  objects = new Map<string, Uint8Array>();
  deleted: string[] = [];
  isEnabled() {
    return true;
  }
  birFormExportKey(firmId: string, birFormId: string, filename: string) {
    return `bir-forms/${firmId}/${birFormId}/${filename}`;
  }
  async putObject(key: string, body: Uint8Array) {
    this.objects.set(key, body);
  }
  async deleteObject(key: string) {
    this.deleted.push(key);
    this.objects.delete(key);
  }
  async signedGetUrl(key: string, opts?: { filename?: string }) {
    const disposition = opts?.filename
      ? `&response-content-disposition=${encodeURIComponent(`attachment; filename="${opts.filename}"`)}`
      : "";
    return `https://storage.test/${key}?signed=1${disposition}`;
  }
}

describe("U14 · delete a draft return (real app over HTTP, db)", () => {
  let app: INestApplication;
  let writer: PrismaService;
  const storage = new FakeStorage();
  let firmId = "";
  let clientId = "";
  let token = "";

  const http = () => request(app.getHttpServer());
  const as = (r: request.Test, t = token) => r.set("Authorization", `Bearer ${t}`);
  const DATA = {
    year: "2026",
    quarter: "3rd",
    rows: [{ atc: "PT010", taxable: "120000", rate: "3" }],
  };

  async function draft(period = "2026-Q3") {
    const res = await as(http().post(`${API}/bir-forms`)).send({
      clientId,
      form: "2551Q",
      period,
      data: DATA,
    });
    expect(res.status).toBe(201);
    return res.body.id as string;
  }
  async function markFiled(id: string) {
    expect(
      (await as(http().patch(`${API}/bir-forms/${id}`)).send({ status: "filed" })).status,
    ).toBe(200);
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(StorageService)
      .useValue(storage)
      .compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix("api/v1");
    await app.init();
    writer = app.get(PrismaService);
    firmId = (await writer.firm.create({ data: { name: `${TAG} Halimbawa Accounting` } }))
      .id;
    clientId = (
      await writer.client.create({
        data: {
          firmId,
          businessName: `${TAG} Invented Sari-Sari`,
          tin: "000666777",
          taxType: "PERCENTAGE",
        },
      })
    ).id;
    const sa = await writer.user.create({
      data: {
        firmId,
        userType: "FIRM",
        fullName: `${TAG} super admin`,
        email: `${TAG}-sa@example.com`,
        status: "ACTIVE",
        firmProfile: { create: { title: "Test" } },
        userRoles: {
          create: {
            roleId: (
              await writer.role.findUniqueOrThrow({
                where: { name_scope: { name: "Super Admin", scope: "FIRM" } },
              })
            ).id,
          },
        },
      },
    });
    token = app
      .get(TokenService)
      .signAccess({ id: sa.id, firmId, userType: "FIRM", email: sa.email });
  });

  afterAll(async () => {
    await app.close();
  });

  describe("T2 · delete a draft", () => {
    it("a draft goes, with its exports and their stored files; the audit row keeps its data", async () => {
      const id = await draft();
      const exported = await as(http().post(`${API}/bir-forms/${id}/export`));
      expect(exported.status).toBe(201);
      const keys = (
        await writer.birFormExport.findMany({ where: { birFormId: id } })
      ).map((e) => e.storageKey);
      expect(keys).toHaveLength(1);
      expect(storage.objects.has(keys[0]!)).toBe(true);

      const res = await as(http().delete(`${API}/bir-forms/${id}`));
      expect([res.status, res.body]).toEqual([200, { deleted: true, id }]);
      expect(await writer.birForm.findUnique({ where: { id } })).toBeNull();
      expect(await writer.birFormExport.count({ where: { birFormId: id } })).toBe(0);
      expect(storage.objects.has(keys[0]!)).toBe(false);
      const audit = await writer.auditLog.findFirstOrThrow({
        where: { action: "bir-form.draft-deleted", entityId: id },
      });
      expect(audit.metadata).toMatchObject({
        form: "2551Q",
        period: "2026-Q3",
        sequence: 1,
        clientId,
        dataJson: DATA,
      });
      expect((await as(http().get(`${API}/bir-forms/${id}`))).status).toBe(404);
    });

    it("a filed return gets 409, and a raw SQL DELETE of it is refused by the database", async () => {
      const id = await draft("2026-Q2");
      await markFiled(id);
      const res = await as(http().delete(`${API}/bir-forms/${id}`));
      expect([res.status, res.body.message]).toEqual([
        409,
        "A filed return can't be deleted; it is the record of what was filed.",
      ]);
      await expect(
        writer.$executeRawUnsafe(`DELETE FROM bir_forms WHERE id = $1::uuid`, id),
      ).rejects.toThrow(/BIR_FORM_SEALED: DELETE of filed BIR form/);
      expect(await writer.birForm.findUnique({ where: { id } })).not.toBeNull();
    });

    it("deleting an amendment draft leaves its original amendable again", async () => {
      const original = await draft("2026-Q1");
      await markFiled(original);
      const amended = await as(http().post(`${API}/bir-forms/${original}/amend`));
      expect(amended.status).toBe(201);
      const again = await as(http().post(`${API}/bir-forms/${original}/amend`));
      expect(again.status).toBe(409);
      expect(
        (await as(http().delete(`${API}/bir-forms/${amended.body.id}`))).status,
      ).toBe(200);
      const fresh = await as(http().post(`${API}/bir-forms/${original}/amend`));
      expect([fresh.status, fresh.body.sequence, fresh.body.amendsId]).toEqual([
        201,
        2,
        original,
      ]);
    });

    it("a client principal and an unassigned firm user get 403; the draft stays", async () => {
      const id = await draft("2025-Q4");
      // A client principal, even holding BIRForms:Create on its own client.
      const role = await writer.role.create({
        data: { name: `${TAG} client creator`, scope: "CLIENT" },
      });
      for (const action of ["Read", "Create"]) {
        const permission = await writer.permission.upsert({
          where: { resource_action: { resource: "BIRForms", action } },
          update: {},
          create: { resource: "BIRForms", action },
        });
        await writer.rolePermission.create({
          data: { roleId: role.id, permissionId: permission.id },
        });
      }
      const portal = await writer.user.create({
        data: {
          firmId,
          userType: "CLIENT",
          fullName: `${TAG} portal user`,
          email: `${TAG}-portal@example.com`,
          status: "ACTIVE",
          clientProfile: { create: { clientId, clientRole: "OWNER" } },
          userRoles: { create: { roleId: role.id, clientScopeId: clientId } },
        },
      });
      const portalToken = app.get(TokenService).signAccess({
        id: portal.id,
        firmId,
        userType: "CLIENT",
        email: portal.email,
        clientId,
      });
      expect(
        (await as(http().delete(`${API}/bir-forms/${id}`), portalToken)).status,
      ).toBe(403);
      // A Manager assigned to another client only.
      const other = await writer.client.create({
        data: { firmId, businessName: `${TAG} Other Invented Co`, tin: "000888999" },
      });
      const manager = await writer.user.create({
        data: {
          firmId,
          userType: "FIRM",
          fullName: `${TAG} manager`,
          email: `${TAG}-manager@example.com`,
          status: "ACTIVE",
          firmProfile: {
            create: {
              title: "Test",
              clientAssignments: { create: { clientId: other.id } },
            },
          },
          userRoles: {
            create: {
              roleId: (
                await writer.role.findUniqueOrThrow({
                  where: { name_scope: { name: "Manager", scope: "FIRM" } },
                })
              ).id,
            },
          },
        },
      });
      const managerToken = app.get(TokenService).signAccess({
        id: manager.id,
        firmId,
        userType: "FIRM",
        email: manager.email,
      });
      expect(
        (await as(http().delete(`${API}/bir-forms/${id}`), managerToken)).status,
      ).toBe(403);
      expect(await writer.birForm.findUnique({ where: { id } })).not.toBeNull();
    });
  });

  describe("T5 · downloads, and what the list rows say", () => {
    it("POST :id/export's url and GET :id/exports/:exportId/url both download under the export's filename", async () => {
      const id = await draft("2024-Q4");
      const exported = await as(http().post(`${API}/bir-forms/${id}/export`));
      const name = exported.body.filename as string;
      const wanted = encodeURIComponent(`attachment; filename="${name}"`);
      expect(exported.body.url).toContain(`response-content-disposition=${wanted}`);
      const again = await as(
        http().get(`${API}/bir-forms/${id}/exports/${exported.body.id}/url`),
      );
      expect(again.body.url).toContain(`response-content-disposition=${wanted}`);
    });

    it("list rows carry clearCopyAvailable and canDelete; GET :id carries canDelete", async () => {
      const draftId = await draft("2024-Q3");
      const filedId = await draft("2024-Q2");
      await markFiled(filedId);
      const list = await as(http().get(`${API}/bir-forms?clientId=${clientId}`));
      const row = (id: string) =>
        (list.body as Array<Record<string, unknown>>).find((r) => r.id === id)!;
      expect([row(draftId).clearCopyAvailable, row(draftId).canDelete]).toEqual([
        false,
        true,
      ]);
      expect([row(filedId).clearCopyAvailable, row(filedId).canDelete]).toEqual([
        true,
        false,
      ]);
      expect((await as(http().get(`${API}/bir-forms/${draftId}`))).body.canDelete).toBe(
        true,
      );
      expect((await as(http().get(`${API}/bir-forms/${filedId}`))).body.canDelete).toBe(
        false,
      );
    });
  });
});
