/**
 * track-c-1701-background.db-spec.ts — C5 T1 (seen to fail first): the 1701's
 * background comes from the client's record (D55). Over HTTP against the real Nest
 * app and the local PostgreSQL, invented clients, one draft 1701 each; every case
 * is checked in the eBIRForms XML export AND in the Preview PDF (an "X" drawn in
 * the right box and in no other).
 *
 *   Item 6 taxpayer type, Item 7 ATC (derived, never typed), Item 16 civil status
 *   (the client's record), Items 17 and 18 (answered only for a married taxpayer).
 */
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { truncateOncePerFile } from "./helpers/truncate";
import { BIR_PDF, loadMap, overlay, readPdfText } from "./helpers/pdf-text";
import { AppModule } from "../../src/app.module";
import { TokenService } from "../../src/auth/token.service";
import { PrismaService } from "../../src/prisma/prisma.service";
import { StorageService } from "../../src/storage/storage.service";

truncateOncePerFile({ firmRoles: ["Super Admin", "Manager"] });

const TAG = `track-c-1701bg-${randomUUID().slice(0, 8)}`;
const API = "/api/v1";
const NS = "frm1701:";

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

function binary(res: request.Response, cb: (err: Error | null, body: Buffer) => void) {
  const chunks: Buffer[] = [];
  res.on("data", (c: Buffer) => chunks.push(c));
  res.on("end", () => cb(null, Buffer.concat(chunks)));
}

function exported(xml: string, key: string): string {
  const esc = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const m = new RegExp(`<div>${esc}=(.*?)${esc}=</div>`).exec(xml);
  if (!m) throw new Error(`${key} is not in the export`);
  return m[1]!;
}

// The radio keys of Items 6, 7, 16, 17 and 18, by what they say.
const ITEM6 = {
  S: "rdoPg1I6TaxpayerTypeS",
  P: "rdoPg1I6TaxpayerTypeP",
  E: "rdoPg1I6TaxpayerTypeE",
  T: "rdoPg1I6TaxpayerTypeT",
  C: "rdoPg1I6TaxpayerTypeC",
};
const ITEM7 = {
  II012: "rdoPg1I7ATC_II012",
  II014: "rdoPg1I7ATC_II014",
  II013: "rdoPg1I7ATC_II013",
  II011: "rdoPg1I7ATC_II011",
  II015: "rdoPg1I7ATC_II015",
  II017: "rdoPg1I7ATC_II017",
  II016: "rdoPg1I7ATC_II016",
};
const ITEM16 = {
  S: "rdoPg1I16CivilStatusS",
  M: "rdoPg1I16CivilStatusM",
  LS: "rdoPg1I16CivilStatusLS",
  W: "rdoPg1I16CivilStatusW",
};
const ITEM17 = { Yes: "rdoPg1I17SpouseIncomeYes", No: "rdoPg1I17SpouseIncomeNo" };
const ITEM18 = { J: "rdoPg1I18FilingStatusJ", S: "rdoPg1I18FilingStatusS" };

interface Case {
  name: string;
  client: Record<string, unknown>;
  data: Record<string, unknown>;
  type: keyof typeof ITEM6 | null;
  atc: keyof typeof ITEM7 | null;
  civil: keyof typeof ITEM16 | null;
  i17: keyof typeof ITEM17 | null;
  i18: keyof typeof ITEM18 | null;
}

const person = (civilStatus: string | null, classification: string | null) => ({
  kind: "individual",
  lastName: "HALIMBAWA",
  firstName: "PEDRO",
  middleName: "SUBOK",
  civilStatus,
  classification,
});
const biz = { salesA: "450000", rateA: "graduated", methodA: "osd" };

