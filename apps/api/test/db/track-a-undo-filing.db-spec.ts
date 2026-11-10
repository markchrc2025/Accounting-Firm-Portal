/**
 * track-a-undo-filing.db-spec.ts — U22 (D63): a return marked filed WITHOUT the BIR
 * confirmation e-mail (the Super Admin override) can be taken back to a draft, and only
 * that. Over HTTP against the real Nest app and the local PostgreSQL, with an in-memory
 * object store. Every firm, client, TIN and figure is invented.
 *
 * T1  POST /bir-forms/:id/undo-filing: an override filing goes back to a draft, its data
 *     as it was; the snapshot, the filed date and the override row are kept as history
 *     (the 1601-EQ's stored alphalist with the snapshot); an audit event.
 * T2  After an undo, Mark as filed works as for any draft (override again, or the BIR
 *     e-mail); a return with a BIR e-mail can never be undone.
 * T3  Refusals: not a Super Admin, a short reason, a BIR e-mail (also one attached after
 *     an override), a draft, a return filed without a confirmation row, an amendment,
 *     another firm's return; the undone draft cannot be deleted.
 * T4  The seal is as strong as ever: a direct update or delete of a filed row is refused,
 *     and so is every attempt to use the undo's exception outside its conditions.
 */
import { randomUUID } from "node:crypto";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { Prisma } from "@prisma/client";
import request from "supertest";
import {
  confirmationFor,
  FakeStorage,
  fileWithConfirmation,
} from "../helpers/file-return";
import { truncateOncePerFile } from "./helpers/truncate";
import { AppModule } from "../../src/app.module";
import { TokenService } from "../../src/auth/token.service";
import { PrismaService } from "../../src/prisma/prisma.service";
import { StorageService } from "../../src/storage/storage.service";

truncateOncePerFile({ firmRoles: ["Super Admin", "Manager"] });

const TAG = `track-a-undo-${randomUUID().slice(0, 8)}`;
const API = "/api/v1";
const OVERRIDE = "The BIR email conforme is still in transit.";
const NOT_ALLOWED =
  "The filing can only be undone when it was marked filed without the BIR confirmation email. A return with an attached BIR email can never be undone; it is corrected by amending.";
const SA_ONLY = "Only a Super Admin can undo a filing.";
const SHORT = "Give the reason in at least 10 characters.";
const AMENDED = "This return has an amendment, so its filing cannot be undone.";
const UNDONE_NOT_DELETABLE =
  "This return was filed and the filing was undone. Its history is kept, so it cannot be deleted.";
const D2551Q = {
  year: "2026",
  quarter: "3rd",
  amended: "no",
  periodType: "calendar",
  taxRelief: "no",
  itRate: "graduated",
  rows: [{ atc: "PT010", taxable: "250000", rate: "3" }],
  i15: "1500",
  i20: "100",
};
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the tests read JSON
type Json = Record<string, any>;

