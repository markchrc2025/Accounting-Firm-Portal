/**
 * track-a-withholding-email.db-spec.ts — U24: the 0619-E, 1601-EQ and 1601-C print the client's
 * e-mail when the draft has none typed, as they already did for the contact number. Over HTTP
 * against the real Nest app and the local PostgreSQL, with an in-memory object store. Every firm,
 * client, TIN and address is invented.
 *
 * E1  Preview PDF: a typed e-mail wins; a blank one prints the client's; no e-mail anywhere prints
 *     nothing and is not refused; the contact number is unchanged.
 * E2  The live preview of unsaved data (POST :id/preview) does the same.
 * E3  A filed return prints the e-mail of its filing snapshot, whatever the client's is now.
 * E4  The connector shows what the return will print, and a blank e-mail is never a need.
 */
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { FakeStorage } from "../helpers/file-return";
import { loadAtcReference } from "./helpers/atc-reference";
import { BIR_PDF, loadMap, overlay, printed, readPdfText } from "./helpers/pdf-text";
import { truncateOncePerFile } from "./helpers/truncate";
import { AppModule } from "../../src/app.module";
import { TokenService } from "../../src/auth/token.service";
import { takeFiledSnapshot } from "../../src/bir-forms/filed-snapshot";
import { PrismaService } from "../../src/prisma/prisma.service";
import { StorageService } from "../../src/storage/storage.service";

truncateOncePerFile({ firmRoles: ["Super Admin"], chartOfAccounts: true });

const TAG = `track-a-email-${randomUUID().slice(0, 8)}`;
const API = "/api/v1";
const ACCEPT = "application/json, text/event-stream";
const SECRET = `${TAG}-connector-secret-0123456789abcdef`;
const CLIENT_EMAIL = "books@halimbawa-client.example";
const TYPED_EMAIL = "payables@typed-sample.example";

/** A draft each return previews with, and its map. */
const FORMS = {
  "0619E": {
    period: "2026-08",
    map: "0619E-2018-01.json",
    data: {
      year: "2026",
      month: "08",
      dueDate: "2026-09-10",
      amended: "no",
      anyWithheld: "yes",
      category: "private",
      remittance: "12,345.67",
      previouslyRemitted: "0",
    },
  },
  "1601EQ": {
    period: "2026-Q3",
    map: "1601EQ-2019-01.json",
    data: {
      year: "2026",
      quarter: "3rd",
      amended: "no",
      anyWithheld: "yes",
      category: "private",
    },
  },
  "1601C": {
    period: "2026-08",
    map: "1601C-2018-01.json",
    data: {
      year: "2026",
      month: "08",
      amended: "no",
      anyWithheld: "yes",
      category: "private",
    },
  },
} as const;
type Form = keyof typeof FORMS;
const ALL = Object.keys(FORMS) as Form[];

type ToolResult = { isError?: boolean; structuredContent?: Record<string, unknown> };
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the tests read tool JSON
type Json = Record<string, any>;

