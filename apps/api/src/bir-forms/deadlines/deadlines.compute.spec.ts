// deadlines.compute.spec.ts — PA8 (D70): the deadlines answer, from clients and returns, with no database.
import { computeDeadlines, type ReturnRecord } from "./deadlines.compute";
import type { DeadlineClient } from "./eligibility";

const corp = (over: Partial<DeadlineClient> = {}): DeadlineClient => ({
  id: "c-corp",
  name: "Alpha Corp",
  kind: "non-individual",
  taxType: "VAT",
  taxTypesJson: [],
  fiscalYearStart: "2024-01-01",
  ...over,
});
const person = (over: Partial<DeadlineClient> = {}): DeadlineClient => ({
  id: "c-person",
  name: "Ben Person",
  kind: "individual",
  taxType: "PERCENTAGE",
  taxTypesJson: [],
  fiscalYearStart: null,
  ...over,
});
const ret = (over: Partial<ReturnRecord>): ReturnRecord => ({
  id: "r1",
  clientId: "c-corp",
  form: "2550Q",
  period: "2026-Q3",
  status: "draft",
  sequence: 1,
  createdAt: "2026-10-01T00:00:00.000Z",
  confirmation: null,
  ...over,
});
const run = (
  clients: DeadlineClient[],
  returns: ReturnRecord[],
  from: string,
  to: string,
  today = "2026-10-01",
) => computeDeadlines({ clients, returns, from, to, today });

/** The clients of one form's entry on one due date. */
function entry(r: ReturnType<typeof run>, due: string, form: string, period?: string) {
  const day = r.deadlines.find((d) => d.dueDate === due);
  return day?.forms.find((f) => f.form === form && (!period || f.period === period));
}

describe("computeDeadlines: the shape and the order", () => {
  it("lists due dates in order, each with its forms, the period each covers and the clients", () => {
    const r = run([corp()], [], "2026-10", "2026-11");
    expect(r.deadlines.map((d) => d.dueDate)).toEqual(["2026-10-26", "2026-11-30"]);
    expect(r.deadlines[0]!.forms).toEqual([
      expect.objectContaining({
        form: "2550Q",
        alternatives: [],
        period: "2026-Q3",
        periodWords: "Q3 2026",
        clients: [
          {
            clientId: "c-corp",
            clientName: "Alpha Corp",
            status: "not_started",
            birFormId: null,
          },
        ],
      }),
    ]);
    // 1702Q for Q3 is due 30 Nov 2026 (29 Nov is a Sunday)
    expect(r.deadlines[1]!.forms.map((f) => f.form)).toEqual(["1702Q"]);
  });
  it("the range is by month of the due date, both ends included, and an empty month is not listed", () => {
    const r = run([corp()], [], "2026-10", "2026-10");
    expect(r.deadlines.map((d) => d.dueDate)).toEqual(["2026-10-26"]);
    expect(run([corp()], [], "2026-09", "2026-09").deadlines).toEqual([]);
  });
  it("a due date moved by the weekend belongs to the month it lands in", () => {
    // 1601EQ Q3 2026: 31 Oct is a Saturday, so 2 Nov
    const c = corp({
      taxType: null,
      taxTypesJson: [{ type: "Withholding Tax - Expanded" }],
    });
    expect(
      entry(run([c], [], "2026-10", "2026-10"), "2026-11-02", "1601EQ"),
    ).toBeUndefined();
    expect(
      entry(run([c], [], "2026-11", "2026-11"), "2026-11-02", "1601EQ"),
    ).toBeDefined();
  });
  it("one form entry holds every client who must file it, by name", () => {
    const r = run(
      [corp({ id: "b", name: "Beta Inc" }), corp({ id: "a", name: "Alpha Corp" })],
      [],
      "2026-10",
      "2026-10",
    );
    expect(entry(r, "2026-10-26", "2550Q")!.clients.map((c) => c.clientName)).toEqual([
      "Alpha Corp",
      "Beta Inc",
    ]);
  });
  it("clients with different fiscal years have separate entries for the same form", () => {
    const r = run(
      [
        corp({ id: "cal" }),
        corp({ id: "fy", name: "Fiscal Co", fiscalYearStart: "2024-07-01" }),
      ],
      [],
      "2026-01",
      "2026-12",
    );
    const dueDates = r.deadlines
      .filter((d) => d.forms.some((f) => f.form === "1702RT"))
      .map((d) => d.dueDate);
    expect(dueDates).toEqual(["2026-04-15", "2026-10-15"]); // calendar 2025 and July-June 2026
  });
});