describe("U22 · undo a filing made without the BIR e-mail (real app over HTTP, db)", () => {
  let app: INestApplication;
  let db: PrismaService;
  const storage = new FakeStorage();
  let firmId = "";
  let otherFirmToken = "";
  let saToken = "";
  let clientId = "";
  let n = 0;

  const http = () => request(app.getHttpServer());
  const as = (r: request.Test, token = saToken) =>
    r.set("Authorization", `Bearer ${token}`);

  async function newClient() {
    n += 1;
    return (
      await db.client.create({
        data: {
          firmId,
          businessName: `${TAG} Halimbawa Sari-Sari ${n}`,
          kind: "individual",
          lastName: "HALIMBAWA",
          firstName: "JUANA",
          middleName: "SUBOK",
          tin: String(100000000 + n),
          branch: "00000",
          rdo: "027",
          address: "5 Invented St",
          city: "Lungsod ng Halimbawa",
          zip: "0000",
          phone: "09170000000",
          taxType: "PERCENTAGE",
        },
      })
    ).id;
  }
  async function draft(
    form = "2551Q",
    period = "2026-Q3",
    data: object = D2551Q,
    forClient?: string,
  ) {
    forClient ??= await newClient();
    const res = await as(http().post(`${API}/bir-forms`)).send({
      clientId: forClient,
      form,
      period,
      data,
    });
    expect(res.status).toBe(201);
    return res.body.id as string;
  }
  const overrideFile = (id: string, reason = OVERRIDE, token = saToken) =>
    as(http().post(`${API}/bir-forms/${id}/mark-filed`), token).field(
      "overrideReason",
      reason,
    );
  const undo = (
    id: string,
    body: object = { reason: "Marked filed before eBIRForms sent it" },
    token = saToken,
  ) => as(http().post(`${API}/bir-forms/${id}/undo-filing`), token).send(body);
  const row = (id: string) => db.birForm.findUniqueOrThrow({ where: { id } });
  const confirmations = (id: string) =>
    db.birFormConfirmation.findMany({
      where: { birFormId: id },
      orderBy: { uploadedAt: "asc" },
    });
  const undos = (id: string) =>
    db.birFormFilingUndo.findMany({
      where: { birFormId: id },
      orderBy: { undoneAt: "asc" },
    });

  /** A Manager assigned to this client: may file it, but is not a Super Admin. */
  async function managerFor(forClient: string) {
    const u = await db.user.create({
      data: {
        firmId,
        userType: "FIRM",
        fullName: `${TAG} manager ${n}`,
        email: `${TAG}-manager-${n}-${randomUUID().slice(0, 4)}@example.com`,
        status: "ACTIVE",
        firmProfile: {
          create: {
            title: "Test",
            clientAssignments: { create: [{ clientId: forClient }] },
          },
        },
        userRoles: {
          create: {
            roleId: (
              await db.role.findUniqueOrThrow({
                where: { name_scope: { name: "Manager", scope: "FIRM" } },
              })
            ).id,
          },
        },
      },
    });
    return app
      .get(TokenService)
      .signAccess({ id: u.id, firmId, userType: "FIRM", email: u.email });
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
    const tokens = app.get(TokenService);
    const role = async (name: string) =>
      (
        await db.role.findUniqueOrThrow({
          where: { name_scope: { name, scope: "FIRM" } },
        })
      ).id;
    const user = async (fid: string, label: string, roleName: string) => {
      const u = await db.user.create({
        data: {
          firmId: fid,
          userType: "FIRM",
          fullName: `${TAG} ${label}`,
          email: `${TAG}-${label}@example.com`,
          status: "ACTIVE",
          firmProfile: { create: { title: "Test" } },
          userRoles: { create: { roleId: await role(roleName) } },
        },
      });
      return {
        id: u.id,
        token: tokens.signAccess({
          id: u.id,
          firmId: fid,
          userType: "FIRM",
          email: u.email,
        }),
      };
    };
    firmId = (await db.firm.create({ data: { name: `${TAG} Halimbawa Accounting` } })).id;
    saToken = (await user(firmId, "sa", "Super Admin")).token;
    const other = await db.firm.create({ data: { name: `${TAG} Ibang Accounting` } });
    otherFirmToken = (await user(other.id, "sa2", "Super Admin")).token;
    clientId = await newClient();
  });
  afterAll(async () => {
    await app.close();
  });

  // ======================================================================================
  describe("T1 · an override filing goes back to a draft; the history is kept", () => {
    it("status draft, data as filed; snapshot, filed date and override row kept; an audit event", async () => {
      const id = await draft();
      const filed = await overrideFile(id);
      expect(filed.status).toBe(200);
      const before = await row(id);
      expect(before.status).toBe("filed");
      const [override] = await confirmations(id);
      expect(override).toMatchObject({
        kind: "override",
        overrideReason: OVERRIDE,
        supersededAt: null,
      });
      const sa = await db.user.findFirstOrThrow({
        where: { email: `${TAG}-sa@example.com` },
      });

      const reason = "Marked filed before eBIRForms sent it";
      const res = await undo(id, { reason });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        id,
        status: "draft",
        filedAt: null,
        confirmation: null,
      });
      expect(res.body.data).toEqual(D2551Q);
      expect(res.body.filingUndos).toEqual([
        expect.objectContaining({
          reason,
          filedAt: before.filedAt!.toISOString(),
          undoneByUserId: sa.id,
          overrideReason: OVERRIDE,
        }),
      ]);

      const after = await row(id);
      expect([after.status, after.filedAt, after.filedSnapshotJson]).toEqual([
        "draft",
        null,
        null,
      ]);
      expect(after.dataJson).toEqual(before.dataJson);
      expect([
        after.form,
        after.period,
        after.clientId,
        after.sequence,
        after.amendsId,
      ]).toEqual([
        before.form,
        before.period,
        before.clientId,
        before.sequence,
        before.amendsId,
      ]);

      const [h] = await undos(id);
      expect(h).toMatchObject({
        birFormId: id,
        firmId,
        confirmationId: override!.id,
        undoneByUserId: sa.id,
        reason,
        overrideReason: OVERRIDE,
      });
      expect(h!.filedAt.toISOString()).toBe(before.filedAt!.toISOString());
      expect(h!.filedSnapshotJson).toEqual(before.filedSnapshotJson);
      expect(h!.undoneAt.getTime()).toBeGreaterThan(h!.filedAt.getTime() - 1);

      // the override row is kept, superseded, never deleted
      const [kept] = await confirmations(id);
      expect(kept).toMatchObject({
        id: override!.id,
        kind: "override",
        overrideReason: OVERRIDE,
      });
      expect(kept!.supersededAt).not.toBeNull();

      const audit = await db.auditLog.findFirst({
        where: { action: "bir-form.filing.undone", entityId: id },
      });
      expect(audit).not.toBeNull();
      expect(audit!.userId).toBe(sa.id);
      expect(audit!.metadata).toMatchObject({
        reason,
        form: "2551Q",
        period: "2026-Q3",
        filedAt: before.filedAt!.toISOString(),
        confirmationId: override!.id,
      });
    });

    it("a 1601-EQ's stored alphalist goes with the snapshot into history; a later filing stores a new one", async () => {
      const id = await draft("1601EQ", "2026-Q3", { year: "2026", quarter: "3" });
      expect((await overrideFile(id)).status).toBe(200);
      const first = await row(id);
      expect(first.filedSnapshotJson).toHaveProperty("alphalist");
      expect((await undo(id)).status).toBe(200);
      const [h] = await undos(id);
      expect(h!.filedSnapshotJson).toEqual(first.filedSnapshotJson);
      expect(h!.filedSnapshotJson).toHaveProperty("alphalist");
      expect((await row(id)).filedSnapshotJson).toBeNull();

      expect(
        (await overrideFile(id, "Filed again after eBIRForms accepted it.")).status,
      ).toBe(200);
      const second = await row(id);
      const a1 = (first.filedSnapshotJson as Json).alphalist;
      const a2 = (second.filedSnapshotJson as Json).alphalist;
      expect(a2).toBeDefined();
      expect(a2).not.toEqual(a1); // its own, made at the second filing
      // the first one is still in history
      expect((await undos(id))[0]!.filedSnapshotJson).toEqual(first.filedSnapshotJson);
    });
  });

  // ======================================================================================
  describe("T2 · after an undo, Mark as filed works as for any draft", () => {
    it("with an override again, then undone a second time (two history rows); with the BIR e-mail it can never be undone", async () => {
      const id = await draft();
      expect((await overrideFile(id)).status).toBe(200);
      expect((await undo(id)).status).toBe(200);

      // a draft again: Mark as filed needs the BIR e-mail or an override, as ever
      const bare = await as(http().post(`${API}/bir-forms/${id}/mark-filed`));
      expect(bare.status).toBe(400);
      expect(
        (await overrideFile(id, "Second override after the first undo.")).status,
      ).toBe(200);
      const second = await row(id);
      expect(second.status).toBe("filed");
      expect(
        (await undo(id, { reason: "Undone a second time, still no email" })).status,
      ).toBe(200);
      const hs = await undos(id);
      expect(hs.map((h) => h.reason)).toEqual([
        "Marked filed before eBIRForms sent it",
        "Undone a second time, still no email",
      ]);
      expect(new Set(hs.map((h) => h.confirmationId)).size).toBe(2);
      expect((await confirmations(id)).every((c) => c.supersededAt !== null)).toBe(true);

      // now with the BIR e-mail
      const withEmail = await fileWithConfirmation(app, saToken, id);
      expect(withEmail.status).toBe(200);
      expect(withEmail.body.confirmation).toMatchObject({ kind: "bir_email" });
      const refused = await undo(id);
      expect([refused.status, refused.body.message]).toEqual([409, NOT_ALLOWED]);
      expect((await row(id)).status).toBe("filed");
    });
  });

  // ======================================================================================
  describe("T3 · what is refused", () => {
    it("not a Super Admin: 403; a short or missing reason: 400; nothing changes", async () => {
      const mine = await newClient();
      const id = await draft("2551Q", "2026-Q3", D2551Q, mine);
      expect((await overrideFile(id)).status).toBe(200);
      const managerToken = await managerFor(mine);
      const m = await undo(
        id,
        { reason: "Marked filed before eBIRForms sent it" },
        managerToken,
      );
      expect([m.status, m.body.message]).toEqual([403, SA_ONLY]);
      for (const body of [
        { reason: "too short" },
        { reason: "         " },
        {},
        { reason: 5 },
      ]) {
        const r = await undo(id, body);
        expect([JSON.stringify(body), r.status, r.body.message]).toEqual([
          JSON.stringify(body),
          400,
          SHORT,
        ]);
      }
      expect((await row(id)).status).toBe("filed");
      expect(await undos(id)).toHaveLength(0);
      expect(
        await db.auditLog.count({
          where: { action: "bir-form.filing.undone", entityId: id },
        }),
      ).toBe(0);
    });

    it("a return filed with the BIR e-mail: 409, and no history", async () => {
      const id = await draft();
      expect((await fileWithConfirmation(app, saToken, id)).status).toBe(200);
      const r = await undo(id);
      expect([r.status, r.body.message]).toEqual([409, NOT_ALLOWED]);
      expect((await row(id)).status).toBe("filed");
      expect(await undos(id)).toHaveLength(0);
    });

    it("an override filing whose BIR e-mail was attached afterwards: 409 (the e-mail row is the active one)", async () => {
      const id = await draft();
      expect((await overrideFile(id)).status).toBe(200);
      const bytes = await confirmationFor(db, id);
      const attached = await as(http().post(`${API}/bir-forms/${id}/confirmation`))
        .field("replace", "true")
        .attach("file", bytes, { filename: "c.pdf", contentType: "application/pdf" });
      expect(attached.status).toBe(200);
      const r = await undo(id);
      expect([r.status, r.body.message]).toEqual([409, NOT_ALLOWED]);
      expect((await row(id)).status).toBe("filed");
    });

    it("a BIR e-mail attached once and then replaced by an override: still never undone, by the Portal or by the database", async () => {
      const id = await draft();
      expect((await fileWithConfirmation(app, saToken, id)).status).toBe(200);
      const swapped = await as(http().post(`${API}/bir-forms/${id}/confirmation`))
        .field("replace", "true")
        .field("overrideReason", "The e-mail was replaced by mistake, test");
      expect(swapped.status).toBe(200);
      expect(swapped.body.confirmation).toMatchObject({ kind: "override" });
      const r = await undo(id);
      expect([r.status, r.body.message]).toEqual([409, NOT_ALLOWED]);
      // the database says the same, with the history row and the flag in place
      const filed = await row(id);
      const live = (await confirmations(id)).find((c) => c.supersededAt === null)!;
      await db.birFormFilingUndo.create({
        data: {
          firmId,
          birFormId: id,
          confirmationId: live.id,
          filedAt: filed.filedAt!,
          filedSnapshotJson: filed.filedSnapshotJson as object,
          reason: "A history row made by hand, for the test",
        },
      });
      await expect(
        db.$transaction(async (tx) => {
          await tx.$executeRaw`select set_config('portal.bir_form_undo', ${id}, true)`;
          await tx.birForm.update({
            where: { id },
            data: { status: "draft", filedAt: null, filedSnapshotJson: Prisma.DbNull },
          });
        }),
      ).rejects.toThrow(/BIR_FORM_SEALED/);
      await expect(
        db.$queryRaw`select bir_form_undo_filing(${id}::uuid, ${firmId}::uuid, null, 'A reason of ten or more')`,
      ).rejects.toThrow(/BIR_UNDO_REFUSED/);
      expect((await row(id)).status).toBe("filed");
    });

    it("a draft, a return filed with no confirmation row (the 1601-C), and a missing id", async () => {
      const d = await draft();
      for (const id of [d]) {
        const r = await undo(id);
        expect([r.status, r.body.message]).toEqual([409, NOT_ALLOWED]);
      }
      const c = await draft("1601C", "2026-08", { year: "2026", month: "08" });
      const filed = await as(http().patch(`${API}/bir-forms/${c}`)).send({
        status: "filed",
      });
      expect(filed.status).toBe(200);
      const r = await undo(c);
      expect([r.status, r.body.message]).toEqual([409, NOT_ALLOWED]);
      expect((await row(c)).status).toBe("filed");
      expect((await undo(randomUUID())).status).toBe(404);
    });

    it("another firm's return: 404, nothing changes", async () => {
      const id = await draft();
      expect((await overrideFile(id)).status).toBe(200);
      const r = await undo(
        id,
        { reason: "Marked filed before eBIRForms sent it" },
        otherFirmToken,
      );
      expect(r.status).toBe(404);
      expect((await row(id)).status).toBe("filed");
    });

    it("a return that has been amended: 409", async () => {
      const id = await draft();
      expect((await overrideFile(id)).status).toBe(200);
      const amended = await as(http().post(`${API}/bir-forms/${id}/amend`));
      expect(amended.status).toBe(201);
      const r = await undo(id);
      expect([r.status, r.body.message]).toEqual([409, AMENDED]);
      expect((await row(id)).status).toBe("filed");
    });

    it("the undone draft is edited as any draft; it cannot be deleted (its history is kept)", async () => {
      const id = await draft();
      expect((await overrideFile(id)).status).toBe(200);
      expect((await undo(id)).status).toBe(200);
      const edit = await as(http().patch(`${API}/bir-forms/${id}`)).send({
        data: { ...D2551Q, i15: "1600" },
      });
      expect(edit.status).toBe(200);
      const del = await as(http().delete(`${API}/bir-forms/${id}`));
      expect([del.status, del.body.message]).toEqual([409, UNDONE_NOT_DELETABLE]);
      expect(await row(id)).toBeDefined();
      expect(await undos(id)).toHaveLength(1);
    });
  });

  // ======================================================================================
  describe("T4 · the seal stays as strong as it was", () => {
    const sealed = /BIR_FORM_SEALED/;

    it("a direct update or delete of a filed row is refused, whoever asks", async () => {
      const id = await draft();
      expect((await overrideFile(id)).status).toBe(200);
      await expect(
        db.birForm.update({ where: { id }, data: { dataJson: { x: 1 } } }),
      ).rejects.toThrow(sealed);
      await expect(
        db.birForm.update({ where: { id }, data: { status: "draft", filedAt: null } }),
      ).rejects.toThrow(sealed);
      await expect(db.birForm.delete({ where: { id } })).rejects.toThrow(sealed);
    });

    it("the exception is opened only inside the named function: setting the flag by hand is not enough", async () => {
      const id = await draft();
      expect((await overrideFile(id)).status).toBe(200);
      const attempt = (data: object) =>
        db.$transaction(async (tx) => {
          await tx.$executeRaw`select set_config('portal.bir_form_undo', ${id}, true)`;
          await tx.birForm.update({ where: { id }, data });
        });
      // no history row yet, so nothing is allowed whatever is asked
      await expect(
        attempt({ status: "draft", filedAt: null, filedSnapshotJson: Prisma.DbNull }),
      ).rejects.toThrow(sealed);
      await expect(attempt({ dataJson: { x: 1 } })).rejects.toThrow(sealed);
      expect((await row(id)).status).toBe("filed");
    });

    it("even with the flag and a history row, nothing but the exact transition is allowed", async () => {
      const id = await draft();
      expect((await overrideFile(id)).status).toBe(200);
      const filed = await row(id);
      const [override] = await confirmations(id);
      await db.birFormFilingUndo.create({
        data: {
          firmId,
          birFormId: id,
          confirmationId: override!.id,
          filedAt: filed.filedAt!,
          filedSnapshotJson: filed.filedSnapshotJson as object,
          reason: "A history row made by hand, for the test",
        },
      });
      const attempt = (data: object) =>
        db.$transaction(async (tx) => {
          await tx.$executeRaw`select set_config('portal.bir_form_undo', ${id}, true)`;
          await tx.birForm.update({ where: { id }, data });
        });
      // the data may not change in the same step
      await expect(
        attempt({
          status: "draft",
          filedAt: null,
          filedSnapshotJson: Prisma.DbNull,
          dataJson: { x: 1 },
        }),
      ).rejects.toThrow(sealed);
      // nor may it stay filed, nor lose only part of the filing
      await expect(attempt({ dataJson: { x: 1 } })).rejects.toThrow(sealed);
      await expect(attempt({ status: "draft" })).rejects.toThrow(sealed);
      // it must become a draft with no filed date AND no snapshot: either alone is refused
      // by the seal (not merely by the table's own check)
      await expect(attempt({ status: "draft", filedAt: null })).rejects.toThrow(sealed);
      await expect(
        attempt({ status: "draft", filedSnapshotJson: Prisma.DbNull }),
      ).rejects.toThrow(sealed);
      await expect(attempt({ period: "2026-Q4" })).rejects.toThrow(sealed);
      // a delete is never opened
      await expect(
        db.$transaction(async (tx) => {
          await tx.$executeRaw`select set_config('portal.bir_form_undo', ${id}, true)`;
          await tx.birForm.delete({ where: { id } });
        }),
      ).rejects.toThrow(sealed);
      expect((await row(id)).status).toBe("filed");
    });

    describe("each condition of the exception is needed on its own", () => {
      /** The history row the function would write, made by hand for a filed form. */
      const prime = async (id: string, confirmationId: string | null) => {
        const filed = await row(id);
        await db.birFormFilingUndo.create({
          data: {
            firmId,
            birFormId: id,
            confirmationId,
            filedAt: filed.filedAt!,
            filedSnapshotJson:
              (filed.filedSnapshotJson as object | null) ?? Prisma.DbNull,
            reason: "A history row made by hand, for the test",
          },
        });
      };
      const back = (id: string, flag: boolean) =>
        db.$transaction(async (tx) => {
          if (flag)
            await tx.$executeRaw`select set_config('portal.bir_form_undo', ${id}, true)`;
          await tx.birForm.update({
            where: { id },
            data: { status: "draft", filedAt: null, filedSnapshotJson: Prisma.DbNull },
          });
        });

      it("control: every condition met, by hand, the exact transition is allowed", async () => {
        const id = await draft();
        expect((await overrideFile(id)).status).toBe(200);
        await prime(id, (await confirmations(id))[0]!.id);
        await back(id, true);
        expect((await row(id)).status).toBe("draft");
      });

      it("without the flag, nothing else is enough", async () => {
        const id = await draft();
        expect((await overrideFile(id)).status).toBe(200);
        await prime(id, (await confirmations(id))[0]!.id);
        await expect(back(id, false)).rejects.toThrow(sealed);
        expect((await row(id)).status).toBe("filed");
      });

      it("a filing that rests on no override (the 1601-C, filed by PATCH) is refused", async () => {
        const id = await draft("1601C", "2026-08", { year: "2026", month: "08" });
        expect(
          (await as(http().patch(`${API}/bir-forms/${id}`)).send({ status: "filed" }))
            .status,
        ).toBe(200);
        await prime(id, null);
        await expect(back(id, true)).rejects.toThrow(sealed);
        expect((await row(id)).status).toBe("filed");
      });

      it("a return that has an amendment is refused", async () => {
        const id = await draft();
        expect((await overrideFile(id)).status).toBe(200);
        expect((await as(http().post(`${API}/bir-forms/${id}/amend`))).status).toBe(201);
        await prime(id, (await confirmations(id))[0]!.id);
        await expect(back(id, true)).rejects.toThrow(sealed);
        expect((await row(id)).status).toBe("filed");
      });

      it("a history row of another filing (other date or snapshot) does not open it", async () => {
        const id = await draft();
        expect((await overrideFile(id)).status).toBe(200);
        const filed = await row(id);
        await db.birFormFilingUndo.create({
          data: {
            firmId,
            birFormId: id,
            confirmationId: (await confirmations(id))[0]!.id,
            filedAt: new Date(filed.filedAt!.getTime() - 86_400_000),
            filedSnapshotJson: filed.filedSnapshotJson as object,
            reason: "A history row of another day, for the test",
          },
        });
        await expect(back(id, true)).rejects.toThrow(sealed);
        expect((await row(id)).status).toBe("filed");
      });
    });

    it("a return with a BIR e-mail is refused by the database itself, flag and history row or not", async () => {
      const id = await draft();
      expect((await fileWithConfirmation(app, saToken, id)).status).toBe(200);
      const filed = await row(id);
      const [email] = await confirmations(id);
      await db.birFormFilingUndo.create({
        data: {
          firmId,
          birFormId: id,
          confirmationId: email!.id,
          filedAt: filed.filedAt!,
          filedSnapshotJson: filed.filedSnapshotJson as object,
          reason: "A history row made by hand, for the test",
        },
      });
      await expect(
        db.$transaction(async (tx) => {
          await tx.$executeRaw`select set_config('portal.bir_form_undo', ${id}, true)`;
          await tx.birForm.update({
            where: { id },
            data: { status: "draft", filedAt: null, filedSnapshotJson: Prisma.DbNull },
          });
        }),
      ).rejects.toThrow(sealed);
      // and the function itself refuses it
      await expect(
        db.$queryRaw`select bir_form_undo_filing(${id}::uuid, ${firmId}::uuid, null, 'A reason of ten or more')`,
      ).rejects.toThrow(/BIR_UNDO_REFUSED/);
      expect((await row(id)).status).toBe("filed");
    });
  });
});
