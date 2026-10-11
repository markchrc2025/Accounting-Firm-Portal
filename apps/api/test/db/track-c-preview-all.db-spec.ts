/**
 * track-c-preview-all.db-spec.ts — C2 T1 (seen to fail first): the 1701Q, 1702Q,
 * 1701, 1701A and 1702RT print on the BIR's own blank form, like the 2551Q and
 * 2550Q (D53). Over HTTP against the real Nest app and the local PostgreSQL, with an
 * in-memory object store that records every write. Every firm, client, TIN and
 * figure is invented.
 *
 * For each form, a draft with invented figures:
 *   - POST /bir-forms/:id/preview-pdf: 200, application/pdf, an attachment named
 *     like the XML with "-DRAFT.pdf"; the template's page count; the text layer
 *     carries the invented TIN, name and the key figures exactly as the eBIRForms
 *     export has them, and "DRAFT — NOT FILED" and the footer on every page;
 *     nothing stored (no BirFormExport row, no bucket write);
 *   - after the return is marked filed, POST /bir-forms/:id/clear-copy makes the
 *     clean copy: the same figures, no stamp and no footer;
 *   - a client principal and a firm user not assigned to the client get 403.
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

const TAG = `track-c-preview-all-${randomUUID().slice(0, 8)}`;
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

/** What the paper shows for an exported amount: whole pesos where it has no centavo boxes. */
const pesos = (v: string) => v.replace(/,/g, "").replace(/\.00$/, "");

function binary(res: request.Response, cb: (err: Error | null, body: Buffer) => void) {
  const chunks: Buffer[] = [];
  res.on("data", (c: Buffer) => chunks.push(c));
  res.on("end", () => cb(null, Buffer.concat(chunks)));
}

interface FormCase {
  form: string;
  map: string;
  pages: number;
  period: string;
  who: "individual" | "company";
  data: Record<string, unknown>;
  /** The key prefix of the form's eBIRForms namespace. */
  ns: string;
  /** TIN part keys (without ns), printed "000" "555" "777". */
  tin: string[];
  /** The key of the name field (without ns) and what it prints. */
  name: [string, string];
  /** Amount keys (without ns) whose printed figure must equal the export's. */
  amounts: string[];
  /** Keys with a fixed printed value (without ns): [key, printed]. */
  fixed: [string, string][];
}

const FORMS: FormCase[] = [
  {
    form: "1701Q",
    map: "1701Q-2018-01.json",
    pages: 2,
    period: "2026-Q3",
    who: "individual",
    ns: "frm1701q:",
    tin: ["txtTIN1", "txtTIN2", "txtTIN3"],
    name: ["txtTaxpayerName", "HALIMBAWA,PEDRO,SUBOK"],
    amounts: [
      "txt26A",
      "txt26B",
      "txt27A",
      "txt28A",
      "txt29A",
      "txt30A",
      "txt30B",
      "txt31",
      "txt36A",
      "txt36B",
      "txt45A",
      "txt46A",
      "txt54B",
      "txt62A",
      "txt63A",
      "txt68A",
      "txt68B",
      "txtAmount32",
    ],
    fixed: [
      ["txtYear", "2026"],
      ["txtRDOCode", "027"],
      ["txtPg2TIN1", "000"],
    ],
    data: {
      year: "2026",
      amended: "no",
      sheets: "2",
      filerType: "single",
      atc: "II012",
      rateA: "graduated",
      methodA: "itemized",
      rateB: "eight",
      salesA: "450000",
      cogsA: "120000",
      deductA: "90000",
      prevTaxableA: "100000",
      nonOpA: "12000",
      nonOpDescA: "INTEREST INCOME",
      cwtA: "4000",
      salesB: "300000",
      cwtB: "1500",
      p32bank: "SAMPLE BANK",
      p32num: "000123",
      p32date: "9/15/2026",
      p32amt: "12000",
    },
  },
];

