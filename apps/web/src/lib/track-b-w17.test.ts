// track-b-w17.test.ts — W17: the model behind the 0619-E, 1601-EQ and 1601-C editors
// (periods, the draft's data, the sentences the web says itself) and the books model
// as the two returns the books fill need it (a table whose compared column is the tax
// withheld, a Yes/No figure, a figure the books leave empty).

import { describe, expect, it } from "vitest";
import {
  buildData,
  BOOK_KEYS,
  emptyEqRow,
  emptySchedule,
  emptyValues,
  FORM_TITLE,
  hydrate,
  isWithholdingForm,
  NO_PAYROLL_NOTE,
  periodOf,
  periodOptions,
  QUARTER_WORD,
  signedPeso,
  sixRowsSentence,
  splitPeriod,
  VALUE_KEYS,
  type DraftState,
} from "./withholding";
import {
  differing,
  editedBadgeText,
  EQ_1601_SPEC,
  fillItemText,
  flattenFigures,
  patchData,
  rowRoom,
  validPeriodFor,
} from "./bookFigures";

const state = (over: Partial<DraftState> = {}): DraftState => ({
  year: "2026",
  sub: "08",
  amended: "no",
  values: emptyValues("0619E"),
  rows: [],
  schedule: emptySchedule(),
  ...over,
});

describe("W17 the period picker", () => {
  it("offers the 0619-E months 1 and 2 of a quarter only", () => {
    expect(periodOptions("0619E").map((o) => o.value)).toEqual([
      "01",
      "02",
      "04",
      "05",
      "07",
      "08",
      "10",
      "11",
    ]);
    expect(periodOptions("0619E").map((o) => o.label)).not.toContain("March");
  });

  it("offers the 1601-EQ the four quarters", () => {
    expect(periodOptions("1601EQ")).toEqual([
      { value: "Q1", label: "Q1" },
      { value: "Q2", label: "Q2" },
      { value: "Q3", label: "Q3" },
      { value: "Q4", label: "Q4" },
    ]);
  });

  it("offers the 1601-C every month, in order", () => {
    const months = periodOptions("1601C");
    expect(months).toHaveLength(12);
    expect(months[0]).toEqual({ value: "01", label: "January" });
    expect(months[11]).toEqual({ value: "12", label: "December" });
  });

  it("writes the period column the way the server reads it", () => {
    expect(periodOf("0619E", "2026", "08")).toBe("2026-08");
    expect(periodOf("1601EQ", "2026", "Q3")).toBe("2026-Q3");
  });

  it("reads a saved period back, and refuses one that is not the form's", () => {
    expect(splitPeriod("0619E", "2026-08")).toEqual({ year: "2026", sub: "08" });
    expect(splitPeriod("1601EQ", "2026-Q3")).toEqual({ year: "2026", sub: "Q3" });
    expect(splitPeriod("1601EQ", "2026-08")).toBeNull();
    expect(splitPeriod("1601C", "2026-Q3")).toBeNull();
    expect(splitPeriod("1601C", "2026-13")).toBeNull();
  });
});

