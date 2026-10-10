/**
 * track-a-clear-copy.db-spec.ts — U13: a filed return printed on the BIR's own blank
 * form, over HTTP against the real Nest app and the local PostgreSQL, with an
 * in-memory object store. Every firm, client, TIN and figure is invented.
 *
 * T1  POST /bir-forms/:id/clear-copy prints the filed 2551Q's eBIRForms export on
 *     the BIR's blank: the stored PDF has the template's pages, and its text read
 *     back carries the TIN, the name, items 14–24 and both Schedule 1 rows exactly
 *     as the export does; the download route serves it. A draft and a 1701 (no map
 *     yet) are refused with 409.
 * T2  The export fixes (Track C's A2): F1 a Schedule 1 ATC the export cannot encode
 *     refuses the export; F2 2551Q item 13 only for an individual's first quarter;
 *     F3 the 2550Q filing date is the return's own; F4 2550Q fiscal quarters.
 * T3  GET /bir-forms/:id says clearCopyAvailable rightly; a client principal and a
 *     firm user not assigned to the client get 403.
 */
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { truncateOncePerFile } from "./helpers/truncate";
import { BIR_PDF, loadMap, overlay, printed, readPdfText } from "./helpers/pdf-text";
import { AppModule } from "../../src/app.module";
import { TokenService } from "../../src/auth/token.service";
import { PrismaService } from "../../src/prisma/prisma.service";
import { StorageService } from "../../src/storage/storage.service";

truncateOncePerFile({ firmRoles: ["Super Admin", "Manager"] });

const TAG = `track-a-clear-copy-${randomUUID().slice(0, 8)}`;
const API = "/api/v1";

/** In-memory object storage standing in for S3. */
class FakeStorage {
  objects = new Map<string, { body: Uint8Array; contentType: string }>();
  isEnabled() {
    return true;
  }
  birFormExportKey(firmId: string, birFormId: string, filename: string) {
    return `bir-forms/${firmId}/${birFormId}/${filename}`;
  }
  async putObject(key: string, body: Uint8Array, contentType: string) {
    this.objects.set(key, { body, contentType });
  }
  async deleteObject(key: string) {
    this.objects.delete(key);
  }
  async signedGetUrl(key: string) {
    return `https://storage.test/${key}?signed=1`;
  }
}

/** One eBIRForms export field's value, as the file carries it. */
function exported(xml: string, key: string): string {
  const esc = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const m = new RegExp(`<div>${esc}=(.*?)${esc}=</div>`).exec(xml);
  if (!m) throw new Error(`${key} is not in the export`);
  return m[1]!;
}