const CASES: Case[] = [
  {
    name: "single proprietor, Single, graduated, OSD",
    client: person("Single", "Single Proprietorship"),
    data: { ...biz },
    type: "S",
    atc: "II012",
    civil: "S",
    i17: null,
    i18: null,
  },
  {
    name: "single, but the draft carries stale spouse answers: Items 17 and 18 stay blank",
    client: person("Single", "Single Proprietorship"),
    data: { ...biz, spouseIncome: "yes", filing: "joint" },
    type: "S",
    atc: "II012",
    civil: "S",
    i17: null,
    i18: null,
  },
  {
    name: "Married, both answers given (Yes, Joint)",
    client: person("Married", "Single Proprietorship"),
    data: { ...biz, spouseIncome: "yes", filing: "joint" },
    type: "S",
    atc: "II012",
    civil: "M",
    i17: "Yes",
    i18: "J",
  },
  {
    name: "Married, answers No and Separate",
    client: person("MARRIED", "Single Proprietorship"),
    data: { ...biz, spouseIncome: "no", filing: "separate" },
    type: "S",
    atc: "II012",
    civil: "M",
    i17: "No",
    i18: "S",
  },
  {
    name: "Married, unanswered: blank",
    client: person("married", "Single Proprietorship"),
    data: { ...biz },
    type: "S",
    atc: "II012",
    civil: "M",
    i17: null,
    i18: null,
  },
  {
    name: "Legally Separated: the box, 17 and 18 blank",
    client: person("Legally Separated", "Single Proprietorship"),
    data: { ...biz, spouseIncome: "yes", filing: "joint" },
    type: "S",
    atc: "II012",
    civil: "LS",
    i17: null,
    i18: null,
  },
  {
    name: "Widow/Widower: the box, 17 and 18 blank",
    client: person("Widow/Widower", "Single Proprietorship"),
    data: { ...biz },
    type: "S",
    atc: "II012",
    civil: "W",
    i17: null,
    i18: null,
  },
  {
    name: "civil status not set: no box, 17 and 18 blank",
    client: person(null, "Single Proprietorship"),
    data: { ...biz },
    type: "S",
    atc: "II012",
    civil: null,
    i17: null,
    i18: null,
  },
  {
    name: "8% single proprietor: II015",
    client: person("Single", "Single Proprietorship"),
    data: { salesA: "450000", rateA: "eight", methodA: "osd" },
    type: "S",
    atc: "II015",
    civil: "S",
    i17: null,
    i18: null,
  },
  {
    name: "professional, graduated: II014",
    client: person("Single", "Professional"),
    data: { ...biz },
    type: "P",
    atc: "II014",
    civil: "S",
    i17: null,
    i18: null,
  },
  {
    name: "professional, 8%: II017",
    client: person("Single", "Professional"),
    data: { salesA: "450000", rateA: "eight", methodA: "osd" },
    type: "P",
    atc: "II017",
    civil: "S",
    i17: null,
    i18: null,
  },
  {
    name: "mixed income (compensation and business), graduated: II013",
    client: person("Single", "Single Proprietorship"),
    data: { ...biz, compA: "300000" },
    type: "S",
    atc: "II013",
    civil: "S",
    i17: null,
    i18: null,
  },
  {
    name: "mixed income, 8%: II016",
    client: person("Single", "Professional"),
    data: { salesA: "450000", compA: "300000", rateA: "eight", methodA: "osd" },
    type: "P",
    atc: "II016",
    civil: "S",
    i17: null,
    i18: null,
  },
  {
    name: "compensation only: Compensation Earner, II011",
    client: person("Single", null),
    data: { compA: "300000", rateA: "graduated", methodA: "osd" },
    type: "C",
    atc: "II011",
    civil: "S",
    i17: null,
    i18: null,
  },
  {
    name: "estate: Item 6 Estate, no ATC ticked (the form lists none for it)",
    client: {
      kind: "non-individual",
      regName: "ESTATE OF HALIMBAWA",
      taxpayerType: "Estate",
      classification: null,
      civilStatus: null,
    },
    data: { ...biz },
    type: "E",
    atc: null,
    civil: null,
    i17: null,
    i18: null,
  },
  {
    name: "trust: Item 6 Trust, no ATC ticked",
    client: {
      kind: "non-individual",
      regName: "HALIMBAWA FAMILY TRUST",
      taxpayerType: "Trust",
      classification: null,
      civilStatus: null,
    },
    data: { ...biz },
    type: "T",
    atc: null,
    civil: null,
    i17: null,
    i18: null,
  },
  {
    name: "business figures but no classification on the client: nothing ticked in 6 and 7",
    client: person("Single", null),
    data: { ...biz },
    type: null,
    atc: null,
    civil: "S",
    i17: null,
    i18: null,
  },
];

