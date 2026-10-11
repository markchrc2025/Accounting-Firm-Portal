/**
 * track-c-preview.db-spec.ts — C3 T1 (seen to fail first): "Preview PDF". A draft
 * return printed on the BIR's own blank form, stamped DRAFT, over HTTP against the
 * real Nest app and the local PostgreSQL, with an in-memory object store that
 * records every write. Every firm, client, TIN and figure is invented.
 *
 * POST /bir-forms/:id/preview-pdf on a draft 2551Q with two Schedule 1 rows:
 *   - 200, application/pdf, an attachment named like the XML with "-DRAFT.pdf";
 *   - the template's page count; the text layer carries the TIN, the name, items
 *     14–24 and both rows exactly as the eBIRForms export does, plus
 *     "DRAFT — NOT FILED" and the preview footer on every page;
 *   - nothing stored: no BirFormExport row, no bucket write, no audit row.
 * Refusals: a filed return and a draft 1701 (no map yet) get 409 with their
 * sentences; a builder refusal keeps its own message. A client principal and a
 * firm user not assigned to the client get 403. GET :id and the list say
 * previewAvailable.
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

const TAG = `track-c-preview-${randomUUID().slice(0, 8)}`;
const API = "/api/v1";
const STAMP = "DRAFT — NOT FILED";
const FOOTER =
  /^Preview printed \d{2} [A-Z][a-z]{2} \d{4}, \d{1,2}:\d{2} (AM|PM) \(Manila\) from the Portal\. Not the filed return\.$/;

/** In-memory object storage standing in for S3; it remembers every write. */
class FakeStorage {
  objects = new Map<string, { body: Uint8Array; contentType: string }>();
  writes = 0;
  isEnabled() {
    return true;
  }
  birFormExportKey(firmId: string, birFormId: string, filename: string) {
    return `bir-forms/${firmId}/${birFormId}/${filename}`;
  }
  async putObject(key: string, body: Uint8Array, contentType: string) {
    this.writes += 1;
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

/** supertest: collect a binary body as a Buffer. */
function binary(res: request.Response, cb: (err: Error | null, body: Buffer) => void) {
  const chunks: Buffer[] = [];
  res.on("data", (c: Buffer) => chunks.push(c));
  res.on("end", () => cb(null, Buffer.concat(chunks)));
}

describe("C3 T1 · Preview PDF: a draft return on the BIR's form, stamped DRAFT (real app over HTTP, db)", () => {
  let app: INestApplication;
  let writer: PrismaService;
  const storage = new FakeStorage();
  let firmId = "";
  let clientId = "";
  let token = "";
  let draftId = "";

  const http = () => request(app.getHttpServer());
  const as = (r: request.Test, t = token) => r.set("Authorization", `Bearer ${t}`);
  const preview = (id: string, t = token) =>
    as(http().post(`${API}/bir-forms/${id}/preview-pdf`), t)
      .buffer(true)
      .parse(binary);

  async function draftForm(form: string, period: string, data: Record<string, unknown>) {
    const created = await as(http().post(`${API}/bir-forms`)).send({
      clientId,
      form,
      period,
      data,
    });
    expect(created.status).toBe(201);
    return created.body.id as string;
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
          businessName: `${TAG} Halimbawa Tindahan`,
          kind: "individual",
          lastName: "HALIMBAWA",
          firstName: "PEDRO",
          middleName: "SUBOK",
          tin: "000555777",
          branch: "00000",
          rdo: "027",
          address: "7 Invented St",
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
    draftId = await draftForm("2551Q", "2026-Q3", {
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
  });

  afterAll(async () => {
    await app.close();
  });

  it("a draft 2551Q: 200, the PDF itself as a -DRAFT.pdf attachment; the template's pages; every figure as exported; the stamp and footer on every page; nothing stored", async () => {
    const auditBefore = await writer.auditLog.count({ where: { entityId: draftId } });
    const writesBefore = storage.writes;

    const res = await preview(draftId);
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/^application\/pdf/);
    const pdf = res.body as Buffer;
    expect(pdf.subarray(0, 5).toString("latin1")).toBe("%PDF-");

    // Never stored: no export row, no bucket write, no audit row (it is a read).
    expect(await writer.birFormExport.count({ where: { birFormId: draftId } })).toBe(0);
    expect(storage.writes).toBe(writesBefore);
    expect(await writer.auditLog.count({ where: { entityId: draftId } })).toBe(auditBefore);

    // The eBIRForms export of the same draft (same builder, same mapping).
    const xmlExport = await as(http().post(`${API}/bir-forms/${draftId}/export`));
    expect(xmlExport.status).toBe(201);
    const xmlName = xmlExport.body.filename as string;
    const xml = Buffer.from(
      [...storage.objects.entries()].find(([k]) => k.endsWith(`/${xmlName}`))![1].body,
    ).toString("utf8");
    expect(res.headers["content-disposition"]).toContain(
      `filename="${xmlName.replace(/\.xml$/, "-DRAFT.pdf")}"`,
    );
    expect(res.headers["content-disposition"]).toMatch(/^attachment;/);

    const map = loadMap("2551Q-2018-01.json");
    const blank = readFileSync(join(BIR_PDF, "templates", map.template));
    const [copy, template] = readPdfText(new Uint8Array(pdf), blank);
    expect(copy!.pages).toBe(template!.pages);
    expect(copy!.pages).toBe(2);
    const added = overlay(copy!, template!);

    // The stamp and the footer, on every page.
    for (let p = 1; p <= copy!.pages; p++) {
      const onPage = added.filter((t) => t.page === p).map((t) => t.str);
      expect([p, onPage.filter((s) => s === STAMP)]).toEqual([p, [STAMP]]);
      expect([p, onPage.filter((s) => FOOTER.test(s)).length]).toEqual([p, 1]);
    }

    // Every figure exactly as exported, read from the boxes (the stamp set aside).
    const ink = added.filter((t) => t.str !== STAMP && !FOOTER.test(t.str));
    const field = (key: string) => map.fields.find((f) => f.key === key)!;
    const money = (v: string) => v.replace(/,/g, "");
    const NS = "frm2551Qv2018:";
    expect(
      ["txtTIN1", "txtTIN2", "txtTIN3"].map((k) => printed(ink, field(NS + k))),
    ).toEqual(["000", "555", "777"]);
    expect(printed(ink, field(NS + "registeredName"))).toBe("HALIMBAWA,PEDROSUBOK");
    for (let i = 14; i <= 24; i++) {
      const key = `${NS}txt${i}`;
      expect([key, printed(ink, field(key))]).toEqual([key, money(exported(xml, key))]);
    }
    expect(printed(ink, field(NS + "txt14"))).toBe("9900.00");
    for (const n of [1, 2]) {
      for (const k of [`txtATCAmt${n}`, `txtATCDue${n}`]) {
        expect([k, printed(ink, field(k))]).toEqual([k, money(exported(xml, k))]);
      }
      expect(printed(ink, field(`txtATCRate${n}`))).toBe("3");
    }
    expect([printed(ink, field("drpATC1")), printed(ink, field("drpATC2"))]).toEqual([
      "PT010",
      "PT040",
    ]);
    expect(printed(ink, field("txtATCAmt2"))).toBe("80000.50");
  });

  it("GET :id and the list say previewAvailable: true for a draft with a map, false for a filed return and for a 1701", async () => {
    const f1701 = await draftForm("1701", "2026", { year: "2026" });
    const filed = await draftForm("2551Q", "2026-Q1", { year: "2026", quarter: "1st" });
    expect((await as(http().patch(`${API}/bir-forms/${filed}`)).send({ status: "filed" })).status).toBe(200);
    const one = async (id: string) =>
      (await as(http().get(`${API}/bir-forms/${id}`))).body.previewAvailable;
    expect({ draft: await one(draftId), filed: await one(filed), f1701: await one(f1701) }).toEqual({
      draft: true,
      filed: false,
      f1701: false,
    });
    const list = (await as(http().get(`${API}/bir-forms?clientId=${clientId}`))).body as {
      id: string;
      previewAvailable: boolean;
    }[];
    const byId = new Map(list.map((r) => [r.id, r.previewAvailable]));
    expect([byId.get(draftId), byId.get(filed), byId.get(f1701)]).toEqual([true, false, false]);
  });

  it("refusals, each 409 with its sentence: a filed return; a draft 1701; a builder refusal keeps its own words", async () => {
    const filed = await draftForm("2551Q", "2026-Q2", {
      year: "2026",
      quarter: "2nd",
      rows: [{ atc: "PT010", taxable: "1000", rate: "3" }],
    });
    await as(http().patch(`${API}/bir-forms/${filed}`)).send({ status: "filed" });
    const a = await preview(filed);
    expect([a.status, JSON.parse((a.body as Buffer).toString("utf8")).message]).toEqual([
      409,
      "This return is filed. Use Download clear copy.",
    ]);

    const f1701 = await draftForm("1701", "2025", { year: "2025" });
    const b = await preview(f1701);
    expect([b.status, JSON.parse((b.body as Buffer).toString("utf8")).message]).toEqual([
      409,
      "A preview of the 1701 is not available yet.",
    ]);

    // An ATC the export cannot encode: the builder's refusal, word for word.
    const bad = await draftForm("2551Q", "2026-Q4", {
      year: "2026",
      quarter: "4th",
      rows: [{ atc: "PT150", taxable: "1000", rate: "18" }],
    });
    const exportRefusal = await as(http().post(`${API}/bir-forms/${bad}/export`));
    expect(exportRefusal.status).toBe(409);
    const c = await preview(bad);
    expect([c.status, JSON.parse((c.body as Buffer).toString("utf8")).message]).toEqual([
      409,
      exportRefusal.body.message,
    ]);
  });

  it("a client principal and a firm user not assigned to the client get 403", async () => {
    const role = await writer.role.create({
      data: { name: `${TAG} client reader`, scope: "CLIENT" },
    });
    const permission = await writer.permission.upsert({
      where: { resource_action: { resource: "BIRForms", action: "Read" } },
      update: {},
      create: { resource: "BIRForms", action: "Read" },
    });
    await writer.rolePermission.create({ data: { roleId: role.id, permissionId: permission.id } });
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
    expect((await preview(draftId, portalToken)).status).toBe(403);

    const other = await writer.client.create({
      data: { firmId, businessName: `${TAG} Other Invented Co`, tin: "000444222" },
    });
    const manager = await writer.user.create({
      data: {
        firmId,
        userType: "FIRM",
        fullName: `${TAG} manager`,
        email: `${TAG}-manager@example.com`,
        status: "ACTIVE",
        firmProfile: {
          create: { title: "Test", clientAssignments: { create: { clientId: other.id } } },
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
    expect((await preview(draftId, managerToken)).status).toBe(403);
  });
});
