/**
 * track-c-c7-2307-print.db-spec.ts — C7 T1 (seen to fail first): BIR Form 2307 prints on
 * the BIR's own blank form (D56): Preview PDF for a draft certificate (stamped DRAFT,
 * never stored), Download clear copy for an issued one (no stamp, no footer). Over HTTP
 * against the real Nest app and the local PostgreSQL, with an in-memory object store.
 * Every firm, client, TIN, name and figure is invented.
 *
 * The client is the payor; the payee is typed per certificate. Amounts print with
 * centavos, exactly as typed; the totals are the exact sum of the printed rows.
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

const TAG = `track-c-c7-${randomUUID().slice(0, 8)}`;
const API = "/api/v1";
const NS = "c2307:";
const STAMP = "DRAFT — NOT FILED";
const FOOTER =
  /^Preview printed \d{2} [A-Z][a-z]{2} \d{4}, \d{1,2}:\d{2} (AM|PM) \(Manila\) from the Portal\. Not the filed return\.$/;
const CLEAR_COPY_DRAFT =
  "Mark the return as filed first; a clear copy shows what was filed.";
const PREVIEW_FILED = "This return is filed. Use Download clear copy.";
const PAYOR_NAME_MISSING =
  "Complete the client's registered name (or last and first name for an individual) before printing this certificate.";

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

/** Integer centavos of an amount typed as "1,234.56", "12", "0.1": no floats. */
function centavos(v: string): number {
  const [p = "0", c = ""] = v.replace(/,/g, "").split(".");
  return Number(p) * 100 + Number(c.padEnd(2, "0").slice(0, 2));
}
/** Centavos as the form prints them: "1,234.56". */
function show(c: number): string {
  const pesos = Math.floor(c / 100)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${pesos}.${String(c % 100).padStart(2, "0")}`;
}

// Read when first needed, so a missing map shows as the 409 it causes, not an import error.
let loadedMap: ReturnType<typeof loadMap> | undefined;
const getMap = () => (loadedMap ??= loadMap("2307-2018-01.json"));
const field = (key: string) => {
  const f = getMap().fields.find((m) => m.key === NS + key);
  if (!f) throw new Error(`the 2307 map has no ${key}`);
  return f;
};

describe("C7 T1 · BIR Form 2307 prints on the BIR's blank (real app over HTTP, db)", () => {
  let app: INestApplication;
  let writer: PrismaService;
  const storage = new FakeStorage();
  let firmId = "";
  let token = "";
  let seq = 0;

  const http = () => request(app.getHttpServer());
  const as = (r: request.Test) => r.set("Authorization", `Bearer ${token}`);
  const preview = (id: string) =>
    as(http().post(`${API}/bir-forms/${id}/preview-pdf`))
      .buffer(true)
      .parse(binary);

  async function payor(over: Record<string, unknown> = {}) {
    seq += 1;
    return (
      await writer.client.create({
        data: {
          firmId,
          businessName: `${TAG} Halimbawa Trading ${seq}`,
          kind: "non-individual",
          regName: "HALIMBAWA TRADING CORP",
          tin: "000111222",
          branch: "00000",
          rdo: "027",
          address: "12 Invented St",
          city: "Lungsod ng Halimbawa",
          zip: "0000",
          taxType: "PERCENTAGE",
          ...over,
        } as never,
      })
    ).id;
  }
  async function certificate(
    clientId: string,
    data: Record<string, unknown>,
    period = "2026-Q3",
  ) {
    const created = await as(http().post(`${API}/bir-forms`)).send({
      clientId,
      form: "2307",
      period,
      data,
    });
    expect(created.status).toBe(201);
    return created.body.id as string;
  }
  async function issue(id: string) {
    const r = await as(http().patch(`${API}/bir-forms/${id}`)).send({ status: "filed" });
    expect(r.status).toBe(200);
  }
  /** The ink a preview or clear copy added to the blank, page 1 only. */
  async function ink(pdf: Buffer, wantStamp: boolean) {
    const blank = readFileSync(join(BIR_PDF, "templates", getMap().template));
    const [copy, template] = readPdfText(new Uint8Array(pdf), blank);
    expect(copy!.pages).toBe(1); // page 2, the BIR's schedule of ATCs, is not printed (D18)
    const added = overlay(copy!, template!);
    const stamps = added.filter((t) => t.str === STAMP).length;
    const footers = added.filter((t) => FOOTER.test(t.str)).length;
    expect([stamps, footers]).toEqual(wantStamp ? [1, 1] : [0, 0]);
    return added.filter((t) => t.str !== STAMP && !FOOTER.test(t.str));
  }
  /** Every listed key printed exactly this text (spaces ignored). */
  function expectPrinted(
    items: Awaited<ReturnType<typeof ink>>,
    want: Record<string, string>,
  ) {
    const got: Record<string, string> = {};
    for (const k of Object.keys(want)) got[k] = printed(items, field(k));
    expect(got).toEqual(want);
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

  const ROW = (i: number) => ({
    atc: i % 2 ? "WI010" : "WC010",
    desc: `PROFESSIONAL FEES ROW ${i}`,
    m1: `${i}${i}1,234.56`,
    m2: `${i}0.10`,
    m3: `${i}.05`,
    tax: `${i}${i}2.01`,
  });

  const INDIVIDUAL_PAYEE = {
    year: "2026",
    quarter: "3",
    payeeName: "DELA CRUZ, JUANA SAMPLE",
    payeeTin: "000-333-444",
    payeeBranch: "00000",
    payeeAddress: "88 Sample Road, Barangay Uno, Lungsod ng Halimbawa",
    payeeZip: "1234",
    payeeForeignAddress: "",
    payorSignatoryName: "PEDRO SUBOK HALIMBAWA",
    payorSignatoryTitle: "TREASURER",
    payorSignatoryTin: "000-111-222-00000",
    payorTaxAgentNo: "TA-0001",
    payorTaxAgentIssued: "01/15/2025",
    payorTaxAgentExpiry: "01/14/2028",
    payeeSignatoryName: "",
    payeeSignatoryTitle: "",
    payeeSignatoryTin: "",
    payeeTaxAgentNo: "TA-0002",
    payeeTaxAgentIssued: "02/01/2025",
    payeeTaxAgentExpiry: "02/01/2028",
    rows: [ROW(1)],
  };

  it("1. an individual payee: every item of the form prints in its own place, with the stamp and footer on the one page", async () => {
    const id = await certificate(await payor(), INDIVIDUAL_PAYEE);
    const auditBefore = await writer.auditLog.count({ where: { entityId: id } });
    const writesBefore = storage.writes;
    const res = await preview(id);
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/^application\/pdf/);
    expect(res.headers["content-disposition"]).toMatch(/^attachment;/);
    expect(res.headers["content-disposition"]).toContain(
      'filename="000111222000-2307-2026-Q3-DRAFT.pdf"',
    );
    // Made on request, never stored.
    expect(await writer.birFormExport.count({ where: { birFormId: id } })).toBe(0);
    expect(storage.writes).toBe(writesBefore);
    expect(await writer.auditLog.count({ where: { entityId: id } })).toBe(auditBefore);

    const items = await ink(res.body as Buffer, true);
    expectPrinted(items, {
      periodFrom: "07012026",
      periodTo: "09302026",
      payeeTin1: "000",
      payeeTin2: "333",
      payeeTin3: "444",
      payeeBranch: "00000",
      payeeName: "DELACRUZ,JUANASAMPLE",
      payeeAddress: "88SAMPLEROAD,BARANGAYUNO,LUNGSODNGHALIMBAWA",
      payeeZip: "1234",
      payeeForeignAddress: "",
      payorTin1: "000",
      payorTin2: "111",
      payorTin3: "222",
      payorBranch: "00000",
      payorName: "HALIMBAWATRADINGCORP",
      payorAddress: "12INVENTEDST,LUNGSODNGHALIMBAWA",
      payorZip: "0000",
      payorSigName: "PEDROSUBOKHALIMBAWA",
      payorSigTitleTin: "TREASURER/TIN000-111-222-00000",
      payorAgentNo: "TA-0001",
      payorAgentIssued: "01152025",
      payorAgentExpiry: "01142028",
      // The payee's CONFORME block: name and TIN fall back to the payee's own.
      payeeSigName: "DELACRUZ,JUANASAMPLE",
      payeeSigTitleTin: "TIN000-333-444-00000",
      payeeAgentNo: "TA-0002",
      payeeAgentIssued: "02012025",
      payeeAgentExpiry: "02012028",
    });
    // Row 1 of block A, in its columns.
    const r = ROW(1);
    expectPrinted(items, {
      a1Desc: "PROFESSIONALFEESROW1",
      a1Atc: "WI010",
      a1M1: show(centavos(r.m1)),
      a1M2: show(centavos(r.m2)),
      a1M3: show(centavos(r.m3)),
      a1Total: show(centavos(r.m1) + centavos(r.m2) + centavos(r.m3)),
      a1Tax: show(centavos(r.tax)),
    });
  });

  it("2. a corporate payee with a foreign address and another branch: its own items print", async () => {
    const id = await certificate(await payor(), {
      ...INDIVIDUAL_PAYEE,
      payeeName: "HALIMBAWA SUPPLIES CORPORATION",
      payeeTin: "000-555-666-00007",
      payeeBranch: "00007",
      payeeForeignAddress: "1 Sample Plaza, Invented City, Elsewhere 0000",
      payeeSignatoryName: "ANA SUBOK",
      payeeSignatoryTitle: "PRESIDENT",
      payeeSignatoryTin: "000-777-888-00000",
    });
    const res = await preview(id);
    expect(res.status).toBe(200);
    const items = await ink(res.body as Buffer, true);
    expectPrinted(items, {
      payeeName: "HALIMBAWASUPPLIESCORPORATION",
      payeeTin1: "000",
      payeeTin2: "555",
      payeeTin3: "666",
      payeeBranch: "00007",
      payeeForeignAddress: "1SAMPLEPLAZA,INVENTEDCITY,ELSEWHERE0000",
      payeeSigName: "ANASUBOK",
      payeeSigTitleTin: "PRESIDENT/TIN000-777-888-00000",
    });
  });

  it("3. ten full block A rows and a block B row: values in their columns, totals exact to the centavo", async () => {
    const rows = Array.from({ length: 10 }, (_, i) => ROW(i + 1));
    const rowsB = [
      {
        atc: "WB010",
        desc: "MONEY PAYMENT SAMPLE",
        m1: "0.10",
        m2: "0.20",
        m3: "0.30",
        tax: "0.07",
      },
    ];
    const id = await certificate(await payor(), { ...INDIVIDUAL_PAYEE, rows, rowsB });
    const res = await preview(id);
    expect(res.status).toBe(200);
    const items = await ink(res.body as Buffer, true);
    const want: Record<string, string> = {};
    let m1 = 0;
    let m2 = 0;
    let m3 = 0;
    let tax = 0;
    rows.forEach((r, i) => {
      const n = i + 1;
      m1 += centavos(r.m1);
      m2 += centavos(r.m2);
      m3 += centavos(r.m3);
      tax += centavos(r.tax);
      want[`a${n}Desc`] = r.desc.replace(/\s+/g, "");
      want[`a${n}Atc`] = r.atc;
      want[`a${n}M1`] = show(centavos(r.m1));
      want[`a${n}M2`] = show(centavos(r.m2));
      want[`a${n}M3`] = show(centavos(r.m3));
      want[`a${n}Total`] = show(centavos(r.m1) + centavos(r.m2) + centavos(r.m3));
      want[`a${n}Tax`] = show(centavos(r.tax));
    });
    want.aTotalM1 = show(m1);
    want.aTotalM2 = show(m2);
    want.aTotalM3 = show(m3);
    want.aTotalIncome = show(m1 + m2 + m3);
    want.aTotalTax = show(tax);
    // Block B: one row, its Total row, the other nine rows empty.
    want.b1Desc = "MONEYPAYMENTSAMPLE";
    want.b1Atc = "WB010";
    want.b1M1 = "0.10";
    want.b1M2 = "0.20";
    want.b1M3 = "0.30";
    want.b1Total = "0.60";
    want.b1Tax = "0.07";
    want.b2Desc = "";
    want.b10Tax = "";
    want.bTotalM1 = "0.10";
    want.bTotalM2 = "0.20";
    want.bTotalM3 = "0.30";
    want.bTotalIncome = "0.60";
    want.bTotalTax = "0.07";
    expectPrinted(items, want);
  });

  it("4. amounts print with centavos exactly as typed, padded to two decimals, never rounded; a third decimal is refused, not rounded", async () => {
    const cid = await payor();
    const rows = [
      { atc: "WI010", desc: "A", m1: "1234.56", m2: "1,234.5", m3: "0.01", tax: "12" },
      { atc: "WI010", desc: "B", m1: "0.1", m2: "0.2", m3: "0.3", tax: "0.07" },
    ];
    const id = await certificate(cid, { ...INDIVIDUAL_PAYEE, rows });
    const res = await preview(id);
    expect(res.status).toBe(200);
    const items = await ink(res.body as Buffer, true);
    expectPrinted(items, {
      a1M1: "1,234.56",
      a1M2: "1,234.50",
      a1M3: "0.01",
      a1Total: "2,469.07",
      a1Tax: "12.00",
      a2M1: "0.10",
      a2M2: "0.20",
      a2M3: "0.30",
      a2Total: "0.60", // 0.1 + 0.2 + 0.3 is exactly 0.60, not 0.6000000000000001
      aTotalM1: "1,234.66",
      aTotalIncome: "2,469.67",
      aTotalTax: "12.07",
    });
    const bad = await certificate(cid, {
      ...INDIVIDUAL_PAYEE,
      rows: [{ atc: "WI010", desc: "C", m1: "12.345", m2: "", m3: "", tax: "" }],
    });
    const refused = await preview(bad);
    expect(refused.status).toBe(409);
    expect(JSON.parse((refused.body as Buffer).toString("utf8")).message).toMatch(
      /12\.345/,
    );
  });

  it("5. a long payee name and address print whole, squeezed into their lines; an absurd one is refused in words that name the field", async () => {
    const name =
      "DELA CRUZ Y SUBOK-HALIMBAWA, JUANA MARIA SAMPLE DE LOS SANTOS NG LUNGSOD NG HALIMBAWA AT MGA ANAK, INC.";
    const address =
      "UNIT 123 SAMPLE TOWER, 456 INVENTED AVENUE CORNER SAMPLE STREET, BARANGAY HALIMBAWA UNO, DISTRITO NG SUBOK, LUNGSOD NG HALIMBAWA, METRO SAMPLE";
    const cid = await payor();
    const id = await certificate(cid, {
      ...INDIVIDUAL_PAYEE,
      payeeName: name,
      payeeAddress: address,
    });
    const res = await preview(id);
    expect(res.status).toBe(200);
    const items = await ink(res.body as Buffer, true);
    expectPrinted(items, {
      payeeName: name.replace(/\s+/g, ""),
      payeeAddress: address.replace(/\s+/g, ""),
    });
    const absurd = await certificate(cid, {
      ...INDIVIDUAL_PAYEE,
      payeeName: "X".repeat(400),
    });
    const refused = await preview(absurd);
    expect(refused.status).toBe(409);
    expect(JSON.parse((refused.body as Buffer).toString("utf8")).message).toMatch(
      /c2307:payeeName.*3 Payee's Name/,
    );
  });

  it("6. an issued certificate prints its payor from the snapshot after the client's name changes; the clear copy has no stamp and no footer", async () => {
    const cid = await payor();
    const id = await certificate(cid, INDIVIDUAL_PAYEE);
    await issue(id);
    await writer.client.update({
      where: { id: cid },
      data: {
        regName: "RENAMED LATER CORP",
        address: "999 Moved Away St",
        tin: "000999888",
      },
    });
    const res = await as(http().post(`${API}/bir-forms/${id}/clear-copy`));
    expect(res.status).toBe(201);
    expect(res.body.kind).toBe("pdf");
    // The same name the editor offers for the file: payor TIN + branch, form, period.
    expect(res.body.filename).toBe("000111222000-2307-2026-Q3.pdf");
    const stored = [...storage.objects.entries()].find(([k]) =>
      k.endsWith(`/${id}/${res.body.filename}`),
    )!;
    expect(stored[1].contentType).toBe("application/pdf");
    const items = await ink(Buffer.from(stored[1].body), false);
    expectPrinted(items, {
      payorTin1: "000",
      payorTin2: "111",
      payorTin3: "222",
      payorName: "HALIMBAWATRADINGCORP",
      payorAddress: "12INVENTEDST,LUNGSODNGHALIMBAWA",
      payeeName: "DELACRUZ,JUANASAMPLE",
    });
    expect(
      await writer.birFormExport.count({ where: { birFormId: id, kind: "pdf" } }),
    ).toBe(1);
    // Reprinting an issued certificate is never refused.
    const again = await as(http().post(`${API}/bir-forms/${id}/clear-copy`));
    expect(again.status).toBe(201);
  });

  it("7. a clear copy of a draft and a preview of an issued certificate are refused as for the other forms", async () => {
    const cid = await payor();
    const draft = await certificate(cid, INDIVIDUAL_PAYEE);
    const clear = await as(http().post(`${API}/bir-forms/${draft}/clear-copy`));
    expect(clear.status).toBe(409);
    expect(clear.body.message).toBe(CLEAR_COPY_DRAFT);
    const filed = await certificate(cid, INDIVIDUAL_PAYEE);
    await issue(filed);
    const pv = await preview(filed);
    expect(pv.status).toBe(409);
    expect(JSON.parse((pv.body as Buffer).toString("utf8")).message).toBe(PREVIEW_FILED);
  });

  it("8. a certificate issued before the replica prints without error, its missing fields blank", async () => {
    const old = await certificate(
      await payor(),
      {
        year: "2025",
        quarter: "4",
        payeeName: "OLD PAYEE",
        payeeTin: "000123456",
        payeeAddress: "1 Old Road",
        // no payeeZip, payeeForeignAddress, payeeBranch, rowsB; signatory under the older keys
        payorName: "OLD SIGNER",
        payorTitle: "OWNER",
        rows: [{ atc: "WI010", desc: "OLD ROW", m1: "100", m2: "", m3: "", tax: "2" }],
      },
      "2025-Q4",
    );
    await issue(old);
    const res = await as(http().post(`${API}/bir-forms/${old}/clear-copy`));
    expect(res.status).toBe(201);
    const stored = [...storage.objects.entries()].find(([k]) =>
      k.endsWith(`/${old}/${res.body.filename}`),
    )!;
    const items = await ink(Buffer.from(stored[1].body), false);
    expectPrinted(items, {
      periodFrom: "10012025",
      periodTo: "12312025",
      payeeName: "OLDPAYEE",
      payeeTin1: "000",
      payeeTin2: "123",
      payeeTin3: "456",
      payeeBranch: "",
      payeeZip: "",
      payeeForeignAddress: "",
      payorSigName: "OLDSIGNER",
      payorSigTitleTin: "OWNER",
      a1M1: "100.00",
      a1Total: "100.00",
      a1Tax: "2.00",
      aTotalIncome: "100.00",
      b1Desc: "",
      bTotalIncome: "",
    });
  });

  it("9. the payor's BIR name: a draft without it is refused in the editor's words; an issued certificate falls back to its business name and is never refused", async () => {
    const noName = await payor({
      regName: null,
      businessName: `${TAG} Display Name Only`,
    });
    const draft = await certificate(noName, INDIVIDUAL_PAYEE);
    const pv = await preview(draft);
    expect(pv.status).toBe(409);
    expect(JSON.parse((pv.body as Buffer).toString("utf8")).message).toBe(
      PAYOR_NAME_MISSING,
    );

    const trade = await payor({
      regName: "HALIMBAWA TRADING CORP",
      tradeName: "KUBO NG HALIMBAWA",
      businessName: "KUBO DISPLAY",
    });
    const okDraft = await certificate(trade, INDIVIDUAL_PAYEE);
    const ok = await preview(okDraft);
    expect(ok.status).toBe(200);
    const items = await ink(ok.body as Buffer, true);
    expectPrinted(items, { payorName: "HALIMBAWATRADINGCORP" }); // never the trade or display name

    const issued = await certificate(noName, INDIVIDUAL_PAYEE);
    await issue(issued);
    const cc = await as(http().post(`${API}/bir-forms/${issued}/clear-copy`));
    expect(cc.status).toBe(201);
  });

  it("10. an individual payor's name prints as LAST, FIRST MIDDLE", async () => {
    const person = await payor({
      kind: "individual",
      regName: null,
      lastName: "HALIMBAWA",
      firstName: "PEDRO",
      middleName: "SUBOK",
    });
    const res = await preview(await certificate(person, INDIVIDUAL_PAYEE));
    expect(res.status).toBe(200);
    const items = await ink(res.body as Buffer, true);
    expectPrinted(items, { payorName: "HALIMBAWA,PEDROSUBOK" });
  });

  it("11. Item 1 follows the quarter: its first and last day, on the calendar year", async () => {
    const cid = await payor();
    const bounds: [string, string, string][] = [
      ["1", "01012026", "03312026"],
      ["2", "04012026", "06302026"],
      ["3", "07012026", "09302026"],
      ["4", "10012026", "12312026"],
    ];
    for (const [q, from, to] of bounds) {
      const id = await certificate(
        cid,
        { ...INDIVIDUAL_PAYEE, quarter: q },
        `2026-Q${q}`,
      );
      const res = await preview(id);
      expect(res.status).toBe(200);
      const items = await ink(res.body as Buffer, true);
      expectPrinted(items, { periodFrom: from, periodTo: to });
    }
  });

  it("12. the lists and the certificate say what can be printed; the 2316 still has no print", async () => {
    const cid = await payor();
    const draft = await certificate(cid, INDIVIDUAL_PAYEE);
    const filed = await certificate(cid, INDIVIDUAL_PAYEE);
    await issue(filed);
    const one = async (id: string) =>
      (await as(http().get(`${API}/bir-forms/${id}`))).body as {
        previewAvailable: boolean;
        clearCopyAvailable: boolean;
      };
    const d = await one(draft);
    const f = await one(filed);
    expect([d.previewAvailable, d.clearCopyAvailable]).toEqual([true, false]);
    expect([f.previewAvailable, f.clearCopyAvailable]).toEqual([false, true]);
    const list = (await as(http().get(`${API}/bir-forms?clientId=${cid}`))).body as {
      id: string;
      previewAvailable: boolean;
      clearCopyAvailable: boolean;
    }[];
    const by = new Map(list.map((x) => [x.id, x]));
    expect(by.get(draft)!.previewAvailable).toBe(true);
    expect(by.get(filed)!.clearCopyAvailable).toBe(true);

    const c2316 = (
      await as(http().post(`${API}/bir-forms`)).send({
        clientId: cid,
        form: "2316",
        period: "2026",
        data: {},
      })
    ).body.id as string;
    const pv = await preview(c2316);
    expect(pv.status).toBe(409);
    expect(JSON.parse((pv.body as Buffer).toString("utf8")).message).toBe(
      "A preview of the 2316 is not available yet.",
    );
  });
});
