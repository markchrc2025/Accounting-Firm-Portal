/**
 * track-c-c8-2307-block-b.db-spec.ts — C8 (real app over HTTP, db): block B of the 2307 (the
 * money payments subject to withholding of business tax) from the editor's entries, and the
 * seeded ATC table the picker reads.
 *
 *   * what the seed says about the WB and WV codes (their classification), read through the
 *     route the picker uses (GET /bir/atc-codes);
 *   * the compute totals block B in exact decimals (POST /bir-forms/compute);
 *   * Preview PDF and Download clear copy print block B through the C7 map, the ATC as chosen,
 *     the totals to the centavo; a certificate saved without block B prints it blank.
 *
 * Every firm, client, TIN, name and figure is invented.
 */
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { truncateOncePerFile } from "./helpers/truncate";
import { BIR_PDF, loadMap, overlay, printed, readPdfText } from "./helpers/pdf-text";
import { loadAtcReference } from "./helpers/atc-reference";
import { AppModule } from "../../src/app.module";
import { TokenService } from "../../src/auth/token.service";
import { PrismaService } from "../../src/prisma/prisma.service";
import { StorageService } from "../../src/storage/storage.service";

truncateOncePerFile({ firmRoles: ["Super Admin", "Manager"] });

const TAG = `track-c-c8-${randomUUID().slice(0, 8)}`;
const API = "/api/v1";

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

const map = () => loadMap("2307-2018-01.json");
const field = (key: string) => {
  const f = map().fields.find((m) => m.key === `c2307:${key}`);
  if (!f) throw new Error(`the 2307 map has no ${key}`);
  return f;
};

