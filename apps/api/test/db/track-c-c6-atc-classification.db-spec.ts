/**
 * track-c-c6-atc-classification.db-spec.ts — C6 T1 (seen to fail first): on the 1701,
 * 1701A and 1701Q, Item 6 (taxpayer type) is the client's Classification and nothing
 * else, and the ATC is the preparer's choice (d.atc), never derived; on the 1702Q and
 * 1702RT the ATC is the preparer's choice too and is never defaulted (D55 amendment).
 * Over HTTP against the real Nest app and the local PostgreSQL, invented clients, one
 * draft each. Every case is checked in the eBIRForms XML export AND in the Preview PDF
 * (an "X" drawn in the right box and in no other of Items 6, 7, 16, 17 and 18; on the
 * 1702s, the ATC marks and the code written in the ATC box).
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

const TAG = `track-c-c6-${randomUUID().slice(0, 8)}`;
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

type Type = "S" | "P" | "E" | "T" | "C";
type Civil = "S" | "M" | "LS" | "W";

interface FormCfg {
  form: "1701" | "1701A" | "1701Q" | "1702Q" | "1702RT";
  period: string;
  ns: string;
  map: string;
  /** The item numbers the form prints. */
  atcItem: string;
  /** Item 6 boxes the form has (E, T, C are on the 1701; E and T on the 1701Q). */
  type: Partial<Record<Type, string>>;
  /** The ATC boxes the template prints, by code (none on the 1702Q: it takes the code as text). */
  atc: Record<string, string>;
  /** The ATCs the form accepts, when they are not all boxes (1702Q). Default: the keys of atc. */
  atcCodes?: string[];
  /** 1702RT: the "other ATC" box, which no accepted ATC ticks. */
  atcOther?: string;
  /** The text key the ATC code is written into, and what it must hold for a chosen code. */
  atcText?: { key: string; holds: (code: string | null) => string };
  /** A non-individual client (the 1702s). */
  company?: boolean;
  /** Items 16 to 18 (the 1701 and 1701A only). */
  civil?: Record<Civil, string>;
  i17?: { Yes: string; No: string };
  i18?: { J: string; S: string };
  /** A draft with no income figures at all, and the same with business figures. */
  base: Record<string, unknown>;
  biz: Record<string, unknown>;
}

const CFG: FormCfg[] = [
  {
    form: "1701",
    period: "2026",
    ns: "frm1701:",
    map: "1701-2018-01.json",
    atcItem: "7",
    type: {
      S: "rdoPg1I6TaxpayerTypeS",
      P: "rdoPg1I6TaxpayerTypeP",
      E: "rdoPg1I6TaxpayerTypeE",
      T: "rdoPg1I6TaxpayerTypeT",
      C: "rdoPg1I6TaxpayerTypeC",
    },
    atc: {
      II012: "rdoPg1I7ATC_II012",
      II014: "rdoPg1I7ATC_II014",
      II013: "rdoPg1I7ATC_II013",
      II011: "rdoPg1I7ATC_II011",
      II015: "rdoPg1I7ATC_II015",
      II017: "rdoPg1I7ATC_II017",
      II016: "rdoPg1I7ATC_II016",
    },
    civil: {
      S: "rdoPg1I16CivilStatusS",
      M: "rdoPg1I16CivilStatusM",
      LS: "rdoPg1I16CivilStatusLS",
      W: "rdoPg1I16CivilStatusW",
    },
    i17: { Yes: "rdoPg1I17SpouseIncomeYes", No: "rdoPg1I17SpouseIncomeNo" },
    i18: { J: "rdoPg1I18FilingStatusJ", S: "rdoPg1I18FilingStatusS" },
    // Compensation figures only: the case the owner's client printed wrongly.
    base: { compA: "300000", rateA: "graduated", methodA: "osd" },
    biz: { compA: "300000", salesA: "450000", rateA: "graduated", methodA: "osd" },
  },
  {
    form: "1701A",
    period: "2026",
    ns: "frm1701A:",
    map: "1701A-2018-01.json",
    atcItem: "7",
    type: { S: "optTaxType_1", P: "optTaxType_2" },
    atc: {
      II012: "optATC_1",
      II014: "optATC_2",
      II015: "optATC_3",
      II017: "optATC_4",
    },
    civil: {
      S: "optCivilStatus_1",
      M: "optCivilStatus_2",
      LS: "optCivilStatus_3",
      W: "optCivilStatus_4",
    },
    i17: { Yes: "optSpouseIncome_1", No: "optSpouseIncome_2" },
    i18: { J: "optFilingStatus_1", S: "optFilingStatus_2" },
    base: { taxRate: "graduated" },
    biz: { taxRate: "graduated", i36A: "450000" },
  },
  {
    form: "1701Q",
    period: "2026-Q3",
    ns: "frm1701q:",
    map: "1701Q-2018-01.json",
    atcItem: "8",
    type: {
      S: "optType_1",
      P: "optType_2",
      E: "optType_3",
      T: "optType_4",
    },
    atc: {
      II012: "optATC_1",
      II014: "optATC_2",
      II013: "optATC_3",
      II015: "optATC_4",
      II017: "optATC_5",
      II016: "optATC_6",
    },
    base: { rateA: "graduated", methodA: "osd" },
    biz: { salesA: "450000", rateA: "graduated", methodA: "osd" },
  },
  {
    form: "1702Q",
    period: "2026-Q3",
    ns: "frm1702q:",
    map: "1702Q-2018-01.json",
    atcItem: "5",
    type: {},
    atc: {},
    atcCodes: ["IC055"],
    atcText: { key: "txtAtc", holds: (code) => code ?? "" },
    company: true,
    base: { rate: "25", method: "itemized" },
    biz: { rate: "25", method: "itemized" },
  },
  {
    form: "1702RT",
    period: "2026",
    ns: "frm1702RT:",
    map: "1702RT-2018-01.json",
    atcItem: "5",
    type: {},
    atc: { IC055: "rdoPg1I5Atc" },
    atcOther: "rdoPg1I5AtcOther",
    atcText: { key: "drpPg1I5AtcOther", holds: () => "" },
    company: true,
    base: {},
    biz: {},
  },
];