describe("C2 T1 · the five other returns on the BIR's form: Preview PDF and clear copy (real app over HTTP, db)", () => {
  let app: INestApplication;
  let writer: PrismaService;
  const storage = new FakeStorage();
  let firmId = "";
  const clients: Record<"individual" | "company", string> = {
    individual: "",
    company: "",
  };
  let token = "";
  let portalToken = "";
  let managerToken = "";

  const http = () => request(app.getHttpServer());
  const as = (r: request.Test, t = token) => r.set("Authorization", `Bearer ${t}`);
  const preview = (id: string, t = token) =>
    as(http().post(`${API}/bir-forms/${id}/preview-pdf`), t)
      .buffer(true)
      .parse(binary);
  const clearCopy = (id: string, t = token) =>
    as(http().post(`${API}/bir-forms/${id}/clear-copy`), t);

  async function draftForm(c: FormCase) {
    const created = await as(http().post(`${API}/bir-forms`)).send({
      clientId: clients[c.who],
      form: c.form,
      period: c.period,
      data: c.data,
    });
    expect([c.form, created.status]).toEqual([c.form, 201]);
    return created.body.id as string;
  }

  const storedXml = (name: string) =>
    Buffer.from(
      [...storage.objects.entries()].find(([k]) => k.endsWith(`/${name}`))![1].body,
    ).toString("utf8");

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
    clients.individual = (
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
          birthdate: new Date("1980-01-15"),
          citizenship: "Filipino",
          taxType: "PERCENTAGE",
        },
      })
    ).id;
    clients.company = (
      await writer.client.create({
        data: {
          firmId,
          businessName: "HALIMBAWA TRADING CORP",
          regName: "HALIMBAWA TRADING CORP",
          kind: "non_individual",
          tin: "000555777",
          branch: "00000",
          rdo: "027",
          address: "9 Invented Ave",
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

    const role = await writer.role.create({
      data: { name: `${TAG} client reader`, scope: "CLIENT" },
    });
    const permission = await writer.permission.upsert({
      where: { resource_action: { resource: "BIRForms", action: "Read" } },
      update: {},
      create: { resource: "BIRForms", action: "Read" },
    });
    await writer.rolePermission.create({
      data: { roleId: role.id, permissionId: permission.id },
    });
    const portal = await writer.user.create({
      data: {
        firmId,
        userType: "CLIENT",
        fullName: `${TAG} portal user`,
        email: `${TAG}-portal@example.com`,
        status: "ACTIVE",
        clientProfile: { create: { clientId: clients.individual, clientRole: "OWNER" } },
        userRoles: { create: { roleId: role.id, clientScopeId: clients.individual } },
      },
    });
    portalToken = app.get(TokenService).signAccess({
      id: portal.id,
      firmId,
      userType: "CLIENT",
      email: portal.email,
      clientId: clients.individual,
    });
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
    managerToken = app.get(TokenService).signAccess({
      id: manager.id,
      firmId,
      userType: "FIRM",
      email: manager.email,
    });
  });

  afterAll(async () => {
    await app.close();
  });

  for (const c of FORMS) {
    describe(c.form, () => {
      // Read when a test needs it: a form without a map must fail on the answer, not here.
      const mapOf = () => loadMap(c.map);
      const field = (key: string) => mapOf().fields.find((f) => f.key === key)!;
      const known = (k: string) => {
        const f = field(c.ns + k) ?? field(k);
        if (!f) throw new Error(`${c.form}: ${k} is not in the map`);
        return f;
      };
      let draftId = "";

      /** The figures every copy of this return must show, as exported. */
      function expectFigures(ink: ReturnType<typeof overlay>, xml: string) {
        expect(c.tin.map((k) => printed(ink, known(k)))).toEqual(["000", "555", "777"]);
        expect(printed(ink, known(c.name[0]))).toBe(c.name[1]);
        for (const k of c.amounts) {
          const key = c.ns + k;
          expect([key, printed(ink, known(k))]).toEqual([key, pesos(exported(xml, key))]);
        }
        for (const [k, v] of c.fixed) expect([k, printed(ink, known(k))]).toEqual([k, v]);
      }

      it("a draft: Preview PDF is a -DRAFT.pdf of the template's pages, the TIN, name and figures as exported, the stamp and footer on every page, nothing stored", async () => {
        draftId = await draftForm(c);
        const auditBefore = await writer.auditLog.count({ where: { entityId: draftId } });
        const writesBefore = storage.writes;

        const res = await preview(draftId);
        expect(res.status).toBe(200);
        expect(res.headers["content-type"]).toMatch(/^application\/pdf/);
        const pdf = res.body as Buffer;
        expect(pdf.subarray(0, 5).toString("latin1")).toBe("%PDF-");

        expect(await writer.birFormExport.count({ where: { birFormId: draftId } })).toBe(
          0,
        );
        expect(storage.writes).toBe(writesBefore);
        expect(await writer.auditLog.count({ where: { entityId: draftId } })).toBe(
          auditBefore,
        );

        const xmlExport = await as(http().post(`${API}/bir-forms/${draftId}/export`));
        expect(xmlExport.status).toBe(201);
        const xmlName = xmlExport.body.filename as string;
        const xml = storedXml(xmlName);
        expect(res.headers["content-disposition"]).toContain(
          `filename="${xmlName.replace(/\.xml$/, "-DRAFT.pdf")}"`,
        );
        expect(res.headers["content-disposition"]).toMatch(/^attachment;/);

        const blank = readFileSync(join(BIR_PDF, "templates", mapOf().template));
        const [copy, template] = readPdfText(new Uint8Array(pdf), blank);
        expect(copy!.pages).toBe(template!.pages);
        expect(copy!.pages).toBe(c.pages);
        const added = overlay(copy!, template!);
        for (let p = 1; p <= copy!.pages; p++) {
          const onPage = added.filter((t) => t.page === p).map((t) => t.str);
          expect([p, onPage.filter((s) => s === STAMP)]).toEqual([p, [STAMP]]);
          expect([p, onPage.filter((s) => FOOTER.test(s)).length]).toEqual([p, 1]);
        }
        expectFigures(
          added.filter((t) => t.str !== STAMP && !FOOTER.test(t.str)),
          xml,
        );
      });

      it("marked filed: the clear copy is the same figures with no stamp and no footer", async () => {
        const filed = await draftForm(c);
        expect(
          (await as(http().patch(`${API}/bir-forms/${filed}`)).send({ status: "filed" }))
            .status,
        ).toBe(200);
        const made = await clearCopy(filed);
        expect([c.form, made.status]).toEqual([c.form, 201]);
        expect(made.body.kind).toBe("pdf");
        const filename = made.body.filename as string;
        expect(filename).toMatch(/\.pdf$/);
        expect(filename).not.toMatch(/DRAFT/);
        const stored = [...storage.objects.entries()].find(([k]) =>
          k.endsWith(`/${filename}`),
        )!;
        expect(stored[1].contentType).toBe("application/pdf");

        const xmlExport = await as(http().post(`${API}/bir-forms/${filed}/export`));
        expect(xmlExport.status).toBe(201);
        const xml = storedXml(xmlExport.body.filename as string);

        const blank = readFileSync(join(BIR_PDF, "templates", mapOf().template));
        const [copy, template] = readPdfText(new Uint8Array(stored[1].body), blank);
        expect(copy!.pages).toBe(c.pages);
        const added = overlay(copy!, template!);
        expect(added.filter((t) => t.str === STAMP || FOOTER.test(t.str))).toEqual([]);
        expectFigures(added, xml);
      });

      it("a client principal and a firm user not assigned to the client get 403", async () => {
        const id = draftId || (await draftForm(c));
        expect((await preview(id, portalToken)).status).toBe(403);
        expect((await preview(id, managerToken)).status).toBe(403);
        expect((await clearCopy(id, portalToken)).status).toBe(403);
        expect((await clearCopy(id, managerToken)).status).toBe(403);
      });
    });
  }
});
