/**
 * track-a-withholding-returns.db-spec.ts — U17, over HTTP against the real Nest app and
 * the local PostgreSQL. The expanded-withholding returns: BIR Form 0619-E (months 1 and
 * 2 of a quarter) and BIR Form 1601-EQ (the quarter). The client is the WITHHOLDING AGENT;
 * the figures come from its posted expense records. Every firm, client, vendor and amount
 * is invented; every expected figure is worked by hand beside it.
 *
 * T1  Books feed both returns, to the centavo (never rounded to pesos); the records that
 *     are left out and the warnings for them; the third-month refusal; items 20, 21 and 23
 *     of the 1601-EQ from the filed returns; the six-row limit; the totals; the due dates;
 *     the export and print refusals; the lifecycle; and a golden proof that the 2551Q and
 *     2550Q feeder responses did not change.
 *
 * Calendar dates: a record's txnDate is a calendar date, so "the first and last second of
 * the month (Manila)" is the first and last day. 31 July, 1 August, 31 August, 1 September.
 */
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { truncateOncePerFile } from "./helpers/truncate";
import { loadAtcReference } from "./helpers/atc-reference";
import { AppModule } from "../../src/app.module";
import { TokenService } from "../../src/auth/token.service";
import { PrismaService } from "../../src/prisma/prisma.service";
import { StorageService } from "../../src/storage/storage.service";
import { FakeStorage, markFiledAny } from "../helpers/file-return";

truncateOncePerFile({ firmRoles: ["Super Admin", "Manager"] });

const TAG = `track-a-withholding-${randomUUID().slice(0, 8)}`;
const API = "/api/v1";
const GOLDEN = join(__dirname, "golden", "u17-business-tax-book-figures.json");

// --- the sentences a person reads (word for word) -----------------------------------
const THIRD_MONTH =
  "The third month of a quarter is reported on the 1601-EQ, not on a 0619-E.";
const PRINTED_NO_XML = "This form is printed; eBIRForms XML is not available for it.";
const SIX_ROWS = (n: number) => `${n} ATCs; the form has six rows.`;
const TYPED_1601C = "1601-C figures are typed; the Portal has no payroll records yet.";
const NO_ATC_2 =
  "2 purchases (₱520.00) have an amount withheld but no ATC and were left out.";
const NOT_EWT_3 =
  "3 purchases (₱205.50) have an amount withheld under an ATC that is not an expanded-withholding code (WI161, WV010, ZZ999) and were left out.";