describe("C5 T1 · the 1701's background from the client record (real app over HTTP, db)", () => {
  let app: INestApplication;
  let writer: PrismaService;
  const storage = new FakeStorage();
  let firmId = "";
  let token = "";
  const http = () => request(app.getHttpServer());
  const as = (r: request.Test) => r.set("Authorization", `Bearer ${token}`);

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

  for (const [n, c] of CASES.entries()) {
    it(`${n + 1}. ${c.name}: XML export and Preview PDF`, async () => {
      const client = await writer.client.create({
        data: {
          firmId,
          businessName: `${TAG} case ${n}`,
          tin: "000555777",
          branch: "00000",
          rdo: "027",
          address: "7 Invented St",
          city: "Lungsod ng Halimbawa",
          zip: "0000",
          birthdate: new Date("1980-01-15"),
          citizenship: "Filipino",
          taxType: "PERCENTAGE",
          ...c.client,
        } as never,
      });
      const created = await as(http().post(`${API}/bir-forms`)).send({
        clientId: client.id,
        form: "1701",
        period: "2026",
        data: { year: "2026", ...c.data },
      });
      expect(created.status).toBe(201);
      const id = created.body.id as string;

      const want = new Set<string>(
        [
          c.type && ITEM6[c.type],
          c.atc && ITEM7[c.atc],
          c.civil && ITEM16[c.civil],
          c.i17 && ITEM17[c.i17],
          c.i18 && ITEM18[c.i18],
        ].filter((k): k is string => !!k),
      );
      const all = [
        ...Object.values(ITEM6),
        ...Object.values(ITEM7),
        ...Object.values(ITEM16),
        ...Object.values(ITEM17),
        ...Object.values(ITEM18),
      ];

      // The XML export.
      const xmlRes = await as(http().post(`${API}/bir-forms/${id}/export`));
      expect(xmlRes.status).toBe(201);
      const xml = Buffer.from(
        [...storage.objects.entries()].find(
          ([k]) => k.includes(`/${id}/`) && k.endsWith(`/${xmlRes.body.filename}`),
        )![1].body,
      ).toString("utf8");
      const inXml = all.filter((k) => exported(xml, NS + k) === "true");
      expect(inXml.sort()).toEqual([...want].sort());

      // The Preview PDF: an X in each wanted box and in no other of these boxes.
      const res = await as(http().post(`${API}/bir-forms/${id}/preview-pdf`))
        .buffer(true)
        .parse(binary);
      expect(res.status).toBe(200);
      const map = loadMap("1701-2018-01.json") as unknown as {
        template: string;
        fields: { key: string; kind: string; page?: number; box?: number[] }[];
      };
      const blank = readFileSync(join(BIR_PDF, "templates", map.template));
      const [copy, template] = readPdfText(new Uint8Array(res.body as Buffer), blank);
      const xs = overlay(copy!, template!).filter((t) => t.str === "X");
      const drawn = all.filter((k) => {
        const f = map.fields.find((m) => m.key === NS + k && m.kind === "mark")!;
        const [x0, y0, x1, y1] = f.box as [number, number, number, number];
        return xs.some(
          (t) =>
            t.page === f.page && t.x >= x0 - 1 && t.x <= x1 && t.y >= y0 - 1 && t.y <= y1,
        );
      });
      expect(drawn.sort()).toEqual([...want].sort());
    });
  }
});
