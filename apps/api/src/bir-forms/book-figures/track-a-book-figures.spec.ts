/**
 * track-a-book-figures.spec.ts — U15 (hermetic): the rounding rule, the quarter a
 * return covers, and the draft's _source check. Invented figures only.
 */
import { Prisma } from "@prisma/client";
import type { Filing, Taxpayer } from "../engine/types";
import { build2550Q } from "../engine/build2550Q";
import { compute2550Q } from "../engine/compute2550Q";
import { assertValidDraftSource } from "../draft-source";
import { bookQuarter } from "./book-period";
import { roundToNearestWholePesoHalfUp } from "./round-to-whole-peso";

describe("U15 R3 · to the nearest whole peso, 50 centavos and above up, in exact decimals", () => {
  it.each([
    ["0.49", 0],
    ["0.50", 1],
    ["0.51", 1],
    ["1.49", 1],
    ["1.50", 2],
    ["120000.49", 120000],
    ["50000.50", 50001],
    ["0", 0],
    ["999999999999.50", 1000000000000],
    ["0.4999999999999999", 0],
    ["0.5000000000000001", 1],
  ])("%s → %s", (amount, peso) => {
    expect(roundToNearestWholePesoHalfUp(amount)).toBe(peso);
  });

  it("takes a Decimal, a string or a number alike", () => {
    expect(roundToNearestWholePesoHalfUp(new Prisma.Decimal("2.50"))).toBe(3);
    expect(roundToNearestWholePesoHalfUp(2.5)).toBe(3);
    expect(roundToNearestWholePesoHalfUp("2.5")).toBe(3);
  });

  it("is exact where floating point is not: 100 × 0.30 is 30, and 7 × 0.07 + 0.01 is the half peso", () => {
    const hundred = Array.from({ length: 100 }, () => new Prisma.Decimal("0.30")).reduce(
      (a, b) => a.plus(b),
      new Prisma.Decimal(0),
    );
    expect(roundToNearestWholePesoHalfUp(hundred)).toBe(30);
    const half = Array.from({ length: 7 }, () => new Prisma.Decimal("0.07"))
      .reduce((a, b) => a.plus(b), new Prisma.Decimal(0))
      .plus("0.01");
    expect(half.toString()).toBe("0.5");
    expect(roundToNearestWholePesoHalfUp(half)).toBe(1);
  });

  it("never answers -0", () => {
    expect(Object.is(roundToNearestWholePesoHalfUp("-0.40"), -0)).toBe(false);
    expect(roundToNearestWholePesoHalfUp("-0.40")).toBe(0);
  });
});