const codesOf = (c: FormCfg) => c.atcCodes ?? Object.keys(c.atc);

const person = (civilStatus: string | null, classification: string | null) => ({
  kind: "individual",
  lastName: "HALIMBAWA",
  firstName: "PEDRO",
  middleName: "SUBOK",
  civilStatus,
  classification,
});
const company = (classification: string | null) => ({
  kind: "non-individual",
  regName: "HALIMBAWA TRADING CORP",
  civilStatus: null,
  classification,
});

interface Case {
  name: string;
  client: Record<string, unknown>;
  data: Record<string, unknown>;
  type: Type | null;
  atc: string | null;
  civil?: Civil | null;
  i17?: "Yes" | "No" | null;
  i18?: "J" | "S" | null;
}

/** The 1702Q and 1702RT: no Item 6, no civil status; only the ATC the preparer chose. */
function casesFor1702(c: FormCfg): Case[] {
  const co = company("Domestic Corporation");
  const out: Case[] = [
    {
      name: "nothing chosen: no ATC ticked, none written (no IC010 default)",
      client: co,
      data: { ...c.base },
      type: null,
      atc: null,
    },
  ];
  for (const code of codesOf(c)) {
    out.push({
      name: `d.atc ${code}: exactly that ATC`,
      client: co,
      data: { ...c.base, atc: code },
      type: null,
      atc: code,
    });
  }
  out.push({
    name: "d.atc ' ic 055 ' (case and spaces): the same as IC055",
    client: co,
    data: { ...c.base, atc: " ic 055 " },
    type: null,
    atc: "IC055",
  });
  return out;
}

