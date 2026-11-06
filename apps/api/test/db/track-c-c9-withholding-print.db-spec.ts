/**
 * track-c-c9-withholding-print.db-spec.ts — C9 T1 (seen to fail first): the 0619-E, the
 * 1601-EQ and the 1601-C print on the BIR's own blanks (D57): Preview PDF for a draft
 * (stamped DRAFT, never stored), Download clear copy for a filed return (no stamp, no
 * footer; from the filing snapshot). Over HTTP against the real Nest app and the local
 * PostgreSQL, with an in-memory object store. Every firm, client, TIN, name and figure is
 * invented.
 *
 * Amounts print with centavos exactly as typed; the totals are the exact sums; a third
 * decimal is refused. The blanks have no place for a minus sign, so a draft with a negative
 * figure is refused, naming the first negative item. The eBIRForms XML stays unavailable.
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
import { markFiledAny } from "../helpers/file-return";

truncateOncePerFile({ firmRoles: ["Super Admin", "Manager"] });

const TAG = `track-c-c9-${randomUUID().slice(0, 8)}`;
const API = "/api/v1";
const STAMP = "DRAFT — NOT FILED";
const FOOTER =
  /^Preview printed \d{2} [A-Z][a-z]{2} \d{4}, \d{1,2}:\d{2} (AM|PM) \(Manila\) from the Portal\. Not the filed return\.$/;
const CLEAR_COPY_DRAFT =
  "Mark the return as filed first; a clear copy shows what was filed.";
const PREVIEW_FILED = "This return is filed. Use Download clear copy.";
const PRINTED_NO_XML = "This form is printed; eBIRForms XML is not available for it.";
const negative = (form: string, where: string) =>
  `A negative amount cannot be printed on the ${form} yet: the BIR blank has no place for a minus sign. ${where} is negative.`;

const MAPS = {
  "0619E": "0619E-2018-01.json",
  "1601EQ": "1601EQ-2019-01.json",
  "1601C": "1601C-2018-01.json",
} as const;
type Form = keyof typeof MAPS;
const PAGES: Record<Form, number> = { "0619E": 1, "1601EQ": 2, "1601C": 2 };

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

function binary(res: request.Response, cb: (err: Error | null, body: Buffer) => void) {
  const chunks: Buffer[] = [];
  res.on("data", (c: Buffer) => chunks.push(c));
  res.on("end", () => cb(null, Buffer.concat(chunks)));
}

// Read when first needed, so a missing map shows as the 409 it causes, not an import error.
const maps = new Map<Form, ReturnType<typeof loadMap>>();
const getMap = (form: Form) => {
  if (!maps.has(form)) maps.set(form, loadMap(MAPS[form]));
  return maps.get(form)!;
};
const field = (form: Form, key: string) => {
  const f = getMap(form).fields.find((m) => m.key === `f${form}:${key}`);
  if (!f) throw new Error(`the ${form} map has no ${key}`);
  return f;
};

describe("C9 T1 · the 0619-E, 1601-EQ and 1601-C print on the BIR's blanks (real app over HTTP, db)", () => {
  let app: INestApplication;
  let writer: PrismaService;
  const storage = new FakeStorage();
  let firmId = "";
  let token = "";
  let seq = 0;

  const http = () => request(app.getHttpServer());
  const as = (r: request.Test) => r.set("Authorization", `Bearer ${token}`);
  const binaryPost = (path: string) =>
    as(http().post(`${API}${path}`))
      .buffer(true)
      .parse(binary);
  const preview = (id: string) => binaryPost(`/bir-forms/${id}/preview-pdf`);
  const messageOf = (res: request.Response) =>
    JSON.parse((res.body as Buffer).toString("utf8")).message as string;

  async function client(over: Record<string, unknown> = {}) {
    seq += 1;
    return (
      await writer.client.create({
        data: {
          firmId,
          businessName: `${TAG} Halimbawa Trading ${seq}`,
          kind: "non-individual",
          regName: "INVENTED SAMPLE TRADING CORPORATION",
          tin: "123456789",
          branch: "00000",
          rdo: "044",
          address: "12 Invented Street, Barangay Halimbawa",
          city: "Lungsod ng Halimbawa",
          zip: "1234",
          taxType: "VAT",
          ...over,
        } as never,
      })
    ).id;
  }
  const individual = (over: Record<string, unknown> = {}) =>
    client({
      kind: "individual",
      regName: null,
      lastName: "Sample",
      firstName: "Testa",
      middleName: "Invented",
      tin: "987654321",
      branch: "00001",
      rdo: "050",
      address: "8 Sample Avenue",
      city: "Sample City",
      zip: "5678",
      ...over,
    });

  async function draft(
    clientId: string,
    form: Form,
    period: string,
    data: Record<string, unknown>,
  ) {
    const res = await as(http().post(`${API}/bir-forms`)).send({
      clientId,
      form,
      period,
      data,
    });
    expect([form, period, res.status]).toEqual([form, period, 201]);
    return res.body.id as string;
  }
  /** Since U18 the 0619-E and 1601-EQ are marked filed with the BIR's confirmation (the 1601-C by PATCH). */
  async function file(id: string) {
    const r = await markFiledAny(app, token, id);
    expect([id, r.status]).toEqual([id, 200]);
  }

  /** The ink a preview or clear copy added to the blank. */
  async function ink(form: Form, pdf: Buffer, wantStamp: boolean) {
    const blank = readFileSync(join(BIR_PDF, "templates", getMap(form).template));
    const [copy, template] = readPdfText(new Uint8Array(pdf), blank);
    expect(copy!.pages).toBe(PAGES[form]);
    const added = overlay(copy!, template!);
    const stamps = added.filter((t) => t.str === STAMP).length;
    const footers = added.filter((t) => FOOTER.test(t.str)).length;
    const n = wantStamp ? PAGES[form] : 0;
    expect([stamps, footers]).toEqual([n, n]);
    return added.filter((t) => t.str !== STAMP && !FOOTER.test(t.str));
  }
  /** Every listed key printed exactly this text (spaces ignored). */
  function expectPrinted(
    form: Form,
    items: Awaited<ReturnType<typeof ink>>,
    want: Record<string, string>,
  ) {
    const got: Record<string, string> = {};
    for (const k of Object.keys(want)) got[k] = printed(items, field(form, k));
    expect(got).toEqual(want);
  }
  /** Whether an X was drawn in the tick square of a mark field. */
  const ticked = (form: Form, items: Awaited<ReturnType<typeof ink>>, key: string) => {
    const [x0, y0, x1, y1] = (field(form, key) as unknown as { box: number[] }).box;
    return items.some(
      (t) =>
        t.str === "X" && t.x >= x0! && t.x <= x1! && t.y >= y0! - 1 && t.y <= y1! + 1,
    );
  };

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

  const SIGN = {
    signatoryName: "DELA CRUZ, TESTA SAMPLE",
    signatoryTitle: "PRESIDENT",
    signatoryTin: "111-222-333-00000",
    taxAgentNo: "TA-0001",
    taxAgentIssueDate: "2025-01-15",
    taxAgentExpiryDate: "2028-01-14",
  };
  const PAY = {
    payCashBank: "SAMPLE BANK",
    payCashNumber: "BDM-0001",
    payCashDate: "2026-09-09",
    payCashAmount: "12,345.67",
    payCheckBank: "BNK",
    payCheckNumber: "CHK1",
    payCheckDate: "2026-09-08",
    payCheckAmount: "1000.10",
    payTaxDebitBank: "NOT PRINTED",
    payTaxDebitNumber: "TDM1",
    payTaxDebitDate: "2026-09-07",
    payTaxDebitAmount: "200.02",
    payOthersSpecify: "GCASH",
    payOthersBank: "SAMPLE",
    payOthersNumber: "OP1",
    payOthersDate: "2026-09-06",
    payOthersAmount: "30.03",
  };
  const D0619E = {
    year: "2026",
    month: "08",
    dueDate: "2026-09-10",
    amended: "yes",
    anyWithheld: "yes",
    category: "government",
    contact: "0917-000-0000",
    email: "Accounts@Invented-Sample.example",
    remittance: "12,345.67",
    previouslyRemitted: "1000.00",
    surcharge: "2,836.42",
    interest: "257.20",
    compromise: "1000.00",
    ...SIGN,
    ...PAY,
  };

  it("1. a 0619-E draft: every item prints in its own place; amended and category ticks; stamp and footer; never stored", async () => {
    const id = await draft(await individual(), "0619E", "2026-08", D0619E);
    const auditBefore = await writer.auditLog.count({ where: { entityId: id } });
    const writesBefore = storage.writes;
    const detail = await as(http().get(`${API}/bir-forms/${id}`));
    expect([detail.body.previewAvailable, detail.body.clearCopyAvailable]).toEqual([
      true,
      false,
    ]);
    const res = await preview(id);
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/^application\/pdf/);
    expect(res.headers["content-disposition"]).toContain(
      'filename="987654321001-0619E-2026-08-DRAFT.pdf"',
    );
    expect(await writer.birFormExport.count({ where: { birFormId: id } })).toBe(0);
    expect(storage.writes).toBe(writesBefore);
    expect(await writer.auditLog.count({ where: { entityId: id } })).toBe(auditBefore);

    const items = await ink("0619E", res.body as Buffer, true);
    expectPrinted("0619E", items, {
      month: "082026",
      dueDate: "09102026",
      tin1: "987",
      tin2: "654",
      tin3: "321",
      branch: "00001",
      rdo: "050",
      name: "SAMPLE,TESTAINVENTED",
      address: "8SAMPLEAVENUE,SAMPLECITY",
      zip: "5678",
      contact: "09170000000",
      email: "Accounts@Invented-Sample.example",
      i14: "12345.67",
      i15: "1000.00",
      i16: "11345.67",
      i17a: "2836.42",
      i17b: "257.20",
      i17c: "1000.00",
      i17d: "4093.62",
      i18: "15439.29",
      // an individual signs on the For Individual side only
      sigIndName: "DELACRUZ,TESTASAMPLE",
      sigIndTitleTin: "PRESIDENT/TIN111-222-333-00000",
      sigNonName: "",
      agentNo: "TA-0001",
      agentIssue: "01/15/2025",
      agentExpiry: "01/14/2028",
      cashNumber: "BDM-0001",
      cashDate: "09092026",
      cashAmount: "12345.67",
      checkAmount: "1000.10",
      debitNumber: "TDM1",
      debitAmount: "200.02",
      othersSpecify: "GCASH",
      othersAmount: "30.03",
    });
    expect(
      ["amendedYes", "amendedNo", "anyYes", "anyNo", "catPrivate", "catGovernment"].map(
        (k) => ticked("0619E", items, k),
      ),
    ).toEqual([true, false, true, false, false, true]);
    // The ATC and tax type code the blank pre-prints are not printed; nor the Tax Debit Memo's
    // bank, which the blank has no box for.
    const all = items.map((t) => t.str).join("|");
    expect(/WME10|NOT PRINTED/.test(all)).toBe(false);
  });

  it("2. a corporation signs on the For Non-Individual side; no due date typed prints the month's default; not amended ticks No", async () => {
    const id = await draft(await client(), "0619E", "2026-08", {
      year: "2026",
      month: "08",
      anyWithheld: "no",
      category: "private",
      remittance: "100.00",
      ...SIGN,
    });
    const res = await preview(id);
    expect(res.status).toBe(200);
    const items = await ink("0619E", res.body as Buffer, true);
    expectPrinted("0619E", items, {
      dueDate: "09102026",
      tin1: "123",
      branch: "00000",
      name: "INVENTEDSAMPLETRADINGCORPORATION",
      sigNonName: "DELACRUZ,TESTASAMPLE",
      sigNonTitleTin: "PRESIDENT/TIN111-222-333-00000",
      sigIndName: "",
      i16: "100.00",
      i17d: "0.00",
      i18: "100.00",
    });
    expect(
      ["amendedYes", "amendedNo", "anyYes", "anyNo", "catPrivate"].map((k) =>
        ticked("0619E", items, k),
      ),
    ).toEqual([false, true, false, true, true]);
  });

  const EQ_ROWS = [
    { atc: "WC158", base: "123456789.01", rate: "1", withheld: "1234567.89" },
    { atc: "WC160", base: "9876543.21", rate: "2", withheld: "197530.86" },
    { atc: "WI010", base: "5555555.55", rate: "5", withheld: "277777.78" },
    { atc: "WI011", base: "4444444.44", rate: "10", withheld: "444444.44" },
    { atc: "WC050", base: "3333333.33", rate: "0.5", withheld: "16666.67" },
    { atc: "WI100", base: "2222222.22", rate: "5", withheld: "111111.11" },
  ];
  const D1601EQ = {
    year: "2026",
    quarter: "2nd",
    amended: "yes",
    anyWithheld: "yes",
    sheetsAttached: "12",
    category: "private",
    contact: "(02) 8000 0000",
    email: "payables@invented-sample.example",
    rows: EQ_ROWS,
    remittance1: "400000.00",
    remittance2: "350000.50",
    previouslyRemitted: "10000.00",
    overRemittancePrior: "5000.25",
    otherPayments: "20000.00",
    surcharge: "30000.00",
    interest: "4000.40",
    compromise: "2000.00",
    ...SIGN,
    ...PAY,
  };

  it("3. a 1601-EQ with six ATC rows: both pages print, each row in its columns, totals exact to the centavo", async () => {
    const id = await draft(await client(), "1601EQ", "2026-Q2", D1601EQ);
    const res = await preview(id);
    expect(res.status).toBe(200);
    expect(res.headers["content-disposition"]).toContain(
      'filename="123456789000-1601EQ-2026-Q2-DRAFT.pdf"',
    );
    const items = await ink("1601EQ", res.body as Buffer, true);
    const want: Record<string, string> = {
      year: "2026",
      sheets: "12",
      zip: "1234",
      contact: "0280000000",
      i19: "2282098.75",
      i20: "400000.00",
      i21: "350000.50",
      i22: "10000.00",
      i23: "5000.25",
      i24: "20000.00",
      i25: "785000.75",
      i26: "1497098.00",
      i27: "30000.00",
      i28: "4000.40",
      i29: "2000.00",
      i30: "36000.40",
      i31: "1533098.40",
      // the 1601-EQ's page 2 has the TIN and the name to fill in
      p2Tin: "12345678900000",
      p2Name: "INVENTEDSAMPLETRADINGCORPORATION",
      sigNonName: "DELACRUZ,TESTASAMPLE",
    };
    EQ_ROWS.forEach((r, i) => {
      const n = i + 1;
      want[`r${n}Atc`] = r.atc;
      want[`r${n}Base`] = r.base;
      want[`r${n}Rate`] = `${r.rate}%`;
      want[`r${n}Withheld`] = r.withheld;
    });
    expectPrinted("1601EQ", items, want);
    expect(
      ["q1", "q2", "q3", "q4", "amendedYes", "anyYes", "catGovernment"].map((k) =>
        ticked("1601EQ", items, k),
      ),
    ).toEqual([false, true, false, false, true, true, false]);
    // The over-remittance ticks are not printed (an over-remittance is refused below).
    expect(
      ["overRefunded", "overTcc", "overCarried"].some((k) => ticked("1601EQ", items, k)),
    ).toBe(false);
  });

  it("4. a 1601-EQ with seven ATCs is refused as before; a typed negative figure is still refused, naming its item", async () => {
    const cid = await client();
    const seven = await draft(cid, "1601EQ", "2026-Q2", {
      ...D1601EQ,
      rows: [...EQ_ROWS, { atc: "WI160", base: "1.00", rate: "5", withheld: "0.05" }],
    });
    const p7 = await preview(seven);
    expect([p7.status, messageOf(p7)]).toEqual([409, "7 ATCs; the form has six rows."]);
    const typed = await draft(cid, "1601EQ", "2026-Q2", {
      ...D1601EQ,
      interest: "-1.00",
    });
    const res = await preview(typed);
    expect([res.status, messageOf(res)]).toEqual([409, negative("1601-EQ", "Item 28")]);
  });

  // C9b: 1,000.00 withheld less 2,700.00 remitted is an over-remittance of 1,700.00.
  const OVER = (quarter: string, choice: string, more: Record<string, unknown> = {}) => ({
    year: "2026",
    quarter,
    anyWithheld: "yes",
    rows: [{ atc: "WC158", base: "100,000.00", rate: "1", withheld: "1,000.00" }],
    remittance1: "1,500.00",
    remittance2: "1,200.00",
    overRemittanceChoice: choice,
    ...SIGN,
    ...more,
  });
  const NO_CHOICE =
    "Choose what to do with the over-remittance: to be refunded, to be issued a Tax Credit Certificate, or to be carried over.";

  it("4b. an over-remittance prints as the figure in Items 26 and 31, with the chosen box ticked and no minus sign: refunded, a tax credit certificate, carried over (quarters 1 to 3)", async () => {
    const cid = await client();
    const cases: [string, string, string, string][] = [
      ["refunded", "overRefunded", "1st", "2026-Q1"],
      ["tcc", "overTcc", "2nd", "2026-Q2"],
      ["carried", "overCarried", "3rd", "2026-Q3"],
    ];
    for (const [choice, box, quarter, period] of cases) {
      const id = await draft(cid, "1601EQ", period, OVER(quarter, choice));
      const res = await preview(id);
      expect([choice, res.status]).toEqual([choice, 200]);
      const items = await ink("1601EQ", res.body as Buffer, true);
      expectPrinted("1601EQ", items, {
        i19: "1000.00",
        i25: "2700.00",
        i26: "1700.00",
        i30: "0.00",
        i31: "1700.00",
      });
      const all = ["overRefunded", "overTcc", "overCarried"];
      expect([choice, all.filter((k) => ticked("1601EQ", items, k))]).toEqual([
        choice,
        [box],
      ]);
      // no minus sign anywhere on the page
      expect(items.filter((t) => /^-/.test(t.str))).toEqual([]);
    }
  });

  it("4c. an over-remittance with no box chosen answers 409 on Preview PDF and on the clear copy, in the owner's words; the draft stays as it was", async () => {
    const cid = await client();
    const id = await draft(cid, "1601EQ", "2026-Q2", OVER("2nd", ""));
    const res = await preview(id);
    expect([res.status, messageOf(res)]).toEqual([409, NO_CHOICE]);
    await file(id);
    const copy = await as(http().post(`${API}/bir-forms/${id}/clear-copy`));
    expect([copy.status, copy.body.message]).toEqual([409, NO_CHOICE]);
    expect(
      await writer.birFormExport.count({ where: { birFormId: id, kind: "pdf" } }),
    ).toBe(0);
  });

  it("4d. in the 4th quarter a saved 'carried' choice is already cleared: refused like no choice; refunded and a tax credit certificate print", async () => {
    const cid = await client();
    const stale = await draft(cid, "1601EQ", "2026-Q4", OVER("4th", "carried"));
    const res = await preview(stale);
    expect([res.status, messageOf(res)]).toEqual([409, NO_CHOICE]);
    for (const [choice, box] of [
      ["refunded", "overRefunded"],
      ["tcc", "overTcc"],
    ] as const) {
      const id = await draft(cid, "1601EQ", "2026-Q4", OVER("4th", choice));
      const ok = await preview(id);
      expect([choice, ok.status]).toEqual([choice, 200]);
      const items = await ink("1601EQ", ok.body as Buffer, true);
      expect(
        ["overRefunded", "overTcc", "overCarried"].filter((k) =>
          ticked("1601EQ", items, k),
        ),
      ).toEqual([box]);
    }
  });

  it("4e. penalties larger than the over-remittance: Item 26 prints 1,700.00, Item 30 1,900.00, Item 31 prints the 200.00 due, nothing is ticked, no choice needed", async () => {
    const cid = await client();
    const id = await draft(
      cid,
      "1601EQ",
      "2026-Q3",
      OVER("3rd", "", {
        surcharge: "1,000.00",
        interest: "500.00",
        compromise: "400.00",
      }),
    );
    const res = await preview(id);
    expect(res.status).toBe(200);
    const items = await ink("1601EQ", res.body as Buffer, true);
    expectPrinted("1601EQ", items, { i26: "1700.00", i30: "1900.00", i31: "200.00" });
    expect(
      ["overRefunded", "overTcc", "overCarried"].filter((k) =>
        ticked("1601EQ", items, k),
      ),
    ).toEqual([]);
    expect(items.filter((t) => /^-/.test(t.str))).toEqual([]);
  });

  it("4f. a filed 1601-EQ with an over-remittance prints its clear copy: the amount, the chosen box, no stamp", async () => {
    const cid = await client();
    const id = await draft(cid, "1601EQ", "2026-Q1", OVER("1st", "tcc"));
    await file(id);
    const copy = await as(http().post(`${API}/bir-forms/${id}/clear-copy`));
    expect(copy.status).toBe(201);
    const stored = [...storage.objects.entries()].find(([k]) =>
      k.endsWith(`/${id}/${copy.body.filename}`),
    )!;
    const items = await ink("1601EQ", Buffer.from(stored[1].body), false);
    expectPrinted("1601EQ", items, { i26: "1700.00", i31: "1700.00" });
    expect(
      ["overRefunded", "overTcc", "overCarried"].filter((k) =>
        ticked("1601EQ", items, k),
      ),
    ).toEqual(["overTcc"]);
  });

  const D1601C = {
    year: "2026",
    month: "08",
    amended: "no",
    anyWithheld: "yes",
    sheetsAttached: "1",
    category: "private",
    contact: "0917-000-0000",
    email: "hr.payroll@invented-sample.example",
    reliefYesNo: "yes",
    reliefSpecify: "PH-JP TREATY",
    compensation: "250,000.00",
    mwe: "20000.00",
    holiday: "1500.50",
    thirteenth: "10000.00",
    deMinimis: "2500.00",
    contributions: "9500.25",
    otherNonTaxable: "1000.00",
    otherNonTaxableSpecify: "TRANSPORTATION",
    notSubjectToWithholding: "0.00",
    taxesWithheld: "15000.00",
    otherRemittances: "500.00",
    otherRemittancesSpecify: "ADVANCE REMITTANCE",
    surcharge: "100.10",
    interest: "50.05",
    compromise: "200.00",
    scheduleRows: [
      {
        month: "2026-05",
        datePaid: "2026-06-10",
        bank: "SAMPLE BANK",
        number: "CHK-001",
        taxPaid: "1000.00",
        shouldBe: "1250.75",
      },
      {
        month: "2026-06",
        datePaid: "2026-07-10",
        bank: "SAMPLE BNK",
        number: "CHK-002",
        taxPaid: "2000.50",
        shouldBe: "2100.55",
      },
      {
        month: "2026-07",
        datePaid: "2026-08-10",
        bank: "SAMPLE BANK",
        number: "CHK-003",
        taxPaid: "3000.00",
        shouldBe: "3000.99",
      },
    ],
    ...SIGN,
    ...PAY,
  };

  it("5. a 1601-C with three Schedule I rows: both pages print, Part II and Schedule I to the centavo, the blank's own pre-printed ATC untouched", async () => {
    const id = await draft(await client(), "1601C", "2026-08", D1601C);
    const res = await preview(id);
    expect(res.status).toBe(200);
    const items = await ink("1601C", res.body as Buffer, true);
    expectPrinted("1601C", items, {
      month: "082026",
      sheets: "1",
      reliefSpecify: "PH-JPTREATY",
      i14: "250000.00",
      i15: "20000.00",
      i16: "1500.50",
      i20: "1000.00",
      i20Specify: "TRANSPORTATION",
      i21: "44500.75",
      i22: "205499.25",
      i23: "0.00",
      i24: "205499.25",
      i25: "15000.00",
      i26: "351.79",
      i27: "15351.79",
      i29: "500.00",
      i29Specify: "ADVANCEREMITTANCE",
      i30: "500.00",
      i31: "14851.79",
      i32: "100.10",
      i35: "350.15",
      i36: "15201.94",
      p2Tin: "12345678900000",
      s1Month: "052026",
      s1DatePaid: "06102026",
      s1Bank: "SAMPLEBANK",
      s1TaxPaid: "1000.00",
      s1ShouldBe: "1250.75",
      s1Adjustment: "250.75",
      s2Adjustment: "100.05",
      s3Adjustment: "0.99",
      sTotal: "351.79",
    });
    expect(
      ["amendedNo", "anyYes", "reliefYes", "reliefNo", "catPrivate"].map((k) =>
        ticked("1601C", items, k),
      ),
    ).toEqual([true, true, true, false, true]);
    expect(items.some((t) => /WW010/.test(t.str))).toBe(false);
  });

  it("6. a 1601-C with a negative figure is refused, naming the first negative item; a Schedule I cell names its row", async () => {
    const cid = await client();
    const cases: [string, Record<string, unknown>, string][] = [
      // Item 26: the schedule's total is negative
      [
        "Item 26",
        {
          scheduleRows: [{ month: "2026-05", taxPaid: "1000.00", shouldBe: "900.00" }],
        },
        "Item 26",
      ],
      // Item 31: more remitted than withheld
      [
        "Item 31",
        { taxesWithheld: "100.00", otherRemittances: "500.00", scheduleRows: [] },
        "Item 31",
      ],
      // a typed negative
      ["Item 14", { compensation: "-1.00" }, "Item 14"],
      // Schedule I row 2: one row negative, the total still positive
      [
        "Schedule I row 2",
        {
          scheduleRows: [
            { month: "2026-05", taxPaid: "100.00", shouldBe: "600.00" },
            { month: "2026-06", taxPaid: "300.00", shouldBe: "200.00" },
            { month: "2026-07", taxPaid: "", shouldBe: "" },
          ],
        },
        "Schedule I row 2",
      ],
    ];
    for (const [label, over, where] of cases) {
      const id = await draft(cid, "1601C", "2026-08", { ...D1601C, ...over });
      const res = await preview(id);
      expect([label, res.status, messageOf(res)]).toEqual([
        label,
        409,
        negative("1601-C", where),
      ]);
    }
    // The compute and the draft are not affected: the figures still read.
    const id = await draft(cid, "1601C", "2026-08", {
      ...D1601C,
      taxesWithheld: "100.00",
    });
    const detail = await as(http().get(`${API}/bir-forms/${id}`));
    expect(detail.status).toBe(200);
    expect(detail.body.computed.i31).toBeLessThan(0);
  });

  it("7. the 0619-E refuses a negative Item 16 (more remitted before than now), naming it", async () => {
    const id = await draft(await client(), "0619E", "2026-08", {
      ...D0619E,
      remittance: "100.00",
      previouslyRemitted: "500.00",
      surcharge: "",
      interest: "",
      compromise: "",
    });
    const res = await preview(id);
    expect([res.status, messageOf(res)]).toEqual([409, negative("0619-E", "Item 16")]);
  });

  it("8. a third decimal is refused, never rounded (preview and clear copy)", async () => {
    const cid = await client();
    const id = await draft(cid, "0619E", "2026-08", {
      ...D0619E,
      remittance: "12345.675",
    });
    const res = await preview(id);
    expect(res.status).toBe(409);
    expect(messageOf(res)).toMatch(
      /12345\.675.*3 decimals but the paper has 2 centavo boxes/,
    );
    await file(id);
    const copy = await as(http().post(`${API}/bir-forms/${id}/clear-copy`));
    expect(copy.status).toBe(409);
    expect(copy.body.message).toMatch(/12345\.675/);
    expect(await writer.birFormExport.count({ where: { birFormId: id } })).toBe(0);
  });

  it("9. a filed return prints its clear copy from the filing snapshot: no stamp, no footer, stored; the draft and filed refusals; XML stays unavailable", async () => {
    const cid = await client();
    const id = await draft(cid, "1601C", "2026-08", D1601C);
    const early = await as(http().post(`${API}/bir-forms/${id}/clear-copy`));
    expect([early.status, early.body.message]).toEqual([409, CLEAR_COPY_DRAFT]);
    await file(id);
    // The client changes after filing: the filed return does not.
    await writer.client.update({
      where: { id: cid },
      data: {
        regName: "RENAMED LATER CORP",
        kind: "individual",
        lastName: "X",
        firstName: "Y",
      },
    });
    const refused = await preview(id);
    expect([refused.status, messageOf(refused)]).toEqual([409, PREVIEW_FILED]);
    const exp = await as(http().post(`${API}/bir-forms/${id}/export`));
    expect([exp.status, exp.body.message]).toEqual([409, PRINTED_NO_XML]);
    const detail = await as(http().get(`${API}/bir-forms/${id}`));
    expect([detail.body.previewAvailable, detail.body.clearCopyAvailable]).toEqual([
      false,
      true,
    ]);

    const copy = await as(http().post(`${API}/bir-forms/${id}/clear-copy`));
    expect(copy.status).toBe(201);
    expect(copy.body).toMatchObject({
      kind: "pdf",
      filename: "123456789000-1601C-2026-08.pdf",
    });
    const stored = [...storage.objects.entries()].find(([k]) =>
      k.endsWith(`/${id}/123456789000-1601C-2026-08.pdf`),
    );
    expect(stored).toBeTruthy();
    expect(
      await writer.birFormExport.count({ where: { birFormId: id, kind: "pdf" } }),
    ).toBe(1);
    const items = await ink("1601C", Buffer.from(stored![1].body), false);
    expectPrinted("1601C", items, {
      name: "INVENTEDSAMPLETRADINGCORPORATION",
      p2Name: "INVENTEDSAMPLETRADINGCORPORATION",
      // the snapshot's kind decides the side: still a corporation
      sigNonName: "DELACRUZ,TESTASAMPLE",
      sigIndName: "",
      i36: "15201.94",
    });
  });

  it("10. a return filed before the snapshot existed prints from the live client, and the audit says so", async () => {
    const cid = await client();
    // A filed return with no snapshot (the database seals a filed row, so it is inserted so).
    const old = await writer.birForm.create({
      data: {
        firmId,
        clientId: cid,
        form: "0619E",
        period: "2026-08",
        status: "filed",
        filedAt: new Date("2026-09-09T00:00:00.000Z"),
        dataJson: D0619E,
      },
    });
    const copy = await as(http().post(`${API}/bir-forms/${old.id}/clear-copy`));
    expect(copy.status).toBe(201);
    const audit = await writer.auditLog.findFirst({
      where: { entityId: old.id, action: "bir-form.clear-copy" },
    });
    expect(JSON.stringify(audit?.metadata)).toContain("none (pre-U3)");
  });

  it("11. every one of the three is offered Preview PDF as a draft and Download clear copy once filed", async () => {
    const cid = await client();
    const ids = {
      "0619E": await draft(cid, "0619E", "2026-07", { ...D0619E, month: "07" }),
      "1601EQ": await draft(cid, "1601EQ", "2026-Q1", { ...D1601EQ, quarter: "1st" }),
      "1601C": await draft(cid, "1601C", "2026-07", { ...D1601C, month: "07" }),
    };
    const list = await as(http().get(`${API}/bir-forms`).query({ clientId: cid }));
    for (const [form, id] of Object.entries(ids)) {
      const row = list.body.find((r: { id: string }) => r.id === id);
      expect([form, row.previewAvailable, row.clearCopyAvailable]).toEqual([
        form,
        true,
        false,
      ]);
      await file(id);
    }
    const after = await as(http().get(`${API}/bir-forms`).query({ clientId: cid }));
    for (const [form, id] of Object.entries(ids)) {
      const row = after.body.find((r: { id: string }) => r.id === id);
      expect([form, row.previewAvailable, row.clearCopyAvailable]).toEqual([
        form,
        false,
        true,
      ]);
    }
  });
});