describe("W17 the draft's data", () => {
  it("writes the 0619-E's year and month from the period, and nothing of a quarter", () => {
    const d = buildData("0619E", state());
    expect(d).toMatchObject({
      year: "2026",
      month: "08",
      amended: "no",
      category: "private",
    });
    expect(d).not.toHaveProperty("quarter");
    expect(d).not.toHaveProperty("rows");
    expect(d).not.toHaveProperty("scheduleRows");
  });

  it("writes the 1601-EQ's quarter as 1st to 4th, with its rows", () => {
    const rows = [{ atc: "WC160", base: "1.00", rate: "2", withheld: "0.02" }];
    const d = buildData(
      "1601EQ",
      state({ sub: "Q3", values: emptyValues("1601EQ"), rows }),
    );
    expect(d).toMatchObject({ year: "2026", quarter: "3rd", amended: "no" });
    expect(d.rows).toEqual(rows);
    expect(d).not.toHaveProperty("month");
    expect(QUARTER_WORD).toEqual({ Q1: "1st", Q2: "2nd", Q3: "3rd", Q4: "4th" });
  });

  it("writes the 1601-C's month, and Schedule I's three rows", () => {
    const d = buildData("1601C", state({ sub: "03", values: emptyValues("1601C") }));
    expect(d).toMatchObject({ year: "2026", month: "03", reliefYesNo: "no" });
    expect(d.scheduleRows).toHaveLength(3);
  });

  it("never types the books-only or computed keys that are not the form's", () => {
    expect(VALUE_KEYS["0619E"]).not.toContain("rows");
    expect(VALUE_KEYS["0619E"]).not.toContain("i16");
    expect(VALUE_KEYS["1601C"]).not.toContain("remittance");
    expect(BOOK_KEYS["0619E"]).toEqual(["anyWithheld", "remittance"]);
    expect(BOOK_KEYS["1601EQ"]).toEqual([
      "anyWithheld",
      "rows",
      "remittance1",
      "remittance2",
      "overRemittancePrior",
    ]);
  });

  it("starts a draft empty, a private withholding agent, no taxes withheld, no tax relief", () => {
    const v = emptyValues("1601C");
    expect(v.category).toBe("private");
    expect(v.anyWithheld).toBe("no");
    expect(v.reliefYesNo).toBe("no");
    expect(v.compensation).toBe("");
    expect(emptyValues("0619E")).not.toHaveProperty("reliefYesNo");
  });

  it("gives the whole draft back from what was saved, and blanks for what was not", () => {
    const saved = {
      year: "2026",
      month: "08",
      remittance: "12.50",
      anyWithheld: "yes",
      payCheckNumber: "000123",
      ignored: "x",
    };
    const h = hydrate("0619E", saved);
    expect(h.values.remittance).toBe("12.50");
    expect(h.values.payCheckNumber).toBe("000123");
    expect(h.values.contact).toBe("");
    expect(h.values).not.toHaveProperty("ignored");
    expect(h.rows).toEqual([]);
    expect(h.schedule).toHaveLength(3);
  });

  it("keeps a 1601-EQ's rows as saved, and gives an empty draft one empty row", () => {
    const rows = [
      { atc: "WC160", base: "100.00", rate: "2", withheld: "2.00" },
      { atc: "WI998", base: "50.00", rate: "", withheld: "1.00" },
    ];
    expect(hydrate("1601EQ", { rows }).rows).toEqual(rows);
    expect(hydrate("1601EQ", {}).rows).toEqual([emptyEqRow()]);
  });

  it("keeps Schedule I's saved rows in their places", () => {
    const row = {
      month: "2026-02",
      datePaid: "2026-03-10",
      bank: "B",
      number: "1",
      taxPaid: "5",
      shouldBe: "6",
    };
    const h = hydrate("1601C", { scheduleRows: [row] });
    expect(h.schedule[0]).toEqual(row);
    expect(h.schedule[1]!.month).toBe("");
  });

  it("round-trips the data the editors save", () => {
    const s = state({
      sub: "Q2",
      values: { ...emptyValues("1601EQ"), remittance1: "10.00", surcharge: "1.25" },
      rows: [{ atc: "WC010", base: "1.00", rate: "5", withheld: "0.05" }],
    });
    const back = hydrate("1601EQ", buildData("1601EQ", s));
    expect(back.values).toEqual(s.values);
    expect(back.rows).toEqual(s.rows);
  });
});

describe("W17 the words and figures the web shows", () => {
  it("shows a minus sign, never a clamp", () => {
    expect(signedPeso(-300)).toBe("-₱300.00");
    expect(signedPeso(1234.5)).toBe("₱1,234.50");
    expect(signedPeso(0)).toBe("₱0.00");
    expect(signedPeso(-0)).toBe("₱0.00");
    expect(signedPeso(undefined)).toBe("₱0.00");
  });

  it("says the six-row sentence as the server does", () => {
    expect(sixRowsSentence(7)).toBe("7 ATCs; the form has six rows.");
  });

  it("says the 1601-C's note as the owner worded it", () => {
    expect(NO_PAYROLL_NOTE).toBe(
      "The Portal has no payroll records yet. Type the figures from your payroll.",
    );
  });

  it("knows the three forms, and only them", () => {
    expect(isWithholdingForm("0619E")).toBe(true);
    expect(isWithholdingForm("1601EQ")).toBe(true);
    expect(isWithholdingForm("1601C")).toBe(true);
    expect(isWithholdingForm("2551Q")).toBe(false);
    expect(isWithholdingForm("1601FQ")).toBe(false);
    expect(isWithholdingForm(undefined)).toBe(false);
    expect(FORM_TITLE["0619E"].code).toBe("0619-E");
  });
});

