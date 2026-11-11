/**
 * track-a-bir-deadlines.db-spec.ts — PA8 (D70): GET /bir/deadlines over HTTP against the real Nest
 * app and the local PostgreSQL. Who must file which return comes from each client's kind and
 * registered tax types; the status from the returns on file. Every firm, user and client is invented.
 * Dates far from today (the year 2090) keep the tests true on any day; the Manila-date boundary of
 * overdue is tested with the clock stood in for.
 *
 * B1  The answer: shape, order, periods, forms, clients, notes.
 * B2  Who must file what: each path of eligibility, the fiscal year.
 * B3  Status: not_started, draft, filed_bir, filed_override, filed, overdue.
 * B4  Who may see it: BIRForms:Read, client visibility, ACTIVE clients only, one firm.
 * B5  The range and its refusals.
 */
import { randomUUID } from "node:crypto";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { truncateOncePerFile } from "./helpers/truncate";
import { AppModule } from "../../src/app.module";
import { TokenService } from "../../src/auth/token.service";
import { dueDateForReturn } from "../../src/bir-forms/deadlines/due-rules";
import { PrismaService } from "../../src/prisma/prisma.service";
import * as constants from "../../src/projects/projects.constants";

truncateOncePerFile({ firmRoles: ["Super Admin"] });

const TAG = `track-a-bdl-${randomUUID().slice(0, 8)}`;
const API = "/api/v1";
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the tests read JSON
type Json = Record<string, any>;
const missing = (...p: string[]) => `Missing permission(s): ${p.join(", ")}`;
const NOTE =
  "A due date on a Saturday or Sunday moves to Monday. The Portal has no holiday table yet, so public holidays are not considered.";

