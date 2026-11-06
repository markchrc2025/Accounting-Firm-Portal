/**
 * track-a-mcp-bir.db-spec.ts — U20, the Portal's MCP connector drafts BIR forms and asks
 * for what is missing. The real Nest app over HTTP at /api/v1/mcp/<key> against the local
 * PostgreSQL; every firm, client, payee, TIN and amount is invented.
 *
 *   T1  the form types and the requirements (needs) for each kind of form
 *   T2  create (twice is the same draft), update (merges like the web), a filed return
 *   T3  the whole conversation: answer the needs, needs end up empty, preview and alphalist links
 *   T4  expenses with payee details, client fields, permissions, audit, tenancy
 */
import { randomUUID } from "node:crypto";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import request from "supertest";
import { FakeStorage } from "../helpers/file-return";
import { loadAtcReference } from "./helpers/atc-reference";
import { truncateOncePerFile } from "./helpers/truncate";
import { AppModule } from "../../src/app.module";
import { AuditService } from "../../src/audit/audit.service";
import { BirFormsService } from "../../src/bir-forms/bir-forms.service";
import { BookFiguresService } from "../../src/bir-forms/book-figures/book-figures.service";
import { AlphalistService } from "../../src/bir-forms/alphalist/alphalist.service";
import { ClientsService } from "../../src/clients/clients.service";
import { SERVER_INSTRUCTIONS } from "../../src/mcp/bir/instructions";
import { registerBirTools } from "../../src/mcp/bir/mcp-bir-tools";
import { PrismaService } from "../../src/prisma/prisma.service";
import { StorageService } from "../../src/storage/storage.service";

truncateOncePerFile({ firmRoles: ["Super Admin", "Manager"], chartOfAccounts: true });

const TAG = `track-a-mcp-bir-${randomUUID().slice(0, 8)}`;
const API = "/api/v1";
const ACCEPT = "application/json, text/event-stream";
const SECRET = `${TAG}-connector-secret-0123456789abcdef`;
const THIRD_MONTH =
  "The third month of a quarter is reported on the 1601-EQ, not on a 0619-E.";
const SEALED = (form: string) =>
  `This ${form} has been filed and is sealed: a filed return is never changed. To correct it, file an amendment — Amend opens a new draft that copies this one.`;

type ToolResult = {
  isError?: boolean;
  content: { type: string; text: string }[];
  structuredContent?: Record<string, unknown>;
};
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the tests read tool JSON
type Json = Record<string, any>;