describe("computeDeadlines: eligibility paths", () => {
  it("lists nothing for a client with no registrations except the income tax of its kind", () => {
    const r = run([corp({ taxType: null })], [], "2026-01", "2026-12");
    const forms = new Set(r.deadlines.flatMap((d) => d.forms.map((f) => f.form)));
    expect([...forms].sort()).toEqual(["1702Q", "1702RT"]);
  });
  it("an individual: percentage tax, 1701Q and one annual row", () => {
    const r = run([person()], [], "2026-01", "2026-12");
    const forms = new Set(r.deadlines.flatMap((d) => d.forms.map((f) => f.form)));
    expect([...forms].sort()).toEqual(["1701", "1701Q", "2551Q"]);
    const annual = entry(r, "2026-04-15", "1701")!;
    expect(annual.alternatives).toEqual(["1701A"]);
    expect(annual.period).toBe("2025");
  });
  it("the compensation path lists the 1601C every month and the annual 1604C and 2316", () => {
    const c = corp({
      taxType: null,
      kind: "individual",
      taxTypesJson: [{ type: "Withholding Tax - Compensation" }],
    });
    const r = run([c], [], "2026-01", "2026-12");
    const c1601 = r.deadlines.flatMap((d) => d.forms).filter((f) => f.form === "1601C");
    expect(c1601).toHaveLength(12); // periods 2025-12 (due 15 Jan 2026) to 2026-11
    expect(entry(r, "2026-01-15", "1601C", "2025-12")).toBeDefined();
    expect(entry(r, "2026-02-02", "1604C", "2025")).toBeDefined();
    expect(entry(r, "2026-02-02", "2316", "2025")).toBeDefined();
  });
  it("the expanded path lists 0619E (months 1 and 2), 1601EQ, 2307 and 1604E", () => {
    const c = corp({
      taxType: null,
      kind: "individual",
      taxTypesJson: [{ type: "Withholding Tax - Expanded" }],
    });
    const r = run([c], [], "2026-04", "2026-05");
    expect(entry(r, "2026-04-20", "2307", "2026-Q1")).toBeDefined();
    expect(entry(r, "2026-04-30", "1601EQ", "2026-Q1")).toBeDefined();
    expect(entry(r, "2026-05-11", "0619E", "2026-04")).toBeDefined();
    expect(
      run([c], [], "2026-03", "2026-03")
        .deadlines.flatMap((d) => d.forms)
        .map((f) => f.form),
    ).toContain("1604E");
    // no 0619E for the third month of a quarter (the 1601EQ covers it)
    expect(
      run([c], [], "2026-04", "2026-04")
        .deadlines.flatMap((d) => d.forms)
        .filter((f) => f.form === "0619E" && f.period === "2026-03"),
    ).toEqual([]);
  });
});

