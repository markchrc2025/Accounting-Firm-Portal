/**
 * track-a-mcp-bir-names.spec.ts — U20b (hermetic): finding a client from what the owner says,
 * the period a draft is for when none is named, and what a client must file soon. Invented
 * clients; "today" is set in every test.
 */
import { chooseDefaultPeriod, periodsOf, periodWords } from "./default-period";
import { dueItems, formsFor, type ExistingReturns } from "./forms-due";
import {
  matchClients,
  normalizeName,
  optionText,
  tinOf,
  type ClientRow,
} from "./client-ref";

const row = (over: Partial<ClientRow> & { id: string }): ClientRow => ({
  businessName: "Sample Agent Corp",
  regName: null,
  tradeName: null,
  tin: "111222333",
  status: "ACTIVE",
  ...over,
});
const ROWS: ClientRow[] = [
  row({
    id: "a",
    businessName: "Sample Agent Corp",
    regName: "SAMPLE AGENT CORPORATION",
    tradeName: "Sample Bakery",
    tin: "111222333",
  }),
  row({
    id: "b",
    businessName: "Bravo Trading",
    regName: "Bravo Trading Inc.",
    tin: "222333444",
  }),
  row({
    id: "c",
    businessName: "Bravo Trading",
    regName: "Bravo Trading Co.",
    tin: "333444555",
    status: "ARCHIVED",
  }),
  row({ id: "d", businessName: "No TIN Client", regName: null, tin: null }),
];
const ids = (r: ClientRow[]) => r.map((x) => x.id);

describe("U20b · finding the client", () => {
  it("normalizes case, punctuation and extra spaces", () => {
    expect(normalizeName("  Bravo,   Trading  Inc. ")).toBe("bravo trading inc");
    expect(normalizeName("O'Brien & Sons — Ltd.")).toBe("o brien sons ltd");
    expect(normalizeName(null)).toBe("");
  });

  it("matches the registered name, the trade name or the business name, exactly", () => {
    expect(ids(matchClients(ROWS, "sample agent corporation").rows)).toEqual(["a"]);
    expect(ids(matchClients(ROWS, "SAMPLE  BAKERY").rows)).toEqual(["a"]);
    expect(ids(matchClients(ROWS, "Sample Agent Corp.").rows)).toEqual(["a"]);
    expect(ids(matchClients(ROWS, "Bravo Trading Inc").rows)).toEqual(["b"]);
    expect(matchClients(ROWS, "Sample").rows).toEqual([]); // exact, not "contains"
    expect(matchClients(ROWS, "   ").rows).toEqual([]);
  });

  it("several clients may share a name: all are returned, the inactive one included", () => {
    expect(ids(matchClients(ROWS, "bravo trading").rows)).toEqual(["b", "c"]);
  });

  it("a TIN is exact, with or without dashes, and a TIN with its branch counts by its first nine digits", () => {
    for (const t of [
      "111222333",
      "111-222-333",
      "111 222 333",
      "111-222-333-000",
      "111-222-333-00000",
    ]) {
      expect({ t, ids: ids(matchClients(ROWS, t).rows) }).toEqual({ t, ids: ["a"] });
    }
    expect(matchClients(ROWS, "111-222-334").rows).toEqual([]);
    expect(tinOf("11122233")).toBeNull();
    expect(tinOf("Sample")).toBeNull();
    expect(matchClients(ROWS, "111222333").by).toBe("tin");
    expect(matchClients(ROWS, "Bravo Trading").by).toBe("name");
  });

  it("an option names the client, its TIN and its status, and flags an inactive client", () => {
    expect(optionText(ROWS[1]!)).toBe("Bravo Trading — TIN 222-333-444 — ACTIVE");
    expect(optionText(ROWS[2]!)).toBe(
      "Bravo Trading — TIN 333-444-555 — ARCHIVED (inactive)",
    );
    expect(optionText(ROWS[3]!)).toBe("No TIN Client — TIN none on file — ACTIVE");
  });
});

