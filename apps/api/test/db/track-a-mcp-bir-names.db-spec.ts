/**
 * track-a-mcp-bir-names.db-spec.ts — U20b, the connector drafts BIR forms from a client's
 * NAME: it finds the client, picks the period, lists what is due, and pulls everything the
 * Portal already holds. The real Nest app over HTTP at /api/v1/mcp/<key>; every firm,
 * client, payee, TIN and amount is invented. "Today" is set where a test needs it.
 */
import { randomUUID } from "node:crypto";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { FakeStorage } from "../helpers/file-return";
import { loadAtcReference } from "./helpers/atc-reference";
import { truncateOncePerFile } from "./helpers/truncate";
import { AppModule } from "../../src/app.module";
import { PrismaService } from "../../src/prisma/prisma.service";
import { StorageService } from "../../src/storage/storage.service";

truncateOncePerFile({ firmRoles: ["Super Admin"], chartOfAccounts: true });

const TAG = `track-a-mcp-names-${randomUUID().slice(0, 8)}`;
const API = "/api/v1";
const ACCEPT = "application/json, text/event-stream";
const SECRET = `${TAG}-connector-secret-0123456789abcdef`;
const NOV_6 = Date.parse("2026-11-06T04:00:00.000Z"); // noon in Manila
const OCT_15 = Date.parse("2026-10-15T04:00:00.000Z");

type ToolResult = {
  isError?: boolean;
  content: { type: string; text: string }[];
  structuredContent?: Record<string, unknown>;
};
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the tests read tool JSON
type Json = Record<string, any>;