describe("U17 · the expanded-withholding returns (real app over HTTP, db)", () => {
  let app: INestApplication;
  let writer: PrismaService;
  let tokens: TokenService;
  let firmId = "";
  let saToken = "";
  const ids: Record<string, string> = {};

  const http = () => request(app.getHttpServer());
  const auth = (r: request.Test, t = saToken) => r.set("Authorization", `Bearer ${t}`);
  const figures = (clientId: string, form: string, period: string, t = saToken) =>
    auth(
      http().get(`${API}/bir-forms/book-figures`).query({ clientId, form, period }),
      t,
    );

  async function client(
    key: string,
    taxType: "VAT" | "PERCENTAGE" | null,
    extra: Record<string, unknown> = {},
  ) {
    const c = await writer.client.create({
      data: {
        firmId,
        businessName: `${TAG} ${key} TRADING CORP`,
        regName: `${TAG} ${key} TRADING CORP`, // the BIR registered name the withholding agent files under
        kind: "non-individual",
        tin: `000444${String(Object.keys(ids).length + 101).padStart(3, "0")}`,
        branch: "00000",
        rdo: "038",
        address: "1 Invented St",
        city: "Lungsod ng Halimbawa",
        zip: "0000",
        taxType,
        ...extra,
      },
    });
    ids[key] = c.id;
    const cat = (type: "INCOME" | "EXPENSE") =>
      writer.category.create({
        data: { clientId: c.id, type, name: `${TAG} ${type} ${key}` },
      });
    cats[key] = { income: (await cat("INCOME")).id, expense: (await cat("EXPENSE")).id };
    return c.id;
  }
  const cats: Record<string, { income: string; expense: string }> = {};

  const buy = (
    key: string,
    date: string,
    net: string,
    wht: string | null,
    atc: string | null,
    o: { status?: "posted" | "held"; vatClaimable?: boolean; taxAmount?: string } = {},
  ) =>
    writer.purchaseTransaction.create({
      data: {
        clientId: ids[key]!,
        categoryId: cats[key]!.expense,
        txnDate: new Date(`${date}T00:00:00.000Z`),
        description: `${TAG} purchase`,
        vendor: `${TAG} Invented Supplier`,
        netAmount: net,
        whtAmount: wht,
        atc,
        status: o.status ?? "posted",
        ...(o.vatClaimable !== undefined ? { vatClaimable: o.vatClaimable } : {}),
        ...(o.taxAmount ? { taxAmount: o.taxAmount } : {}),
      },
    });
  const sale = (
    key: string,
    date: string,
    net: string,
    o: { vatClass?: string; atc?: string | null; gov?: boolean; withheld?: string } = {},
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
    net: string,
    o: { category?: string | null; inputVAT?: string; status?: "posted" | "held" } = {},
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
      },
    });

  /** Create a draft; returns the API's body. */
  async function draft(
    key: string,
    form: string,
    period: string,
    data: Record<string, unknown>,
  ) {
    const res = await auth(http().post(`${API}/bir-forms`)).send({
      clientId: ids[key],
      form,
      period,
      data,
    });
    expect([form, period, res.status]).toEqual([form, period, 201]);
    return res.body as { id: string; data: Record<string, unknown> };
  }
  async function file(id: string) {
    const res = await markFiledAny(app, saToken, id);
    expect([id, res.status]).toEqual([id, 200]);
    return res.body;
  }
  const compute = (form: string, data: Record<string, unknown>) =>
    auth(http().post(`${API}/bir-forms/compute`)).send({ form, data });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(StorageService)
      .useValue(new FakeStorage())
      .compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix("api/v1");
    await app.init();
    writer = app.get(PrismaService);
    tokens = app.get(TokenService);
    expect(await loadAtcReference(writer)).toBe(228);
    // An expanded-withholding code the table gives no rate (the seed has none).
    await writer.birAtcCode.create({
      data: {
        atc: "WI998",
        classification: "ewt",
        taxTypeCode: "WE",
        payeeType: "individual",
        description: "Invented code with no rate",
        rate: null,
        status: "active",
        forms: ["0619-E", "1601-EQ"],
      },
    });
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
    saToken = tokens.signAccess({ id: sa.id, firmId, userType: "FIRM", email: sa.email });

    // --- WHT: the withholding agent. 2026-Q3 = July, August, September ---------------
    await client("WHT", "VAT");
    // July (month 1)
    await buy("WHT", "2026-07-10", "5000.00", "100.00", "WI160"); // 2% of 5,000
    await buy("WHT", "2026-07-12", "3000.00", "60.00", "WI998"); // a code with no rate
    await buy("WHT", "2026-07-20", "10000.00", "250.00", "WC160"); // 2% would be 200.00
    await buy("WHT", "2026-07-31", "100000.00", "2000.00", "WI160"); // last day of July
    await buy("WHT", "2026-07-31", "1.00", "0.00", "WI160"); // an ATC, nothing withheld
    await buy("WHT", "2026-06-30", "99999.00", "9999.99", "WI160"); // the month before
    // August (month 2)
    await buy("WHT", "2026-08-01", "10000.00", "200.00", "WI160"); // first day of August
    await buy("WHT", "2026-08-15", "61728.00", "1234.56", "WC160"); // 2% of 61,728
    await buy("WHT", "2026-08-15", "0.50", "0.01", "WI160"); // 2% of 0.50
    await buy("WHT", "2026-08-31", "20000.00", "1000.00", "WI010"); // last day; 5%
    await buy("WHT", "2026-08-05", "4000.00", "500.00", null); // withheld, no ATC
    await buy("WHT", "2026-08-06", "800.00", "20.00", ""); // blank ATC is no ATC
    await buy("WHT", "2026-08-07", "6000.00", "120.00", "WV010"); // a VAT-withholding code
    await buy("WHT", "2026-08-08", "5000.00", "75.50", "WI161"); // final withholding
    await buy("WHT", "2026-08-09", "500.00", "10.00", "ZZ999"); // not in the table
    await buy("WHT", "2026-08-10", "777.00", "0.00", "WI160"); // nothing withheld
    await buy("WHT", "2026-08-11", "888.00", null, "WI160"); // no amount at all
    await buy("WHT", "2026-08-12", "50000.00", "1000.00", "WI160", { status: "held" });
    // September (month 3)
    await buy("WHT", "2026-09-01", "30000.00", "600.00", "WI160"); // first day of September
    await buy("WHT", "2026-09-15", "100000.00", "5000.00", "WC100"); // 5%
    await buy("WHT", "2026-09-30", "7500.00", "150.00", "WI160"); // last day of the quarter
    await buy("WHT", "2026-10-01", "123456.00", "2469.12", "WI160"); // the quarter after

    // Clients for the rest
    await client("NONE", "VAT"); // withholds nothing
    await client("WHT2", "VAT"); // its Q2 return chose a refund
    await client("WHT6", "VAT"); // exactly six ATCs
    await client("WHT7", "VAT"); // seven ATCs
    await client("NONVAT", "PERCENTAGE"); // netAmount carries the VAT (D23)
    const six: Array<[string, string, string, string]> = [
      ["WI010", "2000.00", "100.00", "5"],
      ["WI100", "2000.00", "100.00", "5"],
      ["WI120", "5000.00", "100.00", "2"],
      ["WI160", "5000.00", "100.00", "2"],
      ["WC100", "2000.00", "100.00", "5"],
      ["WC120", "5000.00", "100.00", "2"],
    ];
    for (const [atc, net, wht] of six) {
      await buy("WHT6", "2026-08-14", net, wht, atc);
      await buy("WHT7", "2026-08-14", net, wht, atc);
    }
    await buy("WHT7", "2026-08-14", "5000.00", "100.00", "WC160"); // the seventh
    // A client that is not VAT-registered books the gross: the VAT is inside netAmount.
    await buy("NONVAT", "2026-08-03", "11200.00", "224.00", "WI160", {
      vatClaimable: false,
      taxAmount: "1200.00", // 11,200.00 = 10,000.00 + 1,200.00 VAT
    });
    await buy("NONVAT", "2026-08-04", "5600.00", "112.00", "WC160", {
      vatClaimable: false,
      taxAmount: "600.00",
    });
    await buy("NONVAT", "2026-08-05", "3000.00", "60.00", "WI160", {
      vatClaimable: false,
    }); // no VAT on this receipt
    await buy("NONVAT", "2026-08-06", "2000.00", "40.00", "WC160");
  });

  afterAll(async () => {
    await app.close();
  });

  // =====================================================================================
  describe("T1 · the 0619-E: the month's remittance", () => {
    it("August is the exact sum of what was withheld, to the centavo; the other records are left out and said", async () => {
      const res = await figures(ids.WHT!, "0619E", "2026-08");
      expect(res.status).toBe(200);
      expect(res.body.form).toBe("0619E");
      expect(res.body.period).toBe("2026-08");
      expect(new Date(res.body.asOf).toISOString()).toBe(res.body.asOf);
      // 200.00 (WI160, 1 Aug) + 1,234.56 (WC160) + 0.01 (WI160) + 1,000.00 (WI010, 31 Aug)
      // = 2,434.57 exactly. In floating point 200 + 1234.56 + 0.01 + 1000 is
      // 2434.5699999999997: the decimal sum is what this proves.
      expect(res.body.figures).toEqual({ anyWithheld: "yes", remittance: "2434.57" });
      expect(res.body.recordCount).toBe(4);
      expect(res.body.lines).toEqual([
        {
          key: "atc.WC160",
          label: "ATC WC160",
          amount: 1234.56,
          records: 1,
          filter: {
            kind: "purchases",
            from: "2026-08-01",
            to: "2026-08-31",
            atc: "WC160",
          },
        },
        {
          key: "atc.WI010",
          label: "ATC WI010",
          amount: 1000,
          records: 1,
          filter: {
            kind: "purchases",
            from: "2026-08-01",
            to: "2026-08-31",
            atc: "WI010",
          },
        },
        {
          key: "atc.WI160",
          label: "ATC WI160",
          amount: 200.01,
          records: 2,
          filter: {
            kind: "purchases",
            from: "2026-08-01",
            to: "2026-08-31",
            atc: "WI160",
          },
        },
        {
          key: "remittance",
          label: "Amount of remittance — Item 14",
          amount: 2434.57,
          records: 4,
          filter: { kind: "purchases", from: "2026-08-01", to: "2026-08-31" },
        },
      ]);
      // Not counted, and said: withheld with no ATC (500.00 + 20.00, the blank one included),
      // and withheld under a code that is not expanded withholding (WV010 120.00,
      // WI161 75.50 - a final-withholding code that begins WI - and ZZ999 10.00).
      // Nothing is said of an ATC with nothing withheld (0.00 or none), nor of the held one.
      expect(res.body.warnings).toEqual([NO_ATC_2, NOT_EWT_3]);
    });

    it("the boundaries are calendar dates: 31 July and 1 September are not August, 1 and 31 August are", async () => {
      const july = await figures(ids.WHT!, "0619E", "2026-07");
      // 100.00 + 60.00 + 250.00 + 2,000.00 (31 July) = 2,410.00; 30 June and the 1.00 with
      // nothing withheld are out.
      expect(july.body.figures).toEqual({ anyWithheld: "yes", remittance: "2410.00" });
      expect(july.body.recordCount).toBe(4);
      expect(july.body.warnings).toEqual([]);
      const aug = await figures(ids.WHT!, "0619E", "2026-08");
      expect(aug.body.lines.at(-1).amount).toBe(2434.57); // 1 Aug and 31 Aug are in
    });

    it("a month with nothing withheld says so: no, and 0.00", async () => {
      const res = await figures(ids.NONE!, "0619E", "2026-08");
      expect(res.status).toBe(200);
      expect(res.body.figures).toEqual({ anyWithheld: "no", remittance: "0.00" });
      expect(res.body.recordCount).toBe(0);
      expect(res.body.warnings).toEqual([]);
      expect(res.body.lines).toEqual([
        {
          key: "remittance",
          label: "Amount of remittance — Item 14",
          amount: 0,
          records: 0,
          filter: { kind: "purchases", from: "2026-08-01", to: "2026-08-31" },
        },
      ]);
    });

    it.each(["2026-03", "2026-06", "2026-09", "2026-12"])(
      "%s, the third month of a quarter, is refused: it is reported on the 1601-EQ",
      async (month) => {
        const res = await figures(ids.WHT!, "0619E", month);
        expect([res.status, res.body.message]).toEqual([400, THIRD_MONTH]);
        const created = await auth(http().post(`${API}/bir-forms`)).send({
          clientId: ids.WHT,
          form: "0619E",
          period: month,
          data: {},
        });
        expect([created.status, created.body.message]).toEqual([400, THIRD_MONTH]);
      },
    );

    it("a period that is not a month is a bad period for the 0619E; the 1601-EQ takes a quarter only", async () => {
      for (const period of [
        "2026-Q3",
        "2026",
        "2026-13",
        "2026-00",
        "2026-8",
        "",
        "1999-08",
      ]) {
        const res = await figures(ids.WHT!, "0619E", period);
        expect([period, res.status, res.body.message]).toEqual([
          period,
          400,
          "That isn't a valid period for the 0619E.",
        ]);
      }
      for (const period of ["2026-08", "2026-Q5", "2026", "", "2101-Q1"]) {
        const res = await figures(ids.WHT!, "1601EQ", period);
        expect([period, res.status, res.body.message]).toEqual([
          period,
          400,
          "That isn't a valid period for the 1601EQ.",
        ]);
      }
    });
  });

  // =====================================================================================
  describe("T1 · the 1601-EQ: the quarter's rows", () => {
    it("rows by ATC with the exact base and withheld, the rate from the table, and a warning for each record that does not add up", async () => {
      // The July and August 0619-Es are filed in the next test; here none is, so items 20
      // and 21 are empty and said. Rows first.
      const res = await figures(ids.WHT!, "1601EQ", "2026-Q3");
      expect(res.status).toBe(200);
      expect(res.body.figures.rows).toEqual([
        // WC100: 100,000.00 withheld 5,000.00 at 5%
        { atc: "WC100", base: "100000.00", rate: "5", withheld: "5000.00" },
        // WC160: 10,000.00 + 61,728.00 = 71,728.00; 250.00 + 1,234.56 = 1,484.56 at 2%
        { atc: "WC160", base: "71728.00", rate: "2", withheld: "1484.56" },
        // WI010: 20,000.00 withheld 1,000.00 at 5%
        { atc: "WI010", base: "20000.00", rate: "5", withheld: "1000.00" },
        // WI160: base 5,000.00 + 100,000.00 + 10,000.00 + 0.50 + 30,000.00 + 7,500.00
        //   = 152,500.50; withheld 100.00 + 2,000.00 + 200.00 + 0.01 + 600.00 + 150.00
        //   = 3,050.01. (The 1.00, 777.00 and 888.00 with nothing withheld add to nothing.)
        { atc: "WI160", base: "152500.50", rate: "2", withheld: "3050.01" },
        // WI998: the table gives no rate, so the field is empty
        { atc: "WI998", base: "3000.00", rate: "", withheld: "60.00" },
      ]);
      expect(res.body.figures.anyWithheld).toBe("yes");
      expect(res.body.recordCount).toBe(11);
      expect(res.body.warnings.slice(0, 4)).toEqual([
        NO_ATC_2,
        NOT_EWT_3,
        // WC160: the 250.00 recorded on 10,000.00 is not 2%.
        "1 purchase under WC160 has an amount withheld that differs from the tax base times the rate (2%) by more than one centavo.",
        "The rate of WI998 is not in the table; enter it by hand.",
      ]);
      // The recorded amount is what is reported, never base times rate:
      // WC160 shows 1,484.56, not 2% of 71,728.00 = 1,434.56.
      expect(res.body.lines.map((l: { key: string }) => l.key)).toEqual([
        "rows.WC100",
        "rows.WC160",
        "rows.WI010",
        "rows.WI160",
        "rows.WI998",
      ]);
    });

    it("items 20 and 21 are the NET amount of the filed 0619-Es (item 16), not the total with penalties; a month with none warns", async () => {
      // July: 2,410.00, with penalties of 10.50 (total 2,420.50): item 16 is 2,410.00.
      const july = await draft("WHT", "0619E", "2026-07", {
        year: "2026",
        month: "07",
        amended: "no",
        anyWithheld: "yes",
        remittance: "2410.00",
        surcharge: "10.00",
        interest: "0.50",
      });
      let res = await figures(ids.WHT!, "1601EQ", "2026-Q3");
      // A draft is not a filed return.
      expect(res.body.figures.remittance1).toBe("");
      expect(res.body.warnings).toEqual(
        expect.arrayContaining([
          "No filed 0619-E for July 2026.",
          "No filed 0619-E for August 2026.",
        ]),
      );
      await file(july.id);
      res = await figures(ids.WHT!, "1601EQ", "2026-Q3");
      expect(res.body.figures.remittance1).toBe("2410.00");
      expect(res.body.figures.remittance2).toBe("");
      expect(res.body.warnings).toContain("No filed 0619-E for August 2026.");
      expect(res.body.warnings).not.toContain("No filed 0619-E for July 2026.");

      // August: an amended return. 2,434.57 less 34.57 already remitted is 2,400.00; with
      // a surcharge of 50.00 the total is 2,450.00. Item 21 is the 2,400.00.
      const aug = await draft("WHT", "0619E", "2026-08", {
        year: "2026",
        month: "08",
        amended: "yes",
        anyWithheld: "yes",
        remittance: "2434.57",
        previouslyRemitted: "34.57",
        surcharge: "50.00",
      });
      await file(aug.id);
      res = await figures(ids.WHT!, "1601EQ", "2026-Q3");
      expect(res.body.figures.remittance1).toBe("2410.00");
      expect(res.body.figures.remittance2).toBe("2400.00");
      expect(res.body.warnings.filter((w: string) => w.startsWith("No filed"))).toEqual(
        [],
      );
    });

    it("an amendment that is filed replaces the return it amends in item 20", async () => {
      const filed = await auth(
        http().get(`${API}/bir-forms`).query({ clientId: ids.WHT, status: "filed" }),
      );
      const july = filed.body.find(
        (f: { form: string; period: string }) =>
          f.form === "0619E" && f.period === "2026-07",
      );
      const amend = await auth(http().post(`${API}/bir-forms/${july.id}/amend`));
      expect([amend.status, amend.body.sequence]).toEqual([201, 2]);
      // The amendment corrects the remittance to 2,500.00 and files it.
      const changed = await auth(http().patch(`${API}/bir-forms/${amend.body.id}`)).send({
        data: {
          year: "2026",
          month: "07",
          amended: "yes",
          anyWithheld: "yes",
          remittance: "2500.00",
          previouslyRemitted: "0.00",
        },
      });
      expect(changed.status).toBe(200);
      await file(amend.body.id);
      const res = await figures(ids.WHT!, "1601EQ", "2026-Q3");
      expect(res.body.figures.remittance1).toBe("2500.00");
    });

    it("item 23 is carried over only from the previous quarter's filed 1601-EQ, and only if its carried-over box was marked", async () => {
      const rows = [{ atc: "WI160", base: "1000.00", rate: "2", withheld: "20.00" }];
      const q2 = (choice: string) => ({
        year: "2026",
        quarter: "2nd",
        amended: "no",
        anyWithheld: "yes",
        rows,
        remittance1: "30.00", // 20.00 due less 30.00 remitted: 10.00 over
        overRemittanceChoice: choice,
      });
      // WHT: Q2 over-remitted 10.00 and marked "carried"
      await file((await draft("WHT", "1601EQ", "2026-Q2", q2("carried"))).id);
      // WHT2: the same, but the choice was a refund
      await file((await draft("WHT2", "1601EQ", "2026-Q2", q2("refunded"))).id);
      const carried = await figures(ids.WHT!, "1601EQ", "2026-Q3");
      expect(carried.body.figures.overRemittancePrior).toBe("10.00");
      const refunded = await figures(ids.WHT2!, "1601EQ", "2026-Q3");
      expect(refunded.body.figures.overRemittancePrior).toBe("");
      // The first quarter has no previous quarter in its taxable year.
      const q1 = await figures(ids.WHT!, "1601EQ", "2026-Q1");
      expect(q1.body.figures.overRemittancePrior).toBe("");
      // A draft of the previous quarter is not a filed return.
      await draft("NONE", "1601EQ", "2026-Q2", q2("carried"));
      expect(
        (await figures(ids.NONE!, "1601EQ", "2026-Q3")).body.figures.overRemittancePrior,
      ).toBe("");
    });

    it("the totals of the saved quarter are exact: items 19, 25, 26, 30 and 31 to the centavo", async () => {
      const res = await figures(ids.WHT!, "1601EQ", "2026-Q3");
      const data = {
        year: "2026",
        quarter: "3rd",
        amended: "no",
        ...res.body.figures,
        otherPayments: "5.25",
        surcharge: "100.00",
        interest: "20.25",
        compromise: "1000.00",
      };
      const created = await draft("WHT", "1601EQ", "2026-Q3", data);
      const read = await auth(http().get(`${API}/bir-forms/${created.id}`));
      const c = read.body.computed;
      // Item 19: 5,000.00 + 1,484.56 + 1,000.00 + 3,050.01 + 60.00 = 10,594.57
      expect(c.i19).toBe(10594.57);
      expect([c.i20, c.i21, c.i22, c.i23, c.i24]).toEqual([2500, 2400, 0, 10, 5.25]);
      // Item 25: 2,500.00 + 2,400.00 + 0 + 10.00 + 5.25 = 4,915.25
      expect(c.i25).toBe(4915.25);
      // Item 26: 10,594.57 - 4,915.25 = 5,679.32
      expect(c.i26).toBe(5679.32);
      // Item 30: 100.00 + 20.25 + 1,000.00 = 1,120.25; item 31: 5,679.32 + 1,120.25 = 6,799.57
      expect([c.i27, c.i28, c.i29, c.i30]).toEqual([100, 20.25, 1000, 1120.25]);
      expect(c.i31).toBe(6799.57);
      expect(c.overRemittance).toBe(false);
      expect(c.overRemittanceChoice).toBe("");
    });

    it("sums that floating point gets wrong are exact here, in both returns", async () => {
      // 0.1 + 0.2 is 0.30000000000000004 in floating point.
      const r1 = await compute("1601EQ", {
        quarter: "1st",
        rows: [
          { atc: "WI010", base: "2.00", rate: "5", withheld: "0.10" },
          { atc: "WI100", base: "4.00", rate: "5", withheld: "0.20" },
        ],
        surcharge: "0.10",
        interest: "0.20",
        compromise: "0.30",
      });
      expect(r1.status).toBe(201);
      expect(r1.body.i19).toBe(0.3);
      expect(r1.body.i30).toBe(0.6);
      expect(r1.body.i31).toBe(0.9);
      const r2 = await compute("0619E", {
        year: "2026",
        month: "08",
        remittance: "1234.56",
        previouslyRemitted: "0.01",
        surcharge: "0.10",
        interest: "0.20",
        compromise: "0.30",
      });
      expect(r2.status).toBe(201);
      expect([r2.body.i14, r2.body.i15, r2.body.i16]).toEqual([1234.56, 0.01, 1234.55]);
      expect([r2.body.i17a, r2.body.i17b, r2.body.i17c, r2.body.i17d]).toEqual([
        0.1, 0.2, 0.3, 0.6,
      ]);
      expect(r2.body.i18).toBe(1235.15);
    });

    it("over-remittance is flagged only when item 31 is negative, and its boxes are exclusive and only valid then", async () => {
      const base = {
        quarter: "2nd",
        rows: [{ atc: "WI160", base: "1000.00", rate: "2", withheld: "20.00" }],
      };
      // 20.00 due, 30.00 remitted: -10.00
      const over = await compute("1601EQ", {
        ...base,
        remittance1: "30.00",
        overRemittanceChoice: "tcc",
      });
      expect([over.body.i26, over.body.i31]).toEqual([-10, -10]);
      expect(over.body.overRemittance).toBe(true);
      expect(over.body.overRemittanceAmount).toBe(10);
      expect(over.body.overRemittanceChoice).toBe("tcc");
      for (const choice of ["refunded", "tcc", "carried"]) {
        const r = await compute("1601EQ", {
          ...base,
          remittance1: "30.00",
          overRemittanceChoice: choice,
        });
        expect(r.body.overRemittanceChoice).toBe(choice);
      }
      // A choice that is none of the three is no choice.
      expect(
        (
          await compute("1601EQ", {
            ...base,
            remittance1: "30.00",
            overRemittanceChoice: "both",
          })
        ).body.overRemittanceChoice,
      ).toBe("");
      // Exactly nothing due: no over-remittance; a choice is ignored.
      const even = await compute("1601EQ", {
        ...base,
        remittance1: "20.00",
        overRemittanceChoice: "refunded",
      });
      expect([
        even.body.i31,
        even.body.overRemittance,
        even.body.overRemittanceChoice,
      ]).toEqual([0, false, ""]);
      // Tax due: no over-remittance.
      const due = await compute("1601EQ", { ...base, overRemittanceChoice: "refunded" });
      expect([
        due.body.i31,
        due.body.overRemittance,
        due.body.overRemittanceChoice,
      ]).toEqual([20, false, ""]);
      // Penalties can take an over-remittance back to nothing: 20.00 - 30.00 + 10.00 = 0.
      const penalised = await compute("1601EQ", {
        ...base,
        remittance1: "30.00",
        surcharge: "10.00",
        overRemittanceChoice: "refunded",
      });
      expect([penalised.body.i31, penalised.body.overRemittance]).toEqual([0, false]);
      // The blank: "carried" is not applicable for the succeeding year, so not in the 4th quarter.
      const q4 = await compute("1601EQ", {
        ...base,
        quarter: "4th",
        remittance1: "30.00",
        overRemittanceChoice: "carried",
      });
      expect(q4.body.overRemittance).toBe(true);
      expect(q4.body.overRemittanceChoice).toBe("");
      const q4refund = await compute("1601EQ", {
        ...base,
        quarter: "4th",
        remittance1: "30.00",
        overRemittanceChoice: "refunded",
      });
      expect(q4refund.body.overRemittanceChoice).toBe("refunded");
    });
  });

  // =====================================================================================
  describe("T1 · the 1601-C: typed figures, every month", () => {
    it("the Portal has no payroll records: the books feed refuses, in a sentence", async () => {
      for (const period of ["2026-08", "2026-12", "2026-Q3"]) {
        const res = await figures(ids.WHT!, "1601C", period);
        expect([period, res.status, res.body.message]).toEqual([
          period,
          400,
          TYPED_1601C,
        ]);
      }
    });

    it("every month is a period: March, June, September and December too; anything else is a bad period", async () => {
      for (const month of [
        "01",
        "02",
        "03",
        "04",
        "05",
        "06",
        "07",
        "08",
        "09",
        "10",
        "11",
        "12",
      ]) {
        const d = await draft("NONE", "1601C", `2026-${month}`, { year: "2026", month });
        expect(d.id).toBeTruthy();
      }
      for (const period of [
        "2026-Q3",
        "2026-13",
        "2026-00",
        "2026-8",
        "2026",
        "",
        "1999-05",
      ]) {
        const res = await auth(http().post(`${API}/bir-forms`)).send({
          clientId: ids.NONE,
          form: "1601C",
          period,
          data: {},
        });
        expect([period, res.status, res.body.message]).toEqual([
          period,
          400,
          "That isn't a valid period for the 1601C.",
        ]);
      }
    });

    it("the totals are exact to the centavo, with a negative schedule adjustment; item 26 is the schedule's total", async () => {
      const data = {
        year: "2026",
        month: "08",
        compensation: "250000.00", // 14
        mwe: "10000.00", // 15
        holiday: "0.01", // 16
        thirteenth: "20000.00", // 17
        deMinimis: "5000.00", // 18
        contributions: "3000.00", // 19
        otherNonTaxable: "0.10", // 20
        notSubjectToWithholding: "50000.00", // 23
        taxesWithheld: "12345.67", // 25
        previouslyRemitted: "0.01", // 28
        otherRemittances: "100.00", // 29
        surcharge: "10.00",
        interest: "0.25",
        compromise: "500.00",
        scheduleRows: [
          {
            month: "2026-05",
            datePaid: "2026-06-10",
            bank: "XYZ",
            number: "123",
            taxPaid: "1000.00",
            shouldBe: "1250.50",
          },
          {
            month: "2026-06",
            datePaid: "2026-07-10",
            bank: "XYZ",
            number: "124",
            taxPaid: "2000.00",
            shouldBe: "1500.25",
          },
          { month: "", datePaid: "", bank: "", number: "", taxPaid: "", shouldBe: "" },
        ],
      };
      const res = await compute("1601C", data);
      expect(res.status).toBe(201);
      const c = res.body;
      // 21: 10,000.00 + 0.01 + 20,000.00 + 5,000.00 + 3,000.00 + 0.10 = 38,000.11
      expect(c.i21).toBe(38000.11);
      // 22: 250,000.00 - 38,000.11 = 211,999.89;  24: 211,999.89 - 50,000.00 = 161,999.89
      expect([c.i22, c.i24]).toEqual([211999.89, 161999.89]);
      // Schedule I: 1,250.50 - 1,000.00 = 250.50;  1,500.25 - 2,000.00 = -499.75;  0
      expect(c.adjustments).toEqual([250.5, -499.75, 0]);
      expect(c.scheduleTotal).toBe(-249.25);
      expect(c.i26).toBe(c.scheduleTotal);
      // 27: 12,345.67 - 249.25 = 12,096.42;  30: 0.01 + 100.00 = 100.01;  31: 11,996.41
      expect([c.i25, c.i27, c.i30, c.i31]).toEqual([
        12345.67, 12096.42, 100.01, 11996.41,
      ]);
      // 35: 10.00 + 0.25 + 500.00 = 510.25;  36: 11,996.41 + 510.25 = 12,506.66
      expect([c.i35, c.i36]).toEqual([510.25, 12506.66]);
    });

    it("sums floating point gets wrong are exact; commas are read; an empty form is all zeros; an over-remittance is negative", async () => {
      // 0.1 + 0.2 is 0.30000000000000004 in floating point
      const traps = await compute("1601C", {
        compensation: "1,000.30",
        mwe: "0.1",
        holiday: "0.2",
        surcharge: "0.10",
        interest: "0.20",
        compromise: "0.30",
      });
      expect(traps.body.i21).toBe(0.3);
      expect(traps.body.i22).toBe(1000);
      expect(traps.body.i35).toBe(0.6);
      const empty = await compute("1601C", {});
      for (const k of [
        "i14",
        "i21",
        "i22",
        "i24",
        "i26",
        "i27",
        "i30",
        "i31",
        "i35",
        "i36",
        "scheduleTotal",
      ]) {
        expect([k, empty.body[k]]).toEqual([k, 0]);
      }
      expect(empty.body.adjustments).toEqual([0, 0, 0]);
      // 100.00 withheld, 300.00 remitted: 200.00 over. There is no refund or credit box.
      const over = await compute("1601C", {
        taxesWithheld: "100.00",
        otherRemittances: "300.00",
      });
      expect([over.body.i31, over.body.i36]).toEqual([-200, -200]);
      expect(over.body).not.toHaveProperty("overRemittanceChoice");
      // A penalty on an over-remittance is added to it: -200.00 + 50.00
      const pen = await compute("1601C", {
        taxesWithheld: "100.00",
        otherRemittances: "300.00",
        surcharge: "50.00",
      });
      expect(pen.body.i36).toBe(-150);
      // An adjustment can make item 27 negative too: 100.00 withheld, 400.00 less adjusted.
      const adj = await compute("1601C", {
        taxesWithheld: "100.00",
        scheduleRows: [
          { month: "2026-05", taxPaid: "500.00", shouldBe: "100.00" },
          {},
          {},
        ],
      });
      expect([adj.body.i26, adj.body.i27, adj.body.i31]).toEqual([-400, -300, -300]);
    });
  });

  // =====================================================================================
  describe("T1 · seven ATCs: all returned, and the return cannot be filed, previewed or copied", () => {
    it("seven ATCs are all returned with the warning; six are fine", async () => {
      const seven = await figures(ids.WHT7!, "1601EQ", "2026-Q3");
      expect(seven.body.figures.rows.map((r: { atc: string }) => r.atc)).toEqual([
        "WC100",
        "WC120",
        "WC160",
        "WI010",
        "WI100",
        "WI120",
        "WI160",
      ]);
      expect(seven.body.warnings).toEqual(expect.arrayContaining([SIX_ROWS(7)]));
      const six = await figures(ids.WHT6!, "1601EQ", "2026-Q3");
      expect(six.body.figures.rows).toHaveLength(6);
      expect(
        six.body.warnings.some((w: string) => w.includes("the form has six rows")),
      ).toBe(false);
    });

    it("Mark as filed, Preview PDF and the clear copy are refused with the sentence for seven rows; six rows file", async () => {
      const sevenRows = (await figures(ids.WHT7!, "1601EQ", "2026-Q3")).body.figures
        .rows as unknown[];
      const d7 = await draft("WHT7", "1601EQ", "2026-Q3", {
        year: "2026",
        quarter: "3rd",
        rows: sevenRows,
      });
      // U18: a 1601-EQ is marked filed with the BIR's confirmation; the six-row refusal comes first.
      const filing = await markFiledAny(app, saToken, d7.id);
      expect([filing.status, filing.body.message]).toEqual([409, SIX_ROWS(7)]);
      const preview = await auth(http().post(`${API}/bir-forms/${d7.id}/preview-pdf`));
      expect([preview.status, preview.body.message]).toEqual([409, SIX_ROWS(7)]);
      const copy = await auth(http().post(`${API}/bir-forms/${d7.id}/clear-copy`));
      expect([copy.status, copy.body.message]).toEqual([409, SIX_ROWS(7)]);
      // Still a draft, still seven rows: nothing was dropped or merged.
      const still = await auth(http().get(`${API}/bir-forms/${d7.id}`));
      expect(still.body.status).toBe("draft");
      expect(still.body.data.rows).toHaveLength(7);
      // Saving a draft of seven rows is allowed.
      const saved = await auth(http().patch(`${API}/bir-forms/${d7.id}`)).send({
        data: { year: "2026", quarter: "3rd", rows: sevenRows, sheetsAttached: "1" },
      });
      expect(saved.status).toBe(200);

      const sixRows = (await figures(ids.WHT6!, "1601EQ", "2026-Q3")).body.figures.rows;
      const d6 = await draft("WHT6", "1601EQ", "2026-Q3", {
        year: "2026",
        quarter: "3rd",
        rows: sixRows,
      });
      await file(d6.id); // six rows are filed
    });
  });

  // =====================================================================================
  describe("T1 · printed, not exported; the print routes answer (C9)", () => {
    it.each([
      ["0619E", "2026-08", { year: "2026", month: "08", remittance: "100.00" }],
      ["1601EQ", "2026-Q3", { year: "2026", quarter: "3rd", rows: [] }],
      ["1601C", "2026-08", { year: "2026", month: "08", compensation: "100.00" }],
    ] as const)(
      "the %s: export 409 with the sentence, draft and filed; Preview PDF and Download clear copy are offered (C9 gave each form its print)",
      async (form, period, data) => {
        const d = await draft("NONE", form, period, { ...data });
        const exp = await auth(http().post(`${API}/bir-forms/${d.id}/export`));
        expect([exp.status, exp.body.message]).toEqual([409, PRINTED_NO_XML]);
        // C9: a draft's preview is the BIR's blank with the figures on it (before C9 this
        // answered "A preview of the <form> is not available yet.").
        const preview = await auth(http().post(`${API}/bir-forms/${d.id}/preview-pdf`));
        expect([preview.status, preview.headers["content-type"]]).toEqual([
          200,
          expect.stringMatching(/^application\/pdf/),
        ]);
        const detail = await auth(http().get(`${API}/bir-forms/${d.id}`));
        expect([detail.body.previewAvailable, detail.body.clearCopyAvailable]).toEqual([
          true,
          false,
        ]);
        await file(d.id);
        const expFiled = await auth(http().post(`${API}/bir-forms/${d.id}/export`));
        expect([expFiled.status, expFiled.body.message]).toEqual([409, PRINTED_NO_XML]);
        const filed = await auth(http().get(`${API}/bir-forms/${d.id}`));
        expect([filed.body.previewAvailable, filed.body.clearCopyAvailable]).toEqual([
          false,
          true,
        ]);
      },
    );

    it("the form catalogue lists both as printed returns, and the list rows say no print copy yet", async () => {
      const cat = await auth(http().get(`${API}/bir-forms/catalog`));
      const codes = cat.body.map((f: { code: string }) => f.code);
      expect(codes).toEqual(expect.arrayContaining(["0619E", "1601EQ", "1601C"]));
      const get = (code: string) =>
        cat.body.find((f: { code: string }) => f.code === code);
      expect(get("0619E")).toMatchObject({
        frequency: "Monthly",
        category: "Withholding",
        xmlExport: false,
        status: "available",
      });
      expect(get("1601EQ")).toMatchObject({
        frequency: "Quarterly",
        category: "Withholding",
        xmlExport: false,
        status: "available",
      });
      expect(get("1601C")).toMatchObject({
        frequency: "Monthly",
        category: "Withholding",
        xmlExport: false,
        status: "available",
      });
    });
  });

  // =====================================================================================
  describe("T1 · lifecycle", () => {
    it("a draft is filed with the taxpayer's snapshot, sealed, amended into a copy, and a draft can be deleted", async () => {
      const data = {
        year: "2026",
        month: "08",
        amended: "no",
        anyWithheld: "yes",
        remittance: "2434.57",
        category: "private",
        email: "invented@example.test",
      };
      const d = await draft("WHT2", "0619E", "2026-08", data);
      expect(d.data).toEqual(data);
      const read = await auth(http().get(`${API}/bir-forms/${d.id}`));
      expect(read.body.computed.i16).toBe(2434.57);
      expect(read.body.canDelete).toBe(true);

      const filed = await file(d.id);
      // The taxpayer block it was filed with.
      expect(filed.filedSnapshot).toMatchObject({
        tin: expect.any(String),
        regName: `${TAG} WHT2 TRADING CORP`,
        businessName: `${TAG} WHT2 TRADING CORP`,
      });
      // Later changes to the client never change the filed return.
      await writer.client.update({
        where: { id: ids.WHT2! },
        data: { businessName: `${TAG} RENAMED LATER`, regName: `${TAG} RENAMED LATER` },
      });
      const after = await auth(http().get(`${API}/bir-forms/${d.id}`));
      expect(after.body.filedSnapshot.regName).toBe(`${TAG} WHT2 TRADING CORP`);

      // Sealed
      const sealed = await auth(http().patch(`${API}/bir-forms/${d.id}`)).send({
        data: { ...data, remittance: "1.00" },
      });
      expect(sealed.status).toBe(409);
      expect(sealed.body.message).toContain("This 0619E has been filed and is sealed");
      const del = await auth(http().delete(`${API}/bir-forms/${d.id}`));
      expect(del.status).toBe(409);

      // Amend: a new draft copying the filed one
      const amended = await auth(http().post(`${API}/bir-forms/${d.id}/amend`));
      expect(amended.status).toBe(201);
      expect(amended.body).toMatchObject({
        status: "draft",
        sequence: 2,
        amendsId: d.id,
      });
      const copy = await auth(http().get(`${API}/bir-forms/${amended.body.id}`));
      expect(copy.body.data).toEqual(data);
      expect(copy.body.period).toBe("2026-08");
      // Deleting the amendment draft leaves the original amendable again.
      const gone = await auth(http().delete(`${API}/bir-forms/${amended.body.id}`));
      expect([gone.status, gone.body.deleted]).toEqual([200, true]);
      const again = await auth(http().post(`${API}/bir-forms/${d.id}/amend`));
      expect(again.status).toBe(201);
    });

    it("the same for a 1601-EQ, and a draft of either can be deleted", async () => {
      const d = await draft("WHT2", "1601EQ", "2026-Q3", {
        year: "2026",
        quarter: "3rd",
        rows: [{ atc: "WI160", base: "1000.00", rate: "2", withheld: "20.00" }],
      });
      expect((await auth(http().delete(`${API}/bir-forms/${d.id}`))).body).toEqual({
        deleted: true,
        id: d.id,
      });
      const e = await draft("WHT2", "1601EQ", "2026-Q3", {
        year: "2026",
        quarter: "3rd",
        rows: [],
      });
      await file(e.id);
      const amend = await auth(http().post(`${API}/bir-forms/${e.id}/amend`));
      expect([amend.status, amend.body.sequence]).toEqual([201, 2]);
    });

    it("the same for a 1601-C: filed with a snapshot, sealed, amended into a copy, and a draft deleted", async () => {
      const data = {
        year: "2026",
        month: "08",
        amended: "no",
        anyWithheld: "yes",
        compensation: "250000.00",
        taxesWithheld: "12345.67",
      };
      const d = await draft("WHT2", "1601C", "2026-08", data);
      expect(d.data).toEqual(data);
      const filed = await file(d.id);
      expect(filed.filedSnapshot).toMatchObject({ tin: expect.any(String) });
      const sealed = await auth(http().patch(`${API}/bir-forms/${d.id}`)).send({
        data: { ...data, compensation: "1.00" },
      });
      expect(sealed.status).toBe(409);
      expect(sealed.body.message).toContain("This 1601C has been filed and is sealed");
      const amended = await auth(http().post(`${API}/bir-forms/${d.id}/amend`));
      expect([amended.status, amended.body.sequence, amended.body.amendsId]).toEqual([
        201,
        2,
        d.id,
      ]);
      expect(
        (await auth(http().get(`${API}/bir-forms/${amended.body.id}`))).body.data,
      ).toEqual(data);
      expect(
        (await auth(http().delete(`${API}/bir-forms/${amended.body.id}`))).body.deleted,
      ).toBe(true);
      const e = await draft("WHT2", "1601C", "2026-12", { year: "2026", month: "12" });
      expect((await auth(http().delete(`${API}/bir-forms/${e.id}`))).body).toEqual({
        deleted: true,
        id: e.id,
      });
    });

    it("a period is checked on update too; an amendment keeps its period", async () => {
      const d = await draft("NONE", "0619E", "2026-08", { year: "2026", month: "08" });
      for (const period of ["2026-09", "2026-Q3", ""]) {
        const res = await auth(http().patch(`${API}/bir-forms/${d.id}`)).send({ period });
        expect([period, res.status]).toEqual([period, 400]);
      }
      const ok = await auth(http().patch(`${API}/bir-forms/${d.id}`)).send({
        period: "2026-07",
      });
      expect([ok.status, ok.body.period]).toEqual([200, "2026-07"]);
    });
  });

  // =====================================================================================
  describe("T1 · authorization, as for the other feeders", () => {
    it("another firm's client is 404; an unassigned firm user is 403; a client principal is 403", async () => {
      const other = await writer.firm.create({ data: { name: `${TAG} Other Firm` } });
      const foreign = await writer.client.create({
        data: { firmId: other.id, businessName: `${TAG} foreign`, taxType: "VAT" },
      });
      for (const [form, period] of [
        ["0619E", "2026-08"],
        ["1601EQ", "2026-Q3"],
      ] as const) {
        const res = await figures(foreign.id, form, period);
        expect([res.status, res.body.message]).toEqual([404, "Client not found"]);
      }
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
              clientAssignments: { create: { clientId: ids.NONE! } },
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
      expect((await figures(ids.WHT!, "0619E", "2026-08", managerToken)).status).toBe(
        403,
      );
      expect((await figures(ids.NONE!, "1601EQ", "2026-Q3", managerToken)).status).toBe(
        200,
      );
      const portal = await writer.user.create({
        data: {
          firmId,
          userType: "CLIENT",
          fullName: `${TAG} portal user`,
          email: `${TAG}-portal@example.com`,
          status: "ACTIVE",
          clientProfile: { create: { clientId: ids.WHT!, clientRole: "OWNER" } },
        },
      });
      const portalToken = tokens.signAccess({
        id: portal.id,
        firmId,
        userType: "CLIENT",
        email: portal.email,
        clientId: ids.WHT!,
      });
      expect((await figures(ids.WHT!, "0619E", "2026-08", portalToken)).status).toBe(403);
    });
  });

  // =====================================================================================
  describe("T1 · the tax base is netAmount as recorded (D23)", () => {
    it("for a client that is not VAT-registered the base includes the VAT, and the recorded-versus-rate warning shows where it matters", async () => {
      // August records of NONVAT that carry withholding under an expanded ATC:
      //  224.00 on 11,200.00 (VAT 1,200.00 inside): 2% of 11,200.00 = 224.00 - matches the base
      //  112.00 on  5,600.00 (VAT   600.00 inside): 2% of 5,600.00 = 112.00 - matches
      //   60.00 on  3,000.00 (no VAT): 2% = 60.00 - matches
      //   40.00 on  2,000.00 (a plain record): 2% = 40.00 - matches
      // The withholding was computed on the gross in every case: the base is what was
      // recorded, VAT included, and nothing here adjusts it (ruling 6).
      const res = await figures(ids.NONVAT!, "1601EQ", "2026-Q3");
      expect(res.body.figures.rows).toEqual([
        { atc: "WC160", base: "7600.00", rate: "2", withheld: "152.00" },
        { atc: "WI160", base: "14200.00", rate: "2", withheld: "284.00" },
      ]);
      expect(res.body.warnings.filter((w: string) => w.includes("differs"))).toEqual([]);
      // How many of this month's counted records carry recorded VAT inside netAmount.
      const counted = await writer.purchaseTransaction.findMany({
        where: {
          clientId: ids.NONVAT!,
          status: "posted",
          whtAmount: { gt: 0 },
          txnDate: {
            gte: new Date("2026-08-01T00:00:00.000Z"),
            lte: new Date("2026-08-31T00:00:00.000Z"),
          },
        },
      });
      const withVat = counted.filter((r) => r.taxAmount && Number(r.taxAmount) > 0);
      expect([counted.length, withVat.length]).toEqual([4, 2]);
      expect(withVat.reduce((s, r) => s + Number(r.taxAmount), 0)).toBe(1800);
    });
  });

  // =====================================================================================
  describe("T1 · the tax estimate does not change when a withholding return is filed (ruling 4)", () => {
    it("a filed 0619-E, 1601-EQ and 1601-C are not in filedForms and change nothing; a filed 2550Q still is (control)", async () => {
      const estimate = () =>
        auth(
          http()
            .get(`${API}/clients/${ids.WHT6}/tax-estimate`)
            .query({ year: 2026, quarter: 3 }),
        );
      const before = await estimate();
      expect(before.status).toBe(200);
      // WHT6 already holds a filed 1601EQ for 2026-Q3 (the six-row test); file a 0619-E too.
      const m = await draft("WHT6", "0619E", "2026-08", {
        year: "2026",
        month: "08",
        anyWithheld: "yes",
        remittance: "600.00",
      });
      await file(m.id);
      const c = await draft("WHT6", "1601C", "2026-08", {
        year: "2026",
        month: "08",
        anyWithheld: "yes",
        compensation: "100000.00",
        taxesWithheld: "5000.00",
      });
      await file(c.id);
      const after = await estimate();
      expect(after.body).toEqual(before.body);
      const forms = (after.body.filedForms as Array<{ form: string }>).map((f) => f.form);
      expect(forms).not.toContain("0619E");
      expect(forms).not.toContain("1601EQ");
      expect(forms).not.toContain("1601C");
      // The control: a filed 2550Q is listed.
      const v = await draft("WHT6", "2550Q", "2026-Q3", { year: "2026" });
      await file(v.id);
      const control = await estimate();
      expect(
        (control.body.filedForms as Array<{ form: string }>).map((f) => f.form),
      ).toContain("2550Q");
    });
  });

  // =====================================================================================
  describe("T1 · the due dates", () => {
    it.each([
      // [month, the 10th of the next month is a ..., the default due date]
      ["07", "2026", "2026-08-10"], // Monday
      ["04", "2026", "2026-05-11"], // 10 May 2026 is a Sunday: Monday the 11th
      ["05", "2028", "2028-06-12"], // 10 June 2028 is a Saturday: Monday the 12th
      ["08", "2026", "2026-09-10"], // Thursday
      ["11", "2026", "2026-12-10"], // Thursday
      ["02", "2027", "2027-03-10"], // Wednesday
    ])("the 0619-E for %s/%s is due %s", async (month, year, due) => {
      const res = await compute("0619E", { year, month });
      expect(res.status).toBe(201);
      expect(res.body.defaultDueDate).toBe(due);
    });

    it("a draft with no month has no default due date", async () => {
      expect((await compute("0619E", {})).body.defaultDueDate).toBe("");
    });
  });

  // =====================================================================================
  describe("U17 · nothing in the 2551Q and 2550Q changes", () => {
    it("their book-figures responses are byte-identical to what they were before this unit, on the same data", async () => {
      await client("GPCT", "PERCENTAGE");
      await sale("GPCT", "2026-07-01", "100000.00", { atc: "PT010" });
      await sale("GPCT", "2026-08-15", "20000.49", { atc: "PT010" });
      await sale("GPCT", "2026-09-30", "50000.50", { atc: "PT040" });
      for (const d of ["2026-08-01", "2026-08-02", "2026-08-03"]) {
        await sale("GPCT", d, "0.40", { atc: "PT060" });
      }
      await sale("GPCT", "2026-07-10", "5000.00", { atc: null });
      await sale("GPCT", "2026-08-05", "3400.00", { atc: "" });
      await sale("GPCT", "2026-09-01", "8000.00", { atc: "WI010" });
      await sale("GPCT", "2026-06-30", "77777.00", { atc: "PT010" });
      await sale("GPCT", "2026-10-01", "66666.00", { atc: "PT010" });

      await client("GVAT", "VAT");
      await sale("GVAT", "2026-07-05", "500000.00", { vatClass: "VATABLE_12" });
      await sale("GVAT", "2026-08-20", "100000.00", {
        vatClass: "VATABLE_12",
        gov: true,
        withheld: "3000.50",
      });
      await sale("GVAT", "2026-08-25", "0.49", { vatClass: "VATABLE_12" });
      await sale("GVAT", "2026-07-15", "250000.50", { vatClass: "ZERO_RATED" });
      for (const d of ["2026-08-01", "2026-08-02", "2026-08-03"]) {
        await sale("GVAT", d, "0.40", { vatClass: "EXEMPT" });
      }
      await sale("GVAT", "2026-09-10", "700.00", { vatClass: "NON_VAT" });
      await cost("GVAT", "2026-07-02", "80000.00", {
        category: "DOMESTIC_PURCHASES",
        inputVAT: "9600.00",
      });
      await cost("GVAT", "2026-09-30", "20000.10", {
        category: "DOMESTIC_PURCHASES",
        inputVAT: "2400.01",
      });
      await cost("GVAT", "2026-07-03", "10000.00", {
        category: "SERVICES_NONRESIDENT",
        inputVAT: "1200.00",
      });
      await cost("GVAT", "2026-07-04", "30000.50", {
        category: "IMPORTATION_GOODS",
        inputVAT: "3600.06",
      });
      await cost("GVAT", "2026-07-06", "5000.00", {
        category: "OTHERS_WITH_INPUT_TAX",
        inputVAT: "600.00",
      });
      await cost("GVAT", "2026-07-07", "7000.49", { category: "DOMESTIC_NO_INPUT_TAX" });
      await cost("GVAT", "2026-07-08", "4000.50", { category: "VAT_EXEMPT_IMPORTATION" });
      await cost("GVAT", "2026-07-09", "1500000.00", {
        category: "CAPITAL_GOODS_GT_1M",
        inputVAT: "180000.00",
      });
      await cost("GVAT", "2026-07-11", "900.00", { category: null });
      await cost("GVAT", "2026-07-12", "1000000.00", {
        category: "DOMESTIC_PURCHASES",
        inputVAT: "120000.00",
        status: "held",
      });

      await client("GFY", "VAT", {
        fiscalYearStart: new Date("2025-07-01T00:00:00.000Z"),
      });
      await sale("GFY", "2026-01-15", "5000.00", { vatClass: "VATABLE_12" });
      await sale("GFY", "2026-03-31", "600.00", { vatClass: "EXEMPT" });
      await sale("GFY", "2026-07-01", "9000.00", { vatClass: "VATABLE_12" });

      const get = async (key: string, form: string, period: string) => {
        const res = await figures(ids[key]!, form, period);
        expect(res.status).toBe(200);
        const { asOf: _asOf, ...rest } = res.body as Record<string, unknown>;
        return rest;
      };
      const now = JSON.stringify({
        "2551Q percentage client": await get("GPCT", "2551Q", "2026-Q3"),
        "2550Q VAT client": await get("GVAT", "2550Q", "2026-Q3"),
        "2550Q fiscal-year client": await get("GFY", "2550Q", "2026-Q3"),
        "2551Q VAT client (wrong regime)": await get("GVAT", "2551Q", "2026-Q3"),
      });
      if (process.env.U17_CAPTURE_GOLDEN === "1") {
        mkdirSync(dirname(GOLDEN), { recursive: true });
        writeFileSync(GOLDEN, `${JSON.stringify(JSON.parse(now), null, 2)}\n`);
      }
      expect(existsSync(GOLDEN)).toBe(true);
      // The file is stored indented; what is compared is its exact JSON text, key order
      // and every character of every value, against what the API answers now.
      expect(now).toBe(JSON.stringify(JSON.parse(readFileSync(GOLDEN, "utf8"))));
    });
  });
});
