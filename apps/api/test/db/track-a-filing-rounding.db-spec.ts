/**
 * track-a-filing-rounding.db-spec.ts — U28 (D75): Mark as filed refuses a saved draft that still
 * holds centavos in a whole-peso figure (a draft saved before U26, or one taken back from such a
 * filing). Mark as filed seals the data as saved and never rounds it; one save does. Over HTTP
 * against the real Nest app and the local PostgreSQL, with an in-memory object store. Every
 * firm, client, TIN and figure is invented.
 *
 * R1  The Super Admin override: 409 with the one sentence; nothing written (status, data,
 *     confirmation rows, audit).
 * R2  The BIR e-mail path: the same 409; nothing written.
 * R3  The contact number answers first, then the ATC, then the centavos.
 * R4  Save, then either path files; the filed return's clear copy prints.
 * R5  The Rossan case: a 1701Q sealed with centavos, undone, refused, saved, re-filed, and its
 *     clear copy prints.
 */
import { randomUUID } from "node:crypto";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { Prisma } from "@prisma/client";
import request from "supertest";
import { FakeStorage, fileWithConfirmation } from "../helpers/file-return";
import { truncateOncePerFile } from "./helpers/truncate";
import { AppModule } from "../../src/app.module";
import { TokenService } from "../../src/auth/token.service";
import { PrismaService } from "../../src/prisma/prisma.service";
import { StorageService } from "../../src/storage/storage.service";

truncateOncePerFile({ firmRoles: ["Super Admin"], chartOfAccounts: true });

const TAG = `track-a-u28-${randomUUID().slice(0, 8)}`;
const API = "/api/v1";
const OVERRIDE = "eBIRForms submitted it; the BIR e-mail did not arrive yet";
const D1701Q = {
  atc: "II012",
  year: "2026",
  amended: "no",
  rateA: "graduated",
  methodA: "osd",
};
const SAVE_FIRST =
  "Item 36A has centavos, which the 1701Q paper has no boxes for. Save the draft so the figures are rounded to whole pesos, then mark it filed.";
const SAVE_FIRST_TWO =
  "Items 36A and 55A have centavos, which the 1701Q paper has no boxes for. Save the draft so the figures are rounded to whole pesos, then mark it filed.";
const CONTACT =
  "Add the client's contact number before this return leaves the Portal. eBIRForms will not submit a return without one.";
const CHOOSE_8 = "Choose the Item 8 ATC before this return leaves the Portal.";

