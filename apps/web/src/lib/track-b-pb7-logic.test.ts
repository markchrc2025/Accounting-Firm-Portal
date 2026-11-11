// track-b-pb7-logic.test.ts - PB7: the fee box rules, the client suggestions, the recurrence
// preview (from projects-core), the routes, and the BIR deadlines filters, chips and counts.
// All data is invented.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CHIP_LABEL,
  CHIP_OF,
  fetchBirDeadlines,
  filterChoices,
  filterDeadlines,
  isFiled,
  monthOf,
  nextMonth,
  type DeadlineDay,
} from "./birDeadlines";
import {
  clientSuggestions,
  dayBefore,
  feeForBox,
  feeText,
  feeToSend,
  feeTypingOk,
  fetchClientMatches,
  fetchProjects,
  fetchRecurrencePreview,
  isListedName,
  NOT_LISTED_NOTE,
  RECURRENCE_END_HINT,
  RECURRING_LINE,
} from "./projects";
import { FREQUENCIES, FREQUENCY_LABELS, previewDates, sameSchedule } from "./recurrence";

describe("PB7 the fee box", () => {
  it("takes digits and at most one point with 2 decimals while typing", () => {
    for (const ok of ["", "0", "3500", "3500.", "3500.5", "3500.50", "0.99"])
      expect(feeTypingOk(ok)).toBe(true);
  });
  it("refuses a minus sign, letters, a comma, a third decimal, two points, spaces", () => {
    for (const bad of [
      "-1",
      "1e3",
      "abc",
      "3,500",
      "3500.555",
      "1.2.3",
      " 12",
      "12 ",
      "₱12",
    ])
      expect(feeTypingOk(bad)).toBe(false);
  });
  it("sends null for an empty box and drops a trailing point", () => {
    expect(feeToSend("")).toBeNull();
    expect(feeToSend("  ")).toBeNull();
    expect(feeToSend("3500.")).toBe("3500");
    expect(feeToSend("3500.5")).toBe("3500.5");
  });
  it("shows a fee as 3,500.00, and puts the API's fee in the box as plain digits", () => {
    expect(feeText("3500.00")).toBe("3,500.00");
    expect(feeText(1234567.5)).toBe("1,234,567.50");
    expect(feeText(null)).toBe("");
    expect(feeForBox("3500.00")).toBe("3500.00");
    expect(feeForBox(3500)).toBe("3500.00");
    expect(feeForBox(null)).toBe("");
    expect(feeForBox("x")).toBe("");
  });
});

describe("PB7 the client suggestions", () => {
  const list = [
    { id: "1", businessName: "INVENTED ALPHA TRADING" },
    { id: "2", businessName: "BETA ALPHA FOODS" },
    { id: "3", businessName: "GAMMA SERVICES" },
  ];
  it("puts names that start with what was typed first, then those that contain it", () => {
    expect(clientSuggestions(list, "alpha").map((c) => c.id)).toEqual(["1", "2"]);
    expect(clientSuggestions(list, "beta").map((c) => c.id)).toEqual(["2"]);
    expect(clientSuggestions(list, "ALPHA").map((c) => c.id)).toEqual(["1", "2"]);
    expect(clientSuggestions(list, "beta a").map((c) => c.id)).toEqual(["2"]);
    expect(clientSuggestions(list, "a").map((c) => c.id)).toEqual(["1", "2", "3"]);
    expect(clientSuggestions(list, "inv").map((c) => c.id)).toEqual(["1"]);
    expect(clientSuggestions(list, "foods").map((c) => c.id)).toEqual(["2"]);
  });
  it("lists every client (up to the limit) for an empty box", () => {
    expect(clientSuggestions(list, "", 2).map((c) => c.id)).toEqual(["1", "2"]);
  });
  it("knows a listed name, ignoring case and outer spaces", () => {
    expect(isListedName(list, " gamma services ")).toBe(true);
    expect(isListedName(list, "gamma")).toBe(false);
    expect(isListedName(list, "")).toBe(false);
  });
  it("says the owner's words", () => {
    expect(NOT_LISTED_NOTE).toBe("Not in your client list");
    expect(RECURRING_LINE).toBe(
      "Each date creates a task in this project, due that day.",
    );
    expect(RECURRENCE_END_HINT).toBe("Leave blank for no end date");
  });
});

describe("PB7 the recurrence preview (projects-core)", () => {
  it("offers the six frequencies with projects-core's words", () => {
    expect([...FREQUENCIES]).toEqual([
      "DAILY",
      "WEEKLY",
      "BI_WEEKLY",
      "MONTHLY",
      "QUARTERLY",
      "ANNUALLY",
    ]);
    expect(FREQUENCY_LABELS.BI_WEEKLY).toBe("Bi-Weekly");
  });
  it("the next 5 dates from today (today included), with no end", () => {
    const s = { on: true, start: "2026-01-15", end: "", frequency: "MONTHLY" as const };
    expect(previewDates(s, "2026-11-15")).toEqual({
      dates: ["2026-11-15", "2026-12-15", "2027-01-15", "2027-02-15", "2027-03-15"],
      problems: [],
    });
  });
  it("stops at the end date", () => {
    const s = {
      on: true,
      start: "2026-11-02",
      end: "2026-11-20",
      frequency: "WEEKLY" as const,
    };
    expect(previewDates(s, "2026-11-10").dates).toEqual(["2026-11-16"]);
  });
  it("says what is missing: a start date, or an end before the start", () => {
    expect(
      previewDates({ on: true, start: "", end: "", frequency: "DAILY" }, "2026-11-10")
        .problems,
    ).toEqual(["Choose a start date for the recurring project."]);
    expect(
      previewDates(
        { on: true, start: "2026-11-10", end: "2026-11-01", frequency: "DAILY" },
        "2026-11-10",
      ).problems,
    ).toEqual(["The end date cannot be before the start date."]);
  });
  it("knows when the form's schedule is the saved one", () => {
    const a = { on: true, start: "2026-01-01", end: "", frequency: "MONTHLY" as const };
    expect(sameSchedule(a, { ...a })).toBe(true);
    expect(sameSchedule(a, { ...a, end: "2026-12-31" })).toBe(false);
  });
  it("the day before a date, across a month and a year", () => {
    expect(dayBefore("2026-03-01")).toBe("2026-02-28");
    expect(dayBefore("2027-01-01")).toBe("2026-12-31");
  });
});