describe("computeDeadlines: status", () => {
  const find = (r: ReturnType<typeof run>) =>
    entry(r, "2026-10-26", "2550Q")!.clients[0]!;
  it("not_started: no return and the due date has not passed", () => {
    expect(find(run([corp()], [], "2026-10", "2026-10", "2026-10-01"))).toMatchObject({
      status: "not_started",
      birFormId: null,
    });
  });
  it("draft: a draft exists and the due date has not passed; the id is given", () => {
    expect(find(run([corp()], [ret({})], "2026-10", "2026-10"))).toMatchObject({
      status: "draft",
      birFormId: "r1",
    });
  });
  it("filed_bir: filed with the BIR e-mail attached", () => {
    expect(
      find(
        run(
          [corp()],
          [ret({ status: "filed", confirmation: "bir_email" })],
          "2026-10",
          "2026-10",
        ),
      ),
    ).toMatchObject({ status: "filed_bir", birFormId: "r1" });
  });
  it("filed_override: filed by a Super Admin without the e-mail", () => {
    expect(
      find(
        run(
          [corp()],
          [ret({ status: "filed", confirmation: "override" })],
          "2026-10",
          "2026-10",
        ),
      ),
    ).toMatchObject({ status: "filed_override" });
  });
  it("filed: a form that files without the e-mail (1601C) and a filing with no confirmation on record", () => {
    const c = corp({
      taxType: null,
      taxTypesJson: [{ type: "Withholding Tax - Compensation" }],
    });
    const r = run(
      [c],
      [ret({ form: "1601C", period: "2026-09", status: "filed" })],
      "2026-10",
      "2026-10",
    );
    expect(entry(r, "2026-10-12", "1601C")!.clients[0]).toMatchObject({
      status: "filed",
    }); // 10 Oct is a Saturday
    expect(
      find(
        run(
          [corp()],
          [ret({ status: "filed", confirmation: null })],
          "2026-10",
          "2026-10",
        ),
      ),
    ).toMatchObject({ status: "filed" });
  });
  it("overdue: the due date is before today (Manila) and the return is not filed, with or without a draft", () => {
    expect(find(run([corp()], [], "2026-10", "2026-10", "2026-10-27"))).toMatchObject({
      status: "overdue",
      birFormId: null,
    });
    expect(
      find(run([corp()], [ret({})], "2026-10", "2026-10", "2026-10-27")),
    ).toMatchObject({ status: "overdue", birFormId: "r1" });
  });
  it("the due date itself is not overdue", () => {
    expect(find(run([corp()], [], "2026-10", "2026-10", "2026-10-26")).status).toBe(
      "not_started",
    );
    expect(find(run([corp()], [], "2026-10", "2026-10", "2026-10-27")).status).toBe(
      "overdue",
    );
  });
  it("a filed return is never overdue", () => {
    expect(
      find(
        run(
          [corp()],
          [ret({ status: "filed", confirmation: "bir_email" })],
          "2026-10",
          "2026-10",
          "2027-01-01",
        ),
      ).status,
    ).toBe("filed_bir");
  });
  it("an amendment: the latest filed return counts, and a newer draft does not undo the filing", () => {
    const rows = [
      ret({ id: "orig", status: "filed", confirmation: "bir_email", sequence: 1 }),
      ret({ id: "amend", status: "draft", sequence: 2 }),
    ];
    expect(find(run([corp()], rows, "2026-10", "2026-10"))).toMatchObject({
      status: "filed_bir",
      birFormId: "orig",
    });
  });
  it("a return of the 1701A counts for the 1701 row", () => {
    const r = run(
      [person()],
      [
        ret({
          clientId: "c-person",
          form: "1701A",
          period: "2025",
          status: "filed",
          confirmation: "bir_email",
          id: "a1",
        }),
      ],
      "2026-04",
      "2026-04",
      "2026-04-01",
    );
    expect(entry(r, "2026-04-15", "1701")!.clients[0]).toMatchObject({
      status: "filed_bir",
      birFormId: "a1",
    });
  });
  it("another client's return does not count", () => {
    const rows = [
      ret({ clientId: "someone-else", status: "filed", confirmation: "bir_email" }),
    ];
    expect(find(run([corp()], rows, "2026-10", "2026-10")).status).toBe("not_started");
  });
});

describe("computeDeadlines: notes and missing information", () => {
  it("always carries the weekend and holiday note", () => {
    expect(run([], [], "2026-10", "2026-10").notes).toContain(
      "A due date on a Saturday or Sunday moves to Monday. The Portal has no holiday table yet, so public holidays are not considered.",
    );
  });
  it("reports what the client record lacks, once per client", () => {
    const r = run(
      [corp({ taxType: null, fiscalYearStart: null })],
      [],
      "2026-10",
      "2026-10",
    );
    expect(r.missing).toEqual([
      {
        clientId: "c-corp",
        clientName: "Alpha Corp",
        missing: [
          {
            field: "taxType",
            sentence:
              "The business tax (VAT or percentage tax) is not set, so the 2550Q or 2551Q cannot be listed.",
          },
          {
            field: "taxTypes",
            sentence:
              "No registered tax types, so the withholding returns cannot be listed.",
          },
          {
            field: "fiscalYearStart",
            sentence:
              "The fiscal year start is not set; the calendar year is assumed for the 2550Q, 1702Q and 1702RT.",
          },
        ],
      },
    ]);
  });
  it("a complete client is not in missing", () => {
    expect(
      run(
        [corp({ taxTypesJson: [{ type: "Withholding Tax - Expanded" }] })],
        [],
        "2026-10",
        "2026-10",
      ).missing,
    ).toEqual([]);
  });
});
