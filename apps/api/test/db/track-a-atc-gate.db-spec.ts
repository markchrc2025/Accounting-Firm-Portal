/**
 * track-a-atc-gate.db-spec.ts — U27 (D74): a return never leaves the Portal (eBIRForms export,
 * Mark as filed on either path, clear copy) while a required ATC is empty; the Super Admin
 * override bypasses only the BIR e-mail. Preview PDF stays open. A code the form does not list
 * is refused when the draft is written. Over HTTP against the real Nest app and the local
 * PostgreSQL, with an in-memory object store. Every firm, client, TIN and figure is invented.
 *
 * G1  Per form (1701, 1701A, 1701Q, 1702Q, 1702RT): with no ATC, export, Mark as filed with the
 *     BIR e-mail, Mark as filed by override, and the clear copy of a return filed with none are
 *     each refused with the one sentence; Preview PDF prints. Once chosen, all four go through.
 * G2  An unknown code is refused on the write path (create and update), naming the item.
 * G3  The spouse's ATC: required on the 1701Q and 1701 when the spouse has sales or receipts.
 * G4  The 2551Q: a Schedule 1 row with a taxable amount and no ATC blocks; an unknown code is
 *     refused on the write path.
 * G5  The connector asks for each missing ATC, with the printed descriptions.
 * G6  Undo filing reaches a return filed before the confirmation rule (no confirmation at all).
 * G7  The contact-number gate still holds beside it.
 * G8  (addendum) The 1701Q's Preview PDF of an 8% return with no spouse column, from the keys the
 *     editor used to default (methodA osd, rateB graduated, methodB osd): no 16A mark and an empty
 *     Part II; a Graduated OSD return still marks 16A.
 */
import { randomUUID } from "node:crypto";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { FakeStorage, fileWithConfirmation } from "../helpers/file-return";
import { PREVIEW_FIXTURES, type PreviewFixture } from "../helpers/preview-fixtures";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { BIR_PDF, loadMap, overlay, readPdfText } from "./helpers/pdf-text";
import { truncateOncePerFile } from "./helpers/truncate";
import { AppModule } from "../../src/app.module";
import { TokenService } from "../../src/auth/token.service";
import { PrismaService } from "../../src/prisma/prisma.service";
import { StorageService } from "../../src/storage/storage.service";

truncateOncePerFile({ firmRoles: ["Super Admin"] });

const TAG = `track-a-atc-${randomUUID().slice(0, 8)}`;
const API = "/api/v1";
const ACCEPT = "application/json, text/event-stream";
const SECRET = `${TAG}-connector-secret-0123456789abcdef`;
const OVERRIDE = "eBIRForms submitted it; the BIR e-mail did not arrive yet";
const CONTACT =
  "Add the client's contact number before this return leaves the Portal. eBIRForms will not submit a return without one.";
const ITEM: Record<string, string> = {
  "1701": "7",
  "1701A": "7",
  "1701Q": "8",
  "1702Q": "5",
  "1702RT": "5",
};
const choose = (item: string) =>
  `Choose the Item ${item} ATC before this return leaves the Portal.`;