/** The cases for one form, built from what the form prints. */
function casesFor(c: FormCfg): Case[] {
  if (c.company) return casesFor1702(c);
  const out: Case[] = [];
  const sp = person("Single", "Single Proprietorship");
  const civ = (k: Civil | null) => (c.civil ? { civil: k, i17: null, i18: null } : {});
  // Compensation figures only (1701); no figures (1701A, 1701Q): Single Proprietor, no ATC.
  out.push({
    name: `Single Proprietorship, no d.atc: Item 6 Single Proprietor, Item 7 nothing${
      c.form === "1701" ? " (compensation figures only)" : ""
    }`,
    client: sp,
    data: { ...c.base },
    type: "S",
    atc: null,
    ...civ("S"),
  });
  // Every ATC the template prints: exactly that box.
  for (const code of Object.keys(c.atc)) {
    out.push({
      name: `Single Proprietorship, d.atc ${code}: exactly that box`,
      client: sp,
      data: { ...c.base, atc: code },
      type: "S",
      atc: code,
      ...civ("S"),
    });
  }
  // The same client with business figures added: Items 6 and 7 do not change.
  out.push({
    name: "business figures added, no d.atc: Items 6 and 7 as without them",
    client: sp,
    data: { ...c.biz },
    type: "S",
    atc: null,
    ...civ("S"),
  });
  const first = Object.keys(c.atc)[0]!;
  out.push({
    name: `business figures added, d.atc ${first}: Items 6 and 7 as without them`,
    client: sp,
    data: { ...c.biz, atc: first },
    type: "S",
    atc: first,
    ...civ("S"),
  });
  // The Classification decides Item 6.
  out.push({
    name: "Professional: Item 6 Professional",
    client: person("Single", "Professional"),
    data: { ...c.base },
    type: "P",
    atc: null,
    ...civ("S"),
  });
  out.push({
    name: "classification written in other case ('professional '): still Professional",
    client: person("Single", "professional "),
    data: { ...c.base },
    type: "P",
    atc: null,
    ...civ("S"),
  });
  for (const k of ["Domestic Corporation", "Partnership"]) {
    out.push({
      name: `${k}: no Item 6 box`,
      client: company(k),
      data: { ...c.biz },
      type: null,
      atc: null,
      ...(c.civil ? { civil: null, i17: null, i18: null } : {}),
    });
  }
  out.push({
    name: "Classification not set, compensation and business figures: no Item 6 box",
    client: person("Single", null),
    data: { ...c.biz },
    type: null,
    atc: null,
    ...civ("S"),
  });
  // The taxpayer-type boxes the Classification can never tick stay empty, even for
  // a client whose Taxpayer type says Estate or Trust (not what Item 6 reads).
  out.push({
    name: "Taxpayer type 'Estate' on a non-individual client with no Classification: no Item 6 box",
    client: { ...company(null), taxpayerType: "Estate" },
    data: { ...c.base },
    type: null,
    atc: null,
    ...(c.civil ? { civil: null, i17: null, i18: null } : {}),
  });
  // Items 17 and 18 (the 1701 and 1701A): as in C5.
  if (c.civil) {
    const ans = { spouseIncome: "yes", filing: "joint" };
    const kinds: [string, Record<string, unknown>, Case][] = [
      [
        "Married, both answers given (Yes, Joint)",
        { ...c.base, ...ans },
        {
          name: "",
          client: {},
          data: {},
          type: "S",
          atc: null,
          civil: "M",
          i17: "Yes",
          i18: "J",
        },
      ],
      [
        "Married (written MARRIED), answers No and Separate",
        { ...c.base, spouseIncome: "no", filing: "separate" },
        {
          name: "",
          client: {},
          data: {},
          type: "S",
          atc: null,
          civil: "M",
          i17: "No",
          i18: "S",
        },
      ],
      [
        "Married, unanswered: blank",
        { ...c.base },
        {
          name: "",
          client: {},
          data: {},
          type: "S",
          atc: null,
          civil: "M",
          i17: null,
          i18: null,
        },
      ],
    ];
    for (const [name, data, want] of kinds) {
      out.push({
        ...want,
        name,
        client: person(
          name.includes("MARRIED") ? "MARRIED" : "Married",
          "Single Proprietorship",
        ),
        data,
      });
    }
    const stale = { ...c.base, ...ans };
    out.push({
      name: "Single, with stale spouse answers in the draft: Items 17 and 18 stay blank",
      client: sp,
      data: stale,
      type: "S",
      atc: null,
      civil: "S",
      i17: null,
      i18: null,
    });
    out.push({
      name: "Legally Separated: the box, 17 and 18 blank",
      client: person("Legally Separated", "Single Proprietorship"),
      data: stale,
      type: "S",
      atc: null,
      civil: "LS",
      i17: null,
      i18: null,
    });
    out.push({
      name: "Widow/Widower: the box, 17 and 18 blank",
      client: person("Widow/Widower", "Single Proprietorship"),
      data: stale,
      type: "S",
      atc: null,
      civil: "W",
      i17: null,
      i18: null,
    });
    out.push({
      name: "civil status not set: no box, 17 and 18 blank",
      client: person(null, "Single Proprietorship"),
      data: stale,
      type: "S",
      atc: null,
      civil: null,
      i17: null,
      i18: null,
    });
  }
  return out;
}

