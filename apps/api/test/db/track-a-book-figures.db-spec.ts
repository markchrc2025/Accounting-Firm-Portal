/**
 * track-a-book-figures.db-spec.ts — U15, GET /bir-forms/book-figures, over HTTP against
 * the real Nest app and the local PostgreSQL. The Portal's books fill the 2551Q and the
 * 2550Q: posted records of the return's quarter, summed exactly and rounded ONCE per
 * reported line to the nearest whole peso (50 centavos and above up). Every firm,
 * client and amount is invented; every expected figure is worked by hand beside it.
 *
 * T1  The feeder itself: the percentage client's rows by ATC, the VAT client's sales by
 *     class, Item 16 and Items 44 to 49, rounding, wrong-regime clients, and the
 *     refusals (404, 403, 400).
 * T2  One truth with the tax estimate (R4).
 * T4  A fiscal-year client's quarter.
 */
import { randomUUID } from "node:crypto";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { truncateOncePerFile } from "./helpers/truncate";
import { AppModule } from "../../src/app.module";
import { TokenService } from "../../src/auth/token.service";
import { compute2550Q } from "../../src/bir-forms/engine";
import { PrismaService } from "../../src/prisma/prisma.service";
import { StorageService } from "../../src/storage/storage.service";

truncateOncePerFile({ firmRoles: ["Super Admin", "Manager"] });

const TAG = `track-a-book-figures-${randomUUID().slice(0, 8)}`;
const API = "/api/v1";
const Q3 = { from: "2026-07-01", to: "2026-09-30" };

/** In-memory object storage standing in for S3. */
class FakeStorage {
  objects = new Map<string, Uint8Array>();
  isEnabled() {
    return true;
  }
  birFormExportKey(firmId: string, birFormId: string, filename: string) {
    return `bir-forms/${firmId}/${birFormId}/${filename}`;
  }
  async putObject(key: string, body: Uint8Array) {
    this.objects.set(key, body);
  }
  async deleteObject(key: string) {
    this.objects.delete(key);
  }
  async signedGetUrl(key: string) {
    return `https://storage.test/${key}?signed=1`;
  }
}

// --- the sentences a person reads (word for word) -----------------------------------
const NOT_PERCENTAGE =
  "This client isn't a percentage-tax client; the 2551Q will stay empty.";
const NOT_VAT = "This client isn't a VAT client; the 2550Q will stay empty.";