describe("PA8 · BIR deadlines data (real app over HTTP, db)", () => {
  let app: INestApplication;
  let db: PrismaService;
  let firmId = "";
  let otherFirmId = "";
  const client: Record<string, string> = {};
  const jwt: Record<string, string> = {};

  const http = () => request(app.getHttpServer());
  const get = (query: string, who = "sa") =>
    http()
      .get(`${API}/bir/deadlines?${query}`)
      .set("Authorization", `Bearer ${jwt[who]}`);
  /** All entries of a form in an answer, with the due date. */
  const entries = (body: Json, form: string): Json[] =>
    (body.deadlines as Json[]).flatMap((d) =>
      (d.forms as Json[])
        .filter((f) => f.form === form)
        .map((f): Json => ({ ...f, dueDate: d.dueDate as string })),
    );
  const clientsOf = (e: Json) => (e.clients as Json[]).map((c) => c.clientName);

  async function makeRole(name: string, perms: string[]) {
    const role = await db.role.create({ data: { name, scope: "FIRM", isSystem: false } });
    for (const p of perms) {
      const [resource, action] = p.split(":") as [string, string];
      const permission = await db.permission.upsert({
        where: { resource_action: { resource, action } },
        update: {},
        create: { resource, action },
      });
      await db.rolePermission.create({
        data: { roleId: role.id, permissionId: permission.id },
      });
    }
    return role.id;
  }
  async function makeUser(
    label: string,
    roleId?: string,
    firm?: string,
    assign?: string[],
  ) {
    const fid = firm ?? firmId;
    const u = await db.user.create({
      data: {
        firmId: fid,
        userType: "FIRM",
        fullName: `${TAG} ${label}`,
        email: `${TAG}-${label}@example.com`,
        status: "ACTIVE",
        firmProfile: {
          create: {
            title: "Test",
            ...(assign?.length
              ? { clientAssignments: { create: assign.map((c) => ({ clientId: c })) } }
              : {}),
          },
        },
        ...(roleId ? { userRoles: { create: { roleId } } } : {}),
      },
    });
    jwt[label] = app
      .get(TokenService)
      .signAccess({ id: u.id, firmId: fid, userType: "FIRM", email: u.email });
  }
  const expanded = {
    type: "Withholding Tax - Expanded",
    form: "1601-EQ",
    frequency: "Quarterly",
  };
  const compensation = {
    type: "Withholding Tax - Compensation",
    form: "1601-C",
    frequency: "Monthly",
  };
  async function makeClient(key: string, name: string, data: Json = {}, firm?: string) {
    client[key] = (
      await db.client.create({
        data: {
          firmId: firm ?? firmId,
          businessName: `${TAG} ${name}`,
          tin: `00099${String(Object.keys(client).length).padStart(4, "0")}`,
          ...data,
        },
      })
    ).id;
    return client[key]!;
  }
  async function filed(
    clientId: string,
    form: string,
    period: string,
    confirmation?: "bir_email" | "override",
  ) {
    const row = await db.birForm.create({
      data: {
        firmId,
        clientId,
        form,
        period,
        status: "filed",
        filedAt: new Date("2090-01-01T00:00:00Z"),
      },
    });
    if (confirmation) {
      await db.birFormConfirmation.create({
        data: {
          firmId,
          birFormId: row.id,
          kind: confirmation,
          ...(confirmation === "override"
            ? { overrideReason: "The BIR e-mail was lost." }
            : { sha256: randomUUID().replace(/-/g, "") }),
        },
      });
    }
    return row.id;
  }
  async function draft(clientId: string, form: string, period: string) {
    return (
      await db.birForm.create({
        data: { firmId, clientId, form, period, status: "draft" },
      })
    ).id;
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix("api/v1");
    await app.init();
    db = app.get(PrismaService);
    firmId = (await db.firm.create({ data: { name: `${TAG} Halimbawa Accounting` } })).id;
    otherFirmId = (await db.firm.create({ data: { name: `${TAG} Ibang Accounting` } }))
      .id;
    const sa = (
      await db.role.findUniqueOrThrow({
        where: { name_scope: { name: "Super Admin", scope: "FIRM" } },
      })
    ).id;
    const reader = await makeRole(`${TAG} BDL Reader`, ["BIRForms:Read"]);
    const noBir = await makeRole(`${TAG} BDL NoBir`, ["Projects:Read"]);

    await makeClient("vat", "Alpha VAT Corp", {
      kind: "non-individual",
      taxType: "VAT",
      taxTypesJson: [expanded, compensation],
    });
    await makeClient("pct", "Ben Percentage", {
      kind: "individual",
      taxType: "PERCENTAGE",
      taxTypesJson: [],
    });
    await makeClient("fy", "Fiscal Corp", {
      kind: "non-individual",
      taxType: null,
      fiscalYearStart: new Date("2024-07-01T00:00:00Z"),
    });
    await makeClient("bare", "Bare Corp", {
      kind: "non-individual",
      taxType: null,
      taxTypesJson: [],
    });
    await makeClient("archived", "Archived Corp", {
      kind: "non-individual",
      taxType: "VAT",
      status: "ARCHIVED",
    });
    await makeClient(
      "other",
      "Other Firm Corp",
      { kind: "non-individual", taxType: "VAT" },
      otherFirmId,
    );

    await makeUser("sa", sa);
    await makeUser("sa2", sa, otherFirmId);
    await makeUser("reader", reader); // BIRForms:Read, sees no client
    await makeUser("readerAssigned", reader, undefined, [client.vat!]);
    await makeUser("noBir", noBir);
  });
  afterAll(async () => {
    jest.restoreAllMocks();
    await app.close();
  });

  // ======================================================================================
  describe("B1 · the answer", () => {
    it("has due dates in order, each with its forms, the period they cover and the clients who must file", async () => {
      const res = await get("from=2090-01&to=2090-12");
      expect(res.status).toBe(200);
      expect(Object.keys(res.body).sort()).toEqual([
        "deadlines",
        "from",
        "missing",
        "notes",
        "to",
        "today",
      ]);
      expect(res.body).toMatchObject({ from: "2090-01", to: "2090-12" });
      expect(res.body.today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(res.body.notes).toContain(NOTE);
      const dates = (res.body.deadlines as Json[]).map((d) => d.dueDate);
      expect(dates).toEqual([...dates].sort());
      expect(new Set(dates).size).toBe(dates.length);
      for (const d of res.body.deadlines as Json[]) {
        expect(d.dueDate.slice(0, 4)).toBe("2090");
        expect(d.forms.length).toBeGreaterThan(0);
        for (const f of d.forms as Json[]) {
          expect(Object.keys(f).sort()).toEqual([
            "alternatives",
            "clients",
            "form",
            "period",
            "periodWords",
            "title",
          ]);
          expect(f.clients.length).toBeGreaterThan(0);
          for (const c of f.clients as Json[]) {
            expect(Object.keys(c).sort()).toEqual([
              "birFormId",
              "clientId",
              "clientName",
              "status",
            ]);
          }
        }
      }
      const q = entries(res.body, "2550Q").find((e) => e.period === "2090-Q1")!;
      expect(q.dueDate).toBe(dueDateForReturn("2550Q", "2090-Q1", null));
      expect(q.periodWords).toBe("Q1 2090");
      expect(q.title).toBe("Quarterly Value-Added Tax Return");
    });

    it("lists a due date in the month it falls in, after the weekend move", async () => {
      const a = await get("from=2090-04&to=2090-04");
      const dates = (a.body.deadlines as Json[]).map((d) => d.dueDate as string);
      expect(dates.length).toBeGreaterThan(0);
      for (const d of dates) expect(d.slice(0, 7)).toBe("2090-04");
    });

    it("an empty range is an empty list, not an error", async () => {
      const res = await get("from=2090-01&to=2090-01");
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.deadlines)).toBe(true);
    });
  });

  // ======================================================================================
  describe("B2 · who must file what", () => {
    let year: Json;
    beforeAll(async () => {
      year = (await get("from=2090-01&to=2091-04")).body; // 16 months: every form falls in it
    });
    it("VAT: the 2550Q; percentage tax: the 2551Q", () => {
      expect(clientsOf(entries(year, "2550Q")[0]!)).toContain(`${TAG} Alpha VAT Corp`);
      const allVat = entries(year, "2550Q").flatMap(clientsOf);
      expect(allVat).not.toContain(`${TAG} Ben Percentage`);
      expect(entries(year, "2551Q").flatMap(clientsOf)).toEqual(
        expect.arrayContaining([`${TAG} Ben Percentage`]),
      );
      expect(entries(year, "2551Q").flatMap(clientsOf)).not.toContain(
        `${TAG} Alpha VAT Corp`,
      );
    });
    it("expanded withholding: 0619E (months 1 and 2), 1601EQ, 2307 and 1604E", () => {
      for (const form of ["0619E", "1601EQ", "2307", "1604E"]) {
        expect(entries(year, form).flatMap(clientsOf)).toContain(`${TAG} Alpha VAT Corp`);
      }
      const months = entries(year, "0619E").map((e) => e.period.slice(5));
      expect(months.length).toBeGreaterThan(0);
      expect(months.every((m: string) => Number(m) % 3 !== 0)).toBe(true);
    });
    it("compensation withholding: 1601C every month, then 1604C and 2316", () => {
      for (const form of ["1601C", "1604C", "2316"]) {
        expect(entries(year, form).flatMap(clientsOf)).toContain(`${TAG} Alpha VAT Corp`);
      }
      expect(new Set(entries(year, "1601C").map((e) => e.period)).size).toBe(
        entries(year, "1601C").length,
      );
    });
    it("a December 1601C is due on 15 January of the next year", () => {
      const dec = entries(year, "1601C").find((e) => e.period === "2090-12")!;
      expect(dec.dueDate).toBe(dueDateForReturn("1601C", "2090-12", null));
      expect(dec.dueDate.slice(0, 7)).toBe("2091-01");
    });
    it("an individual: 1701Q and one annual row that also stands for the 1701A", () => {
      const names = (form: string) => entries(year, form).flatMap(clientsOf);
      expect(names("1701Q")).toContain(`${TAG} Ben Percentage`);
      expect(names("1701")).toContain(`${TAG} Ben Percentage`);
      expect(
        entries(year, "1701").every(
          (e) => e.alternatives.length === 1 && e.alternatives[0] === "1701A",
        ),
      ).toBe(true);
      expect(entries(year, "1701A")).toEqual([]);
      expect(names("1702Q")).not.toContain(`${TAG} Ben Percentage`);
    });
    it("a corporation: 1702Q (three quarters) and 1702RT", () => {
      expect(entries(year, "1702Q").flatMap(clientsOf)).toContain(
        `${TAG} Alpha VAT Corp`,
      );
      expect(entries(year, "1702RT").flatMap(clientsOf)).toContain(
        `${TAG} Alpha VAT Corp`,
      );
      expect(
        entries(year, "1702Q")
          .map((e) => e.period.slice(-1))
          .every((q: string) => q !== "4"),
      ).toBe(true);
      expect(entries(year, "1701Q").flatMap(clientsOf)).not.toContain(
        `${TAG} Alpha VAT Corp`,
      );
    });
    it("the fiscal year decides the 1702RT, 1702Q and 2550Q of a fiscal-year client, and nothing else", async () => {
      const res = (await get("from=2090-01&to=2091-12")).body;
      const rt = entries(res, "1702RT").filter((e) =>
        clientsOf(e).includes(`${TAG} Fiscal Corp`),
      );
      // a July to June year named 2090 ends 30 June 2090: due the 15th of the 4th month after, October
      const fy2090 = rt.find((e) => e.period === "2090")!;
      expect(fy2090.dueDate).toBe(dueDateForReturn("1702RT", "2090", "2024-07-01"));
      expect(fy2090.dueDate.slice(0, 7)).toBe("2090-10");
      const cal = entries(res, "1702RT").find(
        (e) => e.period === "2090" && clientsOf(e).includes(`${TAG} Alpha VAT Corp`),
      )!;
      expect(cal.dueDate.slice(0, 7)).toBe("2091-04");
      expect(cal.dueDate).not.toBe(fy2090.dueDate);
    });
    it("a client with nothing registered is listed only for its kind's income tax, and reported as missing", async () => {
      const res = (await get("from=2090-01&to=2091-12")).body;
      const bare = `${TAG} Bare Corp`;
      const forms = new Set(
        (res.deadlines as Json[]).flatMap((d) =>
          (d.forms as Json[])
            .filter((f) => clientsOf(f).includes(bare))
            .map((f) => f.form),
        ),
      );
      expect([...forms].sort()).toEqual(["1702Q", "1702RT"]);
      const m = (res.missing as Json[]).find((x) => x.clientId === client.bare)!;
      expect(m.clientName).toBe(bare);
      expect(m.missing.map((x: Json) => x.field)).toEqual([
        "taxType",
        "taxTypes",
        "fiscalYearStart",
      ]);
      // the VAT corporation lacks only a fiscal year start (the calendar year is assumed)
      const vat = (res.missing as Json[]).find((x) => x.clientId === client.vat)!;
      expect(vat.missing.map((x: Json) => x.field)).toEqual(["fiscalYearStart"]);
      // the fiscal-year corporation lacks the tax types
      const fy = (res.missing as Json[]).find((x) => x.clientId === client.fy)!;
      expect(fy.missing.map((x: Json) => x.field)).toEqual(["taxType", "taxTypes"]);
      // the individual with percentage tax lacks only the registered tax types
      const pct = (res.missing as Json[]).find((x) => x.clientId === client.pct)!;
      expect(pct.missing.map((x: Json) => x.field)).toEqual(["taxTypes"]);
    });
  });

  // ======================================================================================
  describe("B3 · status", () => {
    const status = (body: Json, form: string, period: string, who: string) => {
      const e = entries(body, form).find((x) => x.period === period)!;
      return (e.clients as Json[]).find((c) => c.clientId === client[who]);
    };
    it("not_started, draft, filed_bir, filed_override and filed (1601C), with the birFormId of the return", async () => {
      const dDraft = await draft(client.vat!, "2550Q", "2090-Q1");
      const dBir = await filed(client.vat!, "2550Q", "2090-Q2", "bir_email");
      const dOverride = await filed(client.vat!, "1601EQ", "2090-Q1", "override");
      const dPlain = await filed(client.vat!, "1601C", "2090-02");
      const body = (await get("from=2090-01&to=2091-04")).body;
      expect(status(body, "2550Q", "2090-Q1", "vat")).toMatchObject({
        status: "draft",
        birFormId: dDraft,
      });
      expect(status(body, "2550Q", "2090-Q2", "vat")).toMatchObject({
        status: "filed_bir",
        birFormId: dBir,
      });
      expect(status(body, "1601EQ", "2090-Q1", "vat")).toMatchObject({
        status: "filed_override",
        birFormId: dOverride,
      });
      expect(status(body, "1601C", "2090-02", "vat")).toMatchObject({
        status: "filed",
        birFormId: dPlain,
      });
      expect(status(body, "2550Q", "2090-Q3", "vat")).toMatchObject({
        status: "not_started",
        birFormId: null,
      });
    });
    it("a return of another client, or of another period, does not count", async () => {
      await filed(client.pct!, "2550Q", "2090-Q4", "bir_email");
      const body = (await get("from=2090-01&to=2091-04")).body;
      expect(status(body, "2550Q", "2090-Q4", "vat")!.status).toBe("not_started");
    });
    it("a 1701A return stands for the 1701 row", async () => {
      const id = await filed(client.pct!, "1701A", "2090", "bir_email");
      const body = (await get("from=2090-01&to=2091-04")).body;
      expect(status(body, "1701", "2090", "pct")).toMatchObject({
        status: "filed_bir",
        birFormId: id,
      });
    });
    it("overdue: a due date in the past and nothing filed, with or without a draft; a filed return never", async () => {
      const dLate = await draft(client.vat!, "2550Q", "2020-Q1");
      await filed(client.vat!, "2550Q", "2020-Q2", "bir_email");
      const body = (await get("from=2020-01&to=2020-12")).body;
      expect(status(body, "2550Q", "2020-Q1", "vat")).toMatchObject({
        status: "overdue",
        birFormId: dLate,
      });
      expect(status(body, "2550Q", "2020-Q2", "vat")!.status).toBe("filed_bir");
      expect(status(body, "2550Q", "2020-Q3", "vat")).toMatchObject({
        status: "overdue",
        birFormId: null,
      });
    });
    it("overdue is by the Manila date: the due date itself is not late, the day after is", async () => {
      const due = dueDateForReturn("2550Q", "2091-Q1", null)!;
      const next = new Date(Date.parse(`${due}T00:00:00Z`) + 86_400_000)
        .toISOString()
        .slice(0, 10);
      const month = due.slice(0, 7);
      const spy = jest.spyOn(constants, "manilaToday");
      try {
        spy.mockReturnValue(due);
        expect(
          status(
            (await get(`from=${month}&to=${month}`)).body,
            "2550Q",
            "2091-Q1",
            "vat",
          )!.status,
        ).toBe("not_started");
        spy.mockReturnValue(next);
        expect(
          status(
            (await get(`from=${month}&to=${month}`)).body,
            "2550Q",
            "2091-Q1",
            "vat",
          )!.status,
        ).toBe("overdue");
      } finally {
        spy.mockRestore();
      }
    });
  });

  // ======================================================================================
  describe("B4 · who may see it", () => {
    it("BIRForms:Read is needed; a person with the permission but no client sees an empty list", async () => {
      const denied = await get("from=2090-01&to=2090-03", "noBir");
      expect(denied.status).toBe(403);
      expect(denied.body.message).toBe(missing("BIRForms:Read"));
      const empty = await get("from=2090-01&to=2090-12", "reader");
      expect(empty.status).toBe(200);
      expect(empty.body.deadlines).toEqual([]);
      expect(empty.body.missing).toEqual([]);
    });
    it("a person sees the clients they are assigned to and no others", async () => {
      const res = await get("from=2090-01&to=2091-04", "readerAssigned");
      expect(res.status).toBe(200);
      const names = new Set(
        (res.body.deadlines as Json[]).flatMap((d) =>
          (d.forms as Json[]).flatMap(clientsOf),
        ),
      );
      expect([...names]).toEqual([`${TAG} Alpha VAT Corp`]);
    });
    it("only ACTIVE clients, and only the firm's own", async () => {
      const res = await get("from=2090-01&to=2091-04");
      const names = new Set(
        (res.body.deadlines as Json[]).flatMap((d) =>
          (d.forms as Json[]).flatMap(clientsOf),
        ),
      );
      expect(names.has(`${TAG} Archived Corp`)).toBe(false);
      expect(names.has(`${TAG} Other Firm Corp`)).toBe(false);
      const other = await get("from=2090-01&to=2091-04", "sa2");
      const others = new Set(
        (other.body.deadlines as Json[]).flatMap((d) =>
          (d.forms as Json[]).flatMap(clientsOf),
        ),
      );
      expect([...others]).toEqual([`${TAG} Other Firm Corp`]);
    });
    it("no sign-in is a 401", async () => {
      expect(
        (await http().get(`${API}/bir/deadlines?from=2090-01&to=2090-03`)).status,
      ).toBe(401);
    });
  });

  // ======================================================================================
  describe("B5 · the range", () => {
    it.each([
      ["", "from and to must be months written YYYY-MM."],
      ["from=2090-01", "from and to must be months written YYYY-MM."],
      ["to=2090-01", "from and to must be months written YYYY-MM."],
      ["from=2090-1&to=2090-03", "from and to must be months written YYYY-MM."],
      ["from=2090-13&to=2090-14", "from and to must be months written YYYY-MM."],
      ["from=2090-01-01&to=2090-03", "from and to must be months written YYYY-MM."],
      ["from=1999-12&to=2000-01", "from and to must be months written YYYY-MM."],
      ["from=2090-05&to=2090-04", "from cannot be after to."],
      ["from=2090-01&to=2092-01", "The range can be at most 24 months."],
    ])("%s is refused: %s", async (query, message) => {
      const res = await get(query);
      expect(res.status).toBe(400);
      expect(res.body.message).toBe(message);
    });
    it("24 months are allowed", async () => {
      expect((await get("from=2090-01&to=2091-12")).status).toBe(200);
    });
  });
});