describe("U13 · clear copies: a filed return on the BIR's own form (real app over HTTP, db)", () => {
  let app: INestApplication;
  let writer: PrismaService;
  const storage = new FakeStorage();
  let firmId = "";
  let clientId = "";
  let token = "";

  const http = () => request(app.getHttpServer());
  const as = (r: request.Test) => r.set("Authorization", `Bearer ${token}`);

  /** A new draft, over HTTP. */
  async function draftForm(
    form: string,
    period: string,
    data: Record<string, unknown>,
    forClient = clientId,
  ) {
    const created = await as(http().post(`${API}/bir-forms`)).send({
      clientId: forClient,
      form,
      period,
      data,
    });
    expect(created.status).toBe(201);
    return created.body.id as string;
  }
  async function markFiled(id: string) {
    const res = await as(http().patch(`${API}/bir-forms/${id}`)).send({
      status: "filed",
    });
    expect(res.status).toBe(200);
  }
  /** POST :id/export, and the XML it stored. */
  async function exportXml(id: string) {
    const res = await as(http().post(`${API}/bir-forms/${id}/export`));
    if (res.status !== 201) return { res, xml: "" };
    const key = [...storage.objects.keys()].find((k) =>
      k.endsWith(`/${id}/${res.body.filename}`),
    )!;
    return { res, xml: Buffer.from(storage.objects.get(key)!.body).toString("utf8") };
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
          businessName: `${TAG} Halimbawa Sari-Sari`,
          kind: "individual",
          lastName: "HALIMBAWA",
          firstName: "JUANA",
          middleName: "SUBOK",
          tin: "000555888",
          branch: "00000",
          rdo: "027",
          address: "5 Invented St",
          city: "Lungsod ng Halimbawa",
          zip: "0000",
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

  it("T1 · a filed 2551Q prints on the BIR's blank: TIN, name, items 14–24 and both Schedule 1 rows as exported; a draft and a 1701 get 409", async () => {
    const id = await draftForm("2551Q", "2026-Q3", {
      year: "2026",
      quarter: "3rd",
      amended: "no",
      periodType: "calendar",
      taxRelief: "no",
      itRate: "graduated",
      rows: [
        { atc: "PT010", taxable: "250000", rate: "3" },
        { atc: "PT040", taxable: "80000.50", rate: "3" },
      ],
      i15: "1500",
      i20: "100",
    });

    // A draft: no clear copy.
    const draft = await as(http().post(`${API}/bir-forms/${id}/clear-copy`));
    expect([draft.status, draft.body.message]).toEqual([
      409,
      "Mark the return as filed first; a clear copy shows what was filed.",
    ]);

    expect(
      (await as(http().patch(`${API}/bir-forms/${id}`)).send({ status: "filed" })).status,
    ).toBe(200);

    // The eBIRForms export, for what the clear copy must carry.
    const xmlExport = await as(http().post(`${API}/bir-forms/${id}/export`));
    expect(xmlExport.status).toBe(201);
    const xmlKey = [...storage.objects.keys()].find((k) => k.endsWith(".xml"))!;
    const xml = Buffer.from(storage.objects.get(xmlKey)!.body).toString("utf8");

    const res = await as(http().post(`${API}/bir-forms/${id}/clear-copy`));
    expect(res.status).toBe(201);
    expect(Object.keys(res.body).sort()).toEqual(["createdAt", "filename", "id", "kind"]);
    expect(res.body.kind).toBe("pdf");
    expect(res.body.filename).toBe(xmlExport.body.filename.replace(/\.xml$/, ".pdf"));
    const row = await writer.birFormExport.findUniqueOrThrow({
      where: { id: res.body.id },
    });
    expect(row).toMatchObject({
      birFormId: id,
      kind: "pdf",
      filename: res.body.filename,
    });
    expect(res.body.createdAt).toBe(row.createdAt.toISOString());
    const stored = storage.objects.get(row.storageKey)!;
    expect(row.storageKey).toBe(xmlKey.replace(/\.xml$/, ".pdf"));
    expect(stored.contentType).toBe("application/pdf");
    const audit = await writer.auditLog.findFirst({
      where: { action: "bir-form.clear-copy", entityId: id },
    });
    expect(audit).not.toBeNull();

    // The template's page count, and the text read back field by field.
    const map = loadMap("2551Q-2018-01.json");
    const blank = readFileSync(join(BIR_PDF, "templates", map.template));
    const [copy, template] = readPdfText(stored.body, blank);
    expect(copy!.pages).toBe(template!.pages);
    expect(copy!.pages).toBe(2);
    const ink = overlay(copy!, template!);
    const field = (key: string) => map.fields.find((f) => f.key === key)!;
    const money = (v: string) => v.replace(/,/g, "");
    const NS = "frm2551Qv2018:";

    expect(
      ["txtTIN1", "txtTIN2", "txtTIN3"].map((k) => printed(ink, field(NS + k))),
    ).toEqual(["000", "555", "888"]);
    expect(printed(ink, field(NS + "registeredName"))).toBe(
      decodeURIComponent(exported(xml, NS + "registeredName")).replace(/\s+/g, ""),
    );
    expect(printed(ink, field(NS + "registeredName"))).toBe("HALIMBAWA,JUANASUBOK");
    for (let i = 14; i <= 24; i++) {
      const key = `${NS}txt${i}`;
      expect([key, printed(ink, field(key))]).toEqual([key, money(exported(xml, key))]);
    }
    // The engine rounds each row to the peso: 14 = 7,500 + 2,400; 24 = 14 − 1,500 + 100.
    expect(printed(ink, field(NS + "txt14"))).toBe("9900.00");
    expect(printed(ink, field(NS + "txt24"))).toBe("8500.00");

    const atc = (n: number) => {
      const choice = map.fields.find((f) => f.key === `drpATC${n}`) as unknown as {
        options: Record<string, string>;
      };
      return choice.options[exported(xml, `drpATC${n}`)];
    };
    for (const n of [1, 2]) {
      expect(printed(ink, field(`drpATC${n}`))).toBe(atc(n));
      expect(printed(ink, field(`txtATCAmt${n}`))).toBe(
        money(exported(xml, `txtATCAmt${n}`)),
      );
      expect(printed(ink, field(`txtATCRate${n}`))).toBe(
        exported(xml, `txtATCRate${n}`).split(".")[0],
      );
      expect(printed(ink, field(`txtATCDue${n}`))).toBe(
        money(exported(xml, `txtATCDue${n}`)),
      );
    }
    expect([atc(1), atc(2)]).toEqual(["PT010", "PT040"]);
    expect(printed(ink, field("txtATCAmt2"))).toBe("80000.50");
    expect(printed(ink, field("drpATC3"))).toBe("");

    // The existing download route serves it.
    const url = await as(http().get(`${API}/bir-forms/${id}/exports/${res.body.id}/url`));
    expect(url.status).toBe(200);
    expect(url.body.url).toContain(row.storageKey);

    // A form with no map yet: refused, even when filed.
    const f1701 = await draftForm("1701", "2026", { year: "2026" });
    await as(http().patch(`${API}/bir-forms/${f1701}`)).send({ status: "filed" });
    const none = await as(http().post(`${API}/bir-forms/${f1701}/clear-copy`));
    expect([none.status, none.body.message]).toEqual([
      409,
      "A clear copy of the 1701 is not available yet.",
    ]);
  });

  // --- T2 (F1–F4) -----------------------------------------------------------------

  describe("T2 · the export fixes", () => {
    const NS1 = "frm2551Qv2018:";
    const NS0 = "frm2550qv2024:";
    const pt = (q: string, extra: Record<string, unknown> = {}) => ({
      year: "2026",
      quarter: q,
      amended: "no",
      periodType: "calendar",
      taxRelief: "no",
      itRate: "graduated",
      rows: [{ atc: "PT010", taxable: "100000", rate: "3" }],
      ...extra,
    });
    const vat = {
      year: "2026",
      amended: "no",
      periodType: "calendar",
      shortPeriod: "no",
    };
    const manila = (d: Date) =>
      new Date(d.getTime() + 8 * 3600_000).toISOString().slice(0, 10).replace(/-/g, "/");
    async function client(over: Record<string, unknown>) {
      return (
        await writer.client.create({
          data: {
            firmId,
            businessName: `${TAG} ${randomUUID().slice(0, 6)} Invented Client`,
            tin: "000555999",
            taxType: "VAT",
            ...over,
          },
        })
      ).id;
    }

    it("F1 · a Schedule 1 row whose ATC the export cannot encode refuses the export and the clear copy (409, naming the ATC and the row); nothing stored", async () => {
      const id = await draftForm(
        "2551Q",
        "2026-Q3",
        pt("3rd", {
          rows: [
            { atc: "PT010", taxable: "100000", rate: "3" },
            { atc: "PT150", taxable: "1000", rate: "3" },
          ],
        }),
      );
      await markFiled(id);
      const objects = storage.objects.size;
      const message =
        "Schedule 1, row 2: the ATC PT150 cannot be written into the eBIRForms export yet. " +
        "Change the row's ATC or remove the row, then export again.";
      const { res } = await exportXml(id);
      expect([res.status, res.body.message]).toEqual([409, message]);
      const copy = await as(http().post(`${API}/bir-forms/${id}/clear-copy`));
      expect([copy.status, copy.body.message]).toEqual([409, message]);
      expect(storage.objects.size).toBe(objects);
    });

    it("F2 · 2551Q item 13 is marked only for an individual in the first quarter", async () => {
      const corp = await client({
        kind: "non-individual",
        regName: "INVENTED TRADING CORP",
      });
      const item13 = (xml: string) => [
        exported(xml, `${NS1}taxRate1`),
        exported(xml, `${NS1}taxRate2`),
      ];
      const corpQ1 = await draftForm("2551Q", "2026-Q1", pt("1st"), corp);
      expect(item13((await exportXml(corpQ1)).xml)).toEqual(["false", "false"]);
      const indivQ2 = await draftForm("2551Q", "2026-Q2", pt("2nd"));
      expect(item13((await exportXml(indivQ2)).xml)).toEqual(["false", "false"]);
      const indivQ1 = await draftForm("2551Q", "2026-Q1", pt("1st", { itRate: "eight" }));
      expect(item13((await exportXml(indivQ1)).xml)).toEqual(["false", "true"]);
      const graduatedQ1 = await draftForm("2551Q", "2026-Q1", pt("1st"));
      expect(item13((await exportXml(graduatedQ1)).xml)).toEqual(["true", "false"]);
    });

    it("F3 · 2550Q dateFiled: a filed return's filedAt date (Manila); a draft's export date (Manila)", async () => {
      const vatClient = await client({
        kind: "non-individual",
        regName: "INVENTED VAT CORP",
      });
      const filed = await draftForm(
        "2550Q",
        "2026-Q3",
        { ...vat, quarter: "3rd" },
        vatClient,
      );
      await markFiled(filed);
      const { filedAt } = await writer.birForm.findUniqueOrThrow({
        where: { id: filed },
      });
      expect(exported((await exportXml(filed)).xml, "dateFiled")).toBe(manila(filedAt!));
      const draft = await draftForm(
        "2550Q",
        "2026-Q3",
        { ...vat, quarter: "3rd" },
        vatClient,
      );
      const before = manila(new Date());
      const got = exported((await exportXml(draft)).xml, "dateFiled");
      expect([before, manila(new Date())]).toContain(got);
      expect(got).not.toMatch(/\/04\/25$/);
    });

    it("F4 · 2550Q quarters follow the client's fiscalYearStart (July): the year ending June 2027", async () => {
      const fiscal = await client({
        kind: "non-individual",
        regName: "INVENTED FISCAL CORP",
        fiscalYearStart: new Date("2026-07-01T00:00:00.000Z"),
      });
      const q1 = await draftForm("2550Q", "2027-Q1", { ...vat, quarter: "1st" }, fiscal);
      const { xml } = await exportXml(q1);
      expect(
        [
          "RtnPeriodFromNo4",
          "RtnPeriodToNo4",
          "calendarNo1",
          "fiscalNo1",
          "selectedMonthNo2",
          "txtYearNo2",
        ].map((k) => exported(xml, NS0 + k)),
      ).toEqual(["7/01/2026", "9/30/2026", "false", "true", "06", "2027"]);
      const q3 = await draftForm("2550Q", "2027-Q3", { ...vat, quarter: "3rd" }, fiscal);
      const x3 = (await exportXml(q3)).xml;
      expect([
        exported(x3, NS0 + "RtnPeriodFromNo4"),
        exported(x3, NS0 + "RtnPeriodToNo4"),
      ]).toEqual(["1/01/2027", "3/31/2027"]);
      // A calendar client keeps calendar quarters.
      const cal = await client({
        kind: "non-individual",
        regName: "INVENTED CALENDAR CORP",
      });
      const c3 = await draftForm("2550Q", "2026-Q3", { ...vat, quarter: "3rd" }, cal);
      const xc = (await exportXml(c3)).xml;
      expect([
        exported(xc, NS0 + "RtnPeriodFromNo4"),
        exported(xc, NS0 + "RtnPeriodToNo4"),
        exported(xc, NS0 + "selectedMonthNo2"),
      ]).toEqual(["7/01/2026", "9/30/2026", "12"]);
    });
  });

  // --- T3 -------------------------------------------------------------------------

  describe("T3 · clearCopyAvailable, and who may print", () => {
    let filed2551Q = "";
    let filedCopy = "";
    beforeAll(async () => {
      filed2551Q = await draftForm("2551Q", "2026-Q2", {
        year: "2026",
        quarter: "2nd",
        rows: [{ atc: "PT010", taxable: "1000", rate: "3" }],
      });
      await markFiled(filed2551Q);
      filedCopy = (await as(http().post(`${API}/bir-forms/${filed2551Q}/clear-copy`)))
        .body.id;
      expect(filedCopy).toBeTruthy();
    });

    it("true for a filed 2551Q or 2550Q; false for a draft, and for a filed 1701 (no map yet)", async () => {
      const available = async (id: string) =>
        (await as(http().get(`${API}/bir-forms/${id}`))).body.clearCopyAvailable;
      const draft = await draftForm("2551Q", "2026-Q2", { year: "2026", quarter: "2nd" });
      const vat = await draftForm("2550Q", "2026-Q2", { year: "2026", quarter: "2nd" });
      expect(await available(vat)).toBe(false);
      await markFiled(vat);
      const f1701 = await draftForm("1701", "2025", { year: "2025" });
      await markFiled(f1701);
      expect({
        filed2551Q: await available(filed2551Q),
        filed2550Q: await available(vat),
        draft2551Q: await available(draft),
        filed1701: await available(f1701),
      }).toEqual({
        filed2551Q: true,
        filed2550Q: true,
        draft2551Q: false,
        filed1701: false,
      });
    });

    it("a client principal gets 403, even holding BIRForms:File on its own client", async () => {
      const role = await writer.role.create({
        data: { name: `${TAG} client filer`, scope: "CLIENT" },
      });
      for (const action of ["Read", "File"]) {
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
      const res = await http()
        .post(`${API}/bir-forms/${filed2551Q}/clear-copy`)
        .set("Authorization", `Bearer ${portalToken}`);
      expect(res.status).toBe(403);
    });

    it("a firm user not assigned to the client gets 403 (D42), for the copy and its download", async () => {
      const other = await writer.client.create({
        data: { firmId, businessName: `${TAG} Other Invented Co`, tin: "000444333" },
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
      const copy = await http()
        .post(`${API}/bir-forms/${filed2551Q}/clear-copy`)
        .set("Authorization", `Bearer ${managerToken}`);
      expect(copy.status).toBe(403);
      const download = await http()
        .get(`${API}/bir-forms/${filed2551Q}/exports/${filedCopy}/url`)
        .set("Authorization", `Bearer ${managerToken}`);
      expect(download.status).toBe(403);
    });
  });
});