describe("U20b · the period when none is named (today is Friday 6 November 2026)", () => {
  const TODAY = "2026-11-06";
  const none = () => false;

  it("lists the periods of a form, leaving out one the Portal refuses (the third month of a 0619-E)", () => {
    expect(periodsOf("0619E", 2026, 2026)).toEqual([
      "2026-01",
      "2026-02",
      "2026-04",
      "2026-05",
      "2026-07",
      "2026-08",
      "2026-10",
      "2026-11",
    ]);
    expect(periodsOf("1601C", 2026, 2026)).toHaveLength(12);
    expect(periodsOf("2551Q", 2026, 2027)).toHaveLength(8);
    expect(periodsOf("1701A", 2025, 2026)).toEqual(["2025", "2026"]);
  });

  it("a form with a due-date rule: the period due next", () => {
    expect(chooseDefaultPeriod("1601C", TODAY, null, none)).toMatchObject({
      period: "2026-10",
      dueDate: "2026-11-10",
      basis: "due-next",
    });
    expect(chooseDefaultPeriod("0619E", TODAY, null, none)).toMatchObject({
      period: "2026-10",
      dueDate: "2026-11-10",
    });
    // the Q3 1601-EQ was due 2 November (a Saturday 31 October moved to Monday): already past
    expect(chooseDefaultPeriod("1601EQ", TODAY, null, none)).toMatchObject({
      period: "2026-Q4",
      dueDate: "2027-02-01",
    });
    expect(chooseDefaultPeriod("2550Q", TODAY, null, none)).toMatchObject({
      period: "2026-Q4",
      dueDate: "2027-01-25",
    });
    expect(chooseDefaultPeriod("2551Q", TODAY, null, none)).toMatchObject({
      period: "2026-Q4",
    });
  });

  it("the due date itself still counts as due next", () => {
    expect(chooseDefaultPeriod("1601C", "2026-11-10", null, none)).toMatchObject({
      period: "2026-10",
    });
    expect(chooseDefaultPeriod("1601C", "2026-11-11", null, none)).toMatchObject({
      period: "2026-11",
    });
  });

  it("never a period that has a filed return: then the next one, and it says so", () => {
    const filed = (p: string) => p === "2026-10";
    const c = chooseDefaultPeriod("0619E", TODAY, null, filed)!;
    expect(c).toMatchObject({ period: "2026-11", dueDate: "2026-12-10" });
    expect(c.reason).toContain("October 2026 is already filed");
    const two = chooseDefaultPeriod(
      "1601C",
      TODAY,
      null,
      (p) => p === "2026-10" || p === "2026-11",
    )!;
    expect(two.period).toBe("2026-12");
    expect(two.reason).toContain("October 2026 and November 2026 are already filed");
  });

  it("says which period and when it is due, in words", () => {
    expect(chooseDefaultPeriod("1601C", TODAY, null, none)!.reason).toBe(
      "I chose October 2026 (2026-10) because it is the 1601C due next, on 10 November 2026, in 4 days.",
    );
    expect(chooseDefaultPeriod("1601C", "2026-11-10", null, none)!.reason).toContain(
      "due next, on 10 November 2026, today.",
    );
  });

  it("a form with no due-date rule: the latest period that has ended; if it is filed, the next", () => {
    const q = chooseDefaultPeriod("1701Q", TODAY, null, none)!;
    expect(q).toMatchObject({ period: "2026-Q3", dueDate: null, basis: "latest-ended" });
    expect(q.reason).toContain("the latest 1701Q period that has ended");
    expect(q.reason).toContain("the Portal has no due-date rule for the 1701Q");
    expect(chooseDefaultPeriod("1701A", TODAY, null, none)).toMatchObject({
      period: "2025",
    });
    const filed = chooseDefaultPeriod("1701Q", TODAY, null, (p) => p === "2026-Q3")!;
    expect(filed.period).toBe("2026-Q4");
    expect(filed.reason).toContain("is already filed");
  });

  it("names a period in words", () => {
    expect(periodWords("2026-Q3")).toBe("Q3 2026");
    expect(periodWords("2026-10")).toBe("October 2026");
    expect(periodWords("2025")).toBe("2025");
  });
});

describe("U20b · what a client must file", () => {
  const TODAY = "2026-11-06";
  const vatWithholder = {
    taxType: "VAT",
    taxTypesJson: [
      { type: "Withholding Tax - Expanded", form: "0619E", frequency: "Monthly" },
    ],
    fiscalYearStart: null,
  };
  const empty = (): ExistingReturns => ({ draft: null, filed: null });
  const find = (
    items: ReturnType<typeof dueItems>["items"],
    form: string,
    period: string,
  ) => items.find((i) => i.form === form && i.period === period);

  it("the forms come from the regime and the registered withholding types", () => {
    expect(formsFor(vatWithholder)).toEqual(["2550Q", "0619E", "1601EQ"]);
    expect(
      formsFor({
        taxType: "PERCENTAGE",
        taxTypesJson: [{ type: "Withholding Tax - Compensation", form: "" }],
      }),
    ).toEqual(["2551Q", "1601C"]);
    expect(formsFor({ taxType: null, taxTypesJson: [] })).toEqual([]);
    expect(
      formsFor({
        taxType: null,
        taxTypesJson: [{ type: "Withholding Tax - Final", form: "0619F" }],
      }),
    ).toEqual([]);
  });

  it("lists what is due in 45 days and what is overdue and unfiled, with days left or late", () => {
    const { items, notes } = dueItems(vatWithholder, TODAY, empty);
    expect(find(items, "0619E", "2026-10")).toMatchObject({
      status: "due",
      dueDate: "2026-11-10",
      daysLeft: 4,
      daysLate: null,
    });
    expect(find(items, "0619E", "2026-11")).toMatchObject({
      status: "due",
      dueDate: "2026-12-10",
      daysLeft: 34,
    });
    expect(find(items, "1601EQ", "2026-Q3")).toMatchObject({
      status: "overdue",
      daysLate: 4,
      daysLeft: null,
    });
    expect(find(items, "2550Q", "2026-Q3")).toMatchObject({
      status: "overdue",
      dueDate: "2026-10-26",
      daysLate: 11,
    });
    expect(find(items, "0619E", "2026-09")).toBeUndefined(); // the third month is the 1601-EQ's
    expect(find(items, "1601EQ", "2026-Q4")).toBeUndefined(); // due in February: not within 45 days
    expect(find(items, "0619E", "2026-12")).toBeUndefined(); // due 10 January
    // sorted by due date
    const dues = items.map((i) => i.dueDate);
    expect([...dues].sort()).toEqual(dues);
    expect(notes.join(" ")).toContain("no due-date rule for the income-tax returns");
  });

  it("a filed period is not listed; a draft is shown with its id", () => {
    const { items } = dueItems(vatWithholder, TODAY, (form, period) =>
      form === "0619E" && period === "2026-10"
        ? { draft: null, filed: { id: "f1" } }
        : form === "0619E" && period === "2026-11"
          ? { draft: { id: "d1" }, filed: null }
          : empty(),
    );
    expect(find(items, "0619E", "2026-10")).toBeUndefined();
    expect(find(items, "0619E", "2026-11")!.existing).toEqual({
      draft: { id: "d1" },
      filed: null,
    });
  });

  it("an unfiled period older than a year is not called overdue", () => {
    const { items } = dueItems(vatWithholder, TODAY, empty);
    expect(items.every((i) => i.dueDate >= "2025-11-06")).toBe(true);
  });
});