describe("C8 · block B of the 2307 and the seeded ATC table (real app over HTTP, db)", () => {
  let app: INestApplication;
  let writer: PrismaService;
  const storage = new FakeStorage();
  let firmId = "";
  let token = "";
  let clientId = "";

  const http = () => request(app.getHttpServer());
  const as = (r: request.Test) => r.set("Authorization", `Bearer ${token}`);

  async function certificate(data: Record<string, unknown>) {
    const created = await as(http().post(`${API}/bir-forms`)).send({
      clientId,
      form: "2307",
      period: "2026-Q3",
      data,
    });
    expect(created.status).toBe(201);
    return created.body.id as string;
  }
  async function ink(pdf: Buffer, stamped: boolean) {
    const blank = readFileSync(join(BIR_PDF, "templates", map().template));
    const [copy, template] = readPdfText(new Uint8Array(pdf), blank);
    const added = overlay(copy!, template!);
    expect(added.some((t) => t.str === "DRAFT — NOT FILED")).toBe(stamped);
    return added;
  }
  function expectPrinted(
    items: Awaited<ReturnType<typeof ink>>,
    want: Record<string, string>,
  ) {
    const got: Record<string, string> = {};
    for (const k of Object.keys(want)) got[k] = printed(items, field(k));
    expect(got).toEqual(want);
  }

  const PAYEE = {
    year: "2026",
    quarter: "3",
    payeeName: "DELA CRUZ, JUANA SAMPLE",
    payeeTin: "000-333-444",
    payeeBranch: "00000",
    payeeAddress: "88 Sample Road",
    payeeZip: "1234",
  };
  const ROWS_A = [
    { atc: "WI010", desc: "FEES", m1: "1,000.00", m2: "", m3: "", tax: "50.00" },
  ];
  const ROWS_B = [
    {
      atc: "WB030",
      desc: "TAX ON CARRIERS",
      m1: "0.1",
      m2: "0.2",
      m3: "0.3",
      tax: "7.77",
    },
    {
      atc: "WV010",
      desc: "VAT WITHHELD ON GOODS",
      m1: "1,234.56",
      m2: "0.01",
      m3: "",
      tax: "61.73",
    },
  ];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(StorageService)
      .useValue(storage)
      .compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix("api/v1");
    await app.init();
    writer = app.get(PrismaService);
    // The seeded table the picker reads (the same file the seed loads).
    expect(await loadAtcReference(writer)).toBeGreaterThan(200);
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
    clientId = (
      await writer.client.create({
        data: {
          firmId,
          businessName: `${TAG} Halimbawa Trading`,
          kind: "non-individual",
          regName: "HALIMBAWA TRADING CORP",
          tin: "000111222",
          branch: "00000",
          rdo: "027",
          address: "12 Invented St",
          city: "Lungsod ng Halimbawa",
          zip: "0000",
          taxType: "PERCENTAGE",
        } as never,
      })
    ).id;
  });

  afterAll(async () => {
    await app.close();
  });

  it("1. the seeded table: every WB code is a percentage-tax withholding code and every WV code a withholding-VAT code; the 2307 carries them, but not the stock and IPO taxes", async () => {
    const res = await as(http().get(`${API}/bir/atc-codes`));
    expect(res.status).toBe(200);
    const all = res.body as {
      atc: string;
      classification: string;
      certificate: string | null;
      status: string;
    }[];
    const wb = all.filter((c) => c.atc.startsWith("WB"));
    const wv = all.filter((c) => c.atc.startsWith("WV"));
    expect(wb.length).toBeGreaterThanOrEqual(30);
    expect(wv.length).toBeGreaterThanOrEqual(9);
    expect([...new Set(wb.map((c) => c.classification))]).toEqual(["percentage_wt"]);
    expect([...new Set(wv.map((c) => c.classification))]).toEqual(["wvat"]);
    // and nothing else carries those two classifications
    const business = all.filter((c) =>
      ["percentage_wt", "wvat"].includes(c.classification),
    );
    expect(business.map((c) => c.atc).sort()).toEqual(
      [...wb, ...wv].map((c) => c.atc).sort(),
    );
    // the stock transaction tax (WB200) and the IPO tax (WB201-203, repealed) are not 2307 codes
    const notOn2307 = business
      .filter((c) => c.certificate !== "2307")
      .map((c) => c.atc)
      .sort();
    expect(notOn2307).toEqual(["WB200", "WB201", "WB202", "WB203"]);
    expect(
      business
        .filter((c) => c.status === "repealed")
        .map((c) => c.atc)
        .sort(),
    ).toEqual(["WB201", "WB202", "WB203"]);
    // block A's codes: expanded withholding, all for the 2307
    const ewt = all.filter((c) => c.classification === "ewt");
    expect(ewt.length).toBeGreaterThanOrEqual(100);
    expect(ewt.every((c) => c.certificate === "2307")).toBe(true);
  });

  it("2. the compute totals block B in exact decimals, and block A as it always did", async () => {
    const res = await as(http().post(`${API}/bir-forms/compute`)).send({
      form: "2307",
      data: { ...PAYEE, rows: ROWS_A, rowsB: ROWS_B },
    });
    expect(res.status).toBe(201);
    expect(res.body.totalIncome).toBe(1000);
    expect(res.body.totalTax).toBe(50);
    expect(res.body.blockB.rows.map((r: { total: number }) => r.total)).toEqual([
      0.6, 1234.57,
    ]);
    expect(res.body.blockB).toMatchObject({
      tM1: 1234.66,
      tM2: 0.21,
      tM3: 0.3,
      totalIncome: 1235.17,
      totalTax: 69.5,
    });
    const without = await as(http().post(`${API}/bir-forms/compute`)).send({
      form: "2307",
      data: { ...PAYEE, rows: ROWS_A },
    });
    expect(without.body.blockB.rows).toEqual([]);
    expect(without.body.blockB.totalIncome).toBe(0);
  });

  it("3. Preview PDF prints block B from the editor's entries: the ATC as chosen, amounts as typed, totals to the centavo", async () => {
    const id = await certificate({ ...PAYEE, rows: ROWS_A, rowsB: ROWS_B });
    const res = await as(http().post(`${API}/bir-forms/${id}/preview-pdf`))
      .buffer(true)
      .parse(binary);
    expect(res.status).toBe(200);
    const items = await ink(res.body as Buffer, true);
    expectPrinted(items, {
      a1Atc: "WI010",
      b1Desc: "TAXONCARRIERS",
      b1Atc: "WB030",
      b1M1: "0.10",
      b1M2: "0.20",
      b1M3: "0.30",
      b1Total: "0.60",
      b1Tax: "7.77",
      b2Desc: "VATWITHHELDONGOODS",
      b2Atc: "WV010",
      b2M1: "1,234.56",
      b2M2: "0.01",
      b2M3: "",
      b2Total: "1,234.57",
      b2Tax: "61.73",
      bTotalM1: "1,234.66",
      bTotalM2: "0.21",
      bTotalM3: "0.30",
      bTotalIncome: "1,235.17",
      bTotalTax: "69.50",
    });
  });

  it("4. the clear copy of an issued certificate prints block B too, with no stamp", async () => {
    const id = await certificate({ ...PAYEE, rows: ROWS_A, rowsB: ROWS_B });
    const issued = await as(http().patch(`${API}/bir-forms/${id}`)).send({
      status: "filed",
    });
    expect(issued.status).toBe(200);
    const copy = await as(http().post(`${API}/bir-forms/${id}/clear-copy`));
    expect(copy.status).toBe(201);
    const stored = [...storage.objects.entries()].find(([k]) =>
      k.endsWith(`/${id}/${copy.body.filename}`),
    )!;
    const items = await ink(Buffer.from(stored[1].body), false);
    expectPrinted(items, {
      b1Atc: "WB030",
      b2Atc: "WV010",
      bTotalIncome: "1,235.17",
      bTotalTax: "69.50",
    });
  });

  it("5. a certificate saved without block B prints it blank, exactly as before; a third decimal in block B is refused, not rounded", async () => {
    const id = await certificate({ ...PAYEE, rows: ROWS_A });
    const res = await as(http().post(`${API}/bir-forms/${id}/preview-pdf`))
      .buffer(true)
      .parse(binary);
    expect(res.status).toBe(200);
    const items = await ink(res.body as Buffer, true);
    expectPrinted(items, {
      b1Desc: "",
      b1Atc: "",
      b1Total: "",
      bTotalIncome: "",
      bTotalTax: "",
      a1Atc: "WI010",
    });
    const bad = await certificate({
      ...PAYEE,
      rows: ROWS_A,
      rowsB: [{ atc: "WB030", desc: "X", m1: "12.345", m2: "", m3: "", tax: "" }],
    });
    const refused = await as(http().post(`${API}/bir-forms/${bad}/preview-pdf`))
      .buffer(true)
      .parse(binary);
    expect(refused.status).toBe(409);
    expect(JSON.parse((refused.body as Buffer).toString("utf8")).message).toMatch(
      /12\.345/,
    );
  });
});