describe("PB7 the routes", () => {
  let urls: string[] = [];
  beforeEach(() => {
    urls = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) => {
        urls.push(String(url).replace(/^.*\/api\/v1/, ""));
        return Promise.resolve(new Response("{}", { status: 200 }));
      }),
    );
  });
  afterEach(() => vi.unstubAllGlobals());
  it("asks for the portfolio by category, client matches, the preview and the deadlines", async () => {
    await fetchProjects(false, "cat-1");
    await fetchProjects(true, "none");
    await fetchProjects(false);
    await fetchClientMatches("PAY");
    await fetchRecurrencePreview("PAY");
    await fetchBirDeadlines("2026-11", "2026-12");
    expect(urls).toEqual([
      "/projects?categoryId=cat-1",
      "/projects?includeArchived=true&categoryId=none",
      "/projects",
      "/projects/PAY/client-matches",
      "/projects/PAY/recurrence-preview?count=5",
      "/bir/deadlines?from=2026-11&to=2026-12",
    ]);
  });
});

const DAYS: DeadlineDay[] = [
  {
    dueDate: "2026-11-10",
    forms: [
      {
        form: "0619E",
        alternatives: [],
        title: "Monthly Remittance Form",
        period: "2026-10",
        periodWords: "October 2026",
        clients: [
          { clientId: "a", clientName: "ALPHA", status: "filed_bir", birFormId: "f1" },
          { clientId: "b", clientName: "BETA", status: "overdue", birFormId: null },
        ],
      },
    ],
  },
  {
    dueDate: "2026-11-25",
    forms: [
      {
        form: "2551Q",
        alternatives: [],
        title: "Quarterly Percentage Tax Return",
        period: "2026-Q3",
        periodWords: "Q3 2026",
        clients: [
          { clientId: "b", clientName: "BETA", status: "draft", birFormId: "f2" },
          {
            clientId: "c",
            clientName: "CHARLIE",
            status: "filed_override",
            birFormId: "f3",
          },
        ],
      },
      {
        form: "2550Q",
        alternatives: [],
        title: "Quarterly VAT Return",
        period: "2026-Q3",
        periodWords: "Q3 2026",
        clients: [
          { clientId: "a", clientName: "ALPHA", status: "not_started", birFormId: null },
        ],
      },
    ],
  },
];

describe("PB7 the BIR deadlines", () => {
  it("names each status with the owner's chip", () => {
    expect(
      Object.fromEntries(Object.entries(CHIP_OF).map(([k, v]) => [k, CHIP_LABEL[v]])),
    ).toEqual({
      not_started: "Not started",
      draft: "Draft",
      filed_bir: "Filed",
      filed: "Filed",
      filed_override: "Filed without BIR email",
      overdue: "Overdue",
    });
    expect(isFiled("filed_override")).toBe(true);
    expect(isFiled("draft")).toBe(false);
  });
  it("counts filed of total per due date", () => {
    const out = filterDeadlines(DAYS, { form: "", clientId: "", chip: "" });
    expect(out.map((d) => [d.dueDate, d.filed, d.total])).toEqual([
      ["2026-11-10", 1, 2],
      ["2026-11-25", 1, 3],
    ]);
  });
  it("filters by form, client and status, dropping what is left empty", () => {
    expect(
      filterDeadlines(DAYS, { form: "2551Q", clientId: "", chip: "" }).map(
        (d) => d.dueDate,
      ),
    ).toEqual(["2026-11-25"]);
    const byClient = filterDeadlines(DAYS, { form: "", clientId: "a", chip: "" });
    expect(byClient.map((d) => d.forms.map((f) => f.form))).toEqual([
      ["0619E"],
      ["2550Q"],
    ]);
    expect(byClient[0]!.total).toBe(1);
    const overdue = filterDeadlines(DAYS, { form: "", clientId: "", chip: "overdue" });
    expect(overdue.map((d) => d.dueDate)).toEqual(["2026-11-10"]);
    expect(overdue[0]!.forms[0]!.clients.map((c) => c.clientId)).toEqual(["b"]);
    const filed = filterDeadlines(DAYS, { form: "", clientId: "", chip: "filed" });
    expect(
      filed.flatMap((d) => d.forms.flatMap((f) => f.clients.map((c) => c.status))),
    ).toEqual(["filed_bir"]);
  });
  it("offers the forms and clients the answer names, sorted", () => {
    expect(filterChoices(DAYS)).toEqual({
      forms: ["0619E", "2550Q", "2551Q"],
      clients: [
        { id: "a", name: "ALPHA" },
        { id: "b", name: "BETA" },
        { id: "c", name: "CHARLIE" },
      ],
    });
  });
  it("the default range is this month and next, across a year", () => {
    expect(monthOf("2026-11-10")).toBe("2026-11");
    expect(nextMonth("2026-11")).toBe("2026-12");
    expect(nextMonth("2026-12")).toBe("2027-01");
  });
});
