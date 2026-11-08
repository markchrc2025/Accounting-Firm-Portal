/**
 * track-a-contact-number.db-spec.ts — U21: a return does not leave the Portal without a
 * contact number (eBIRForms will not submit one). Over HTTP against the real Nest app
 * and the local PostgreSQL, with an in-memory object store. Every firm, client, TIN and
 * number is invented.
 *
 * T1  Each of the ten returns that print a contact number refuses a blank one, with the one
 *     sentence, on the eBIRForms XML export, Preview PDF and Mark as filed (the three
 *     withholding returns are printed, never exported: their export keeps its own answer).
 * T2  Clear copy and export of a filed return: refused for a return filed before the
 *     snapshot existed (it reads the live client); a sealed snapshot is never refused and
 *     answers what it was filed with, whatever the client's number is now.
 * T3  The client's number clears it: export, Preview and Mark as filed go through, and the
 *     number is in the XML and in the snapshot; 13 digits are refused in the engine's words.
 * T4  The withholding returns take the number typed in the draft, else the client's.
 * T5  The connector lists the need for each form and it clears after portal_update_client.
 */
import { randomUUID } from "node:crypto";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { FakeStorage, fileWithConfirmation } from "../helpers/file-return";
import { loadAtcReference } from "./helpers/atc-reference";
import { truncateOncePerFile } from "./helpers/truncate";
import { AppModule } from "../../src/app.module";
import { TokenService } from "../../src/auth/token.service";
import { takeFiledSnapshot } from "../../src/bir-forms/filed-snapshot";
import { PrismaService } from "../../src/prisma/prisma.service";
import { StorageService } from "../../src/storage/storage.service";

truncateOncePerFile({ firmRoles: ["Super Admin"], chartOfAccounts: true });

const TAG = `track-a-contact-${randomUUID().slice(0, 8)}`;
const API = "/api/v1";
const ACCEPT = "application/json, text/event-stream";
const SECRET = `${TAG}-connector-secret-0123456789abcdef`;
const SENTENCE =
  "Add the client's contact number before this return leaves the Portal. eBIRForms will not submit a return without one.";
const PRINTED_NOT_XML = "This form is printed; eBIRForms XML is not available for it.";

/** form, period, which client, and whether the Portal exports it as XML. */
const FORMS: Array<[string, string, "ind" | "corp", boolean]> = [
  ["2551Q", "2026-Q3", "ind", true],
  ["1701", "2026", "ind", true],
  ["1701A", "2026", "ind", true],
  ["1701Q", "2026-Q3", "ind", true],
  ["2550Q", "2026-Q3", "corp", true],
  ["1702Q", "2026-Q3", "corp", true],
  ["1702RT", "2026", "corp", true],
  ["0619E", "2026-08", "corp", false],
  ["1601EQ", "2026-Q3", "corp", false],
  ["1601C", "2026-08", "corp", false],
];
/** A 2551Q that exports and prints (the one the clear-copy spec uses). */
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
const D0619E = {
  year: "2026",
  month: "08",
  dueDate: "2026-09-10",
  amended: "no",
  anyWithheld: "yes",
  category: "private",
  remittance: "12,345.67",
  previouslyRemitted: "0",
};

type ToolResult = { structuredContent?: Record<string, unknown> };
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the tests read tool JSON
type Json = Record<string, any>;