describe("U28 · Mark as filed waits for a save while whole-peso figures hold centavos (db)", () => {
  let app: INestApplication;
  let db: PrismaService;
  const storage = new FakeStorage();
  let firmId = "";
  let token = "";

  const http = () => request(app.getHttpServer());
  const as = (r: request.Test) => r.set("Authorization", `Bearer ${token}`);
  const row = (id: string) => db.birForm.findUniqueOrThrow({ where: { id } });
  const override = (id: string) =>
    as(http().post(`${API}/bir-forms/${id}/mark-filed`)).field(
      "overrideReason",
      OVERRIDE,
    );

  async function newClient(phone: string | null = "09181111111") {
    const c = await db.client.create({
      data: {
        firmId,
        kind: "individual",
        lastName: "DELA CRUZ",
        firstName: "JUANA",
        businessName: `${TAG} Halimbawa ${randomUUID().slice(0, 4)}`,
        taxType: "PERCENTAGE",
        tin: "000555888",
        branch: "00000",
        rdo: "027",
        address: "5 Invented St",
        city: "Lungsod ng Halimbawa",
        zip: "0000",
        phone,
        birthdate: new Date("1990-01-01"),
        civilStatus: "Single",
        classification: "Professional",
      },
    });
    return c.id;
  }

  /** A draft saved before U26: its centavos are in the row as typed (the API would round them). */
  async function legacyDraft(data: Prisma.InputJsonObject, phone?: string | null) {
    const clientId = await newClient(phone);
    return db.birForm.create({
      data: { firmId, clientId, form: "1701Q", period: "2026-Q3", dataJson: data },
    });
  }

  /** Nothing about the return moved: status, data, confirmations, filing audit. */
  async function unchanged(id: string, before: Awaited<ReturnType<typeof row>>) {
    const after = await row(id);
    expect([after.status, after.filedAt, after.dataJson, after.updatedAt]).toEqual([
      "draft",
      null,
      before.dataJson,
      before.updatedAt,
    ]);
    expect(await db.birFormConfirmation.count({ where: { birFormId: id } })).toBe(0);
    expect(
      await db.auditLog.count({
        where: {
          entityId: id,
          action: {
            in: [
              "bir-form.mark-filed",
              "bir-form.confirmation.override",
              "bir-form.update",
            ],
          },
        },
      }),
    ).toBe(0);
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(StorageService)
      .useValue(storage)
      .compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix("api/v1");
    await app.init();
    db = app.get(PrismaService);
    firmId = (await db.firm.create({ data: { name: `${TAG} Halimbawa Accounting` } })).id;
    const roleId = (
      await db.role.findUniqueOrThrow({
        where: { name_scope: { name: "Super Admin", scope: "FIRM" } },
      })
    ).id;
    const sa = await db.user.create({
      data: {
        firmId,
        userType: "FIRM",
        fullName: `${TAG} Super Admin`,
        email: `${TAG}-sa@example.com`,
        status: "ACTIVE",
        firmProfile: { create: { title: "Test" } },
        userRoles: { create: { roleId } },
      },
    });
    token = app
      .get(TokenService)
      .signAccess({ id: sa.id, firmId, userType: "FIRM", email: sa.email });
  });
  afterAll(async () => {
    await app?.close();
  });

  describe("R1 and R2 · both paths refuse, nothing written", () => {
    it("the override: 409, one sentence, every item once", async () => {
      const d = await legacyDraft({ ...D1701Q, salesA: "130507.95", excessA: "99.49" });
      const res = await override(d.id);
      expect([res.status, res.body.message]).toEqual([409, SAVE_FIRST_TWO]);
      await unchanged(d.id, d);
    });

    it("the BIR e-mail: the same 409, the confirmation never kept", async () => {
      const d = await legacyDraft({ ...D1701Q, salesA: "130507.95" });
      const res = await fileWithConfirmation(app, token, d.id);
      expect([res.status, res.body.message]).toEqual([409, SAVE_FIRST]);
      await unchanged(d.id, d);
      expect([...storage.objects.keys()].filter((k) => k.includes(d.id))).toEqual([]);
    });
  });

  describe("R3 · the order of the refusals", () => {
    it("the contact number first, then the ATC, then the centavos", async () => {
      const noPhone = await legacyDraft({ ...D1701Q, salesA: "130507.95" }, null);
      const a = await override(noPhone.id);
      expect([a.status, a.body.message]).toEqual([409, CONTACT]);
      const { atc: _atc, ...noAtc } = D1701Q;
      const b = await override((await legacyDraft({ ...noAtc, salesA: "130507.95" })).id);
      expect([b.status, b.body.message]).toEqual([409, CHOOSE_8]);
      const c = await override(
        (await legacyDraft({ ...D1701Q, salesA: "130507.95" })).id,
      );
      expect([c.status, c.body.message]).toEqual([409, SAVE_FIRST]);
    });
  });

  describe("R4 · a save lets it through", () => {
    it("override after a save: filed in whole pesos, and its clear copy prints", async () => {
      const d = await legacyDraft({ ...D1701Q, salesA: "130507.95" });
      const saved = await as(http().patch(`${API}/bir-forms/${d.id}`)).send({
        data: d.dataJson,
      });
      expect(saved.status).toBe(200);
      const res = await override(d.id);
      expect(res.status).toBe(200);
      expect((await row(d.id)).dataJson).toMatchObject({ salesA: "130508" });
      const cc = await as(http().post(`${API}/bir-forms/${d.id}/clear-copy`));
      expect(cc.status).toBe(201);
    });

    it("the BIR e-mail after a save files", async () => {
      const d = await legacyDraft({ ...D1701Q, salesA: "130507.95" });
      await as(http().patch(`${API}/bir-forms/${d.id}`)).send({ data: d.dataJson });
      const res = await fileWithConfirmation(app, token, d.id);
      expect(res.status).toBe(200);
      expect((await row(d.id)).status).toBe("filed");
    });

    it("whole pesos already, and zero centavos, never wait", async () => {
      const d = await legacyDraft({ ...D1701Q, salesA: "130,508.00" });
      expect((await override(d.id)).status).toBe(200);
    });
  });

  describe("R5 · the Rossan case: sealed with centavos, undone, saved, re-filed", () => {
    it("undo → refused → save → filed → clear copy", async () => {
      const clientId = await newClient();
      const sealed = await db.birForm.create({
        data: {
          firmId,
          clientId,
          form: "1701Q",
          period: "2026-Q3",
          status: "filed",
          filedAt: new Date("2026-11-15T03:32:49.000Z"),
          dataJson: { ...D1701Q, salesA: "130507.95" },
        },
      });
      const undo = await as(
        http().post(`${API}/bir-forms/${sealed.id}/undo-filing`),
      ).send({
        reason: "Filed with centavos in whole-peso boxes",
      });
      expect(undo.status).toBe(200);
      const refused = await override(sealed.id);
      expect([refused.status, refused.body.message]).toEqual([409, SAVE_FIRST]);
      expect((await row(sealed.id)).status).toBe("draft");

      await as(http().patch(`${API}/bir-forms/${sealed.id}`)).send({
        data: (await row(sealed.id)).dataJson,
      });
      expect((await override(sealed.id)).status).toBe(200);
      const cc = await as(http().post(`${API}/bir-forms/${sealed.id}/clear-copy`));
      expect(cc.status).toBe(201);
    });
  });
});