describe("C6 T1 · Item 6 is the Classification, Item 7 is chosen (real app over HTTP, db)", () => {
  let app: INestApplication;
  let writer: PrismaService;
  const storage = new FakeStorage();
  let firmId = "";
  let token = "";
  let seq = 0;
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

  /** An invented client and a draft of the form for it. */
  async function draft(
    c: FormCfg,
    client: Record<string, unknown>,
    data: Record<string, unknown>,
  ) {
    seq += 1;
    const row = await writer.client.create({
      data: {
        firmId,
        businessName: `${TAG} case ${seq}`,
        tin: "000555777",
        branch: "00000",
        rdo: "027",
        address: "7 Invented St",
        city: "Lungsod ng Halimbawa",
        zip: "0000",
        birthdate: new Date("1980-01-15"),
        citizenship: "Filipino",
        taxType: "PERCENTAGE",
        ...client,
      } as never,
    });
    const created = await as(http().post(`${API}/bir-forms`)).send({
      clientId: row.id,
      form: c.form,
      period: c.period,
      data: { year: "2026", ...data },
    });
    expect(created.status).toBe(201);
    return created.body.id as string;
  }

  for (const c of CFG) {
    const all = [
      ...Object.values(c.type),
      ...Object.values(c.atc),
      ...(c.atcOther ? [c.atcOther] : []),
      ...(c.civil ? Object.values(c.civil) : []),
      ...(c.i17 ? Object.values(c.i17) : []),
      ...(c.i18 ? Object.values(c.i18) : []),
    ] as string[];

    describe(`BIR Form ${c.form}`, () => {
      for (const [n, k] of casesFor(c).entries()) {
        it(`${c.form} ${n + 1}. ${k.name}: XML export and Preview PDF`, async () => {
          const id = await draft(c, k.client, k.data);
          const want = new Set<string>(
            [
              k.type && c.type[k.type],
              k.atc && c.atc[k.atc],
              k.civil && c.civil?.[k.civil],
              k.i17 && c.i17?.[k.i17],
              k.i18 && c.i18?.[k.i18],
            ].filter((x): x is string => !!x),
          );

          // The XML export.
          const xmlRes = await as(http().post(`${API}/bir-forms/${id}/export`));
          expect(xmlRes.status).toBe(201);
          const xml = Buffer.from(
            [...storage.objects.entries()].find(
              ([key]) =>
                key.includes(`/${id}/`) && key.endsWith(`/${xmlRes.body.filename}`),
            )![1].body,
          ).toString("utf8");
          const inXml = all.filter((key) => exported(xml, c.ns + key) === "true");
          expect(inXml.sort()).toEqual([...want].sort());
          const text = c.atcText ? c.atcText.holds(k.atc) : null;
          if (c.atcText) expect(exported(xml, c.ns + c.atcText.key)).toBe(text);

          // The Preview PDF: an X in each wanted box and in no other of these boxes.
          const res = await as(http().post(`${API}/bir-forms/${id}/preview-pdf`))
            .buffer(true)
            .parse(binary);
          expect(res.status).toBe(200);
          const map = loadMap(c.map) as unknown as {
            template: string;
            fields: { key: string; kind: string; page?: number; box?: number[] }[];
          };
          const blank = readFileSync(join(BIR_PDF, "templates", map.template));
          const [copy, template] = readPdfText(new Uint8Array(res.body as Buffer), blank);
          const xs = overlay(copy!, template!).filter((t) => t.str === "X");
          const drawn = all.filter((key) => {
            const f = map.fields.find((m) => m.key === c.ns + key && m.kind === "mark")!;
            const [x0, y0, x1, y1] = f.box as [number, number, number, number];
            return xs.some(
              (t) =>
                t.page === f.page &&
                t.x >= x0 - 1 &&
                t.x <= x1 &&
                t.y >= y0 - 1 &&
                t.y <= y1,
            );
          });
          expect(drawn.sort()).toEqual([...want].sort());
          if (c.atcText) {
            // What is written in the ATC code box (the text field's own place on the form).
            const f = map.fields.find(
              (m) => m.key === c.ns + c.atcText!.key && m.kind === "text",
            ) as unknown as { page: number; x0: number; x1: number; y: number };
            const written = overlay(copy!, template!)
              .filter(
                (t) =>
                  t.page === f.page &&
                  Math.abs(t.y - f.y) < 4 &&
                  t.x >= f.x0 - 2 &&
                  t.x <= f.x1 + 2,
              )
              .sort((a, b) => a.x - b.x)
              .map((t) => t.str)
              .join("")
              .replace(/\s+/g, "");
            expect(written).toBe(text);
          }
        });
      }

      // An ATC the template does not print on this form is refused, in the export and
      // in the Preview, naming the ATC and the form.
      const outside = c.company
        ? ["II099", "IC010"]
        : ["II099", ...["II011", "II013", "II016"].filter((a) => !(a in c.atc))];
      for (const code of outside) {
        it(`${c.form}: d.atc ${code} is refused at export and at Preview, naming the ATC and the form`, async () => {
          const id = await draft(
            c,
            c.company
              ? company("Domestic Corporation")
              : person("Single", "Single Proprietorship"),
            { ...c.base, atc: code },
          );
          const message = `Item ${c.atcItem}: the ATC ${code} is not one of the ATC choices printed on BIR Form ${c.form}. Choose Item ${c.atcItem} again, or clear it, then try again.`;
          const xmlRes = await as(http().post(`${API}/bir-forms/${id}/export`));
          expect(xmlRes.status).toBe(409);
          expect(xmlRes.body.message).toBe(message);
          const pdfRes = await as(http().post(`${API}/bir-forms/${id}/preview-pdf`));
          expect(pdfRes.status).toBe(409);
          expect(pdfRes.body.message).toBe(message);
        });
      }
    });
  }
});
