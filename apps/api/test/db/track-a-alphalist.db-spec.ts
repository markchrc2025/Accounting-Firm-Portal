/**
 * track-a-alphalist.db-spec.ts — U19, over HTTP against the real Nest app and the local
 * PostgreSQL: the 1601-EQ alphalist (QAP .DAT) made from the client's posted expense
 * records. Golden bytes with CRLF; the payee details on an expense (REST); the prefill
 * route; every refusal; a filed return answering its STORED rows after the books change.
 * Every firm, client, payee, TIN and amount is invented.
 */
import { randomUUID } from "node:crypto";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { FakeStorage, markFiledAny } from "../helpers/file-return";
import { loadAtcReference } from "./helpers/atc-reference";
import { truncateOncePerFile } from "./helpers/truncate";
import { AppModule } from "../../src/app.module";
import { TokenService } from "../../src/auth/token.service";
import { PrismaService } from "../../src/prisma/prisma.service";
import { StorageService } from "../../src/storage/storage.service";

truncateOncePerFile({ firmRoles: ["Super Admin", "Manager"] });

const TAG = `track-a-alphalist-${randomUUID().slice(0, 8)}`;
const API = "/api/v1";
const CRLF = "\r\n";
const lines = (...l: string[]) => l.join(CRLF) + CRLF;

const ONLY_1601EQ = "The alphalist file is only made for the 1601-EQ.";
const NOT_STORED = "The alphalist was not stored when this return was filed.";
const NEED_RDO = "Add the client's RDO code before making the alphalist.";

