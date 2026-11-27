/**
 * track-a-whole-pesos.db-spec.ts — U26 (D73): whole pesos where the BIR paper has no centavo
 * boxes. Over HTTP against the real Nest app and the local PostgreSQL, with an in-memory object
 * store. Every firm, client, TIN and figure is invented.
 *
 * W1  Saving a draft (POST, PATCH): a whole-peso figure typed with centavos is stored rounded,
 *     with one note per figure; a form with centavo boxes keeps its centavos.
 * W2  The connector's create and update round the same way and answer the notes.
 * W3  A sealed 1701Q with centavos in whole-peso items: Download clear copy is 409 with one
 *     plain sentence naming every item; the filed row is not changed.
 * W4  Undo that filing: the draft keeps its figures as they were (the Preview says what to do);
 *     the first save rounds them, with the notes.
 */
import { randomUUID } from "node:crypto";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { FakeStorage } from "../helpers/file-return";
import { truncateOncePerFile } from "./helpers/truncate";
import { AppModule } from "../../src/app.module";
import { TokenService } from "../../src/auth/token.service";
import { PrismaService } from "../../src/prisma/prisma.service";
import { StorageService } from "../../src/storage/storage.service";

truncateOncePerFile({ firmRoles: ["Super Admin"], chartOfAccounts: true });

const TAG = `track-a-whole-${randomUUID().slice(0, 8)}`;
const API = "/api/v1";
const ACCEPT = "application/json, text/event-stream";
const SECRET = `${TAG}-connector-secret-0123456789abcdef`;
const D1701Q = {
  // U27 (D74): a return is filed only with its Item 8 ATC chosen.
  atc: "II012",
  year: "2026",
  amended: "no",
  rateA: "graduated",
  methodA: "osd",
};
const ITEMS = "Items 36A, 38A, 41A, 45A, 47A, 49A and 51A";
const FILED = `This return was filed with centavos in ${ITEMS}, which the 1701Q paper has no boxes for. Undo the filing, save the draft so the figures are rounded to whole pesos, and mark it filed again.`;
const DRAFT = `${ITEMS} have centavos, which the 1701Q paper has no boxes for. Save the draft so the figures are rounded to whole pesos.`;
const NOTE_36 =
  "Item 36A was rounded to 130,508 because eBIRForms takes whole pesos on the 1701Q.";

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the tests read tool JSON
type Json = Record<string, any>;