const FORMS = ["1701", "1701A", "1701Q", "1702Q", "1702RT"];
/** The fixture, its spouse's ATC chosen where the spouse has sales (the 1701Q's). */
const fx = (form: string): PreviewFixture => {
  const f = PREVIEW_FIXTURES.find((x) => x.form === form)!;
  return form === "1701Q" ? { ...f, data: { ...f.data, spouseAtc: "II015" } } : f;
};
const withoutAtc = (d: Record<string, unknown>) => {
  const { atc: _atc, ...rest } = d;
  return rest;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the tests read JSON
type Json = Record<string, any>;

function binary(res: request.Response, cb: (err: Error | null, body: Buffer) => void) {
  const chunks: Buffer[] = [];
  res.on("data", (c: Buffer) => chunks.push(c));
  res.on("end", () => cb(null, Buffer.concat(chunks)));
}

describe("U27 · the ATC gate (real app over HTTP, db)", () => {
  let app: INestApplication;
  let db: PrismaService;
  const storage = new FakeStorage();
  let prevSecret: string | undefined;
  let firmId = "";
  let token = "";
  let rpc = 1;
  let seq = 0;

  const http = () => request(app.getHttpServer());
  const as = (r: request.Test) => r.set("Authorization", `Bearer ${token}`);
  const row = (id: string) => db.birForm.findUniqueOrThrow({ where: { id } });

  async function newClient(who: "ind" | "corp", phone: string | null = "09181111111") {
    seq += 1;
    const tin = String(100000000 + seq * 7919).slice(0, 9);
    return (
      await db.client.create({
        data: {
          firmId,
          ...(who === "ind"
            ? {
                kind: "individual",
                lastName: "HALIMBAWA",
                firstName: "JUANA",
                middleName: "SUBOK",
                businessName: `${TAG} Halimbawa Sari-Sari ${seq}`,
                taxType: "PERCENTAGE",
                birthdate: new Date("1980-01-15"),
                citizenship: "Filipino",
              }
            : {
                kind: "non_individual",
                regName: "HALIMBAWA TRADING CORP",
                businessName: `${TAG} Halimbawa Trading ${seq}`,
                taxType: "VAT",
              }),
          phone,
          tin,
          branch: "00000",
          rdo: "027",
          address: "5 Invented St",
          city: "Lungsod ng Halimbawa",
          zip: "0000",
        },
      })
    ).id;
  }
  async function draft(form: string, data: Record<string, unknown>, clientId?: string) {
    const f = fx(form);
    const res = await as(http().post(`${API}/bir-forms`)).send({
      clientId: clientId ?? (await newClient(f.who)),
      form,
      period: f.period,
      data,
    });
    expect([form, res.status, res.body.message]).toEqual([form, 201, undefined]);
    return res.body.id as string;
  }
  const exportXml = (id: string) => as(http().post(`${API}/bir-forms/${id}/export`));
  const preview = (id: string) => as(http().post(`${API}/bir-forms/${id}/preview-pdf`));
  const override = (id: string) =>
    as(http().post(`${API}/bir-forms/${id}/mark-filed`)).field(
      "overrideReason",
      OVERRIDE,
    );
  const clearCopy = (id: string) => as(http().post(`${API}/bir-forms/${id}/clear-copy`));
  /** A return filed with no ATC (as the three found by the audit), straight to the row. */
  async function filedWithout(form: string) {
    const f = fx(form);
    return db.birForm.create({
      data: {
        firmId,
        clientId: await newClient(f.who),
        form,
        period: f.period,
        status: "filed",
        filedAt: new Date("2026-11-15T03:22:12.000Z"),
        dataJson: withoutAtc(f.data) as object,
      },
    });
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

  describe("G1 · per form: nothing leaves without the ATC; Preview stays open", () => {
    it.each(FORMS)(
      "%s: export, both filing paths and the clear copy refuse; preview prints",
      async (form) => {
        const sentence = choose(ITEM[form]!);
        const id = await draft(form, withoutAtc(fx(form).data));
        const ex = await exportXml(id);
        expect([form, ex.status, ex.body.message]).toEqual([form, 409, sentence]);
        expect((await preview(id)).status).toBe(200);
        const ov = await override(id);
        expect([form, ov.status, ov.body.message]).toEqual([form, 409, sentence]);
        const em = await fileWithConfirmation(app, token, id);
        expect([form, em.status, em.body.message]).toEqual([form, 409, sentence]);
        expect((await row(id)).status).toBe("draft");
        expect(await db.birFormExport.count({ where: { birFormId: id } })).toBe(0);

        const sealed = await filedWithout(form);
        const cc = await clearCopy(sealed.id);
        expect([form, cc.status, cc.body.message]).toEqual([form, 409, sentence]);
        const sx = await exportXml(sealed.id);
        expect([form, sx.status, sx.body.message]).toEqual([form, 409, sentence]);
        expect(await db.birFormExport.count({ where: { birFormId: sealed.id } })).toBe(0);
      },
    );

    it.each(FORMS)(
      "%s: once the ATC is chosen, export, both filing paths and the clear copy go through",
      async (form) => {
        const id = await draft(form, withoutAtc(fx(form).data));
        const saved = await as(http().patch(`${API}/bir-forms/${id}`)).send({
          data: fx(form).data,
        });
        expect([form, saved.status]).toEqual([form, 200]);
        expect([form, (await exportXml(id)).status]).toEqual([form, 201]);
        const ov = await override(id);
        expect([form, ov.status, ov.body.message]).toEqual([form, 200, undefined]);
        expect([form, (await clearCopy(id)).status]).toEqual([form, 201]);
        const other = await draft(form, fx(form).data);
        const em = await fileWithConfirmation(app, token, other);
        expect([form, em.status, em.body.message]).toEqual([form, 200, undefined]);
      },
    );
  });

  describe("G2 · an unknown code is refused where the draft is written", () => {
    it.each([
      ["1701Q", "II011", "8"],
      ["1701A", "II013", "7"],
      ["1701", "II099", "7"],
      ["1702Q", "IC010", "5"],
      ["1702RT", "IC010", "5"],
    ])(
      "%s: ATC %s is refused on create and on update; nothing is stored",
      async (form, code, item) => {
        const sentence = `Item ${item}: the ATC ${code} is not one of the ATC choices printed on BIR Form ${form}. Choose Item ${item} again.`;
        const f = fx(form);
        const made = await as(http().post(`${API}/bir-forms`)).send({
          clientId: await newClient(f.who),
          form,
          period: f.period,
          data: { ...f.data, atc: code },
        });
        expect([made.status, made.body.message]).toEqual([400, sentence]);
        const id = await draft(form, f.data);
        const upd = await as(http().patch(`${API}/bir-forms/${id}`)).send({
          data: { ...f.data, atc: code },
        });
        expect([upd.status, upd.body.message]).toEqual([400, sentence]);
        expect((await row(id)).dataJson).toMatchObject({ atc: f.data.atc });
      },
    );

    it("the 1701 lists II011 for the filer; the 1701Q does not", async () => {
      const id = await draft("1701", { ...fx("1701").data, atc: "II011" });
      expect((await row(id)).dataJson).toMatchObject({ atc: "II011" });
    });
  });

  describe("G3 · the spouse's ATC", () => {
    it("1701Q: a spouse with sales needs Item 20; a spouse column with none does not; a wrong code is refused", async () => {
      const { spouseAtc: _s, ...rest } = fx("1701Q").data;
      const base = { ...rest, rateB: "graduated", methodB: "osd", salesB: "" };
      const id = await draft("1701Q", { ...base, salesB: "50000" });
      const ex = await exportXml(id);
      expect([ex.status, ex.body.message]).toEqual([
        409,
        "Choose the spouse's Item 20 ATC before this return leaves the Portal.",
      ]);
      await as(http().patch(`${API}/bir-forms/${id}`)).send({
        data: { ...base, salesB: "50000", spouseAtc: "II011" },
      });
      expect((await exportXml(id)).status).toBe(201);
      const none = await draft("1701Q", base);
      expect((await exportXml(none)).status).toBe(201);
      const bad = await as(http().patch(`${API}/bir-forms/${none}`)).send({
        data: { ...base, spouseAtc: "PT010" },
      });
      expect([bad.status, bad.body.message]).toEqual([
        400,
        "Item 20 (the spouse's ATC): the ATC PT010 is not one of the ATC choices printed on BIR Form 1701Q. Choose Item 20 again.",
      ]);
    });

    it("1701: a spouse with sales needs the spouse's Item 4", async () => {
      const id = await draft("1701", { ...fx("1701").data, salesB: "50000" });
      const ex = await exportXml(id);
      expect([ex.status, ex.body.message]).toEqual([
        409,
        "Choose the spouse's Item 4 ATC before this return leaves the Portal.",
      ]);
    });
  });

  describe("G4 · the 2551Q's Schedule 1 rows", () => {
    it("a row with a taxable amount and no ATC blocks all three; an unknown code is refused on write", async () => {
      const f = fx("2551Q");
      const rows = [
        { atc: "PT010", taxable: "250000", rate: "3" },
        { atc: "", taxable: "80000.50", rate: "3" },
      ];
      const sentence =
        "Schedule 1, row 2 has a taxable amount but no ATC. Choose its ATC before this return leaves the Portal.";
      const id = await draft("2551Q", { ...f.data, rows });
      const ex = await exportXml(id);
      expect([ex.status, ex.body.message]).toEqual([409, sentence]);
      expect((await preview(id)).status).toBe(200);
      const ov = await override(id);
      expect([ov.status, ov.body.message]).toEqual([409, sentence]);
      const em = await fileWithConfirmation(app, token, id);
      expect([em.status, em.body.message]).toEqual([409, sentence]);
      // A row with no ATC and no amount is not a row.
      const empty = await draft("2551Q", {
        ...f.data,
        rows: [rows[0], { atc: "", taxable: "", rate: "" }],
      });
      expect((await exportXml(empty)).status).toBe(201);
      const bad = await as(http().patch(`${API}/bir-forms/${id}`)).send({
        data: {
          ...f.data,
          rows: [rows[0], { atc: "PT150", taxable: "1000", rate: "3" }],
        },
      });
      expect([bad.status, bad.body.message]).toEqual([
        400,
        "Schedule 1, row 2: the ATC PT150 is not one of the ATCs the 2551Q offers. Choose its ATC again.",
      ]);
    });
  });

  describe("G5 · the connector asks; it never picks", () => {
    it("portal_get_bir_form lists the ATC question with the printed descriptions while it is empty", async () => {
      const id = await draft("1701Q", {
        ...withoutAtc(fx("1701Q").data),
        spouseAtc: "",
        rateB: "graduated",
        methodB: "osd",
        salesB: "1000",
      });
      const v = await call("portal_get_bir_form", { id });
      const atc = (v.needs as Json[]).find((n) => n.key === "data.atc")!;
      expect(atc).toMatchObject({
        kind: "atc",
        setWith: expect.stringContaining("portal_update_bir_form_draft"),
        options: ["II012", "II014", "II013", "II015", "II017", "II016"],
        optionLabels: [
          "II012 Business Income-Graduated IT Rates",
          "II014 Income from Profession–Graduated IT Rates",
          "II013 Mixed Income–Graduated IT Rates",
          "II015 Business Income - 8% IT Rate",
          "II017 Income from Profession – 8% IT Rate",
          "II016 Mixed Income – 8% IT Rate",
        ],
      });
      const spouse = (v.needs as Json[]).find((n) => n.key === "data.spouseAtc")!;
      expect(spouse).toMatchObject({
        kind: "atc",
        setWith: expect.stringContaining("spouseAtc"),
        options: ["II012", "II014", "II013", "II011", "II015", "II017", "II016"],
      });
      expect((await row(id)).dataJson).not.toHaveProperty("atc");
    });

    it("the 2551Q: a row with an amount and no ATC is a need", async () => {
      const id = await draft("2551Q", {
        ...fx("2551Q").data,
        rows: [{ atc: "", taxable: "1000", rate: "3" }],
      });
      const v = await call("portal_get_bir_form", { id });
      expect((v.needs as Json[]).find((n) => n.key === "data.rows.1.atc")).toMatchObject({
        kind: "atc",
        options: ["PT010", "PT040", "PT041", "PT060", "PT070", "PT090", "PT120", "PT130"],
      });
    });
  });

  describe("G6 · undo reaches a return filed before the confirmation rule", () => {
    it("a 1701 filed with no confirmation at all goes back to a draft; one with a BIR e-mail never", async () => {
      const sealed = await filedWithout("1701");
      const res = await as(http().post(`${API}/bir-forms/${sealed.id}/undo-filing`)).send(
        {
          reason: "Filed before the ATC was chosen",
        },
      );
      expect([res.status, res.body.message]).toEqual([200, undefined]);
      const after = await row(sealed.id);
      expect([after.status, after.filedAt]).toEqual(["draft", null]);
      const history = await db.birFormFilingUndo.findMany({
        where: { birFormId: sealed.id },
      });
      expect(history).toHaveLength(1);
      expect([history[0]!.confirmationId, history[0]!.overrideReason]).toEqual([
        null,
        null,
      ]);
      // A 1601-C is filed without a confirmation by design: never undone.
      const c = await db.birForm.create({
        data: {
          firmId,
          clientId: sealed.clientId,
          form: "1601C",
          period: "2026-08",
          status: "filed",
          filedAt: new Date("2026-09-09T02:00:00.000Z"),
        },
      });
      const no = await as(http().post(`${API}/bir-forms/${c.id}/undo-filing`)).send({
        reason: "Filed before the ATC was chosen",
      });
      expect(no.status).toBe(409);
      expect((await row(c.id)).status).toBe("filed");
    });
  });

  describe("G8 · the 1701Q's conditional marks on paper", () => {
    const BOXES = [
      "optMethodOfDeduction:_1",
      "optMethodOfDeduction:_2",
      "optSpouseType_1",
      "optSpouseType_2",
      "optSpouseType_3",
      "optSpouseATC_1",
      "optSpouseATC_4",
      "optSpouseForeignTaxCred_1",
      "optSpouseForeignTaxCred_2",
      "optSpouseTaxRate_1",
      "optSpouseTaxRate_2",
      "optSpouseMethod:_1",
      "optSpouseMethod:_2",
    ];
    /** Which of BOXES carry an X on the Preview PDF of a draft. */
    async function xed(data: Record<string, unknown>) {
      const id = await draft("1701Q", data);
      const res = await preview(id).buffer(true).parse(binary);
      expect(res.status).toBe(200);
      const map = loadMap("1701Q-2018-01.json") as unknown as {
        template: string;
        fields: { key: string; kind: string; page?: number; box?: number[] }[];
      };
      const blank = readFileSync(join(BIR_PDF, "templates", map.template));
      const [copy, template] = readPdfText(new Uint8Array(res.body as Buffer), blank);
      const xs = overlay(copy!, template!).filter((t) => t.str === "X");
      return BOXES.filter((key) => {
        const f = map.fields.find(
          (m) => m.key === `frm1701q:${key}` && m.kind === "mark",
        )!;
        const [x0, y0, x1, y1] = f.box as [number, number, number, number];
        return xs.some(
          (t) =>
            t.page === f.page && t.x >= x0 - 1 && t.x <= x1 && t.y >= y0 - 1 && t.y <= y1,
        );
      });
    }

    it("8% with the defaulted keys and the spouse column off: no 16A, an empty Part II", async () => {
      const marked = await xed({
        year: "2026",
        amended: "no",
        atc: "II015",
        rateA: "eight",
        methodA: "osd",
        rateB: "graduated",
        methodB: "osd",
        salesA: "500000",
      });
      expect(marked).toEqual([]);
    });

    it("Graduated with OSD: 16A OSD is marked, as before", async () => {
      const marked = await xed({
        year: "2026",
        amended: "no",
        atc: "II012",
        rateA: "graduated",
        methodA: "osd",
        salesA: "500000",
      });
      expect(marked).toEqual(["optMethodOfDeduction:_2"]);
    });
  });

  describe("G7 · the contact-number gate still holds", () => {
    it("no contact number: the contact sentence answers, before the ATC is asked", async () => {
      const f = fx("1701Q");
      const id = await draft("1701Q", withoutAtc(f.data), await newClient("ind", null));
      const ex = await exportXml(id);
      expect([ex.status, ex.body.message]).toEqual([409, CONTACT]);
      const ov = await override(id);
      expect([ov.status, ov.body.message]).toEqual([409, CONTACT]);
    });
  });
});
