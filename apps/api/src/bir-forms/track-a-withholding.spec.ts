/**
 * track-a-withholding.spec.ts — U17 T2 (hermetic): the exact arithmetic of the three
 * withholding returns (0619-E, 1601-EQ, 1601-C), their due dates and periods, the
 * six-row rule, and which clients are expected to file. Invented figures only; every
 * expected figure is worked by hand beside it.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { compute0619E } from "./engine/compute0619E";
import { compute1601C } from "./engine/compute1601C";
import { compute1601EQ } from "./engine/compute1601EQ";
import { centavoText, centavos, dec, sum } from "./engine/exact";
import {
  dueDate0619E,
  dueDate1601C,
  dueDate1601EQ,
  moveOffWeekend,
  nextDue0619E,
  nextDue1601C,
  nextDue1601EQ,
} from "./engine/withholding-dates";
import type { FilingData } from "./engine/types";
import {
  checkWithholdingPeriod,
  registeredWithholding,
  sixRowsRefusal,
  THIRD_MONTH_REFUSAL,
} from "./withholding";

describe("U17 R4 · exact decimals to the centavo", () => {
  it("reads a typed field exactly: commas, blanks and junk", () => {
    expect(dec("1,234.56").toString()).toBe("1234.56");
    expect(dec(" 0.01 ").toString()).toBe("0.01");
    for (const v of ["", "  ", null, undefined, "abc", "NaN", "Infinity"]) {
      expect(dec(v).toString()).toBe("0");
    }
  });

  it("0.1 + 0.2 is 0.3, not 0.30000000000000004; ten thousand 0.01s are 100", () => {
    expect(0.1 + 0.2).not.toBe(0.3); // floating point
    expect(centavos(sum(dec("0.1"), dec("0.2")))).toBe(0.3);
    expect(centavos(sum(...Array.from({ length: 10_000 }, () => dec("0.01"))))).toBe(100);
  });

  it("reports to the centavo, half up, and never -0; the text always has two places", () => {
    expect(centavos(dec("1.005"))).toBe(1.01); // half up
    expect(centavos(dec("1.004"))).toBe(1);
    expect(centavos(dec("-0.004"))).toBe(0);
    expect(Object.is(centavos(dec("-0.004")), -0)).toBe(false);
    expect(centavoText(dec("1234.5"))).toBe("1234.50");
    expect(centavoText(dec("0"))).toBe("0.00");
    expect(centavoText(dec("1234.567"))).toBe("1234.57");
  });

  it("the three compute files and the withholding feeder never use the peso rounding", () => {
    const src = (f: string) =>
      readFileSync(join(__dirname, f), "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "") // block comments
        .replace(/\/\/.*$/gm, ""); // line comments
    for (const f of [
      "engine/compute0619E.ts",
      "engine/compute1601EQ.ts",
      "engine/compute1601C.ts",
      "engine/exact.ts",
      "book-figures/withholding-feeder.ts",
    ]) {
      const code = src(f);
      expect([
        f,
        /round-to-whole-peso|roundToNearestWholePeso|roundPeso\b|\.\.\/format/.test(code),
      ]).toEqual([f, false]);
    }
  });
});

describe("U17 · compute0619E", () => {
  it("net remittance, penalties and total, to the centavo", () => {
    // 14: 1,234.56   15: 0.01   16: 1,234.55
    // 17A 0.10 + 17B 0.20 + 17C 0.30 = 0.60 (0.6000000000000001 in floating point)
    // 18: 1,234.55 + 0.60 = 1,235.15
    const c = compute0619E({
      remittance: "1,234.56",
      previouslyRemitted: "0.01",
      surcharge: "0.10",
      interest: "0.20",
      compromise: "0.30",
    });
    expect(c).toMatchObject({
      i14: 1234.56,
      i15: 0.01,
      i16: 1234.55,
      i17d: 0.6,
      i18: 1235.15,
    });
  });

  it("an empty form is all zeros and has no due date; a month gives the default", () => {
    expect(compute0619E({})).toEqual({
      i14: 0,
      i15: 0,
      i16: 0,
      i17a: 0,
      i17b: 0,
      i17c: 0,
      i17d: 0,
      i18: 0,
      defaultDueDate: "",
    });
    expect(compute0619E({ year: "2026", month: "07" }).defaultDueDate).toBe("2026-08-10");
  });
});

describe("U17 · compute1601EQ", () => {
  const row = (atc: string, base: string, withheld: string) => ({
    atc,
    base,
    rate: "2",
    withheld,
  });

  it("items 19 to 31 from the rows and the typed items, to the centavo", () => {
    const d: FilingData = {
      quarter: "3rd",
      rows: [row("WI160", "5000.00", "100.10"), row("WC160", "10000.00", "200.20")],
      remittance1: "50.05",
      remittance2: "0.10",
      previouslyRemitted: "0.02",
      overRemittancePrior: "10.00",
      otherPayments: "5.25",
      surcharge: "1.10",
      interest: "2.20",
      compromise: "3.30",
    };
    const c = compute1601EQ(d);
    // 19: 100.10 + 200.20 = 300.30
    expect(c.i19).toBe(300.3);
    // 25: 50.05 + 0.10 + 0.02 + 10.00 + 5.25 = 65.42;  26: 300.30 - 65.42 = 234.88
    expect([c.i25, c.i26]).toEqual([65.42, 234.88]);
    // 30: 1.10 + 2.20 + 3.30 = 6.60;  31: 234.88 + 6.60 = 241.48
    expect([c.i30, c.i31]).toEqual([6.6, 241.48]);
    expect(c.overRemittance).toBe(false);
    expect(c.overRemittanceAmount).toBe(0);
  });

  it("an over-remittance appears only when item 31 is negative, with one valid box", () => {
    const base: FilingData = {
      quarter: "2nd",
      rows: [row("WI160", "1000.00", "20.00")],
      remittance1: "30.00",
    };
    const refunded = compute1601EQ({ ...base, overRemittanceChoice: "refunded" });
    expect([
      refunded.i31,
      refunded.overRemittance,
      refunded.overRemittanceAmount,
    ]).toEqual([-10, true, 10]);
    expect(refunded.overRemittanceChoice).toBe("refunded");
    for (const choice of ["tcc", "carried", " Carried "]) {
      expect(
        compute1601EQ({ ...base, overRemittanceChoice: choice }).overRemittanceChoice,
      ).toBe(choice.trim().toLowerCase());
    }
    for (const choice of ["", "both", "refund", undefined]) {
      expect(
        compute1601EQ({ ...base, overRemittanceChoice: choice }).overRemittanceChoice,
      ).toBe("");
    }
    // 31 = 0: no over-remittance, so no box
    const zero = compute1601EQ({
      ...base,
      remittance1: "20.00",
      overRemittanceChoice: "tcc",
    });
    expect([zero.i31, zero.overRemittance, zero.overRemittanceChoice]).toEqual([
      0,
      false,
      "",
    ]);
    // "carried" is not applicable for the succeeding year: not in the 4th quarter
    expect(
      compute1601EQ({ ...base, quarter: "4th", overRemittanceChoice: "carried" })
        .overRemittanceChoice,
    ).toBe("");
    expect(
      compute1601EQ({ ...base, quarter: "4th", overRemittanceChoice: "tcc" })
        .overRemittanceChoice,
    ).toBe("tcc");
  });

  it("counts the rows in use: an ATC, a base or an amount withheld; blank rows are not rows", () => {
    expect(compute1601EQ({}).rowCount).toBe(0);
    expect(
      compute1601EQ({
        rows: [row("WI010", "0", "0"), { atc: "", base: "", withheld: "" }],
      }).rowCount,
    ).toBe(1);
    expect(
      compute1601EQ({ rows: [{ atc: "", base: "100.00", withheld: "" }] }).rowCount,
    ).toBe(1);
    expect(
      compute1601EQ({ rows: [{ atc: " ", base: "0", withheld: "0.01" }] }).rowCount,
    ).toBe(1);
    // a seventh row is added to item 19, never dropped
    const seven = Array.from({ length: 7 }, (_, i) => row(`WI0${i}0`, "100.00", "1.00"));
    const c = compute1601EQ({ rows: seven });
    expect([c.rowCount, c.i19]).toEqual([7, 7]);
  });

  it("the six-row refusal names the number of rows; six and fewer, and other forms, are fine", () => {
    const rows = (n: number) =>
      Array.from({ length: n }, (_, i) => row(`WI${100 + i}`, "1.00", "0.02"));
    expect(sixRowsRefusal("1601EQ", { rows: rows(7) })).toBe(
      "7 ATCs; the form has six rows.",
    );
    expect(sixRowsRefusal("1601EQ", { rows: rows(9) })).toBe(
      "9 ATCs; the form has six rows.",
    );
    expect(sixRowsRefusal("1601EQ", { rows: rows(6) })).toBeNull();
    expect(sixRowsRefusal("1601EQ", null)).toBeNull();
    expect(sixRowsRefusal("0619E", { rows: rows(9) })).toBeNull();
  });
});

describe("U17 · compute1601C", () => {
  it("every item as printed, to the centavo", () => {
    const c = compute1601C({
      compensation: "250000.00",
      mwe: "10000.00",
      holiday: "0.01",
      thirteenth: "20000.00",
      deMinimis: "5000.00",
      contributions: "3000.00",
      otherNonTaxable: "0.10",
      notSubjectToWithholding: "50000.00",
      taxesWithheld: "12345.67",
      previouslyRemitted: "0.01",
      otherRemittances: "100.00",
      surcharge: "10.00",
      interest: "0.25",
      compromise: "500.00",
      scheduleRows: [
        { taxPaid: "1000.00", shouldBe: "1250.50" },
        { taxPaid: "2000.00", shouldBe: "1500.25" },
        {},
      ],
    });
    // 21 = 10,000.00 + 0.01 + 20,000.00 + 5,000.00 + 3,000.00 + 0.10 = 38,000.11
    // 22 = 250,000.00 - 38,000.11 = 211,999.89;  24 = 211,999.89 - 50,000.00 = 161,999.89
    // Schedule I: 1,250.50 - 1,000.00 = 250.50;  1,500.25 - 2,000.00 = -499.75;  total -249.25
    // 27 = 12,345.67 - 249.25 = 12,096.42;  30 = 100.01;  31 = 11,996.41
    // 35 = 510.25;  36 = 11,996.41 + 510.25 = 12,506.66
    expect(c).toEqual({
      i14: 250000,
      i21: 38000.11,
      i22: 211999.89,
      i23: 50000,
      i24: 161999.89,
      i25: 12345.67,
      adjustments: [250.5, -499.75, 0],
      scheduleTotal: -249.25,
      i26: -249.25,
      i27: 12096.42,
      i28: 0.01,
      i29: 100,
      i30: 100.01,
      i31: 11996.41,
      i32: 10,
      i33: 0.25,
      i34: 500,
      i35: 510.25,
      i36: 12506.66,
    });
  });

  it("item 26 is always the schedule's total, whatever the rows; a missing row is nothing", () => {
    for (const rows of [undefined, [], [{}], [{ taxPaid: "1.00", shouldBe: "0.99" }]]) {
      const c = compute1601C({ scheduleRows: rows as never });
      expect(c.i26).toBe(c.scheduleTotal);
    }
    expect(
      compute1601C({ scheduleRows: [{ taxPaid: "1.00", shouldBe: "0.99" }] }).adjustments,
    ).toEqual([-0.01, 0, 0]);
  });

  it("negatives are shown as the arithmetic gives them: an over-remittance, a large adjustment, a contradiction", () => {
    expect(
      compute1601C({ taxesWithheld: "100.00", otherRemittances: "300.00" }).i36,
    ).toBe(-200);
    const adj = compute1601C({
      taxesWithheld: "100.00",
      scheduleRows: [{ taxPaid: "500.00", shouldBe: "100.00" }],
    });
    expect([adj.i26, adj.i27, adj.i31]).toEqual([-400, -300, -300]);
    // more non-taxable pay than total pay: item 22 is negative, not clamped
    expect(compute1601C({ compensation: "100.00", mwe: "150.00" }).i22).toBe(-50);
  });
});

describe("U17 R6, A5 · due dates (calendar dates, a weekend moves to Monday, no holidays)", () => {
  it.each([
    ["2026-08-08", "2026-08-10"], // Saturday -> Monday
    ["2026-05-10", "2026-05-11"], // Sunday -> Monday
    ["2026-08-10", "2026-08-10"], // Monday stays
    ["2026-06-10", "2026-06-10"], // Wednesday stays
    ["2028-06-10", "2028-06-12"], // Saturday -> Monday
  ])("%s becomes %s", (from, to) => {
    expect(moveOffWeekend(from)).toBe(to);
  });

  it.each([
    // [year, month, the 10th of the next month is a ..., the due date]
    ["2026", "07", "2026-08-10"], // Monday
    ["2026", "04", "2026-05-11"], // 10 May 2026 is a Sunday
    ["2028", "05", "2028-06-12"], // 10 June 2028 is a Saturday
    ["2026", "11", "2026-12-10"], // Thursday
    ["2027", "02", "2027-03-10"], // Wednesday
    ["2026", "1", "2026-02-10"], // a month without its zero is a month
    [2026, 8, "2026-09-10"], // numbers too
  ])("the 0619-E for %s/%s is due %s", (year, month, due) => {
    expect(dueDate0619E(year, month)).toBe(due);
  });

  it("a month or year that is not one has no due date", () => {
    for (const [y, m] of [
      ["", "07"],
      ["2026", ""],
      ["2026", "13"],
      ["2026", "0"],
      ["1999", "07"],
      ["x", "y"],
    ]) {
      expect([y, m, dueDate0619E(y!, m!)]).toEqual([y, m, ""]);
      expect([y, m, dueDate1601C(y!, m!)]).toEqual([y, m, ""]);
    }
    expect(dueDate1601EQ("2026", "5")).toBe("");
    expect(dueDate1601EQ("", "1")).toBe("");
  });

  it.each([
    ["2026", "09", "2026-10-12"], // 10 October 2026 is a Saturday
    ["2026", "10", "2026-11-10"], // Tuesday
    ["2026", "11", "2026-12-10"],
    ["2026", "12", "2027-01-15"], // December: 15 January of the next year (Friday)
    ["2027", "12", "2028-01-17"], // 15 January 2028 is a Saturday
    ["2026", "03", "2026-04-10"], // March is a month for the 1601-C
  ])("the 1601-C for %s/%s is due %s", (year, month, due) => {
    expect(dueDate1601C(year, month)).toBe(due);
  });

  it.each([
    ["2026", "1", "2026-04-30"], // Thursday
    ["2026", "2", "2026-07-31"], // Friday
    ["2026", "3", "2026-11-02"], // 31 October 2026 is a Saturday
    ["2026", "4", "2027-02-01"], // 31 January 2027 is a Sunday
    ["2027", "1", "2027-04-30"], // Friday
    ["2027", "2", "2027-08-02"], // 31 July 2027 is a Saturday
  ])("the 1601-EQ for %s Q%s is due %s", (year, quarter, due) => {
    expect(dueDate1601EQ(year, quarter)).toBe(due);
  });
});

describe("U17 T3 · the next return still due, by Manila date", () => {
  it.each([
    // [today, the 0619-E: period, due]
    ["2026-10-27", "2026-10", "2026-11-10"], // September is a 3rd month; October is month 1
    ["2026-11-03", "2026-10", "2026-11-10"],
    ["2026-11-10", "2026-10", "2026-11-10"], // the due day itself still lists it
    ["2026-11-11", "2026-11", "2026-12-10"],
    ["2026-12-20", "2027-01", "2027-02-10"], // December is a 3rd month
    ["2026-05-02", "2026-04", "2026-05-11"], // 10 May is a Sunday
    ["2026-01-02", "2026-01", "2026-02-10"], // December is a 3rd month, so January is next
  ])("on %s the 0619-E is %s, due %s", (today, period, due) => {
    expect(nextDue0619E(today)).toEqual({ period, due });
  });

  it.each([
    ["2026-10-27", "2026-10", "2026-11-10"], // September's was due 12 October (the 10th is a Saturday)
    ["2026-10-11", "2026-09", "2026-10-12"],
    ["2026-12-12", "2026-12", "2027-01-15"], // December: 15 January
    ["2027-01-03", "2026-12", "2027-01-15"],
    ["2027-01-16", "2027-01", "2027-02-10"],
  ])("on %s the 1601-C is %s, due %s", (today, period, due) => {
    expect(nextDue1601C(today)).toEqual({ period, due });
  });

  it.each([
    ["2026-10-27", "2026-Q3", "2026-11-02"],
    ["2026-11-02", "2026-Q3", "2026-11-02"],
    ["2026-11-03", "2026-Q4", "2027-02-01"],
    ["2027-02-02", "2027-Q1", "2027-04-30"],
    ["2027-01-10", "2026-Q4", "2027-02-01"],
  ])("on %s the 1601-EQ is %s, due %s", (today, period, due) => {
    expect(nextDue1601EQ(today)).toEqual({ period, due });
  });
});

describe("U17 R2 · a draft's period", () => {
  it.each([
    "2026-01",
    "2026-02",
    "2026-04",
    "2026-05",
    "2026-07",
    "2026-08",
    "2026-10",
    "2026-11",
  ])("%s is a month for the 0619-E", (period) =>
    expect(checkWithholdingPeriod("0619E", period)).toBeNull(),
  );
  it.each(["2026-03", "2026-06", "2026-09", "2026-12"])(
    "%s is the 3rd month of a quarter: refused for the 0619-E, accepted for the 1601-C",
    (period) => {
      expect(checkWithholdingPeriod("0619E", period)).toBe(THIRD_MONTH_REFUSAL);
      expect(checkWithholdingPeriod("1601C", period)).toBeNull();
    },
  );
  it("the 1601-EQ takes a calendar quarter and nothing else", () => {
    for (const q of ["2026-Q1", "2026-Q2", "2026-Q3", "2026-Q4"]) {
      expect(checkWithholdingPeriod("1601EQ", q)).toBeNull();
    }
    for (const bad of [
      "2026-q3",
      "2026-Q5",
      "2026-Q0",
      "2026",
      "2026-08",
      "",
      " 2026-Q3",
      "1999-Q1",
      "2101-Q1",
    ]) {
      expect([bad, checkWithholdingPeriod("1601EQ", bad)]).toEqual([
        bad,
        "That isn't a valid period for the 1601EQ.",
      ]);
    }
  });
  it.each(["0619E", "1601C"])(
    "the %s takes a calendar month and nothing else",
    (form) => {
      for (const bad of [
        "2026-Q3",
        "2026-13",
        "2026-00",
        "2026-8",
        "2026",
        "",
        " 2026-08",
        "1999-08",
        "2101-08",
        "2026-08-01",
      ]) {
        expect([form, bad, checkWithholdingPeriod(form, bad)]).toEqual([
          form,
          bad,
          `That isn't a valid period for the ${form}.`,
        ]);
      }
    },
  );
  it("any other form is none of its business", () => {
    expect(checkWithholdingPeriod("2551Q", "whatever")).toBeNull();
    expect(checkWithholdingPeriod("1701", "")).toBeNull();
  });
});

describe("U17 R7, A6 · who files them: matched on the registered tax TYPE", () => {
  it("expanded withholding brings the 0619-E and 1601-EQ; compensation brings the 1601-C", () => {
    expect(
      registeredWithholding([
        { type: "Withholding Tax - Expanded", form: "", frequency: "" },
      ]),
    ).toEqual({
      expanded: true,
      compensation: false,
    });
    expect(
      registeredWithholding([{ type: "Withholding Tax - Compensation", form: "1601C" }]),
    ).toEqual({
      expanded: false,
      compensation: true,
    });
    expect(
      registeredWithholding([
        { type: "Value-Added Tax", form: "2550Q" },
        { type: "withholding tax - expanded (creditable)", form: "0619-E" },
        { type: "WITHHOLDING TAX - COMPENSATION", form: "1601-C" },
      ]),
    ).toEqual({ expanded: true, compensation: true });
  });
  it("the form column is never read: a blank or hyphenated form does not matter", () => {
    for (const form of ["", "0619E", "0619-E", "1601-EQ", undefined]) {
      expect(
        registeredWithholding([{ type: "Withholding Tax - Expanded", form }]).expanded,
      ).toBe(true);
    }
    // a form without the type is not a registration
    expect(registeredWithholding([{ type: "", form: "0619E" }])).toEqual({
      expanded: false,
      compensation: false,
    });
  });
  it("other withholding types and rubbish files nothing", () => {
    for (const raw of [
      [{ type: "Withholding Tax - Final" }],
      [{ type: "Value-Added Tax" }],
      [{ type: "Income Tax" }],
      [{ type: 5 }, null, "text", []],
      null,
      undefined,
      {},
      "Withholding Tax - Expanded",
      [],
    ]) {
      expect(registeredWithholding(raw)).toEqual({
        expanded: false,
        compensation: false,
      });
    }
  });
});