describe("U20 · the MCP connector drafts BIR forms (real app over HTTP, db)", () => {
  let app: INestApplication;
  let db: PrismaService;
  const storage = new FakeStorage();
  let prevSecret: string | undefined;
  let rpc = 1;
  let firmId = "";
  const c: Record<string, string> = {};

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
        businessName: `${TAG} ${key} TRADING CORP`,
        regName: `${TAG} ${key} TRADING CORP`,
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
  const buy = async (
    key: string,
    date: string,
    net: string,
    wht: string,
    atc: string,
    payee: Record<string, string | null> = {},
  ) => {
    const cat =
      (await db.category.findFirst({
        where: { clientId: c[key]!, type: "EXPENSE", name: `${TAG} exp` },
      })) ??
      (await db.category.create({
        data: { clientId: c[key]!, type: "EXPENSE", name: `${TAG} exp` },
      }));
    return db.purchaseTransaction.create({
      data: {
        clientId: c[key]!,
        categoryId: cat.id,
        txnDate: new Date(`${date}T00:00:00.000Z`),
        description: `${TAG} purchase`,
        vendor: payee.vendor ?? null,
        vendorTin: payee.tin ?? null,
        vendorBranch: payee.branch ?? null,
        payeeKind: payee.kind ?? null,
        payeeLastName: payee.last ?? null,
        payeeFirstName: payee.first ?? null,
        netAmount: net,
        whtAmount: wht,
        atc,
        status: "posted",
      },
    });
  };

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
    await client("BARE", "111222333", { rdo: null, address: null, zip: null }); // missing RDO, address, ZIP
    await client("FULL", "222333444");
    await client("AGENT", "333444555");
    await client("IND", "444555666", {
      kind: "individual",
      regName: null,
      lastName: "Reyes",
      firstName: "Ana",
      civilStatus: null,
      classification: null,
      birthdate: null,
    });
  });
  afterAll(async () => {
    if (prevSecret === undefined) delete process.env.MCP_SHARED_SECRET;
    else process.env.MCP_SHARED_SECRET = prevSecret;
    await app.close();
  });
  beforeEach(async () => {
    storage.objects.clear();
    await db.purchaseTransaction.deleteMany({});
  });

  // ======================================================================================
  describe("T1 · form types and requirements", () => {
    it("lists the forms the Portal can draft, with period kind, books or typed, and the due-date rule", async () => {
      const res = await call("portal_list_bir_form_types", {});
      expect(res.isError).toBeUndefined();
      const forms = j(res).forms as Json[];
      expect(forms.map((f) => f.code).sort()).toEqual(
        [
          "0619E",
          "1601C",
          "1601EQ",
          "1701",
          "1701A",
          "1701Q",
          "1702Q",
          "1702RT",
          "2307",
          "2316",
          "2550Q",
          "2551Q",
        ].sort(),
      );
      const by = (code: string) => forms.find((f) => f.code === code)!;
      expect(by("0619E")).toMatchObject({ periodKind: "month", figures: "books" });
      expect(by("1601C")).toMatchObject({ periodKind: "month", figures: "typed" });
      expect(by("1601EQ")).toMatchObject({ periodKind: "quarter", figures: "books" });
      expect(by("1701A")).toMatchObject({ periodKind: "year", figures: "typed" });
      expect(by("2551Q").dueDateRule).toContain("25th");
      for (const f of forms) expect(f.name).toEqual(expect.any(String));
    });

    it("a client missing its RDO, address and ZIP: the first call for a draft asks for each, as plain questions", async () => {
      const res = await call("portal_bir_form_requirements", {
        clientId: c.BARE,
        formCode: "2551Q",
        year: 2026,
        quarter: 1,
      });
      const out = j(res);
      expect(out).toMatchObject({
        period: "2026-Q1",
        form: "2551Q",
        exists: false,
        existing: { draft: null, filed: null },
      });
      // the client's record first, then the books: this period has no posted records
      expect(keys(out.needs)).toEqual([
        "client.rdo",
        "client.address",
        "client.zip",
        "books.noRecords",
      ]);
      expect(out.needs[0]).toEqual({
        key: "client.rdo",
        question: "What is the client's RDO code (3 digits)?",
        why: "The BIR 2551Q prints the Revenue District Office code.",
        setWith: "portal_update_client field rdo",
        kind: "text",
      });
      expect(await db.birForm.count({ where: { clientId: c.BARE } })).toBe(0); // a dry run writes nothing
    });

    it("0619-E for month 3 is refused with the Portal's own sentence", async () => {
      const res = await call("portal_bir_form_requirements", {
        clientId: c.FULL,
        formCode: "0619E",
        year: 2026,
        month: 9,
      });
      expect(res.isError).toBe(true);
      expect(text(res)).toContain(THIRD_MONTH);
      const create = await call("portal_create_bir_form_draft", {
        clientId: c.FULL,
        formCode: "0619E",
        year: 2026,
        month: 3,
      });
      expect(create.isError).toBe(true);
      expect(text(create)).toContain(THIRD_MONTH);
    });

    it("the period input must fit the form", async () => {
      const a = await call("portal_bir_form_requirements", {
        clientId: c.FULL,
        formCode: "2551Q",
        year: 2026,
      });
      expect(a.isError).toBe(true);
      expect(text(a)).toContain("give quarter (1 to 4)");
      const b = await call("portal_bir_form_requirements", {
        clientId: c.FULL,
        formCode: "1701A",
        year: 2026,
        quarter: 1,
      });
      expect(text(b)).toContain("give year only");
      const d = await call("portal_bir_form_requirements", {
        clientId: c.FULL,
        formCode: "9999",
        year: 2026,
      });
      expect(d.isError).toBe(true);
    });

    it("a 1601-C is typed: with nothing typed it asks for Items 14 and 25", async () => {
      const out = j(
        await call("portal_bir_form_requirements", {
          clientId: c.FULL,
          formCode: "1601C",
          year: 2026,
          month: 7,
        }),
      );
      expect(out.figures).toBe("typed");
      expect(keys(out.needs)).toEqual(["data.compensation", "data.taxesWithheld"]);
      expect(out.needs[0]).toMatchObject({
        question:
          "What is the total amount of compensation paid in this month (Item 14)?",
        setWith: "portal_update_bir_form_draft field data.compensation",
        kind: "number",
      });
    });

    it("a 2307 asks for the payee and the income payments", async () => {
      const out = j(
        await call("portal_bir_form_requirements", {
          clientId: c.FULL,
          formCode: "2307",
          year: 2026,
          quarter: 2,
        }),
      );
      expect(keys(out.needs)).toEqual([
        "data.payeeName",
        "data.payeeTin",
        "data.payeeBranch",
        "data.payeeAddress",
        "data.rows",
      ]);
    });

    it("an individual's 1701A asks for the client's background and the ATC the preparer chooses", async () => {
      const out = j(
        await call("portal_bir_form_requirements", {
          clientId: c.IND,
          formCode: "1701A",
          year: 2025,
        }),
      );
      expect(keys(out.needs)).toEqual([
        "client.birthdate",
        "client.civilStatus",
        "client.classification",
        "data.atc",
      ]);
      const atc = out.needs.find((n: Json) => n.key === "data.atc");
      expect(atc).toMatchObject({
        kind: "atc",
        options: ["II012", "II014", "II015", "II017"],
      });
      const civil = out.needs.find((n: Json) => n.key === "client.civilStatus");
      expect(civil.options).toEqual([
        "Single",
        "Married",
        "Widow/Widower",
        "Legally Separated",
      ]);
    });

    it("a books-fed form with no posted records says so and asks, instead of guessing", async () => {
      const out = j(
        await call("portal_bir_form_requirements", {
          clientId: c.FULL,
          formCode: "0619E",
          year: 2026,
          month: 7,
        }),
      );
      expect(keys(out.needs)).toContain("books.noRecords");
      expect(out.notes.join(" ")).toContain("no posted records");
      const need = out.needs.find((n: Json) => n.key === "books.noRecords");
      expect(need.question).toContain(
        "Should the figures be typed instead, or are records missing?",
      );
    });

    it("books-fed figures are never needs: with posted records the 0619-E asks for nothing about them", async () => {
      await buy("FULL", "2026-07-10", "100000.00", "1000.00", "WC158", {
        vendor: "X",
        tin: "123456789",
      });
      const out = j(
        await call("portal_bir_form_requirements", {
          clientId: c.FULL,
          formCode: "0619E",
          year: 2026,
          month: 7,
        }),
      );
      expect(keys(out.needs)).toEqual([]);
      expect(out.figures).toBe("books");
      expect(out.computed.find((i: Json) => i.item === "14")).toMatchObject({
        key: "i14",
        value: 1000,
      });
    });
  });

  // ======================================================================================
  describe("T2 · create, update, filed", () => {
    it("create twice answers the same draft with existing:true, and writes one row", async () => {
      const args = { clientId: c.FULL, formCode: "1601C", year: 2026, month: 8 };
      const a = j(await call("portal_create_bir_form_draft", args));
      expect(a).toMatchObject({
        existing: false,
        status: "draft",
        form: "1601C",
        period: "2026-08",
      });
      const b = j(await call("portal_create_bir_form_draft", args));
      expect(b).toMatchObject({ existing: true, id: a.id });
      expect(
        await db.birForm.count({
          where: { clientId: c.FULL, form: "1601C", period: "2026-08" },
        }),
      ).toBe(1);
    });

    it("a books-fed draft is filled from the posted records, with _source, and the period keys the web writes", async () => {
      await buy("FULL", "2026-08-10", "100000.00", "1000.00", "WC158", {
        vendor: "X",
        tin: "123456789",
      });
      const out = j(
        await call("portal_create_bir_form_draft", {
          clientId: c.FULL,
          formCode: "0619E",
          year: 2026,
          month: 8,
        }),
      );
      expect(out.data).toMatchObject({
        year: "2026",
        month: "08",
        remittance: "1000.00",
        anyWithheld: "yes",
      });
      expect(out.data._source).toMatchObject({ mode: "books", edited: [] });
    });

    it("update merges like the web: the supplied keys change, the others stay; null clears a key", async () => {
      const d = j(
        await call("portal_create_bir_form_draft", {
          clientId: c.FULL,
          formCode: "1601C",
          year: 2026,
          month: 9,
          data: { compensation: "100000.00" },
        }),
      );
      const u = j(
        await call("portal_update_bir_form_draft", {
          id: d.id,
          data: { taxesWithheld: "5000.00" },
        }),
      );
      expect(u.data).toMatchObject({
        compensation: "100000.00",
        taxesWithheld: "5000.00",
      });
      expect(keys(u.needs)).toEqual([]);
      const cleared = j(
        await call("portal_update_bir_form_draft", {
          id: d.id,
          data: { compensation: null },
        }),
      );
      expect(cleared.data.compensation).toBeUndefined();
      expect(keys(cleared.needs)).toEqual(["data.compensation"]);
      const row = await db.birForm.findUniqueOrThrow({ where: { id: d.id } });
      expect((row.dataJson as Json).taxesWithheld).toBe("5000.00");
    });

    it("editing a figure the books gave marks it edited in _source", async () => {
      await buy("FULL", "2026-08-10", "100000.00", "1000.00", "WC158", {
        vendor: "X",
        tin: "123456789",
      });
      const d = j(
        await call("portal_create_bir_form_draft", {
          clientId: c.FULL,
          formCode: "0619E",
          year: 2026,
          month: 8,
        }),
      );
      const u = j(
        await call("portal_update_bir_form_draft", {
          id: d.id,
          data: { remittance: "999.00" },
        }),
      );
      expect(u.data._source.edited).toEqual(["remittance"]);
    });

    it("a filed return is never updated, and no second return is made for its period", async () => {
      const filed = await db.birForm.create({
        data: {
          firmId,
          clientId: c.FULL!,
          form: "1601C",
          period: "2026-10",
          status: "filed",
          filedAt: new Date("2026-11-05T02:00:00.000Z"),
          dataJson: {},
          filedSnapshotJson: { snapshotVersion: 1 },
        },
      });
      const upd = await call("portal_update_bir_form_draft", {
        id: filed.id,
        data: { compensation: "1.00" },
      });
      expect(upd.isError).toBe(true);
      expect(text(upd)).toContain(SEALED("1601C"));
      const create = await call("portal_create_bir_form_draft", {
        clientId: c.FULL,
        formCode: "1601C",
        year: 2026,
        month: 10,
      });
      expect(create.isError).toBe(true);
      expect(text(create)).toContain(SEALED("1601C"));
      const req = j(
        await call("portal_bir_form_requirements", {
          clientId: c.FULL,
          formCode: "1601C",
          year: 2026,
          month: 10,
        }),
      );
      expect(req).toMatchObject({
        exists: true,
        existing: { draft: null, filed: { id: filed.id } },
        status: "filed",
        needs: [],
      });
      const got = j(await call("portal_get_bir_form", { id: filed.id }));
      expect(got).toMatchObject({ status: "filed", needs: [] });
      expect(got.filed).toMatchObject({ confirmation: { status: "not required" } });
    });

    it("lists returns with id, form, period, status and due date; filters by form, year and status", async () => {
      await client("LIST", "555666777");
      const a = j(
        await call("portal_create_bir_form_draft", {
          clientId: c.LIST,
          formCode: "1601C",
          year: 2026,
          month: 11,
        }),
      );
      await call("portal_create_bir_form_draft", {
        clientId: c.LIST,
        formCode: "1701A",
        year: 2025,
      });
      const all = j(await call("portal_list_bir_forms", { clientId: c.LIST }));
      expect((all.forms as Json[]).map((f) => f.form).sort()).toEqual(["1601C", "1701A"]);
      const only = j(
        await call("portal_list_bir_forms", {
          clientId: c.LIST,
          formCode: "1601C",
          year: 2026,
          status: "draft",
        }),
      );
      expect(only.forms).toEqual([
        expect.objectContaining({
          id: a.id,
          form: "1601C",
          period: "2026-11",
          status: "draft",
          dueDate: "2026-12-10",
        }),
      ]);
    });

    it("get shows the due date and the days left, the computed items with their numbers, and the needs", async () => {
      const d = j(
        await call("portal_create_bir_form_draft", {
          clientId: c.FULL,
          formCode: "1601C",
          year: 2026,
          month: 12,
          data: { compensation: "100000.00", taxesWithheld: "5000.00" },
        }),
      );
      const got = j(await call("portal_get_bir_form", { id: d.id }));
      expect(got.dueDate).toBe("2027-01-15");
      expect(typeof got.daysLeft).toBe("number");
      expect(got.computed.find((i: Json) => i.item === "25")).toMatchObject({
        key: "i25",
        value: 5000,
      });
      expect(got.computed.find((i: Json) => i.item === "14").label).toEqual(
        expect.any(String),
      );
    });
  });

  // ======================================================================================
  describe("T3 · the whole conversation", () => {
    it("a 1601-EQ with payees missing details: one question per payee; answered, the needs end empty; preview and alphalist links", async () => {
      await buy("AGENT", "2026-07-10", "300000.00", "3000.00", "WC158", {
        vendor: "Juan Dela Cruz",
        tin: "123-456-789",
        branch: "0000",
      });
      await buy("AGENT", "2026-08-12", "300000.00", "6000.00", "WC160", {
        vendor: "Sample Supplier Inc",
        tin: "987654321",
        branch: "0001",
      });
      const d = j(
        await call("portal_create_bir_form_draft", {
          clientId: c.AGENT,
          formCode: "1601EQ",
          year: 2026,
          quarter: 3,
        }),
      );
      expect(keys(d.needs)).toEqual([
        "payee.123456789.payeeKind",
        "payee.987654321.payeeKind",
      ]);
      const first = d.needs[0];
      expect(first).toMatchObject({
        question: "Is payee 123-456-789 an individual or a company?",
        kind: "choice",
        options: ["individual", "non_individual"],
      });
      expect(first.refs.expenseIds).toHaveLength(1);
      expect(first.setWith).toContain("portal_update_expense");

      // before the answers, the alphalist is refused and the preview may be
      const bad = j(await call("portal_alphalist_check", { id: d.id }));
      expect(bad.ok).toBe(false);
      const refused = j(await call("portal_alphalist_file", { id: d.id }));
      expect(refused).toMatchObject({ ok: false });
      expect(refused.url).toBeUndefined();

      // the owner answers; each answer is written with the tool named in setWith
      const [e1] = d.needs[0].refs.expenseIds;
      const [e2] = d.needs[1].refs.expenseIds;
      const u1 = await call("portal_update_expense", {
        id: e1,
        payeeKind: "individual",
        payeeLastName: "Dela Cruz",
        payeeFirstName: "Juan",
        payeeMiddleName: "Santos",
      });
      expect(u1.isError).toBeUndefined();
      await call("portal_update_expense", { id: e2, payeeKind: "non_individual" });
      const done = j(await call("portal_get_bir_form", { id: d.id }));
      expect(done.needs).toEqual([]);

      const ok = j(await call("portal_alphalist_check", { id: d.id }));
      expect(ok).toMatchObject({
        ok: true,
        source: "books",
        fileName: "33344455500000920261601EQ.DAT",
        returnTotal: "9000.00",
      });
      const file = j(await call("portal_alphalist_file", { id: d.id }));
      expect(file.ok).toBe(true);
      expect(file.url).toContain("1601EQ.DAT");
      const stored = [...storage.objects.entries()].find(([k]) =>
        k.includes("alphalist-"),
      );
      expect(Buffer.from(stored![1].body).toString("ascii")).toContain(
        'D1,1601EQ,1,123456789,0000,"","DELA CRUZ","JUAN","SANTOS"',
      );

      const preview = j(await call("portal_bir_form_preview", { id: d.id }));
      expect(preview.ok).toBe(true);
      expect(preview.url).toContain("preview-");
      expect(preview.filename).toContain("DRAFT.pdf");
      const pdf = [...storage.objects.entries()].find(([k]) => k.includes("preview-"));
      expect(Buffer.from(pdf![1].body).subarray(0, 5).toString("latin1")).toBe("%PDF-");
    });

    it("a 1601-EQ with an over-remittance and no choice asks the choice, with the amount", async () => {
      await buy("AGENT", "2025-05-10", "100000.00", "1000.00", "WC158", {
        vendor: "X",
        tin: "123456789",
        kind: "individual",
        last: "Cruz",
        first: "Ana",
      });
      const d = j(
        await call("portal_create_bir_form_draft", {
          clientId: c.AGENT,
          formCode: "1601EQ",
          year: 2025,
          quarter: 2,
          data: { remittance1: "1500.00", remittance2: "1200.00" },
        }),
      );
      const need = d.needs.find((n: Json) => n.key === "data.overRemittanceChoice");
      expect(need).toMatchObject({
        question:
          "Item 31 is an over-remittance of 1,700.00. Should it be refunded, issued as a Tax Credit Certificate, or carried over to the next quarter?",
        kind: "choice",
        options: ["refunded", "tcc", "carried"],
        setWith: "portal_update_bir_form_draft field data.overRemittanceChoice",
      });
      const u = j(
        await call("portal_update_bir_form_draft", {
          id: d.id,
          data: { overRemittanceChoice: "refunded" },
        }),
      );
      expect(
        u.needs.find((n: Json) => n.key === "data.overRemittanceChoice"),
      ).toBeUndefined();
    });

    it("a blocked preview gives the Portal's refusal sentences, and the needs", async () => {
      const rows = [1, 2, 3, 4, 5, 6, 7].map((n) => ({
        atc: `WI0${n}0`,
        base: "100.00",
        rate: "1",
        withheld: "1.00",
      }));
      const d = j(
        await call("portal_create_bir_form_draft", {
          clientId: c.AGENT,
          formCode: "1601EQ",
          year: 2026,
          quarter: 2,
          data: { rows },
        }),
      );
      const p = j(await call("portal_bir_form_preview", { id: d.id }));
      expect(p.ok).toBe(false);
      expect(p.refusals).toEqual(["7 ATCs; the form has six rows."]);
      expect(p.url).toBeUndefined();
      // the refusal is also a need, as a question that is the sentence itself
      expect(
        p.needs.find((n: Json) => n.question === "7 ATCs; the form has six rows."),
      ).toMatchObject({
        setWith: null,
        kind: "text",
        key: expect.stringMatching(/^refusal\.\d+$/),
      });
      expect(
        j(await call("portal_get_bir_form", { id: d.id })).needs.some(
          (n: Json) => n.question === "7 ATCs; the form has six rows.",
        ),
      ).toBe(true);
    });

    it("a ready 1601-C previews; a filed return gets the Portal's sentence, never a clear copy", async () => {
      const d = j(
        await call("portal_create_bir_form_draft", {
          clientId: c.FULL,
          formCode: "1601C",
          year: 2027,
          month: 2,
          data: { compensation: "100000.00", taxesWithheld: "5000.00" },
        }),
      );
      expect(j(await call("portal_get_bir_form", { id: d.id })).needs).toEqual([]);
      const p = j(await call("portal_bir_form_preview", { id: d.id }));
      expect(p.ok).toBe(true);
      expect(p.url).toEqual(expect.any(String));
      const filed = await db.birForm.create({
        data: {
          firmId,
          clientId: c.FULL!,
          form: "1601C",
          period: "2027-03",
          status: "filed",
          filedAt: new Date("2027-04-05T02:00:00.000Z"),
          dataJson: {},
          filedSnapshotJson: { snapshotVersion: 1 },
        },
      });
      const f = j(await call("portal_bir_form_preview", { id: filed.id }));
      expect(f).toMatchObject({
        ok: false,
        refusals: ["This return is filed. Use Download clear copy."],
      });
    });

    it("the alphalist tools refuse any other form with the Portal's sentence", async () => {
      const d = j(
        await call("portal_create_bir_form_draft", {
          clientId: c.FULL,
          formCode: "1601C",
          year: 2027,
          month: 4,
        }),
      );
      const r = await call("portal_alphalist_check", { id: d.id });
      expect(r.isError).toBe(true);
      expect(text(r)).toContain("The alphalist file is only made for the 1601-EQ.");
    });
  });

  // ======================================================================================
  describe("T4 · expenses, client fields, permissions, audit, tenancy", () => {
    it("a recorded expense carries the payee details and is posted at once", async () => {
      const res = j(
        await call("portal_record_expense", {
          clientId: c.AGENT,
          txnDate: "2026-07-15",
          amount: 50000,
          category: "Rent",
          counterparty: "Juan Dela Cruz",
          atc: "WC158",
          whtAmount: 500,
          vendorTin: "123-456-789",
          vendorBranch: "0",
          payeeKind: "individual",
          payeeLastName: "Dela Cruz",
          payeeFirstName: "Juan",
        }),
      );
      expect(res.transaction).toMatchObject({
        vendorTin: "123-456-789",
        payeeKind: "individual",
        payeeLastName: "Dela Cruz",
        payeeFirstName: "Juan",
        vendorBranch: "0",
        status: "posted",
      });
      const row = await db.purchaseTransaction.findUniqueOrThrow({
        where: { id: res.id },
      });
      expect(row.status).toBe("posted");
      const bad = await call("portal_record_expense", {
        clientId: c.AGENT,
        txnDate: "2026-07-15",
        amount: 1,
        category: "Rent",
        vendorTin: "12",
        payeeKind: "individual",
      });
      expect(bad.isError).toBe(true);
    });

    it("update_expense changes only what is supplied", async () => {
      const e = await buy("AGENT", "2026-07-10", "1000.00", "10.00", "WC158", {
        vendor: "Old Name",
        tin: "123456789",
      });
      const u = j(
        await call("portal_update_expense", {
          id: e.id,
          payeeKind: "non_individual",
          counterparty: "New Name Inc",
        }),
      );
      expect(u.transaction).toMatchObject({
        payeeKind: "non_individual",
        vendor: "New Name Inc",
        vendorTin: "123456789",
      });
      const row = await db.purchaseTransaction.findUniqueOrThrow({ where: { id: e.id } });
      expect(row.atc).toBe("WC158");
      const none = await call("portal_update_expense", { id: e.id });
      expect(none.isError).toBe(true);
    });

    it("portal_update_client sets the fields the needs point at, the fiscal year start included", async () => {
      const u = j(
        await call("portal_update_client", {
          clientId: c.BARE,
          rdo: "045",
          address: "5 Invented Ave",
          zip: "1800",
          fiscalYearStart: "2025-07-01",
        }),
      );
      expect(u.client).toMatchObject({
        rdo: "045",
        address: "5 Invented Ave",
        zip: "1800",
      });
      const row = await db.client.findUniqueOrThrow({ where: { id: c.BARE! } });
      expect(row.fiscalYearStart?.toISOString().slice(0, 10)).toBe("2025-07-01");
      const out = j(
        await call("portal_bir_form_requirements", {
          clientId: c.BARE,
          formCode: "2551Q",
          year: 2026,
          quarter: 1,
        }),
      );
      expect(keys(out.needs)).not.toContain("client.rdo");
    });

    it("every connector write records the usual audit event with source mcp", async () => {
      const d = j(
        await call("portal_create_bir_form_draft", {
          clientId: c.FULL,
          formCode: "1601C",
          year: 2027,
          month: 6,
        }),
      );
      await call("portal_update_bir_form_draft", {
        id: d.id,
        data: { compensation: "1.00" },
      });
      const rows = await db.auditLog.findMany({
        where: {
          action: {
            in: ["mcp.portal_create_bir_form_draft", "mcp.portal_update_bir_form_draft"],
          },
          entityId: d.id,
        },
      });
      expect(rows.map((r) => r.action).sort()).toEqual([
        "mcp.portal_create_bir_form_draft",
        "mcp.portal_update_bir_form_draft",
      ]);
      for (const r of rows)
        expect(r.metadata).toMatchObject({ source: "mcp", actor: "Claude (MCP)" });
      expect(
        await db.auditLog.count({ where: { action: "bir-form.create", entityId: d.id } }),
      ).toBe(1);
    });

    it("another firm's return is not found", async () => {
      const other = await db.firm.create({ data: { name: `${TAG} Other Firm` } });
      const oc = await db.client.create({
        data: { firmId: other.id, businessName: `${TAG} Other`, tin: "999000111" },
      });
      const f = await db.birForm.create({
        data: {
          firmId: other.id,
          clientId: oc.id,
          form: "1601C",
          period: "2026-07",
          dataJson: {},
        },
      });
      for (const [tool, args] of [
        ["portal_get_bir_form", { id: f.id }],
        ["portal_update_bir_form_draft", { id: f.id, data: { compensation: "1" } }],
        ["portal_bir_form_preview", { id: f.id }],
        ["portal_alphalist_check", { id: f.id }],
        [
          "portal_bir_form_requirements",
          { clientId: oc.id, formCode: "1601C", year: 2026, month: 7 },
        ],
        [
          "portal_create_bir_form_draft",
          { clientId: oc.id, formCode: "1601C", year: 2026, month: 8 },
        ],
        ["portal_list_bir_forms", { clientId: oc.id }],
      ] as const) {
        const r = await call(tool, args as Record<string, unknown>);
        expect({ tool, isError: r.isError }).toEqual({ tool, isError: true });
      }
      expect(await db.birForm.count({ where: { clientId: oc.id } })).toBe(1);
    });

    it("the server instructions carry the proactive rules, and every BIR-form tool repeats the key line", async () => {
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
      expect(res.body.result.instructions).toBe(SERVER_INSTRUCTIONS);
      expect(SERVER_INSTRUCTIONS).toContain(
        "Ask the owner every question in `needs` in ONE message",
      );
      const list = await http()
        .post(`${API}/mcp/${SECRET}`)
        .set("Accept", ACCEPT)
        .send({ jsonrpc: "2.0", id: rpc++, method: "tools/list" });
      const tools = list.body.result.tools as Array<{
        name: string;
        description: string;
      }>;
      expect(tools.length).toBe(27); // 17 before, plus 10 new (portal_update_expense among them); record_expense extended
      for (const name of [
        "portal_bir_form_requirements",
        "portal_create_bir_form_draft",
        "portal_update_bir_form_draft",
        "portal_get_bir_form",
      ]) {
        expect(tools.find((t) => t.name === name)!.description).toContain(
          "in ONE message",
        );
      }
    });

    it("a user without the BIR-forms permissions cannot create: the tool defers to the service's check on the acting user", async () => {
      const roleId = (
        await db.role.findUniqueOrThrow({
          where: { name_scope: { name: "Manager", scope: "FIRM" } },
        })
      ).id;
      const mgr = await db.user.create({
        data: {
          firmId,
          userType: "FIRM",
          fullName: `${TAG} unassigned manager`,
          email: `${TAG}-mgr@example.com`,
          status: "ACTIVE",
          firmProfile: { create: { title: "Test" } }, // assigned to no client
          userRoles: { create: { roleId } },
        },
      });
      const server = new McpServer({ name: "t", version: "1" });
      registerBirTools(server, {
        prisma: db,
        audit: app.get(AuditService),
        clients: app.get(ClientsService),
        birForms: app.get(BirFormsService),
        bookFigures: app.get(BookFiguresService),
        alphalists: app.get(AlphalistService),
        getActor: async () => ({
          id: mgr.id,
          firmId,
          userType: "FIRM",
          email: mgr.email,
        }),
      });
      const [a, b] = InMemoryTransport.createLinkedPair();
      const cl = new Client({ name: "t", version: "1" });
      await Promise.all([server.connect(a), cl.connect(b)]);
      const r = (await cl.callTool({
        name: "portal_create_bir_form_draft",
        arguments: { clientId: c.FULL, formCode: "1601C", year: 2028, month: 1 },
      })) as ToolResult;
      expect(r.isError).toBe(true);
      expect(text(r)).toContain("Missing permission");
      expect(
        await db.birForm.count({ where: { clientId: c.FULL, period: "2028-01" } }),
      ).toBe(0);
      const read = (await cl.callTool({
        name: "portal_list_bir_forms",
        arguments: { clientId: c.FULL },
      })) as ToolResult;
      expect(read.isError).toBe(true);
      await cl.close();
      await server.close();
    });
  });
});