describe("U15 · the Portal's books fill the 2551Q and the 2550Q (real app over HTTP, db)", () => {
  let app: INestApplication;
  let writer: PrismaService;
  let tokens: TokenService;
  const storage = new FakeStorage();
  let firmId = "";
  let saToken = "";
  const ids: Record<string, string> = {};
  const cats: Record<string, { income: string; expense: string }> = {};

  const http = () => request(app.getHttpServer());
  const figures = (clientId: string, form: string, period: string, token = saToken) =>
    http()
      .get(`${API}/bir-forms/book-figures`)
      .query({ clientId, form, period })
      .set("Authorization", `Bearer ${token}`);

  async function client(
    key: string,
    taxType: "VAT" | "PERCENTAGE" | null,
    fiscalYearStart: string | null = null,
  ) {
    const c = await writer.client.create({
      data: {
        firmId,
        businessName: `${TAG} ${key}`,
        tin: `000000${String(Object.keys(ids).length + 801).padStart(3, "0")}`,
        taxType,
        fiscalYearStart: fiscalYearStart
          ? new Date(`${fiscalYearStart}T00:00:00.000Z`)
          : null,
      },
    });
    ids[key] = c.id;
    const income = await writer.category.create({
      data: { clientId: c.id, type: "INCOME", name: `${TAG} sales ${key}` },
    });
    const expense = await writer.category.create({
      data: { clientId: c.id, type: "EXPENSE", name: `${TAG} costs ${key}` },
    });
    cats[key] = { income: income.id, expense: expense.id };
    return c.id;
  }

  const sale = (
    key: string,
    date: string,
    net: number | string,
    o: {
      vatClass?: string;
      atc?: string | null;
      gov?: boolean;
      withheld?: number | string;
    } = {},
  ) =>
    writer.incomeTransaction.create({
      data: {
        clientId: ids[key]!,
        categoryId: cats[key]!.income,
        txnDate: new Date(`${date}T00:00:00.000Z`),
        description: `${TAG} sale`,
        netAmount: net,
        vatClass: o.vatClass ?? "NON_VAT",
        atc: o.atc === undefined ? null : o.atc,
        saleToGovernment: o.gov ?? false,
        creditableVATWithheld5pct: o.withheld ?? null,
      },
    });

  const cost = (
    key: string,
    date: string,
    net: number | string,
    o: {
      category?: string | null;
      inputVAT?: number | string;
      status?: "posted" | "held";
      capital?: boolean;
    } = {},
  ) =>
    writer.purchaseTransaction.create({
      data: {
        clientId: ids[key]!,
        categoryId: cats[key]!.expense,
        txnDate: new Date(`${date}T00:00:00.000Z`),
        description: `${TAG} cost`,
        netAmount: net,
        inputVATCategory: o.category === undefined ? null : o.category,
        inputVAT: o.inputVAT ?? 0,
        status: o.status ?? "posted",
        isCapitalGood: o.capital ?? false,
        ...(o.capital
          ? { capitalGoodAcquisitionCost: net, estimatedUsefulLifeMonths: 60 }
          : {}),
      },
    });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(StorageService)
      .useValue(storage)
      .compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix("api/v1");
    await app.init();
    writer = app.get(PrismaService);
    tokens = app.get(TokenService);
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
    saToken = tokens.signAccess({
      id: sa.id,
      firmId,
      userType: "FIRM",
      email: sa.email,
    });

    // --- the percentage-tax client: Q3 2026 (1 July – 30 September) ----------------
    await client("PCT", "PERCENTAGE");
    await sale("PCT", "2026-07-01", "100000.00", { atc: "PT010" });
    await sale("PCT", "2026-08-15", "20000.49", { atc: "PT010" }); // PT010 = 120,000.49
    await sale("PCT", "2026-09-30", "50000.50", { atc: "PT040" }); // last day counts; .50 up
    for (const d of ["2026-08-01", "2026-08-02", "2026-08-03"]) {
      await sale("PCT", d, "0.40", { atc: "PT060" }); // three 0.40s: 0 each, 1.20 together
    }
    await sale("PCT", "2026-07-10", "5000.00", { atc: null });
    await sale("PCT", "2026-07-20", "4000.00", { atc: null });
    await sale("PCT", "2026-08-05", "3400.00", { atc: "" }); // blank = no ATC: 12,400 in all
    await sale("PCT", "2026-09-01", "8000.00", { atc: "WI010" }); // a withholding code
    await sale("PCT", "2026-06-30", "77777.00", { atc: "PT010" }); // the quarter before
    await sale("PCT", "2026-10-01", "66666.00", { atc: "PT010" }); // the quarter after
    await cost("PCT", "2026-08-10", "123456.00", { status: "held" }); // never counted

    // --- the VAT client: Q3 2026 ---------------------------------------------------
    await client("VAT", "VAT");
    await sale("VAT", "2026-07-05", "500000.00", { vatClass: "VATABLE_12" });
    await sale("VAT", "2026-08-20", "100000.00", {
      vatClass: "VATABLE_12",
      gov: true,
      withheld: "3000.50", // Item 16: .50 rounds up
    });
    await sale("VAT", "2026-08-25", "0.49", { vatClass: "VATABLE_12" });
    await sale("VAT", "2026-07-15", "250000.50", { vatClass: "ZERO_RATED" });
    for (const d of ["2026-08-01", "2026-08-02", "2026-08-03"]) {
      await sale("VAT", d, "0.40", { vatClass: "EXEMPT" });
    }
    await sale("VAT", "2026-09-10", "700.00", { vatClass: "NON_VAT" });
    await sale("VAT", "2026-06-30", "9999.00", { vatClass: "VATABLE_12" });
    await sale("VAT", "2026-10-01", "9998.00", { vatClass: "VATABLE_12" });

    await cost("VAT", "2026-07-02", "80000.00", {
      category: "DOMESTIC_PURCHASES",
      inputVAT: "9600.00",
    });
    await cost("VAT", "2026-09-30", "20000.10", {
      category: "DOMESTIC_PURCHASES",
      inputVAT: "2400.01",
    });
    await cost("VAT", "2026-07-03", "10000.00", {
      category: "SERVICES_NONRESIDENT",
      inputVAT: "1200.00",
    });
    await cost("VAT", "2026-07-04", "30000.50", {
      category: "IMPORTATION_GOODS",
      inputVAT: "3600.06",
    });
    await cost("VAT", "2026-07-06", "5000.00", {
      category: "OTHERS_WITH_INPUT_TAX",
      inputVAT: "600.00",
    });
    await cost("VAT", "2026-07-07", "7000.49", { category: "DOMESTIC_NO_INPUT_TAX" });
    await cost("VAT", "2026-07-08", "4000.50", { category: "VAT_EXEMPT_IMPORTATION" });
    await cost("VAT", "2026-07-09", "1500000.00", {
      category: "CAPITAL_GOODS_GT_1M",
      inputVAT: "180000.00",
      capital: true,
    });
    await cost("VAT", "2026-07-11", "900.00", { category: null });
    await cost("VAT", "2026-07-12", "1000000.00", {
      category: "DOMESTIC_PURCHASES",
      inputVAT: "120000.00",
      status: "held", // a held import is in no figure
    });
    await cost("VAT", "2026-06-30", "55555.00", {
      category: "DOMESTIC_PURCHASES",
      inputVAT: "6666.60",
    });
    await cost("VAT", "2026-10-01", "44444.00", {
      category: "DOMESTIC_PURCHASES",
      inputVAT: "5333.28",
    });

    // --- exempt from business tax (taxType null): neither form -----------------------
    await client("EXEMPT", null);
    await sale("EXEMPT", "2026-08-01", "99999.00");
  });

  afterAll(async () => {
    await app.close();
  });

  describe("T1 · the 2551Q for a percentage-tax client", () => {
    it("rows by ATC with the editor's rate; no-ATC and unlisted-ATC sales left out and warned; neighbouring quarters and held records never counted", async () => {
      const res = await figures(ids.PCT!, "2551Q", "2026-Q3");
      expect(res.status).toBe(200);
      expect(res.body.form).toBe("2551Q");
      expect(res.body.period).toBe("2026-Q3");
      expect(new Date(res.body.asOf).toISOString()).toBe(res.body.asOf);
      // PT010 100,000.00 + 20,000.49 = 120,000.49 → 120,000 (.49 down);
      // PT040 50,000.50 → 50,001 (.50 up), on 30 September itself;
      // PT060 three × 0.40 = 1.20 → 1 (each is 0 alone: crosses a peso only in total).
      // Rate "3": the editor's rate for every row (BirForm2551QEditor.tsx:42).
      expect(res.body.figures).toEqual({
        rows: [
          { atc: "PT010", taxable: "120000", rate: "3" },
          { atc: "PT040", taxable: "50001", rate: "3" },
          { atc: "PT060", taxable: "1", rate: "3" },
        ],
      });
      expect(res.body.warnings).toEqual([
        "3 sales (₱12,400) have no ATC and were left out.",
        "1 sale (₱8,000) has an ATC the 2551Q doesn't list (WI010) and was left out.",
      ]);
      // 10 income records in the quarter: 2 + 1 + 3 + 3 + 1. (The two outside it and
      // the held purchase are not among them.)
      expect(res.body.recordCount).toBe(10);
      // Gross receipts: 120,000.49 + 50,000.50 + 1.20 + 12,400 + 8,000 = 190,402.19.
      expect(res.body.lines).toEqual([
        {
          key: "rows.PT010",
          label: "Schedule 1 · PT010",
          amount: 120000,
          records: 2,
          filter: { kind: "income", ...Q3, atc: "PT010" },
        },
        {
          key: "rows.PT040",
          label: "Schedule 1 · PT040",
          amount: 50001,
          records: 1,
          filter: { kind: "income", ...Q3, atc: "PT040" },
        },
        {
          key: "rows.PT060",
          label: "Schedule 1 · PT060",
          amount: 1,
          records: 3,
          filter: { kind: "income", ...Q3, atc: "PT060" },
        },
        {
          key: "grossReceipts",
          label: "Gross receipts for the quarter",
          amount: 190402,
          records: 10,
          filter: { kind: "income", ...Q3 },
        },
      ]);
    });

    it("a 2550Q request for the percentage client gets no figures and the VAT warning", async () => {
      const res = await figures(ids.PCT!, "2550Q", "2026-Q3");
      expect(res.status).toBe(200);
      expect(res.body.figures).toEqual({});
      expect(res.body.lines).toEqual([]);
      expect(res.body.recordCount).toBe(0);
      expect(res.body.warnings).toEqual([NOT_VAT]);
    });
  });

  describe("T1 · the 2550Q for a VAT client", () => {
    it("sales by class, Item 16 and Items 44 to 49, rounded once per line", async () => {
      const res = await figures(ids.VAT!, "2550Q", "2026-Q3");
      expect(res.status).toBe(200);
      // Item 31A: 500,000.00 + 100,000.00 (a sale to government: the form has no
      //   separate line) + 0.49 = 600,000.49 → 600,000.
      // Item 32A: 250,000.50 → 250,001.   Item 33A: 3 × 0.40 = 1.20 → 1.
      // Item 16: the government sale's 3,000.50 withheld → 3,001.
      // Item 44: 80,000.00 + 20,000.10 = 100,000.10 → 100,000; input tax
      //   9,600.00 + 2,400.01 = 12,000.01 → 12,000.
      // Item 45: 10,000 / 1,200.   Item 46: 30,000.50 → 30,001; 3,600.06 → 3,600.
      // Item 47: 5,000 / 600.   Item 48A: 7,000.49 → 7,000.   Item 49A: 4,000.50 → 4,001.
      // No Item 31B, 50, 51 …: the output tax and the totals are the compute file's.
      expect(res.body.figures).toEqual({
        i31a: "600000",
        i32a: "250001",
        i33a: "1",
        i16: "3001",
        i44a: "100000",
        i44b: "12000",
        i45a: "10000",
        i45b: "1200",
        i46a: "30001",
        i46b: "3600",
        i47a: "5000",
        i47b: "600",
        i48a: "7000",
        i49a: "4001",
      });
      expect(res.body.warnings).toEqual([
        "1 sale (₱700) is marked non-VAT and was left out.",
        "1 purchase (₱1,500,000) is capital goods over ₱1 million; it belongs in Schedule 1 and was left out.",
        "1 purchase (₱900) has no VAT category and was left out.",
      ]);
      // 8 sales in the quarter (3 + 1 + 3 + 1) and 9 posted purchases (the held one,
      // and the two outside the quarter, are not counted).
      expect(res.body.recordCount).toBe(17);
      const line = (key: string) =>
        (res.body.lines as Array<{ key: string }>).find((l) => l.key === key);
      expect(line("i31a")).toEqual({
        key: "i31a",
        label: "VATable sales (net) — Item 31A",
        amount: 600000,
        records: 3,
        filter: { kind: "income", ...Q3, vatClass: "VATABLE_12" },
      });
      expect(line("i33a")).toMatchObject({ amount: 1, records: 3 });
      expect(line("i16")).toEqual({
        key: "i16",
        label: "Creditable VAT withheld — Item 16",
        amount: 3001,
        records: 1,
        filter: { kind: "income", ...Q3 },
      });
      expect(line("i44b")).toEqual({
        key: "i44b",
        label: "Domestic — goods (Item 44): input tax",
        amount: 12000,
        records: 2,
        filter: { kind: "purchases", ...Q3, inputVATCategory: "DOMESTIC_PURCHASES" },
      });
      expect(line("i48a")).toMatchObject({
        amount: 7000,
        records: 1,
        filter: { kind: "purchases", ...Q3, inputVATCategory: "DOMESTIC_NO_INPUT_TAX" },
      });
      // Gross receipts: 600,000.49 + 250,000.50 + 1.20 + 700 = 850,702.19 → 850,702.
      expect(line("grossReceipts")).toEqual({
        key: "grossReceipts",
        label: "Gross receipts for the quarter",
        amount: 850702,
        records: 8,
        filter: { kind: "income", ...Q3 },
      });
    });

    it("the figures go through compute2550Q: the output tax is the compute file's own 12%, and a saved draft computes the same", async () => {
      const res = await figures(ids.VAT!, "2550Q", "2026-Q3");
      const data = { year: "2026", ...res.body.figures };
      const direct = compute2550Q(data);
      // Output tax: 12% of 31A (600,000) = 72,000 — never the books' advisory outputVAT.
      expect(direct.i31b).toBe(72000);
      // Item 50A: 100,000 + 10,000 + 30,001 + 5,000 + 7,000 + 4,001 = 156,002;
      // Item 50B: 12,000 + 1,200 + 3,600 + 600 = 17,400.
      expect(direct.i50a).toBe(156002);
      expect(direct.i50b).toBe(17400);
      expect(direct.i16).toBe(3001);
      const saved = await http()
        .post(`${API}/bir-forms`)
        .set("Authorization", `Bearer ${saToken}`)
        .send({ clientId: ids.VAT, form: "2550Q", period: "2026-Q3", data });
      expect(saved.status).toBe(201);
      expect(saved.body.computed).toEqual(JSON.parse(JSON.stringify(direct)));
    });
  });

  describe("T1 · rounding", () => {
    it("49 centavos round down, 50 centavos round up, on one line", async () => {
      await client("EDGE", "VAT");
      await sale("EDGE", "2026-07-01", "10.49", { vatClass: "VATABLE_12" });
      await sale("EDGE", "2026-07-01", "10.50", { vatClass: "ZERO_RATED" });
      const res = await figures(ids.EDGE!, "2550Q", "2026-Q3");
      expect(res.body.figures.i31a).toBe("10");
      expect(res.body.figures.i32a).toBe("11");
    });

    it("a sum of many small rows is rounded once, not row by row", async () => {
      await client("MANY", "VAT");
      // 100 × 0.30 = 30.00 exactly (in floating point it is 30.000000000000004);
      // rounded row by row it would be 0.
      for (let i = 0; i < 100; i++) {
        await sale("MANY", "2026-08-15", "0.30", { vatClass: "VATABLE_12" });
      }
      // 7 × 0.07 = 0.49, and 1 more × 0.01 = 0.50 exactly: the boundary, in exact
      // decimal arithmetic.
      for (let i = 0; i < 7; i++) {
        await sale("MANY", "2026-08-15", "0.07", { vatClass: "EXEMPT" });
      }
      await sale("MANY", "2026-08-15", "0.01", { vatClass: "EXEMPT" });
      const res = await figures(ids.MANY!, "2550Q", "2026-Q3");
      expect(res.body.figures.i31a).toBe("30");
      expect(res.body.figures.i33a).toBe("1");
    });

    it("a negative total is never produced: the line shows ₱0 and says so", async () => {
      await client("NEG", "PERCENTAGE");
      // The API refuses a negative amount; only a direct write can leave one.
      await sale("NEG", "2026-08-02", "-50.00", { atc: "PT130" });
      await sale("NEG", "2026-08-03", "100.00", { atc: "PT010" });
      const res = await figures(ids.NEG!, "2551Q", "2026-Q3");
      expect(res.status).toBe(200);
      expect(res.body.figures.rows).toEqual([
        { atc: "PT010", taxable: "100", rate: "3" },
        { atc: "PT130", taxable: "0", rate: "3" },
      ]);
      expect(res.body.warnings).toEqual([
        "The books total for Schedule 1 · PT130 is below zero (-₱50); it is shown as ₱0.",
      ]);
      for (const l of res.body.lines as Array<{ amount: number }>) {
        expect(l.amount).toBeGreaterThanOrEqual(0);
      }
    });
  });

  describe("T1 · the edges the review found", () => {
    it("small negative totals say so, with the exact figure, and show ₱0", async () => {
      await client("NEG2", "PERCENTAGE");
      await sale("NEG2", "2026-08-02", "-0.40", { atc: "PT130" });
      await sale("NEG2", "2026-08-03", "-0.50", { atc: "PT120" });
      await sale("NEG2", "2026-08-04", "1234.00", { atc: "PT010" });
      const res = await figures(ids.NEG2!, "2551Q", "2026-Q3");
      expect(res.body.figures.rows).toEqual([
        { atc: "PT010", taxable: "1234", rate: "3" },
        { atc: "PT120", taxable: "0", rate: "3" },
        { atc: "PT130", taxable: "0", rate: "3" },
      ]);
      expect(res.body.warnings).toEqual([
        "The books total for Schedule 1 · PT120 is below zero (-₱0.50); it is shown as ₱0.",
        "The books total for Schedule 1 · PT130 is below zero (-₱0.40); it is shown as ₱0.",
      ]);
    });

    it("purchase lines are rounded once, not row by row; a category the Portal does not know is left out and said", async () => {
      await client("PURCH", "VAT");
      // Three purchases of 0.40 and 0.40 of input tax each: 0.00 row by row, 1 together.
      for (const d of ["2026-08-01", "2026-08-02", "2026-08-03"]) {
        await cost("PURCH", d, "0.40", {
          category: "SERVICES_NONRESIDENT",
          inputVAT: "0.40",
        });
        await cost("PURCH", d, "0.40", { category: "DOMESTIC_NO_INPUT_TAX" });
      }
      await cost("PURCH", "2026-08-04", "250.00", { category: "BOGUS_CATEGORY" });
      const res = await figures(ids.PURCH!, "2550Q", "2026-Q3");
      expect(res.body.figures).toMatchObject({ i45a: "1", i45b: "1", i48a: "1" });
      expect(res.body.warnings).toEqual([
        "1 purchase (₱250) has no VAT category and was left out.",
      ]);
    });

    it("a 2551Q inside the CREATE window (1 July 2020 to 30 June 2023) warns that the rate is not applied; outside it, nothing", async () => {
      await client("CREATE", "PERCENTAGE");
      for (const d of [
        "2020-05-10",
        "2020-08-10",
        "2022-02-10",
        "2023-05-10",
        "2023-08-10",
      ]) {
        await sale("CREATE", d, "1000.00", { atc: "PT010" });
      }
      const warning =
        "The 1% rate of 1 July 2020 to 30 June 2023 (CREATE, RA 11534) is not applied. Check the rate on each row.";
      for (const [period, warns] of [
        ["2020-Q2", false], // April–June 2020: before the window
        ["2020-Q3", true], // July–September 2020: its first quarter
        ["2022-Q1", true],
        ["2023-Q2", true], // April–June 2023: its last quarter
        ["2023-Q3", false], // July–September 2023: after
      ] as const) {
        const res = await figures(ids.CREATE!, "2551Q", period);
        expect([period, res.body.warnings]).toEqual([period, warns ? [warning] : []]);
        expect(res.body.figures.rows).toHaveLength(1);
      }
      // A window quarter with no rows has nothing to warn about.
      expect((await figures(ids.CREATE!, "2551Q", "2021-Q1")).body.warnings).toEqual([]);
    });

    it("a year that is not a real one is a bad period (400), never a 500", async () => {
      for (const period of ["0000-Q1", "0001-Q3", "1999-Q4", "2101-Q1", "9999-Q2"]) {
        for (const key of ["VAT", "FY"] as const) {
          if (!ids[key]) continue;
          const res = await figures(ids[key]!, "2550Q", period);
          expect([period, res.status]).toEqual([period, 400]);
          expect(res.body.message).toBe("That isn't a valid period for the 2550Q.");
        }
        expect((await figures(ids.PCT!, "2551Q", period)).status).toBe(400);
      }
    });
  });

  describe("T1 · wrong-regime clients get no figures and the exact warning", () => {
    it("a client exempt from business tax: neither form", async () => {
      for (const [form, warning] of [
        ["2551Q", NOT_PERCENTAGE],
        ["2550Q", NOT_VAT],
      ] as const) {
        const res = await figures(ids.EXEMPT!, form, "2026-Q3");
        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({
          form,
          period: "2026-Q3",
          figures: {},
          lines: [],
          recordCount: 0,
          warnings: [warning],
        });
      }
    });

    it("a VAT client asking for the 2551Q", async () => {
      const res = await figures(ids.VAT!, "2551Q", "2026-Q3");
      expect(res.status).toBe(200);
      expect(res.body.figures).toEqual({});
      expect(res.body.warnings).toEqual([NOT_PERCENTAGE]);
    });
  });

  describe("T1 · refusals", () => {
    it("another firm's client is 404", async () => {
      const other = await writer.firm.create({ data: { name: `${TAG} Other Firm` } });
      const foreign = await writer.client.create({
        data: { firmId: other.id, businessName: `${TAG} foreign`, taxType: "VAT" },
      });
      const res = await figures(foreign.id, "2550Q", "2026-Q3");
      expect(res.status).toBe(404);
      expect(res.body.message).toBe("Client not found");
    });

    it("a client principal is 403, and so is a firm user not assigned to the client", async () => {
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
          clientProfile: { create: { clientId: ids.VAT!, clientRole: "OWNER" } },
          userRoles: { create: { roleId: role.id, clientScopeId: ids.VAT! } },
        },
      });
      const portalToken = tokens.signAccess({
        id: portal.id,
        firmId,
        userType: "CLIENT",
        email: portal.email,
        clientId: ids.VAT!,
      });
      expect((await figures(ids.VAT!, "2550Q", "2026-Q3", portalToken)).status).toBe(403);

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
              clientAssignments: { create: { clientId: ids.PCT! } },
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
      const managerToken = tokens.signAccess({
        id: manager.id,
        firmId,
        userType: "FIRM",
        email: manager.email,
      });
      // Assigned to the percentage client only.
      expect((await figures(ids.VAT!, "2550Q", "2026-Q3", managerToken)).status).toBe(
        403,
      );
      expect((await figures(ids.PCT!, "2551Q", "2026-Q3", managerToken)).status).toBe(
        200,
      );
    });

    it("a form with no feeder is 400, and so is a bad period", async () => {
      const noFeeder = await figures(ids.VAT!, "1701Q", "2026-Q3");
      expect(noFeeder.status).toBe(400);
      expect(noFeeder.body.message).toBe("Books can't fill the 1701Q yet.");
      expect((await figures(ids.VAT!, "9999", "2026-Q3")).body.message).toBe(
        "Books can't fill the 9999 yet.",
      );
      for (const [form, period] of [
        ["2550Q", "2026"],
        ["2550Q", "2026-Q5"],
        ["2551Q", "Q3-2026"],
        ["2551Q", "2026-Q0"],
        ["2550Q", "  "],
      ] as const) {
        const res = await figures(ids.VAT!, form, period);
        expect(res.status).toBe(400);
        expect(res.body.message).toBe(`That isn't a valid period for the ${form}.`);
      }
      const noClient = await http()
        .get(`${API}/bir-forms/book-figures`)
        .query({ form: "2550Q", period: "2026-Q3" })
        .set("Authorization", `Bearer ${saToken}`);
      expect(noClient.status).toBe(400);
    });
  });
  describe("T2 · one truth with the tax estimate (R4)", () => {
    const estimate = (clientId: string, year: number, quarter: number) =>
      http()
        .get(`${API}/clients/${clientId}/tax-estimate`)
        .query({ year, quarter })
        .set("Authorization", `Bearer ${saToken}`);
    /** The half-up rule on the estimate's two-decimal figure. */
    const halfUp = (n: number) => Math.floor(n + 0.5);
    const gross = (body: { lines: Array<{ key: string; amount: number }> }) =>
      body.lines.find((l) => l.key === "grossReceipts")!.amount;

    it("a percentage-tax quarter: the gross receipts equal the estimate's, to the peso, and the rate is the estimate's", async () => {
      const est = await estimate(ids.PCT!, 2026, 3);
      expect(est.status).toBe(200);
      // The estimate sums the same income, net of VAT: 190,402.19.
      expect(est.body.businessTax.grossReceipts).toBe(190402.19);
      const fed = await figures(ids.PCT!, "2551Q", "2026-Q3");
      expect(gross(fed.body)).toBe(halfUp(est.body.businessTax.grossReceipts));
      expect(gross(fed.body)).toBe(190402);
      // The rate on every row is the percentage-tax rate the estimate applies.
      for (const row of fed.body.figures.rows as Array<{ rate: string }>) {
        expect(Number(row.rate)).toBe(est.body.businessTax.rate);
      }
    });

    it("a VAT quarter: the gross receipts equal the estimate's, to the peso", async () => {
      const est = await estimate(ids.VAT!, 2026, 3);
      expect(est.body.businessTax.grossReceipts).toBe(850702.19);
      const fed = await figures(ids.VAT!, "2550Q", "2026-Q3");
      expect(gross(fed.body)).toBe(halfUp(est.body.businessTax.grossReceipts));
      // The sales lines and what the 2550Q leaves out make up the estimate's figure.
      const f = fed.body.figures as Record<string, string>;
      expect(Number(f.i31a) + Number(f.i32a) + Number(f.i33a) + 700).toBe(850702);
    });

    it("a half-peso total rounds up on both sides", async () => {
      await client("HALF", "PERCENTAGE");
      await sale("HALF", "2026-08-01", "100.25", { atc: "PT010" });
      await sale("HALF", "2026-08-02", "100.25", { atc: "PT010" });
      const est = await estimate(ids.HALF!, 2026, 3);
      expect(est.body.businessTax.grossReceipts).toBe(200.5);
      const fed = await figures(ids.HALF!, "2551Q", "2026-Q3");
      expect(gross(fed.body)).toBe(201);
      expect(fed.body.figures.rows).toEqual([
        { atc: "PT010", taxable: "201", rate: "3" },
      ]);
    });
  });

  describe("T4 · a fiscal-year client's quarter is its own fiscal quarter", () => {
    // A fiscal year from 1 July 2025 ends 30 June 2026, so it is "2026": Q1 is
    // July–September 2025, Q2 October–December 2025, Q3 January–March 2026 and
    // Q4 April–June 2026 — the quarters the 2550Q's clear copy already prints.
    beforeAll(async () => {
      await client("FY", "VAT", "2025-07-01");
      for (const [date, net, vatClass] of [
        ["2025-06-30", "1000.00", "VATABLE_12"], // the year before: its Q4
        ["2025-07-01", "2000.00", "VATABLE_12"], // Q1, first day
        ["2025-09-30", "3000.00", "VATABLE_12"], // Q1, last day
        ["2025-10-01", "4000.00", "VATABLE_12"], // Q2
        ["2026-01-15", "5000.00", "VATABLE_12"], // Q3
        ["2026-03-31", "600.00", "EXEMPT"], // Q3, last day
        ["2026-04-01", "7000.00", "VATABLE_12"], // Q4
        ["2026-06-30", "8000.00", "VATABLE_12"], // Q4, last day
        ["2026-07-01", "9000.00", "VATABLE_12"], // the next fiscal year
      ] as const) {
        await sale("FY", date, net, { vatClass });
      }
    });

    it.each([
      ["2026-Q1", "2025-07-01", "2025-09-30", "5000", "0", 2],
      ["2026-Q2", "2025-10-01", "2025-12-31", "4000", "0", 1],
      ["2026-Q3", "2026-01-01", "2026-03-31", "5000", "600", 2],
      ["2026-Q4", "2026-04-01", "2026-06-30", "15000", "0", 2],
      ["2025-Q4", "2025-04-01", "2025-06-30", "1000", "0", 1],
    ])(
      "%s is %s to %s: Item 31A %s, Item 33A %s, %i sales",
      async (period, from, to, i31a, i33a, count) => {
        const res = await figures(ids.FY!, "2550Q", period);
        expect(res.status).toBe(200);
        expect(res.body.figures.i31a).toBe(i31a);
        expect(res.body.figures.i33a).toBe(i33a);
        expect(res.body.recordCount).toBe(count);
        const gross = res.body.lines.find(
          (l: { key: string }) => l.key === "grossReceipts",
        );
        expect(gross.filter).toEqual({ kind: "income", from, to });
      },
    );

    it("agrees with the dates the 2550Q's own export prints for the same draft", async () => {
      const draft = await http()
        .post(`${API}/bir-forms`)
        .set("Authorization", `Bearer ${saToken}`)
        .send({
          clientId: ids.FY,
          form: "2550Q",
          period: "2026-Q3",
          data: { year: "2026" },
        });
      expect(draft.status).toBe(201);
      const exp = await http()
        .post(`${API}/bir-forms/${draft.body.id}/export`)
        .set("Authorization", `Bearer ${saToken}`);
      expect(exp.status).toBe(201);
      const xml = Buffer.from(
        storage.objects.get(`bir-forms/${firmId}/${draft.body.id}/${exp.body.filename}`)!,
      ).toString("utf8");
      const field = (k: string) =>
        new RegExp(`<div>frm2550qv2024:${k}=(.*?)frm2550qv2024:${k}=</div>`).exec(
          xml,
        )![1];
      // "1/01/2026" – "3/31/2026": January to March 2026, as the feeder reads it.
      expect([field("RtnPeriodFromNo4"), field("RtnPeriodToNo4")]).toEqual([
        "1/01/2026",
        "3/31/2026",
      ]);
    });

    it("the 2551Q reads calendar quarters even for a fiscal-year client: its export, clear copy and editor have no fiscal quarter", async () => {
      await client("FYP", "PERCENTAGE", "2025-04-01");
      await sale("FYP", "2025-05-10", "5000.00", { atc: "PT010" }); // fiscal Q1 of "2026"
      await sale("FYP", "2026-02-10", "1000.00", { atc: "PT010" }); // calendar Q1 of 2026
      const res = await figures(ids.FYP!, "2551Q", "2026-Q1");
      expect(res.body.figures.rows).toEqual([
        { atc: "PT010", taxable: "1000", rate: "3" },
      ]);
      const g = res.body.lines.find((l: { key: string }) => l.key === "grossReceipts");
      expect(g.filter).toEqual({ kind: "income", from: "2026-01-01", to: "2026-03-31" });
    });

    it("a calendar client keeps calendar quarters; and the tax estimate still counts calendar quarters for every client (U10, not touched here)", async () => {
      const calendar = await figures(ids.VAT!, "2550Q", "2026-Q3");
      const g = calendar.body.lines.find(
        (l: { key: string }) => l.key === "grossReceipts",
      );
      expect(g.filter).toEqual({ kind: "income", ...Q3 });
      // The estimate for the fiscal client's "quarter 3" is July–September 2026 —
      // 9,000 — while its fiscal Q3 return is January–March 2026 — 5,600. R4's
      // equality therefore holds for calendar clients only; reported in U15.
      const est = await http()
        .get(`${API}/clients/${ids.FY}/tax-estimate`)
        .query({ year: 2026, quarter: 3 })
        .set("Authorization", `Bearer ${saToken}`);
      expect(est.body.businessTax.grossReceipts).toBe(9000);
    });
  });
});