describe("U19 · the 1601-EQ alphalist (real app over HTTP, db)", () => {
  let app: INestApplication;
  let db: PrismaService;
  let tokens: TokenService;
  let firmId = "";
  let saToken = "";
  let readerToken = "";
  let noAccessToken = "";
  const ids: Record<string, string> = {};
  const cats: Record<string, string> = {};
  const http = () => request(app.getHttpServer());
  const auth = (r: request.Test, t = saToken) => r.set("Authorization", `Bearer ${t}`);

  async function client(key: string, tin: string, extra: Record<string, unknown> = {}) {
    const c = await db.client.create({
      data: {
        phone: "09170000000",
        firmId,
        businessName: `${TAG} ${key}`,
        regName: "SAMPLE AGENT CORP",
        kind: "non-individual",
        tin,
        branch: "00000",
        rdo: "045",
        address: "1 Invented St",
        city: "Lungsod ng Halimbawa",
        zip: "0000",
        taxType: "VAT",
        ...extra,
      },
    });
    ids[key] = c.id;
    cats[key] = (
      await db.category.create({
        data: { clientId: c.id, type: "EXPENSE", name: `${TAG} ${key} exp` },
      })
    ).id;
    return c.id;
  }

  /** A posted expense with an expanded-withholding ATC and an amount withheld. */
  const buy = (
    key: string,
    date: string,
    net: string,
    wht: string,
    atc: string,
    payee: {
      vendor?: string | null;
      tin?: string | null;
      branch?: string | null;
      kind?: string | null;
      last?: string | null;
      first?: string | null;
      middle?: string | null;
    },
  ) =>
    db.purchaseTransaction.create({
      data: {
        clientId: ids[key]!,
        categoryId: cats[key]!,
        txnDate: new Date(`${date}T00:00:00.000Z`),
        description: `${TAG} purchase`,
        vendor: payee.vendor ?? null,
        vendorTin: payee.tin ?? null,
        vendorBranch: payee.branch ?? null,
        payeeKind: payee.kind ?? null,
        payeeLastName: payee.last ?? null,
        payeeFirstName: payee.first ?? null,
        payeeMiddleName: payee.middle ?? null,
        netAmount: net,
        whtAmount: wht,
        atc,
        status: "posted",
      },
    });

  const juan = {
    vendor: "Juan Dela Cruz",
    tin: "123-456-789",
    branch: "0000",
    kind: "individual",
    last: "Dela Cruz",
    first: "Juan",
    middle: "Santos",
  };
  const supplier = {
    vendor: "Sample Supplier Inc",
    tin: "987654321",
    branch: "0001",
    kind: "non_individual",
  };

  async function draft1601EQ(
    key: string,
    period: string,
    rows: Array<{ atc: string; base: string; rate: string; withheld: string }>,
  ) {
    const res = await auth(http().post(`${API}/bir-forms`)).send({
      clientId: ids[key],
      form: "1601EQ",
      period,
      data: { rows },
    });
    expect([key, period, res.status]).toEqual([key, period, 201]);
    return res.body as { id: string };
  }
  const alphalist = (id: string, t = saToken) =>
    auth(http().get(`${API}/bir-forms/${id}/alphalist`), t);
  const check = (id: string, t = saToken) =>
    auth(http().get(`${API}/bir-forms/${id}/alphalist/check`), t);

  const GOLDEN_S1 = lines(
    'HQAP,H1601EQ,111222333,0000,"SAMPLE AGENT CORP",09/2026,045',
    'D1,1601EQ,1,123456789,0000,"","DELA CRUZ","JUAN","SANTOS",09/2026,WC158,1.00,300000.00,3000.00',
    'D1,1601EQ,2,987654321,0001,"SAMPLE SUPPLIER INC","","","",09/2026,WC160,2.00,300000.00,6000.00',
    "C1,1601EQ,111222333,0000,09/2026,600000.00,9000.00",
  );

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(StorageService)
      .useValue(new FakeStorage())
      .compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix("api/v1");
    await app.init();
    db = app.get(PrismaService);
    tokens = app.get(TokenService);
    expect(await loadAtcReference(db)).toBe(228);
    firmId = (await db.firm.create({ data: { name: `${TAG} Halimbawa Accounting` } })).id;
    const role = async (name: string) =>
      (
        await db.role.findUniqueOrThrow({
          where: { name_scope: { name, scope: "FIRM" } },
        })
      ).id;
    const mk = async (label: string, roleName: string, assign: string[] = []) => {
      const u = await db.user.create({
        data: {
          firmId,
          userType: "FIRM",
          fullName: `${TAG} ${label}`,
          email: `${TAG}-${label}@example.com`,
          status: "ACTIVE",
          firmProfile: {
            create: {
              title: "Test",
              ...(assign.length
                ? {
                    clientAssignments: {
                      create: assign.map((clientId) => ({ clientId })),
                    },
                  }
                : {}),
            },
          },
          userRoles: { create: { roleId: await role(roleName) } },
        },
      });
      return tokens.signAccess({ id: u.id, firmId, userType: "FIRM", email: u.email });
    };
    saToken = await mk("sa", "Super Admin");
    await client("AGENT", "111222333");
    await client("OTHER", "444555666");
    readerToken = await mk("reader", "Manager", [ids.AGENT!]);
    noAccessToken = await mk("outsider", "Manager", [ids.OTHER!]);
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(async () => {
    await db.purchaseTransaction.deleteMany({});
  });

  // ======================================================================================
  describe("T1 · the file", () => {
    it("Schedule 1 only: an individual and a company, byte for byte, CRLF on every line", async () => {
      await buy("AGENT", "2026-07-10", "300000.00", "3000.00", "WC158", juan);
      await buy("AGENT", "2026-08-12", "300000.00", "6000.00", "WC160", supplier);
      const d = await draft1601EQ("AGENT", "2026-Q3", [
        { atc: "WC158", base: "300000.00", rate: "1", withheld: "3000.00" },
        { atc: "WC160", base: "300000.00", rate: "2", withheld: "6000.00" },
      ]);
      const res = await alphalist(d.id);
      expect(res.status).toBe(200);
      expect(res.headers["content-type"]).toMatch(/^text\/plain/);
      expect(res.headers["content-disposition"]).toContain(
        "11122233300000920261601EQ.DAT",
      );
      expect(res.headers["content-disposition"]).toMatch(/^attachment/);
      expect(res.text).toBe(GOLDEN_S1);
      expect((res.text.match(/\n/g) ?? []).length).toBe(
        (res.text.match(/\r\n/g) ?? []).length,
      );
    });

    it("branch 000, 0000 and 00000 are one payee, written as 0000; records outside the quarter, held or not withheld are not listed", async () => {
      await buy("AGENT", "2026-07-10", "100000.00", "1000.00", "WC158", {
        ...juan,
        branch: "000",
      });
      await buy("AGENT", "2026-08-10", "100000.00", "1000.00", "WC158", {
        ...juan,
        branch: "0000",
      });
      await buy("AGENT", "2026-09-30", "100000.00", "1000.00", "WC158", {
        ...juan,
        branch: "00000",
      });
      await buy("AGENT", "2026-06-30", "999999.00", "9999.99", "WC158", { ...juan }); // the quarter before
      await buy("AGENT", "2026-10-01", "999999.00", "9999.99", "WC158", { ...juan }); // the quarter after
      await buy("AGENT", "2026-08-01", "5000.00", "0.00", "WC158", { ...juan }); // nothing withheld
      const held = await buy("AGENT", "2026-08-02", "5000.00", "100.00", "WC158", {
        ...juan,
      });
      await db.purchaseTransaction.update({
        where: { id: held.id },
        data: { status: "held" },
      });
      const d = await draft1601EQ("AGENT", "2026-Q3", [
        { atc: "WC158", base: "300000.00", rate: "1", withheld: "3000.00" },
      ]);
      const res = await alphalist(d.id);
      expect(res.status).toBe(200);
      expect(res.text).toBe(
        lines(
          'HQAP,H1601EQ,111222333,0000,"SAMPLE AGENT CORP",09/2026,045',
          'D1,1601EQ,1,123456789,0000,"","DELA CRUZ","JUAN","SANTOS",09/2026,WC158,1.00,300000.00,3000.00',
          "C1,1601EQ,111222333,0000,09/2026,300000.00,3000.00",
        ),
      );
    });

    it("the check answers ok, counts and totals per schedule, and the conversions made", async () => {
      await buy("AGENT", "2026-07-10", "300000.00", "3000.00", "WC158", {
        ...juan,
        last: "Peña",
      });
      const d = await draft1601EQ("AGENT", "2026-Q3", [
        { atc: "WC158", base: "300000.00", rate: "1", withheld: "3000.00" },
      ]);
      const res = await check(d.id);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        ok: true,
        source: "books",
        fileName: "11122233300000920261601EQ.DAT",
        refusals: [],
        notes: ["The name of payee 123-456-789 had Ñ; it is written as N."],
        schedule1: { rows: 1, income: "300000.00", tax: "3000.00" },
        schedule2: { rows: 0, income: "0.00" },
        returnTotal: "3000.00",
      });
      const file = await alphalist(d.id);
      expect(file.text).toContain('"PENA"');
      expect(file.text).not.toContain("Ñ");
    });

    it("an individual agent is LAST FIRST MIDDLE with single spaces and no comma", async () => {
      await client("IND", "555666777", {
        kind: "individual",
        regName: null,
        lastName: "Reyes",
        firstName: "Ana",
        middleName: "Lim",
        businessName: `${TAG} IND`,
      });
      await buy("IND", "2026-07-10", "100000.00", "1000.00", "WC158", juan);
      const d = await draft1601EQ("IND", "2026-Q3", [
        { atc: "WC158", base: "100000.00", rate: "1", withheld: "1000.00" },
      ]);
      const res = await alphalist(d.id);
      expect(res.text.split(CRLF)[0]).toBe(
        'HQAP,H1601EQ,555666777,0000,"Reyes Ana Lim",09/2026,045',
      );
    });
  });

  // ======================================================================================
  describe("T2 · the BIR Validation program's rules, as 409s", () => {
    const rows = (withheld: string) => [
      { atc: "WC158", base: "100000.00", rate: "1", withheld },
    ];

    it("wrong form", async () => {
      const f = await auth(http().post(`${API}/bir-forms`)).send({
        clientId: ids.AGENT,
        form: "2550Q",
        period: "2026-Q3",
        data: {},
      });
      for (const path of ["alphalist", "alphalist/check"]) {
        const res = await auth(http().get(`${API}/bir-forms/${f.body.id}/${path}`));
        expect([path, res.status, res.body.message]).toEqual([path, 409, ONLY_1601EQ]);
      }
    });

    it("missing payee details: one 409 listing every payee", async () => {
      await buy("AGENT", "2026-07-10", "100000.00", "1000.00", "WC158", {
        vendor: "X",
        tin: "123456789",
        kind: null,
      });
      await buy("AGENT", "2026-07-11", "100000.00", "1000.00", "WC158", {
        vendor: "Y",
        tin: "987654321",
        kind: "individual",
        last: "Reyes",
      });
      const d = await draft1601EQ("AGENT", "2026-Q3", [
        { atc: "WC158", base: "200000.00", rate: "1", withheld: "2000.00" },
      ]);
      const res = await alphalist(d.id);
      expect(res.status).toBe(409);
      const sentence =
        "These payees need details before the alphalist can be made: 123-456-789 (choose individual or company), 987-654-321 (first name).";
      expect(res.body.message).toBe(sentence);
      expect(res.body.refusals).toEqual([sentence]);
      const c = await check(d.id);
      expect(c.status).toBe(200);
      expect(c.body).toMatchObject({ ok: false, refusals: [sentence], fileName: null });
    });

    it("expenses of one payee that disagree", async () => {
      await buy("AGENT", "2026-07-10", "50000.00", "500.00", "WC158", juan);
      await buy("AGENT", "2026-07-11", "50000.00", "500.00", "WC158", {
        ...juan,
        middle: "S",
      });
      const d = await draft1601EQ("AGENT", "2026-Q3", [
        { atc: "WC158", base: "100000.00", rate: "1", withheld: "1000.00" },
      ]);
      const res = await alphalist(d.id);
      expect([res.status, res.body.message]).toEqual([
        409,
        "These payees have different details on different expenses: 123-456-789 (DELA CRUZ JUAN S on 1 expense, DELA CRUZ JUAN SANTOS on 1 expense). Make them the same, then try again.",
      ]);
    });

    it("a blank-detail expense takes the details of the others", async () => {
      await buy("AGENT", "2026-07-10", "50000.00", "500.00", "WC158", juan);
      await buy("AGENT", "2026-07-11", "50000.00", "500.00", "WC158", {
        vendor: null,
        tin: "123456789",
        branch: null,
      });
      const d = await draft1601EQ("AGENT", "2026-Q3", [
        { atc: "WC158", base: "100000.00", rate: "1", withheld: "1000.00" },
      ]);
      expect((await alphalist(d.id)).status).toBe(200);
    });

    it("a client with no RDO code", async () => {
      await client("NORDO", "666777888", { rdo: null });
      await buy("NORDO", "2026-07-10", "100000.00", "1000.00", "WC158", juan);
      const d = await draft1601EQ("NORDO", "2026-Q3", rows("1000.00"));
      const res = await alphalist(d.id);
      expect([res.status, res.body.message]).toEqual([409, NEED_RDO]);
    });

    it("a forbidden character in a name", async () => {
      await buy("AGENT", "2026-07-10", "100000.00", "1000.00", "WC158", {
        ...juan,
        first: "Juan & Sons",
      });
      const d = await draft1601EQ("AGENT", "2026-Q3", rows("1000.00"));
      const res = await alphalist(d.id);
      expect([res.status, res.body.message]).toEqual([
        409,
        "The name of payee 123-456-789 contains &, which the BIR alphalist does not accept. Correct the name in the payee record.",
      ]);
    });

    it("a row that fails the formula (income x rate / 100 is not the tax withheld)", async () => {
      await buy("AGENT", "2026-07-10", "100000.00", "1001.00", "WC158", juan);
      const d = await draft1601EQ("AGENT", "2026-Q3", rows("1001.00"));
      const res = await alphalist(d.id);
      expect([res.status, res.body.message]).toEqual([
        409,
        "Payee 123-456-789 WC158: 100000.00 at 1.00% is 1000.00, but the tax withheld is 1001.00.",
      ]);
    });

    it("a zero income with tax withheld", async () => {
      await buy("AGENT", "2026-07-10", "0.00", "5.00", "WC158", juan);
      const d = await draft1601EQ("AGENT", "2026-Q3", rows("5.00"));
      const res = await alphalist(d.id);
      expect([res.status, res.body.message]).toEqual([
        409,
        "Payee 123-456-789 WC158: the income payment and the tax withheld must not be zero.",
      ]);
    });

    it("a total different from the return's Item 19 (both figures in the refusal)", async () => {
      await buy("AGENT", "2026-07-10", "100000.00", "1000.00", "WC158", juan);
      const d = await draft1601EQ("AGENT", "2026-Q3", rows("1100.00"));
      const res = await alphalist(d.id);
      expect([res.status, res.body.message]).toEqual([
        409,
        "The alphalist's total tax withheld is 1000.00, but the 1601-EQ's total taxes withheld (Item 19) is 1100.00.",
      ]);
      expect((await check(d.id)).body).toMatchObject({
        ok: false,
        returnTotal: "1100.00",
      });
    });

    it("a quarter with nothing withheld has no alphalist", async () => {
      const d = await draft1601EQ("AGENT", "2026-Q3", []);
      const res = await alphalist(d.id);
      expect([res.status, res.body.message]).toEqual([
        409,
        "The alphalist has no payees to list.",
      ]);
    });

    it("a payee's TIN that is not 9 digits", async () => {
      await buy("AGENT", "2026-07-10", "100000.00", "1000.00", "WC158", {
        ...juan,
        tin: "12345",
      });
      const d = await draft1601EQ("AGENT", "2026-Q3", rows("1000.00"));
      const res = await alphalist(d.id);
      expect([res.status, res.body.message]).toEqual([
        409,
        "An expense for Juan Dela Cruz has a vendor TIN that is not 9 digits (12345). Correct it on the expense.",
      ]);
    });

    it("access: the same permissions as Preview PDF; another firm's client is a 404", async () => {
      await buy("AGENT", "2026-07-10", "100000.00", "1000.00", "WC158", juan);
      const d = await draft1601EQ("AGENT", "2026-Q3", rows("1000.00"));
      expect((await alphalist(d.id, readerToken)).status).toBe(200);
      expect((await alphalist(d.id, noAccessToken)).status).toBe(403);
      expect((await check(d.id, noAccessToken)).status).toBe(403);
      expect((await alphalist(randomUUID())).status).toBe(404);
    });
  });

  // ======================================================================================
  describe("T3 · a filed return answers its stored rows", () => {
    it("Mark as filed stores the rows; a new expense in the quarter afterwards changes nothing", async () => {
      await buy("AGENT", "2026-07-10", "300000.00", "3000.00", "WC158", juan);
      await buy("AGENT", "2026-08-12", "300000.00", "6000.00", "WC160", supplier);
      const d = await draft1601EQ("AGENT", "2026-Q3", [
        { atc: "WC158", base: "300000.00", rate: "1", withheld: "3000.00" },
        { atc: "WC160", base: "300000.00", rate: "2", withheld: "6000.00" },
      ]);
      const filed = await markFiledAny(app, saToken, d.id);
      expect(filed.status).toBe(200);
      expect(filed.body.alphalist).toEqual({ stored: true, warning: null });
      const row = await db.birForm.findUniqueOrThrow({ where: { id: d.id } });
      const snap = row.filedSnapshotJson as {
        alphalist?: { model?: { schedule1?: unknown[] } };
      };
      expect(snap.alphalist?.model?.schedule1).toHaveLength(2);

      // the books change afterwards: a new payee, a changed name, a deleted expense
      await buy("AGENT", "2026-09-15", "777777.00", "7777.77", "WC158", {
        ...juan,
        tin: "555666777",
      });
      await db.purchaseTransaction.updateMany({
        where: { vendorTin: "123-456-789" },
        data: { payeeLastName: "Changed" },
      });
      const after = await alphalist(d.id);
      expect(after.status).toBe(200);
      expect(after.text).toBe(GOLDEN_S1);
      const c = await check(d.id);
      expect(c.body).toMatchObject({
        ok: true,
        source: "stored",
        returnTotal: "9000.00",
      });
    });

    it("Mark as filed is not blocked by an incomplete alphalist: it files, stores no rows, and warns with the refusals", async () => {
      await buy("AGENT", "2026-07-10", "100000.00", "1000.00", "WC158", {
        vendor: "X",
        tin: "123456789",
        kind: null,
      });
      const d = await draft1601EQ("AGENT", "2026-Q3", [
        { atc: "WC158", base: "100000.00", rate: "1", withheld: "1000.00" },
      ]);
      const before = await check(d.id); // usable on a draft, before filing
      expect(before.body.ok).toBe(false);
      const filed = await markFiledAny(app, saToken, d.id);
      expect(filed.status).toBe(200);
      expect(filed.body.status).toBe("filed");
      expect(filed.body.alphalist).toEqual({
        stored: false,
        warning: {
          message:
            "The alphalist could not be made when this return was filed, so none was stored. A filed return's alphalist cannot be made later.",
          refusals: before.body.refusals,
        },
      });
      const res = await alphalist(d.id);
      expect([res.status, res.body.message]).toEqual([409, NOT_STORED]);
      const c = await check(d.id);
      expect(c.status).toBe(200);
      expect(c.body).toMatchObject({ ok: false, source: "none", refusals: [NOT_STORED] });
      // and the same warning is on the return when it is read again
      const one = await auth(http().get(`${API}/bir-forms/${d.id}`));
      expect(one.body.alphalist.stored).toBe(false);
      expect(one.body.alphalist.warning.refusals).toEqual(before.body.refusals);
    });

    it("a return filed before U19 holds no rows: 409, and it is never rebuilt from the books", async () => {
      await buy("AGENT", "2026-07-10", "100000.00", "1000.00", "WC158", juan);
      const old = await db.birForm.create({
        data: {
          firmId,
          clientId: ids.AGENT!,
          form: "1601EQ",
          period: "2026-Q3",
          status: "filed",
          filedAt: new Date("2026-10-20T02:00:00.000Z"),
          dataJson: {
            rows: [{ atc: "WC158", base: "100000.00", rate: "1", withheld: "1000.00" }],
          },
          filedSnapshotJson: { snapshotVersion: 1, businessName: "x" },
        },
      });
      const res = await alphalist(old.id);
      expect([res.status, res.body.message]).toEqual([409, NOT_STORED]);
      expect((await check(old.id)).body).toMatchObject({ ok: false, source: "none" });
    });

    it("only the 1601-EQ gets an alphalist state; other returns are marked filed as before", async () => {
      const d = await auth(http().post(`${API}/bir-forms`)).send({
        clientId: ids.AGENT,
        form: "1601C",
        period: "2026-07",
        data: {},
      });
      const filed = await markFiledAny(app, saToken, d.body.id);
      expect(filed.status).toBe(200);
      expect(filed.body.alphalist ?? null).toBeNull();
    });
  });

  // ======================================================================================
  describe("T4 · the payee details on an expense (REST), and the prefill", () => {
    // A percentage-tax client: its expenses need no VAT category.
    beforeAll(async () => {
      await client("PCT", "333444555", { taxType: "PERCENTAGE" });
    });
    const base = () => ({
      txnDate: "2026-07-10",
      description: "Rent",
      categoryId: cats.PCT,
      netAmount: 1000,
      vendor: "Juan Dela Cruz",
      vendorTin: "123-456-789",
      atc: "WC158",
      whtAmount: 10,
    });
    const url = (extra = "") => `${API}/clients/${ids.PCT}/purchase-transactions${extra}`;

    it("create and update accept the five fields and read them back", async () => {
      const res = await auth(http().post(url())).send({
        ...base(),
        vendorBranch: "00001",
        payeeKind: "individual",
        payeeLastName: "Dela Cruz",
        payeeFirstName: "Juan",
        payeeMiddleName: "Santos",
      });
      expect([res.status, res.body.message]).toEqual([201, undefined]);
      expect(res.body).toMatchObject({
        vendorBranch: "00001",
        payeeKind: "individual",
        payeeLastName: "Dela Cruz",
        payeeFirstName: "Juan",
        payeeMiddleName: "Santos",
      });
      const upd = await auth(http().patch(url(`/${res.body.id}`))).send({
        payeeMiddleName: "S",
        payeeKind: "individual",
        vendorBranch: "2",
      });
      expect(upd.status).toBe(200);
      expect(upd.body).toMatchObject({ payeeMiddleName: "S", vendorBranch: "2" });
      const got = await auth(http().get(url(`/${res.body.id}`)));
      expect(got.body).toMatchObject({
        payeeLastName: "Dela Cruz",
        payeeMiddleName: "S",
      });
      // all optional: an expense without them still works
      expect((await auth(http().post(url())).send(base())).status).toBe(201);
    });

    it("refuses a payeeKind that is neither, and a branch that is not digits", async () => {
      const kind = await auth(http().post(url())).send({
        ...base(),
        payeeKind: "company",
      });
      expect(kind.status).toBe(400);
      const branch = await auth(http().post(url())).send({
        ...base(),
        vendorBranch: "A12",
      });
      expect(branch.status).toBe(400);
    });

    it("the prefill route answers the latest saved details for a payee TIN", async () => {
      await buy("AGENT", "2026-07-10", "1.00", "0.00", "WC158", {
        ...juan,
        middle: "Old",
      });
      await buy("AGENT", "2026-08-10", "1.00", "0.00", "WC158", {
        ...juan,
        middle: "New",
      });
      await buy("AGENT", "2026-09-10", "1.00", "0.00", "WC158", {
        vendor: "No details",
        tin: "123456789",
      });
      const agentUrl = `${API}/clients/${ids.AGENT}/purchase-transactions/payee-details`;
      const res = await auth(http().get(agentUrl).query({ tin: "123-456-789" }));
      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        found: true,
        tin: "123456789",
        branch: "0000",
        payeeKind: "individual",
        registeredName: null,
        lastName: "Dela Cruz",
        firstName: "Juan",
        middleName: "New",
        vendor: "Juan Dela Cruz",
      });
      const none = await auth(http().get(agentUrl).query({ tin: "000000001" }));
      expect(none.body).toEqual({ found: false });
      expect((await auth(http().get(agentUrl).query({ tin: "12" }))).status).toBe(400);
      expect(
        (await auth(http().get(agentUrl).query({ tin: "123456789" }), noAccessToken))
          .status,
      ).toBe(403);
    });
  });
});