describe("U20b · draft BIR forms from a client name (real app over HTTP, db)", () => {
  let app: INestApplication;
  let db: PrismaService;
  const storage = new FakeStorage();
  let prevSecret: string | undefined;
  let rpc = 1;
  let firmId = "";
  const c: Record<string, string> = {};
  let nowSpy: jest.SpyInstance | undefined;
  const setNow = (ms: number) => {
    nowSpy?.mockRestore();
    nowSpy = jest.spyOn(Date, "now").mockReturnValue(ms);
  };

  const http = () => request(app.getHttpServer());
  async function call(name: string, args: Record<string, unknown>): Promise<ToolResult> {
    const res = await http()
      .post(`${API}/mcp/${SECRET}`)
      .set("Accept", ACCEPT)
      .send({
        jsonrpc: "2.0",
        id: rpc++,
        method: "tools/call",
        params: { name, arguments: args },
      });
    expect(res.status).toBe(200);
    return res.body.result as ToolResult;
  }
  const j = (r: ToolResult): Json => r.structuredContent as Json;
  const text = (r: ToolResult) => r.content[0]!.text;
  const keys = (needs: Array<{ key: string }>) => needs.map((n) => n.key);

  async function client(key: string, tin: string, extra: Record<string, unknown> = {}) {
    const row = await db.client.create({
      data: {
        firmId,
        businessName: `${key}`,
        regName: key,
        kind: "non-individual",
        tin,
        branch: "00000",
        rdo: "045",
        address: "1 Invented St",
        city: "Lungsod ng Halimbawa",
        zip: "1800",
        taxType: "PERCENTAGE",
        ...extra,
      },
    });
    c[key] = row.id;
    return row.id;
  }
  const EXPANDED = [
    { type: "Withholding Tax - Expanded", form: "0619E", frequency: "Monthly" },
  ];
  const buy = async (
    clientId: string,
    date: string,
    net: string,
    wht: string,
    atc: string,
    payee: Record<string, string | null>,
  ) => {
    const cat =
      (await db.category.findFirst({
        where: { clientId, type: "EXPENSE", name: "exp" },
      })) ??
      (await db.category.create({ data: { clientId, type: "EXPENSE", name: "exp" } }));
    return db.purchaseTransaction.create({
      data: {
        clientId,
        categoryId: cat.id,
        txnDate: new Date(`${date}T00:00:00.000Z`),
        description: "purchase",
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
  };
  const filed = (
    clientId: string,
    form: string,
    period: string,
    data: Record<string, unknown> = {},
  ) =>
    db.birForm.create({
      data: {
        firmId,
        clientId,
        form,
        period,
        status: "filed",
        filedAt: new Date("2026-08-05T02:00:00.000Z"),
        dataJson: data as object,
        filedSnapshotJson: { snapshotVersion: 1 },
      },
    });

  beforeAll(async () => {
    prevSecret = process.env.MCP_SHARED_SECRET;
    process.env.MCP_SHARED_SECRET = SECRET;
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(StorageService)
      .useValue(storage)
      .compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix("api/v1");
    await app.init();
    db = app.get(PrismaService);
    expect(await loadAtcReference(db)).toBe(228);
    firmId = (await db.firm.create({ data: { name: `${TAG} Halimbawa Accounting` } })).id;
    const roleId = (
      await db.role.findUniqueOrThrow({
        where: { name_scope: { name: "Super Admin", scope: "FIRM" } },
      })
    ).id;
    await db.user.create({
      data: {
        firmId,
        userType: "FIRM",
        fullName: `${TAG} Super Admin`,
        email: `${TAG}-sa@example.com`,
        status: "ACTIVE",
        firmProfile: { create: { title: "Test" } },
        userRoles: { create: { roleId } },
      },
    });
    await client("Sample Agent Corporation", "111222333", {
      tradeName: "Sample Bakery",
      businessName: "Sample Agent Corp",
    });
    await client("Twin Trading Inc", "222333444", { businessName: "Twin Trading" });
    await client("Twin Trading Co", "333444555", {
      businessName: "Twin Trading",
      status: "ARCHIVED",
    });
    await client("Retired Goods Corp", "444555666", { status: "ARCHIVED" });
    await client("Withholder VAT Corp", "555666777", {
      taxType: "VAT",
      taxTypesJson: EXPANDED,
    });
    await client("Complete Agent Corp", "666777888", { taxTypesJson: EXPANDED });
  });
  afterAll(async () => {
    nowSpy?.mockRestore();
    if (prevSecret === undefined) delete process.env.MCP_SHARED_SECRET;
    else process.env.MCP_SHARED_SECRET = prevSecret;
    await app.close();
  });
  afterEach(() => nowSpy?.mockRestore());

  // ======================================================================================
  describe("T1 · the client, from a name or a TIN", () => {
    const sample = () => c["Sample Agent Corporation"]!;

    it("by registered name, ignoring case, punctuation and extra spaces; the answer echoes id, name and TIN", async () => {
      for (const name of [
        "Sample Agent Corporation",
        "sample   agent corporation",
        "SAMPLE AGENT, CORPORATION.",
      ]) {
        const out = j(
          await call("portal_bir_form_requirements", {
            client: name,
            formCode: "2551Q",
            year: 2026,
            quarter: 1,
          }),
        );
        expect({ name, client: out.client }).toEqual({
          name,
          client: { id: sample(), name: "Sample Agent Corp", tin: "111222333" },
        });
        expect(out.matchedBy).toBe("name");
      }
    });

    it("by trade name, and by the business name", async () => {
      expect(
        j(
          await call("portal_bir_form_requirements", {
            client: "sample bakery",
            formCode: "2551Q",
            year: 2026,
            quarter: 1,
          }),
        ).client.id,
      ).toBe(sample());
      expect(
        j(
          await call("portal_bir_form_requirements", {
            client: "Sample Agent Corp",
            formCode: "2551Q",
            year: 2026,
            quarter: 1,
          }),
        ).client.id,
      ).toBe(sample());
    });

    it("by TIN, with and without dashes; a TIN is exact", async () => {
      for (const tin of ["111222333", "111-222-333", "111-222-333-00000"]) {
        const out = j(
          await call("portal_bir_form_requirements", {
            client: tin,
            formCode: "2551Q",
            year: 2026,
            quarter: 1,
          }),
        );
        expect({ tin, id: out.client.id, by: out.matchedBy }).toEqual({
          tin,
          id: sample(),
          by: "tin",
        });
      }
      const none = j(
        await call("portal_bir_form_requirements", {
          client: "111-222-334",
          formCode: "2551Q",
          year: 2026,
          quarter: 1,
        }),
      );
      expect(none.client).toBeNull();
    });

    it("several clients with that name: nothing is created, and the choice is a need with name, TIN and status", async () => {
      const out = j(
        await call("portal_create_bir_form_draft", {
          client: "twin trading",
          formCode: "1601C",
          year: 2026,
          month: 7,
        }),
      );
      expect(out).toMatchObject({ created: false, client: null });
      expect(out.needs).toHaveLength(1);
      expect(out.needs[0]).toMatchObject({
        key: "client",
        question: "Which client do you mean?",
        kind: "choice",
        options: [
          "Twin Trading — TIN 222-333-444 — ACTIVE",
          "Twin Trading — TIN 333-444-555 — ARCHIVED (inactive)",
        ],
        refs: { clientIds: [c["Twin Trading Inc"], c["Twin Trading Co"]] },
      });
      // exact matches keep their own reason; they are not turned into near matches (U20c)
      expect(out.needs[0].why).toContain("More than one client has that name or TIN");
      expect(
        await db.birForm.count({
          where: { clientId: { in: [c["Twin Trading Inc"]!, c["Twin Trading Co"]!] } },
        }),
      ).toBe(0);
      // the owner's answer: the TIN of the option chosen
      const again = j(
        await call("portal_bir_form_requirements", {
          client: "222-333-444",
          formCode: "1601C",
          year: 2026,
          month: 7,
        }),
      );
      expect(again.client.id).toBe(c["Twin Trading Inc"]);
    });

    it("no match: a need that asks for the registered name or TIN, and nothing is created", async () => {
      const out = j(
        await call("portal_create_bir_form_draft", {
          client: "Nobody Inc",
          formCode: "1601C",
          year: 2026,
          month: 7,
        }),
      );
      expect(out).toMatchObject({ created: false, client: null });
      expect(out.needs).toEqual([
        expect.objectContaining({
          key: "client",
          question:
            "I could not find a client named Nobody Inc. What is the registered name or TIN?",
          kind: "text",
        }),
      ]);
      const list = j(await call("portal_list_bir_forms", { client: "Nobody Inc" }));
      expect(list.client).toBeNull();
      expect(list.needs).toHaveLength(1);
    });

    it("an inactive client is matched and flagged", async () => {
      const out = j(
        await call("portal_bir_form_requirements", {
          client: "Retired Goods Corp",
          formCode: "1601C",
          year: 2026,
          month: 7,
        }),
      );
      expect(out.client.id).toBe(c["Retired Goods Corp"]);
      expect(out.notes.join(" ")).toContain("is ARCHIVED (inactive)");
    });

    it("an id still works; with neither an id nor a name the tool says what to give", async () => {
      expect(
        j(
          await call("portal_bir_form_requirements", {
            clientId: sample(),
            formCode: "2551Q",
            year: 2026,
            quarter: 1,
          }),
        ).client.id,
      ).toBe(sample());
      const r = await call("portal_bir_form_requirements", {
        formCode: "2551Q",
        year: 2026,
        quarter: 1,
      });
      expect(r.isError).toBe(true);
      expect(text(r)).toContain("Give client");
    });

    it("lists a client's returns by name", async () => {
      const d = j(
        await call("portal_create_bir_form_draft", {
          client: "Sample Bakery",
          formCode: "1601C",
          year: 2025,
          month: 2,
        }),
      );
      const list = j(
        await call("portal_list_bir_forms", {
          client: "Sample Bakery",
          formCode: "1601C",
        }),
      );
      expect(list.client.id).toBe(sample());
      expect((list.forms as Json[]).map((f) => f.id)).toContain(d.id);
    });
  });

  // ======================================================================================
  describe("U20c · near matches when the name is not exact", () => {
    beforeAll(async () => {
      await client("Juan Dela Cruz Trading", "123456780", {
        businessName: "JUAN DELA CRUZ TRADING",
      });
      for (let i = 1; i <= 12; i++) {
        await client(
          `Mega Store ${String(i).padStart(2, "0")}`,
          `5000001${String(i).padStart(2, "0")}`,
        );
      }
    });
    const dc = () => c["Juan Dela Cruz Trading"]!;

    it("part of a name gives one option, never an automatic pick, and writes nothing", async () => {
      const out = j(
        await call("portal_create_bir_form_draft", {
          client: "Dela Cruz",
          formCode: "1601C",
          year: 2026,
          month: 7,
        }),
      );
      expect(out).toMatchObject({ created: false, client: null, matchedBy: null });
      expect(out.needs).toHaveLength(1);
      expect(out.needs[0]).toMatchObject({
        key: "client",
        question: "Which client do you mean?",
        kind: "choice",
        options: ["JUAN DELA CRUZ TRADING — TIN 123-456-780 — ACTIVE"],
        refs: { clientIds: [dc()] },
      });
      expect(await db.birForm.count({ where: { clientId: dc() } })).toBe(0);
      // the owner's answer: the TIN of the option, or the longer name
      const again = j(
        await call("portal_bir_form_requirements", {
          client: "123-456-780",
          formCode: "1601C",
          year: 2026,
          month: 7,
        }),
      );
      expect(again.client.id).toBe(dc());
    });

    it("two words in any order", async () => {
      for (const words of ["cruz juan", "Trading, Dela Cruz", "JUAN   TRADING"]) {
        const out = j(
          await call("portal_bir_form_requirements", {
            client: words,
            formCode: "1601C",
            year: 2026,
            month: 7,
          }),
        );
        expect({ words, ids: out.needs[0].refs.clientIds }).toEqual({
          words,
          ids: [dc()],
        });
      }
    });

    it("a TIN prefix of three or more digits; two digits are not a prefix", async () => {
      const out = j(await call("portal_bir_forms_due", { client: "123-456" }));
      expect(out.needs[0]).toMatchObject({
        question: "Which client do you mean?",
        refs: { clientIds: [dc()] },
      });
      expect(
        j(await call("portal_bir_forms_due", { client: "50" })).needs[0].question,
      ).toBe("I could not find a client named 50. What is the registered name or TIN?");
    });

    it("several near matches are all offered, by name", async () => {
      const out = j(await call("portal_list_bir_forms", { client: "trading" }));
      expect(out.client).toBeNull();
      const options = out.needs[0].options as string[];
      expect(options).toEqual([
        "JUAN DELA CRUZ TRADING — TIN 123-456-780 — ACTIVE",
        "Twin Trading — TIN 222-333-444 — ACTIVE",
        "Twin Trading — TIN 333-444-555 — ARCHIVED (inactive)",
      ]);
    });

    it("more than ten: the first ten by name, a note that says how many more, asking for a longer name", async () => {
      const out = j(
        await call("portal_create_bir_form_draft", {
          client: "mega store",
          formCode: "1601C",
          year: 2026,
          month: 7,
        }),
      );
      expect(out.created).toBe(false);
      const need = out.needs[0];
      expect(need.question).toBe("Which client do you mean?");
      expect(need.options).toHaveLength(10);
      expect(need.options[0]).toBe("Mega Store 01 — TIN 500-000-101 — ACTIVE");
      expect(need.options[9]).toBe("Mega Store 10 — TIN 500-000-110 — ACTIVE");
      expect(need.refs.clientIds).toHaveLength(10);
      expect(out.notes).toEqual([
        "12 clients match; these are the first 10 by name. 2 more match: give a longer name or a TIN.",
      ]);
      expect(need.why).toContain("longer name");
      expect(
        await db.birForm.count({ where: { clientId: { in: need.refs.clientIds } } }),
      ).toBe(0);
      // a longer name settles it
      const one = j(
        await call("portal_bir_form_requirements", {
          client: "mega store 11",
          formCode: "1601C",
          year: 2026,
          month: 7,
        }),
      );
      expect(one.client).toMatchObject({ name: "Mega Store 11" });
      expect(one.matchedBy).toBe("name");
    });

    it("no near match: the could-not-find question, as before", async () => {
      const out = j(
        await call("portal_create_bir_form_draft", {
          client: "Zzyzx Holdings",
          formCode: "1601C",
          year: 2026,
          month: 7,
        }),
      );
      expect(out.needs).toEqual([
        expect.objectContaining({
          key: "client",
          question:
            "I could not find a client named Zzyzx Holdings. What is the registered name or TIN?",
          kind: "text",
        }),
      ]);
    });

    it("an exact match is still used, even when a longer name also contains the words", async () => {
      // "Mega Store 01" is exact; "Mega Store 1" words are also in 01, 10, 11, 12
      const out = j(
        await call("portal_bir_form_requirements", {
          client: "mega store 01",
          formCode: "1601C",
          year: 2026,
          month: 7,
        }),
      );
      expect(out.client.name).toBe("Mega Store 01");
      expect(out.matchedBy).toBe("name");
    });
  });

  // ======================================================================================
  describe("T2 · the period, when none is named", () => {
    it("the period due next, said in words; create picks the same, and again is the same draft", async () => {
      setNow(NOV_6);
      await client("Period Corp", "777888999", { taxTypesJson: EXPANDED });
      const req = j(
        await call("portal_bir_form_requirements", {
          client: "Period Corp",
          formCode: "1601C",
        }),
      );
      expect(req.period).toBe("2026-10");
      expect(req.periodChoice).toMatchObject({
        period: "2026-10",
        dueDate: "2026-11-10",
        basis: "due-next",
        reason:
          "I chose October 2026 (2026-10) because it is the 1601C due next, on 10 November 2026, in 4 days.",
      });
      const a = j(
        await call("portal_create_bir_form_draft", {
          client: "Period Corp",
          formCode: "1601C",
        }),
      );
      expect(a).toMatchObject({ period: "2026-10", existing: false });
      expect(a.periodChoice.reason).toContain("October 2026");
      const b = j(
        await call("portal_create_bir_form_draft", {
          client: "Period Corp",
          formCode: "1601C",
        }),
      );
      expect(b).toMatchObject({ id: a.id, existing: true });
    });

    it("never a period that has a filed return: then the next one", async () => {
      setNow(NOV_6);
      await client("Skip Corp", "888999000", { taxTypesJson: EXPANDED });
      await filed(c["Skip Corp"]!, "0619E", "2026-10");
      const out = j(
        await call("portal_bir_form_requirements", {
          client: "Skip Corp",
          formCode: "0619E",
        }),
      );
      expect(out.period).toBe("2026-11");
      expect(out.periodChoice.reason).toContain("October 2026 is already filed");
      // the 1601-EQ: Q3 was due 2 November; the next is Q4
      expect(
        j(
          await call("portal_bir_form_requirements", {
            client: "Skip Corp",
            formCode: "1601EQ",
          }),
        ).period,
      ).toBe("2026-Q4");
    });

    it("a form with no due-date rule: the latest period that has ended", async () => {
      setNow(NOV_6);
      const out = j(
        await call("portal_bir_form_requirements", {
          client: "Sample Bakery",
          formCode: "1701Q",
        }),
      );
      expect(out.period).toBe("2026-Q3");
      expect(out.periodChoice).toMatchObject({ basis: "latest-ended", dueDate: null });
      expect(out.periodChoice.reason).toContain(
        "the Portal has no due-date rule for the 1701Q",
      );
      expect(
        j(
          await call("portal_bir_form_requirements", {
            client: "Sample Bakery",
            formCode: "1701A",
          }),
        ).period,
      ).toBe("2025");
    });

    it("a half-named period is an error, not a default", async () => {
      const r = await call("portal_bir_form_requirements", {
        client: "Sample Bakery",
        formCode: "2551Q",
        year: 2026,
      });
      expect(r.isError).toBe(true);
      expect(text(r)).toContain("give quarter (1 to 4)");
    });
  });

  // ======================================================================================
  describe("T3 · portal_bir_forms_due", () => {
    it("a client with expanded withholding and VAT: what is due in 45 days and what is overdue, with the drafts and filed returns", async () => {
      const draft = j(
        await call("portal_create_bir_form_draft", {
          client: "Withholder VAT Corp",
          formCode: "0619E",
          year: 2026,
          month: 11,
        }),
      );
      await filed(c["Withholder VAT Corp"]!, "0619E", "2026-10");
      const out = j(
        await call("portal_bir_forms_due", {
          client: "withholder vat corp",
          asOf: "2026-11-06",
        }),
      );
      expect(out.client).toMatchObject({
        id: c["Withholder VAT Corp"],
        tin: "555666777",
      });
      expect(out.asOf).toBe("2026-11-06");
      const items = out.items as Json[];
      const find = (form: string, period: string) =>
        items.find((i) => i.form === form && i.period === period);
      expect(find("0619E", "2026-10")).toBeUndefined(); // filed
      expect(find("0619E", "2026-11")).toMatchObject({
        status: "due",
        dueDate: "2026-12-10",
        daysLeft: 34,
        existing: { draft: { id: draft.id }, filed: null },
      });
      expect(find("1601EQ", "2026-Q3")).toMatchObject({
        status: "overdue",
        dueDate: "2026-11-02",
        daysLate: 4,
        existing: { draft: null, filed: null },
      });
      expect(find("2550Q", "2026-Q3")).toMatchObject({
        status: "overdue",
        dueDate: "2026-10-26",
        daysLate: 11,
      });
      expect(find("0619E", "2026-09")).toBeUndefined();
      const dues = items.map((i) => i.dueDate);
      expect([...dues].sort()).toEqual(dues);
      expect(out.notes.join(" ")).toContain(
        "no due-date rule for the income-tax returns",
      );
    });

    it("without an as-of date it is today, and a client with nothing registered has nothing due", async () => {
      setNow(NOV_6);
      const out = j(
        await call("portal_bir_forms_due", { client: "Withholder VAT Corp" }),
      );
      expect(out.asOf).toBe("2026-11-06");
      expect((out.items as Json[]).length).toBeGreaterThan(0);
      await client("Exempt Corp", "999000111", { taxType: null });
      const none = j(
        await call("portal_bir_forms_due", { client: "Exempt Corp", asOf: "2026-11-06" }),
      );
      expect(none.items).toEqual([]);
      const bad = await call("portal_bir_forms_due", {
        client: "Exempt Corp",
        asOf: "2026-02-30",
      });
      expect(bad.isError).toBe(true);
    });

    it("an unknown or ambiguous client is a need, as for the other tools", async () => {
      expect(
        j(await call("portal_bir_forms_due", { client: "Nobody Inc" })).needs[0].key,
      ).toBe("client");
      expect(
        j(await call("portal_bir_forms_due", { client: "Twin Trading" })).needs[0]
          .options,
      ).toHaveLength(2);
    });
  });

  // ======================================================================================
  describe("T4 · pull what the Portal has, ask for nothing it holds", () => {
    it("a client with complete records and posted expenses: from the name alone, a 1601-EQ draft with no needs", async () => {
      setNow(OCT_15); // the 1601-EQ due next is the 3rd quarter's (2 November)
      const id = c["Complete Agent Corp"]!;
      await buy(id, "2026-07-10", "300000.00", "3000.00", "WC158", {
        vendor: "Juan Dela Cruz",
        tin: "123-456-789",
        branch: "0000",
        kind: "individual",
        last: "Dela Cruz",
        first: "Juan",
        middle: "Santos",
      });
      await buy(id, "2026-08-12", "300000.00", "6000.00", "WC160", {
        vendor: "Sample Supplier Inc",
        tin: "987654321",
        branch: "0001",
        kind: "non_individual",
      });
      await filed(id, "0619E", "2026-07", {
        year: "2026",
        month: "07",
        remittance: "3000.00",
      });
      await filed(id, "0619E", "2026-08", {
        year: "2026",
        month: "08",
        remittance: "6000.00",
      });

      const out = j(
        await call("portal_create_bir_form_draft", {
          client: "complete agent corp",
          formCode: "1601EQ",
        }),
      );
      expect(out).toMatchObject({
        form: "1601EQ",
        period: "2026-Q3",
        status: "draft",
        existing: false,
      });
      expect(out.periodChoice.reason).toContain("Q3 2026");
      expect(out.needs).toEqual([]);
      expect(out.warnings).toEqual([]);
      // everything came from the books and the filed 0619-Es
      expect(out.data).toMatchObject({
        year: "2026",
        quarter: "3rd",
        remittance1: "3000.00",
        remittance2: "6000.00",
      });
      expect(out.data.rows).toHaveLength(2);
      expect(out.computed.find((i: Json) => i.item === "19")).toMatchObject({
        value: 9000,
      });
      expect(out.computed.find((i: Json) => i.item === "26")).toMatchObject({ value: 0 });
      // the alphalist and the preview are ready
      expect(j(await call("portal_alphalist_check", { id: out.id }))).toMatchObject({
        ok: true,
        returnTotal: "9000.00",
      });
      expect(j(await call("portal_bir_form_preview", { id: out.id })).ok).toBe(true);
      expect(keys(j(await call("portal_get_bir_form", { id: out.id })).needs)).toEqual(
        [],
      );
    });
  });

  // ======================================================================================
  describe("T5 · the instructions", () => {
    it("tell Claude to pass the name, to offer the list when no form is named, to tell the owner the period, and to ask only what is in needs", async () => {
      const res = await http()
        .post(`${API}/mcp/${SECRET}`)
        .set("Accept", ACCEPT)
        .send({
          jsonrpc: "2.0",
          id: rpc++,
          method: "initialize",
          params: {
            protocolVersion: "2025-06-18",
            capabilities: {},
            clientInfo: { name: "t", version: "1" },
          },
        });
      const text = res.body.result.instructions as string;
      for (const line of [
        "When the owner names a client, pass the name as `client`; do not ask for an id.",
        "If the owner names no form, call portal_bir_forms_due and offer the list.",
        "If the owner names no period, use the period the tool chose and tell the owner which one.",
        "Ask only the questions in `needs`.",
      ]) {
        expect(text).toContain(line);
      }
    });
  });
});