describe("U24 · the withholding returns print the client's e-mail by default (real app over HTTP, db)", () => {
  let app: INestApplication;
  let db: PrismaService;
  const storage = new FakeStorage();
  let prevSecret: string | undefined;
  let firmId = "";
  let token = "";
  let rpc = 1;

  const http = () => request(app.getHttpServer());
  const as = (r: request.Test) => r.set("Authorization", `Bearer ${token}`);

  async function newClient(email: string | null, phone: string | null = "0918 111 1111") {
    return db.client.create({
      data: {
        firmId,
        kind: "non_individual",
        regName: "HALIMBAWA TRADING CORP",
        businessName: `${TAG} Halimbawa Trading ${randomUUID().slice(0, 4)}`,
        taxType: "VAT",
        email,
        phone,
        tin: "000555888",
        branch: "00000",
        rdo: "027",
        address: "5 Invented St",
        city: "Lungsod ng Halimbawa",
        zip: "0000",
        taxTypesJson: [
          { type: "Withholding Tax - Expanded" },
          { type: "Withholding Tax - Compensation" },
        ],
      },
    });
  }
  async function draft(
    clientId: string,
    form: Form,
    extra: Record<string, unknown> = {},
  ) {
    const res = await as(http().post(`${API}/bir-forms`)).send({
      clientId,
      form,
      period: FORMS[form].period,
      data: { ...FORMS[form].data, ...extra },
    });
    expect([form, res.status]).toEqual([form, 201]);
    return res.body.id as string;
  }
  /** The text one item prints on a PDF of `form`. */
  function item(form: Form, pdf: Uint8Array, key: string) {
    const map = loadMap(FORMS[form].map);
    const blank = readFileSync(join(BIR_PDF, "templates", map.template));
    const [copy, template] = readPdfText(pdf, blank);
    const field = map.fields.find((f) => f.key === `f${form}:${key}`)!;
    return printed(overlay(copy!, template!), field);
  }
  const previewPdf = (id: string) =>
    as(http().post(`${API}/bir-forms/${id}/preview-pdf`)).buffer(true);
  const livePreview = (id: string, data: object) =>
    as(http().post(`${API}/bir-forms/${id}/preview`))
      .send({ data })
      .buffer(true);
  async function printedBy(form: Form, id: string, key: string) {
    const res = await previewPdf(id);
    expect([form, res.status]).toEqual([form, 200]);
    return item(form, new Uint8Array(res.body), key);
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
    return (res.body.result as ToolResult).structuredContent as Json;
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
    expect(await loadAtcReference(db)).toBe(228);
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
    await app.close();
  });

  // ======================================================================================
  describe("E1 · Preview PDF", () => {
    it.each(ALL)("%s: a blank e-mail prints the client's", async (form) => {
      const c = await newClient(CLIENT_EMAIL);
      const id = await draft(c.id, form);
      expect(await printedBy(form, id, "email")).toBe(CLIENT_EMAIL);
    });
    it.each(ALL)("%s: an e-mail of only spaces is as blank as none", async (form) => {
      const c = await newClient(CLIENT_EMAIL);
      const id = await draft(c.id, form, { email: "   " });
      expect(await printedBy(form, id, "email")).toBe(CLIENT_EMAIL);
    });
    it.each(ALL)("%s: a typed e-mail wins over the client's", async (form) => {
      const c = await newClient(CLIENT_EMAIL);
      const id = await draft(c.id, form, { email: TYPED_EMAIL });
      expect(await printedBy(form, id, "email")).toBe(TYPED_EMAIL);
    });
    it.each(ALL)(
      "%s: no e-mail anywhere: the item is empty and the preview is not refused",
      async (form) => {
        const c = await newClient(null);
        const id = await draft(c.id, form);
        expect(await printedBy(form, id, "email")).toBe("");
      },
    );
    it.each(ALL)(
      "%s: the contact number is unchanged: the client's when none is typed, else the typed one",
      async (form) => {
        const c = await newClient(CLIENT_EMAIL, "0918 111 1111");
        expect(await printedBy(form, await draft(c.id, form), "contact")).toBe(
          "09181111111",
        );
        const typed = await draft(c.id, form, { contact: "0917-000-0000" });
        expect(await printedBy(form, typed, "contact")).toBe("09170000000");
      },
    );
    it("the client's e-mail is read when the return prints, so a later change shows on the next preview", async () => {
      const c = await newClient(null);
      const id = await draft(c.id, "0619E");
      expect(await printedBy("0619E", id, "email")).toBe("");
      await db.client.update({ where: { id: c.id }, data: { email: CLIENT_EMAIL } });
      expect(await printedBy("0619E", id, "email")).toBe(CLIENT_EMAIL);
      const row = await db.birForm.findUniqueOrThrow({ where: { id } });
      expect((row.dataJson as Json).email).toBeUndefined(); // nothing was written into the draft
    });
  });

  // ======================================================================================
  describe("E2 · the live preview of unsaved data", () => {
    it.each(ALL)(
      "%s: an unsaved blank e-mail prints the client's; an unsaved typed one wins",
      async (form) => {
        const c = await newClient(CLIENT_EMAIL);
        const id = await draft(c.id, form, { email: TYPED_EMAIL });
        const blank = await livePreview(id, { ...FORMS[form].data, email: "" });
        expect(blank.status).toBe(200);
        expect(item(form, new Uint8Array(blank.body), "email")).toBe(CLIENT_EMAIL);
        const typed = await livePreview(id, {
          ...FORMS[form].data,
          email: "other@typed.example",
        });
        expect(item(form, new Uint8Array(typed.body), "email")).toBe(
          "other@typed.example",
        );
      },
    );
  });

  // ======================================================================================
  describe("E3 · a filed return reads its snapshot", () => {
    async function filedWith(form: Form, snapshotEmail: string, typed: string | null) {
      const c = await newClient(snapshotEmail);
      const snapshot = takeFiledSnapshot(c, new Date("2026-09-05T02:00:00.000Z"));
      const row = await db.birForm.create({
        data: {
          firmId,
          clientId: c.id,
          form,
          period: FORMS[form].period,
          status: "filed",
          filedAt: new Date("2026-09-05T02:00:00.000Z"),
          dataJson: {
            ...FORMS[form].data,
            contact: "09181111111",
            ...(typed === null ? {} : { email: typed }),
          },
          filedSnapshotJson: snapshot as object,
        },
      });
      // the client changes after filing: the filed return does not
      await db.client.update({
        where: { id: c.id },
        data: { email: "changed-later@client.example" },
      });
      return row.id;
    }
    async function clearCopyEmail(form: Form, id: string) {
      const copy = await as(http().post(`${API}/bir-forms/${id}/clear-copy`));
      expect([form, copy.status]).toEqual([form, 201]);
      const stored = [...storage.objects.entries()].find(([k]) =>
        k.endsWith(`/${id}/${copy.body.filename}`),
      );
      expect(stored).toBeTruthy();
      return item(form, new Uint8Array(stored![1].body), "email");
    }
    it.each(ALL)(
      "%s: filed with no typed e-mail, the clear copy prints the snapshot's",
      async (form) => {
        const id = await filedWith(form, CLIENT_EMAIL, null);
        expect(await clearCopyEmail(form, id)).toBe(CLIENT_EMAIL);
      },
    );
    it.each(ALL)("%s: filed with a typed e-mail, the typed one", async (form) => {
      const id = await filedWith(form, CLIENT_EMAIL, TYPED_EMAIL);
      expect(await clearCopyEmail(form, id)).toBe(TYPED_EMAIL);
    });
    it("the filed row itself is never changed", async () => {
      const id = await filedWith("0619E", CLIENT_EMAIL, "");
      const before = await db.birForm.findUniqueOrThrow({ where: { id } });
      await clearCopyEmail("0619E", id);
      const after = await db.birForm.findUniqueOrThrow({ where: { id } });
      expect([after.dataJson, after.filedSnapshotJson, after.status]).toEqual([
        before.dataJson,
        before.filedSnapshotJson,
        before.status,
      ]);
    });
  });

  // ======================================================================================
  describe("E4 · the connector", () => {
    it.each(ALL)(
      "%s: portal_get_bir_form shows the e-mail and contact number the return will print",
      async (form) => {
        const c = await newClient(CLIENT_EMAIL, "0918 111 1111");
        const blank = await draft(c.id, form);
        expect((await call("portal_get_bir_form", { id: blank })).prints).toEqual({
          contactNumber: "09181111111",
          email: CLIENT_EMAIL,
        });
        const typed = await draft(c.id, form, {
          email: TYPED_EMAIL,
          contact: "0917-000-0000",
        });
        expect((await call("portal_get_bir_form", { id: typed })).prints).toEqual({
          contactNumber: "09170000000",
          email: TYPED_EMAIL,
        });
      },
    );
    it.each(ALL)(
      "%s: portal_bir_form_requirements shows the same before a draft exists",
      async (form) => {
        const c = await newClient(CLIENT_EMAIL, "0918 111 1111");
        const p = FORMS[form].period;
        const args =
          form === "1601EQ"
            ? { clientId: c.id, formCode: form, year: 2026, quarter: 3 }
            : {
                clientId: c.id,
                formCode: form,
                year: Number(p.slice(0, 4)),
                month: Number(p.slice(5, 7)),
              };
        expect((await call("portal_bir_form_requirements", args)).prints).toEqual({
          contactNumber: "09181111111",
          email: CLIENT_EMAIL,
        });
      },
    );
    it.each(ALL)(
      "%s: a blank client e-mail is not a need; a missing contact number still is",
      async (form) => {
        const c = await newClient(null, null);
        const id = await draft(c.id, form);
        const view = await call("portal_get_bir_form", { id });
        expect(view.prints).toEqual({ contactNumber: null, email: null });
        const keys = (view.needs as Array<{ key: string }>).map((n) => n.key);
        expect(keys).toContain("client.contactNumber");
        expect(keys.filter((k) => /email/i.test(k))).toEqual([]);
      },
    );
    it("a filed return shows what its snapshot prints", async () => {
      const c = await newClient(CLIENT_EMAIL, "0918 111 1111");
      const row = await db.birForm.create({
        data: {
          firmId,
          clientId: c.id,
          form: "1601C",
          period: "2026-07",
          status: "filed",
          filedAt: new Date("2026-08-05T02:00:00.000Z"),
          dataJson: { ...FORMS["1601C"].data, month: "07" },
          filedSnapshotJson: takeFiledSnapshot(
            c,
            new Date("2026-09-05T02:00:00.000Z"),
          ) as object,
        },
      });
      await db.client.update({
        where: { id: c.id },
        data: { email: "changed@later.example", phone: "0919 222 2222" },
      });
      expect((await call("portal_get_bir_form", { id: row.id })).prints).toEqual({
        contactNumber: "0918 111 1111",
        email: CLIENT_EMAIL,
      });
    });
  });
});