describe("U15 · the quarter a return covers", () => {
  const at = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

  it.each([
    ["2026-Q1", null, "2026-01-01", "2026-03-31"],
    ["2026-Q2", null, "2026-04-01", "2026-06-30"],
    ["2026-Q3", null, "2026-07-01", "2026-09-30"],
    ["2026-Q4", null, "2026-10-01", "2026-12-31"],
    ["2028-Q1", null, "2028-01-01", "2028-03-31"], // a leap year
    ["2026-q3", null, "2026-07-01", "2026-09-30"], // the case of the Q does not matter
    ["  2026-Q3 ", null, "2026-07-01", "2026-09-30"],
    ["2026-Q3", "2026-01-01", "2026-07-01", "2026-09-30"], // a January start is calendar
    ["2027-Q2", "2026-07-01", "2026-10-01", "2026-12-31"],
    ["2027-Q4", "2026-07-01", "2027-04-01", "2027-06-30"],
    ["2028-Q4", "2027-03-01", "2027-12-01", "2028-02-29"],
  ])("%s with a fiscal year from %s is %s to %s", (period, start, from, to) => {
    expect(bookQuarter(period, start ? at(start) : null)).toEqual({ from, to });
  });

  it.each(["", "2026", "2026-Q5", "2026-Q0", "Q3-2026", "26-Q3", "2026-3", "2026-Q3-1"])(
    "%j is not a period",
    (period) => {
      expect(bookQuarter(period, null)).toBeNull();
    },
  );

  // The 2550Q's own export (U13 F4) is the rule the feeder follows: for every start
  // month and every quarter, the dates the export prints are the dates the books are read for.
  const tp: Taxpayer = {
    id: "tp1",
    kind: "non-individual",
    regName: "INVENTED TRADING CORP",
    lastName: "",
    firstName: "",
    middleName: "",
    tin: "000123456",
    branch: "00000",
    rdo: "038",
    address: "1 Invented St",
    city: "Lungsod ng Halimbawa",
    zip: "0000",
    birthdate: "",
    email: "",
    phone: "",
    citizenship: "",
    civilStatus: "",
    taxpayerType: "",
    classification: "",
    createdAt: 0,
  };
  const exportedRange = (period: string, fiscalYearStart: string) => {
    const f: Filing = {
      id: "f1",
      form: "2550Q",
      taxpayerId: "tp1",
      status: "filed",
      period,
      data: {},
      createdAt: 0,
      updatedAt: 0,
    };
    const xml = build2550Q(f, tp, compute2550Q(f.data), { fiscalYearStart });
    const field = (k: string) =>
      new RegExp(`<div>frm2550qv2024:${k}=(.*?)frm2550qv2024:${k}=</div>`).exec(xml)![1]!;
    const iso = (us: string) => {
      const [m, d, y] = us.split("/") as [string, string, string];
      return `${y}-${m.padStart(2, "0")}-${d}`;
    };
    return {
      from: iso(field("RtnPeriodFromNo4")),
      to: iso(field("RtnPeriodToNo4")),
    };
  };

  it.each(
    [2027, 2028].flatMap((year) =>
      Array.from({ length: 12 }, (_, i) => i + 1).flatMap((month) =>
        [1, 2, 3, 4].map((q) => [year, month, q] as const),
      ),
    ),
  )(
    "%i, a fiscal year from month %i, Q%i: the books are read for the dates the export prints",
    (year, month, q) => {
      const start = `2026-${String(month).padStart(2, "0")}-01`;
      expect(bookQuarter(`${year}-Q${q}`, at(start))).toEqual(
        exportedRange(`${year}-Q${q}`, start),
      );
    },
  );
});

describe("U15 R5 · the draft's _source", () => {
  const source = {
    mode: "books",
    asOf: "2026-10-12T01:02:03.000Z",
    fed: { i31a: "600000" },
    edited: ["i31a"],
  };

  it("a draft with no data, no _source or a good one passes", () => {
    expect(() => assertValidDraftSource(undefined)).not.toThrow();
    expect(() => assertValidDraftSource({ i31a: "1" })).not.toThrow();
    expect(() => assertValidDraftSource({ _source: source })).not.toThrow();
    expect(() =>
      assertValidDraftSource({
        _source: { ...source, mode: "manual", fed: {}, edited: [] },
      }),
    ).not.toThrow();
    expect(() =>
      assertValidDraftSource({
        _source: { ...source, asOf: "2026-10-12T09:02:03+08:00" },
      }),
    ).not.toThrow();
  });

  it.each([
    ["mode", { ...source, mode: "auto" }],
    ["asOf", { mode: "books", fed: {}, edited: [] }],
    ["asOf", { ...source, asOf: "yesterday" }],
    ["edited", { ...source, edited: "i31a" }],
    ["edited", { ...source, edited: [1] }],
    ["fed", { ...source, fed: ["i31a"] }],
    ["fed", { ...source, fed: null }],
  ])("a bad %s is refused, naming it", (name, bad) => {
    expect(() => assertValidDraftSource({ _source: bad })).toThrow(
      new RegExp(`^The draft's _source isn't valid\\. ${name}(\\.\\d+)?: `),
    );
  });

  it.each([["books"], [null], [7], [[]]])("%j instead of an object is refused", (bad) => {
    expect(() => assertValidDraftSource({ _source: bad })).toThrow(
      /^The draft's _source isn't valid\. /,
    );
  });
});