describe("U26 · whole pesos where the paper has no centavo boxes (real app over HTTP, db)", () => {
  let app: INestApplication;
  let db: PrismaService;
  const storage = new FakeStorage();
  let prevSecret: string | undefined;
  let firmId = "";
  let token = "";
  let rpc = 1;

  const http = () => request(app.getHttpServer());
  const as = (r: request.Test) => r.set("Authorization", `Bearer ${token}`);
  const row = (id: string) => db.birForm.findUniqueOrThrow({ where: { id } });

  async function newClient() {
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
        phone: "09181111111",
        birthdate: new Date("1990-01-01"),
        civilStatus: "Single",
        classification: "Professional",
      },
    });
    return c.id;
  }
  async function call(name: string, args: Record<string, unknown>) {
    const res = await http()
      .post(`${API}/mcp/${SECRET}`)
      .set("Accept", ACCEPT)
      .send({
        jsonrpc: "2.0",
        id: rpc++,
        method: "tools/call",
        params: { name, arguments: args },
      });
    expect(res.status).toBe(200);
    return (res.body.result as { structuredContent: Json }).structuredContent;
  }

  beforeAll(async () => {
    prevSecret = process.env.MCP_SHARED_SECRET;
    process.env.MCP_SHARED_SECRET = SECRET;
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
    if (prevSecret === undefined) delete process.env.MCP_SHARED_SECRET;
    else process.env.MCP_SHARED_SECRET = prevSecret;
    await app?.close();
  });

  describe("W1 · saving a draft", () => {
    it("POST and PATCH store whole pesos in whole-peso fields, with one note per figure", async () => {
      const clientId = await newClient();
      const res = await as(http().post(`${API}/bir-forms`)).send({
        clientId,
        form: "1701Q",
        period: "2026-Q3",
        data: { ...D1701Q, salesA: "130507.95", cogsA: "1000" },
      });
      expect(res.status).toBe(201);
      expect(res.body.notes).toEqual([NOTE_36]);
      expect((await row(res.body.id)).dataJson).toMatchObject({
        salesA: "130508",
        cogsA: "1000",
      });

      const p = await as(http().patch(`${API}/bir-forms/${res.body.id}`)).send({
        data: { ...D1701Q, salesA: "130508", cogsA: "1,000.50", excessA: "99.49" },
      });
      expect(p.status).toBe(200);
      expect(p.body.notes).toEqual([
        "Item 37A was rounded to 1,001 because eBIRForms takes whole pesos on the 1701Q.",
        "Item 55A was rounded to 99 because eBIRForms takes whole pesos on the 1701Q.",
      ]);
      expect((await row(res.body.id)).dataJson).toMatchObject({
        salesA: "130508",
        cogsA: "1001",
        excessA: "99",
      });
      // Nothing to round: no notes.
      const again = await as(http().patch(`${API}/bir-forms/${res.body.id}`)).send({
        data: { ...D1701Q, salesA: "130508" },
      });
      expect(again.body.notes).toEqual([]);
    });

    it("a form with centavo boxes keeps its centavos", async () => {
      const clientId = await newClient();
      const res = await as(http().post(`${API}/bir-forms`)).send({
        clientId,
        form: "0619E",
        period: "2026-08",
        data: { year: "2026", month: "08", remittance: "12,345.67" },
      });
      expect(res.status).toBe(201);
      expect(res.body.notes).toEqual([]);
      expect((await row(res.body.id)).dataJson).toMatchObject({
        remittance: "12,345.67",
      });
    });
  });

  describe("W2 · the connector rounds too", () => {
    it("portal_create_bir_form_draft and portal_update_bir_form_draft store whole pesos and say so", async () => {
      const clientId = await newClient();
      const made = await call("portal_create_bir_form_draft", {
        clientId,
        formCode: "1701Q",
        year: 2026,
        quarter: 3,
        data: { ...D1701Q, salesA: "130507.95" },
      });
      expect(made.notes).toEqual(expect.arrayContaining([NOTE_36]));
      expect((await row(made.id)).dataJson).toMatchObject({ salesA: "130508" });
      const upd = await call("portal_update_bir_form_draft", {
        id: made.id,
        data: { cogsA: "100.50" },
      });
      expect(upd.notes).toEqual(
        expect.arrayContaining([
          "Item 37A was rounded to 101 because eBIRForms takes whole pesos on the 1701Q.",
        ]),
      );
      expect((await row(made.id)).dataJson).toMatchObject({
        salesA: "130508",
        cogsA: "101",
      });
    });
  });

  describe("W3 and W4 · a sealed return with centavos, then undo and save", () => {
    it("clear copy is 409 with every item; undo keeps the figures; the first save rounds them", async () => {
      const clientId = await newClient();
      // A draft saved before U26: its centavos are in the row as typed.
      const d = await db.birForm.create({
        data: {
          firmId,
          clientId,
          form: "1701Q",
          period: "2026-Q3",
          dataJson: { ...D1701Q, salesA: "130507.95" },
        },
      });
      const filed = await as(http().post(`${API}/bir-forms/${d.id}/mark-filed`)).field(
        "overrideReason",
        "eBIRForms submitted it; the BIR e-mail did not arrive yet",
      );
      expect(filed.status).toBe(200);
      const before = await row(d.id);
      expect(before.status).toBe("filed");

      const cc = await as(http().post(`${API}/bir-forms/${d.id}/clear-copy`));
      expect([cc.status, cc.body.message]).toEqual([409, FILED]);
      const after = await row(d.id);
      expect([after.dataJson, after.updatedAt]).toEqual([
        before.dataJson,
        before.updatedAt,
      ]);
      expect(await db.birFormExport.count({ where: { birFormId: d.id } })).toBe(0);

      const undo = await as(http().post(`${API}/bir-forms/${d.id}/undo-filing`)).send({
        reason: "Marked filed before eBIRForms sent it",
      });
      expect(undo.status).toBe(200);
      expect((await row(d.id)).dataJson).toMatchObject({ salesA: "130507.95" });
      const preview = await as(http().post(`${API}/bir-forms/${d.id}/preview-pdf`));
      expect([preview.status, preview.body.message]).toEqual([409, DRAFT]);

      const saved = await as(http().patch(`${API}/bir-forms/${d.id}`)).send({
        data: (await row(d.id)).dataJson,
      });
      expect(saved.status).toBe(200);
      expect(saved.body.notes).toEqual([NOTE_36]);
      expect((await row(d.id)).dataJson).toMatchObject({ salesA: "130508" });
      expect((await as(http().post(`${API}/bir-forms/${d.id}/preview-pdf`))).status).toBe(
        200,
      );
    });
  });
});