describe("W17 the books model for the withholding returns", () => {
  const KEYS = [...BOOK_KEYS["1601EQ"]];
  const row = (atc: string, base: string, rate: string, withheld: string) => ({
    atc,
    base,
    rate,
    withheld,
  });
  const fresh = flattenFigures(
    {
      anyWithheld: "yes",
      rows: [
        row("WC160", "50000.00", "2", "1000.00"),
        row("WI998", "10000.00", "", "250.00"),
      ],
      remittance1: "400.00",
      remittance2: "",
      overRemittancePrior: "",
    },
    KEYS,
    EQ_1601_SPEC,
  );

  it("compares a 1601-EQ row by its tax withheld, named by its ATC", () => {
    expect(fresh.map((f) => [f.id, f.books])).toEqual([
      ["anyWithheld", "yes"],
      ["rows.WC160", "1000.00"],
      ["rows.WI998", "250.00"],
      ["remittance1", "400.00"],
    ]);
  });

  it("leaves out a figure the books leave empty", () => {
    expect(fresh.map((f) => f.id)).not.toContain("remittance2");
    expect(fresh.map((f) => f.id)).not.toContain("overRemittancePrior");
  });

  it("fills a matching row's tax withheld and base, and its rate only when the user's is empty", () => {
    const data = {
      rows: [row("WC160", "1.00", "5", "1.00"), row("WI998", "1.00", "", "1.00")],
    };
    const after = patchData(data, fresh, ["rows.WC160", "rows.WI998"]);
    expect(after.rows).toEqual([
      row("WC160", "50000.00", "5", "1000.00"),
      row("WI998", "10000.00", "", "250.00"),
    ]);
    const blankRate = patchData({ rows: [row("WC160", "", "", "")] }, fresh, [
      "rows.WC160",
    ]);
    expect((blankRate.rows as { rate: string }[])[0]!.rate).toBe("2");
  });

  it("puts a new row in the editor's empty starting row, else after the user's rows", () => {
    const starter = patchData({ rows: [row("", "", "", "")] }, fresh, [
      "rows.WC160",
      "rows.WI998",
    ]);
    expect(starter.rows).toEqual([
      row("WC160", "50000.00", "2", "1000.00"),
      row("WI998", "10000.00", "", "250.00"),
    ]);
    const mine = patchData({ rows: [row("WC010", "1.00", "5", "0.05")] }, fresh, [
      "rows.WC160",
    ]);
    expect((mine.rows as { atc: string }[]).map((r) => r.atc)).toEqual([
      "WC010",
      "WC160",
    ]);
  });

  it("shows every row: a 1601-EQ has no room limit of its own", () => {
    expect(
      rowRoom({ rows: new Array(9).fill(row("A", "1", "1", "1")) }, EQ_1601_SPEC.max),
    ).toBe(Number.POSITIVE_INFINITY);
    const six = ["A", "B", "C", "D", "E", "F"].map((a) => row(a, "1.00", "2", "0.02"));
    const more = flattenFigures(
      { rows: [row("G", "1.00", "2", "0.02")] },
      KEYS,
      EQ_1601_SPEC,
    );
    const after = patchData({ rows: six }, more, ["rows.G"]);
    expect((after.rows as unknown[]).length).toBe(7);
  });

  it("asks about a Yes/No in words, not in pesos", () => {
    const values = { anyWithheld: "no" };
    const yes = fresh.filter((f) => f.id === "anyWithheld");
    expect(differing(values, yes).map((f) => f.id)).toEqual(["anyWithheld"]);
    expect(fillItemText("Any taxes withheld? (Item 4)", "no", "yes")).toBe(
      "Any taxes withheld? (Item 4): No becomes Yes",
    );
    expect(editedBadgeText("yes")).toBe("Edited · books say Yes");
    // An amount keeps its pesos, with its centavos.
    expect(fillItemText("Item 14", "100", "12345.67")).toBe(
      "Item 14: ₱100.00 becomes ₱12,345.67",
    );
  });

  it("asks the 0619-E's books for a month and the others' for a quarter", () => {
    expect(validPeriodFor("0619E", "2026-08")).toBe(true);
    expect(validPeriodFor("0619E", "2026-Q3")).toBe(false);
    expect(validPeriodFor("0619E", "2026-8")).toBe(false);
    expect(validPeriodFor("1601EQ", "2026-Q3")).toBe(true);
    expect(validPeriodFor("1601EQ", "2026-08")).toBe(false);
    expect(validPeriodFor("2551Q", "2026-Q1")).toBe(true);
  });
});