describe("U21 · the contact number is required before a return leaves the Portal (real app over HTTP, db)", () => {
  let app: INestApplication;
  let db: PrismaService;
  const storage = new FakeStorage();
  let prevSecret: string | undefined;
  let firmId = "";
  let token = "";
  let rpc = 1;
  const who: Record<"ind" | "corp", string> = { ind: "", corp: "" };

  const http = () => request(app.getHttpServer());
  const as = (r: request.Test) => r.set("Authorization", `Bearer ${token}`);

  async function newClient(
    kind: "ind" | "corp",
    phone: string | null,
    tin = "000555888",
  ) {
    const base =
      kind === "ind"
        ? {
            kind: "individual",
            lastName: "HALIMBAWA",
            firstName: "JUANA",
            middleName: "SUBOK",
            businessName: `${TAG} Halimbawa Sari-Sari ${randomUUID().slice(0, 4)}`,
            taxType: "PERCENTAGE",
          }
        : {
            kind: "non_individual",
            regName: "HALIMBAWA TRADING CORP",
            businessName: `${TAG} Halimbawa Trading ${randomUUID().slice(0, 4)}`,
            taxType: "VAT",
          };
    return db.client.create({
      data: {
        firmId,
        ...base,
        phone,
        tin,
        branch: "00000",
        rdo: "027",
        address: "5 Invented St",
        city: "Lungsod ng Halimbawa",
        zip: "0000",
      },
    });
  }
  async function draft(clientId: string, form: string, period: string, data = {}) {
    const res = await as(http().post(`${API}/bir-forms`)).send({
      clientId,
      form,
      period,
      data,
    });
    expect([form, res.status]).toEqual([form, 201]);
    return res.body.id as string;
  }
  /** A return that is already filed, written as the database holds one. */
  const filedRow = (
    clientId: string,
    form: string,
    period: string,
    data: object,
    snapshot: object | null,
  ) =>
    db.birForm.create({
      data: {
        firmId,
        clientId,
        form,
        period,
        status: "filed",
        filedAt: new Date("2026-08-05T02:00:00.000Z"),
        dataJson: data,
        ...(snapshot ? { filedSnapshotJson: snapshot } : {}),
      },
    });
  const preview = (id: string) =>
    as(http().post(`${API}/bir-forms/${id}/preview-pdf`)).buffer(true);
  const exportXml = (id: string) => as(http().post(`${API}/bir-forms/${id}/export`));
  const clearCopy = (id: string) => as(http().post(`${API}/bir-forms/${id}/clear-copy`));
  async function markFiled(id: string, form: string) {
    return form === "1601C"
      ? as(http().patch(`${API}/bir-forms/${id}`)).send({ status: "filed" })
      : fileWithConfirmation(app, token, id);
  }
  /** The XML an export stored, and one value of it. */
  const storedXml = (id: string, filename: string) =>
    Buffer.from(
      storage.objects.get(
        [...storage.objects.keys()].find((k) => k.endsWith(`/${id}/${filename}`))!,
      )!.body,
    ).toString("utf8");
  const exported = (xml: string, key: string) => {
    const esc = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const m = new RegExp(`<div>${esc}=(.*?)${esc}=</div>`).exec(xml);
    if (!m) throw new Error(`${key} is not in the export`);
    return decodeURIComponent(m[1]!);
  };

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
    return res.body.result as ToolResult;
  }
  const j = (r: ToolResult): Json => r.structuredContent as Json;

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
    who.ind = (await newClient("ind", null)).id;
    who.corp = (await newClient("corp", "  ")).id;
  });
  afterAll(async () => {
    if (prevSecret === undefined) delete process.env.MCP_SHARED_SECRET;
    else process.env.MCP_SHARED_SECRET = prevSecret;
    await app.close();
  });

  // ======================================================================================
  describe("T1 · a blank contact number: export, Preview PDF and Mark as filed refuse", () => {
    it.each(FORMS)(
      "%s (%s): the one sentence on each; the draft stays a draft and nothing is stored",
      async (form, period, kind, xml) => {
        const writes = storage.objects.size;
        const id = await draft(who[kind], form, period);

        const pv = await preview(id);
        expect([pv.status, pv.body.message]).toEqual([409, SENTENCE]);

        const ex = await exportXml(id);
        expect([ex.status, ex.body.message]).toEqual([
          409,
          xml ? SENTENCE : PRINTED_NOT_XML,
        ]);

        const mf = await markFiled(id, form);
        expect([mf.status, mf.body.message]).toEqual([409, SENTENCE]);

        const row = await db.birForm.findUniqueOrThrow({ where: { id } });
        expect([row.status, row.filedAt, row.filedSnapshotJson]).toEqual([
          "draft",
          null,
          null,
        ]);
        expect(await db.birFormConfirmation.count({ where: { birFormId: id } })).toBe(0);
        expect(await db.birFormExport.count({ where: { birFormId: id } })).toBe(0);
        expect(storage.objects.size).toBe(writes);
      },
    );

    it("a number made only of separators or letters is as blank as none", async () => {
      for (const phone of ["-", "( ) + .", "n/a", ""]) {
        const c = await newClient("ind", phone, "000555999");
        const id = await draft(c.id, "2551Q", "2026-Q3", D2551Q);
        const ex = await exportXml(id);
        expect([phone, ex.status, ex.body.message]).toEqual([phone, 409, SENTENCE]);
      }
    });
  });

  // ======================================================================================
  describe("T2 · a filed return: the sealed snapshot is never refused; one without a snapshot reads the live client", () => {
    it.each(FORMS)(
      "%s (%s): filed before the snapshot existed, with no number: clear copy%s refused",
      async (form, period, kind, xml) => {
        const row = await filedRow(who[kind], form, period, {}, null);
        const cc = await clearCopy(row.id);
        expect([cc.status, cc.body.message]).toEqual([409, SENTENCE]);
        if (xml) {
          const ex = await exportXml(row.id);
          expect([ex.status, ex.body.message]).toEqual([409, SENTENCE]);
        }
      },
    );

    it("a sealed snapshot answers what it was filed with, whatever the client's number is now", async () => {
      const c = await newClient("ind", "0917 123 4567", "000555111");
      const snap = takeFiledSnapshot(c, new Date("2026-08-05T02:00:00.000Z"));
      const f = await filedRow(c.id, "2551Q", "2026-Q3", D2551Q, snap);
      await db.client.update({ where: { id: c.id }, data: { phone: null } });

      const ex = await exportXml(f.id);
      expect(ex.status).toBe(201);
      expect(exported(storedXml(f.id, ex.body.filename), "frm2551Qv2018:telNo")).toBe(
        "0917 123 4567",
      );
      expect((await clearCopy(f.id)).status).toBe(201);
    });

    it("a sealed snapshot filed without a number is still answered, unchanged (the number stays blank)", async () => {
      const c = await newClient("ind", null, "000555222");
      const snap = takeFiledSnapshot(c, new Date("2026-08-05T02:00:00.000Z"));
      const f = await filedRow(c.id, "2551Q", "2026-Q3", D2551Q, snap);
      await db.client.update({ where: { id: c.id }, data: { phone: "0918 000 0000" } });

      const ex = await exportXml(f.id);
      expect(ex.status).toBe(201);
      expect(exported(storedXml(f.id, ex.body.filename), "frm2551Qv2018:telNo")).toBe("");
      expect((await clearCopy(f.id)).status).toBe(201);
    });
  });

  // ======================================================================================
  describe("T3 · the client's number clears it", () => {
    it("export, Preview and Mark as filed go through; the number is in the XML and the snapshot", async () => {
      const c = await newClient("ind", null, "000555333");
      const id = await draft(c.id, "2551Q", "2026-Q3", D2551Q);
      expect((await exportXml(id)).status).toBe(409);

      const patched = await as(http().patch(`${API}/clients/${c.id}`)).send({
        phone: "0917 123 4567",
      });
      expect(patched.status).toBe(200);

      const ex = await exportXml(id);
      expect(ex.status).toBe(201);
      expect(exported(storedXml(id, ex.body.filename), "frm2551Qv2018:telNo")).toBe(
        "0917 123 4567",
      );
      expect((await preview(id)).status).toBe(200);
      const mf = await markFiled(id, "2551Q");
      expect(mf.status).toBe(200);
      const row = await db.birForm.findUniqueOrThrow({ where: { id } });
      expect((row.filedSnapshotJson as Json).phone).toBe("0917 123 4567");
      expect((await clearCopy(id)).status).toBe(201);
    });

    it("more than 12 digits is refused in the print engine's own words, naming the item; 12 is not", async () => {
      const c = await newClient("ind", "0917 123 4567 8901", "000555444");
      const id = await draft(c.id, "2551Q", "2026-Q3", D2551Q);
      const sentence =
        '2551Q 2018-01 frm2551Qv2018:telNo (item 10): "0917 123 4567 8901" is 15 characters but the paper has 12 boxes';
      for (const res of [await exportXml(id), await preview(id)]) {
        expect([res.status, res.body.message]).toEqual([409, sentence]);
      }
      expect((await markFiled(id, "2551Q")).body.message).toBe(sentence);
      await db.client.update({
        where: { id: c.id },
        data: { phone: "+63 917 123 4567" },
      });
      expect((await exportXml(id)).status).toBe(201);
    });
  });

  // ======================================================================================
  describe("T4 · the withholding returns: the number typed in the draft, else the client's", () => {
    it("a typed number is enough; the client's is used when none was typed; neither is refused", async () => {
      const none = await newClient("corp", null, "000555555");
      const typed = await draft(none.id, "0619E", "2026-08", {
        ...D0619E,
        contact: "0917-000-0000",
      });
      expect((await preview(typed)).status).toBe(200);

      const untyped = await draft(none.id, "0619E", "2026-08", D0619E);
      const refused = await preview(untyped);
      expect([refused.status, refused.body.message]).toEqual([409, SENTENCE]);

      await db.client.update({
        where: { id: none.id },
        data: { phone: "0918 000 0000" },
      });
      expect((await preview(untyped)).status).toBe(200);
    });
  });

  // ======================================================================================
  describe("T5 · the connector asks for it, and portal_update_client writes it", () => {
    it.each(FORMS)(
      "%s: client.contactNumber is a need until portal_update_client sets phone",
      async (form, period, kind) => {
        const c = await newClient(kind, null, "000555666");
        const year = Number(period.slice(0, 4));
        const q = /Q([1-4])$/.exec(period)?.[1];
        const m = /-(\d\d)$/.exec(period)?.[1];
        const args = {
          clientId: c.id,
          formCode: form,
          year,
          ...(q ? { quarter: Number(q) } : {}),
          ...(m && !q ? { month: Number(m) } : {}),
        };
        const ask = async () =>
          j(await call("portal_bir_form_requirements", args)).needs as Array<{
            key: string;
            question: string;
            setWith: string;
            kind: string;
          }>;
        const need = (await ask()).find((n) => n.key === "client.contactNumber");
        expect(need).toMatchObject({
          question: "What is the client's contact number (landline or mobile)?",
          setWith: "portal_update_client field phone",
          kind: "text",
        });

        const upd = await call("portal_update_client", {
          clientId: c.id,
          phone: "0917 123 4567",
        });
        expect((upd as { isError?: boolean }).isError).toBeFalsy();
        expect((await db.client.findUniqueOrThrow({ where: { id: c.id } })).phone).toBe(
          "0917 123 4567",
        );
        expect((await ask()).map((n) => n.key)).not.toContain("client.contactNumber");
      },
    );

    it("a withholding draft with a typed number does not ask; one without still does", async () => {
      const c = await newClient("corp", null, "000555777");
      const ask = async () =>
        (
          j(
            await call("portal_bir_form_requirements", {
              clientId: c.id,
              formCode: "0619E",
              year: 2026,
              month: 8,
            }),
          ).needs as Array<{ key: string }>
        ).map((n) => n.key);
      expect(await ask()).toContain("client.contactNumber");
      const id = await draft(c.id, "0619E", "2026-08", {
        ...D0619E,
        contact: "0917-000-0000",
      });
      expect(await ask()).not.toContain("client.contactNumber");
      await as(http().patch(`${API}/bir-forms/${id}`)).send({ data: D0619E });
      expect(await ask()).toContain("client.contactNumber");
    });
  });
});
