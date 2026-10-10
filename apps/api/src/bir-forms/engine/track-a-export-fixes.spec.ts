/**
 * track-a-export-fixes.spec.ts — U13 R3 (hermetic): the edges of F1–F4 in the
 * builders themselves. Invented taxpayers only.
 */
import type { Filing, Taxpayer } from "./types";
import { build2550Q, fileName2550Q } from "./build2550Q";
import { build2551Q } from "./build2551Q";
import { compute2550Q } from "./compute2550Q";
import { compute2551Q } from "./compute2551Q";
import { ExportRefusal, manilaDate } from "./export-refusal";

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

const filing = (
  form: "2551Q" | "2550Q",
  period: string,
  data: Filing["data"],
): Filing => ({
  id: "f1",
  form,
  taxpayerId: "tp1",
  status: "filed",
  period,
  data,
  createdAt: 0,
  updatedAt: 0,
});

const field = (xml: string, key: string) =>
  new RegExp(`<div>${key}=(.*?)${key}=</div>`).exec(xml)?.[1];

describe("U13 F1 · Schedule 1 rows the export cannot carry refuse it", () => {
  const build = (rows: Array<Record<string, string>>) => {
    const f = filing("2551Q", "2026-Q3", { rows });
    return () => build2551Q(f, tp, compute2551Q(f.data));
  };

  it("an amount with no ATC refuses, naming the row", () => {
    expect(build([{ atc: "PT010", taxable: "100" }, { taxable: "50" }])).toThrow(
      new ExportRefusal(
        "Schedule 1, row 2 has an amount but no ATC. Choose its ATC or remove the row, then export again.",
      ),
    );
  });

  it("a seventh counted row refuses: the form has six", () => {
    const rows = Array.from({ length: 7 }, () => ({
      atc: "PT010",
      taxable: "1",
      rate: "3",
    }));
    expect(build(rows)).toThrow(/^Schedule 1, row 7: the form has room for 6 rows\./);
  });

  it("blank rows (no ATC, no amount), wherever they sit, are fine", () => {
    const xml = build([
      {},
      { atc: "PT010", taxable: "100", rate: "3" },
      {},
      {},
      {},
      {},
      {},
    ])();
    expect([field(xml, "drpATC1"), field(xml, "drpATC2")]).toEqual(["0", "1"]);
  });
});

describe("U13 F3 · the Manila calendar", () => {
  it("a filing late on 24 October UTC is dated 25 October in Manila", () => {
    expect(manilaDate(new Date("2026-10-24T15:59:59.000Z"))).toBe("2026/10/24");
    expect(manilaDate(new Date("2026-10-24T16:00:00.000Z"))).toBe("2026/10/25");
  });

  it("the builder writes the date it is given", () => {
    const f = filing("2550Q", "2026-Q3", {});
    expect(
      field(
        build2550Q(f, tp, compute2550Q(f.data), { dateFiled: "2026/10/25" }),
        "dateFiled",
      ),
    ).toBe("2026/10/25");
  });
});

describe("U13 F4 · fiscal quarters, by start month", () => {
  const range = (period: string, fiscalYearStart: string | null) => {
    const f = filing("2550Q", period, {});
    const xml = build2550Q(f, tp, compute2550Q(f.data), { fiscalYearStart });
    const NS = "frm2550qv2024:";
    return [field(xml, `${NS}RtnPeriodFromNo4`), field(xml, `${NS}RtnPeriodToNo4`)];
  };

  it.each([
    ["2027-Q2", "2026-07-01", ["10/01/2026", "12/31/2026"]],
    ["2027-Q4", "2026-07-01", ["4/01/2027", "6/30/2027"]],
    ["2027-Q1", "2026-04-01", ["4/01/2026", "6/30/2026"]],
    ["2027-Q4", "2026-11-01", ["8/01/2027", "10/31/2027"]],
    ["2028-Q4", "2027-03-01", ["12/01/2027", "2/29/2028"]], // leap February
    ["2026-Q2", "2026-01-01", ["4/01/2026", "6/30/2026"]], // a January start is calendar
    ["2026-Q4", null, ["10/01/2026", "12/31/2026"]],
  ])("%s with a fiscal year from %s", (period, start, expected) => {
    expect(range(period, start)).toEqual(expected);
  });

  it("the filename carries the year-end month", () => {
    const f = filing("2550Q", "2027-Q1", {});
    expect(fileName2550Q(f, tp, { fiscalYearStart: "2026-07-01" })).toBe(
      "0001234560002550Qv2024062027Q1.xml",
    );
    expect(fileName2550Q(f, tp)).toBe("0001234560002550Qv2024122027Q1.xml");
  });
});

describe("U13 F2 · item 13 needs an individual's first quarter", () => {
  it("a fiscal-year individual's first quarter is asked; a corporation never is", () => {
    const indiv = { ...tp, kind: "individual" as const };
    const f = filing("2551Q", "2026-Q1", { itRate: "eight", periodType: "fiscal" });
    const xml = build2551Q(f, indiv, compute2551Q(f.data));
    expect([
      field(xml, "frm2551Qv2018:taxRate1"),
      field(xml, "frm2551Qv2018:taxRate2"),
    ]).toEqual(["false", "true"]);
    const corp = build2551Q(f, tp, compute2551Q(f.data));
    expect([
      field(corp, "frm2551Qv2018:taxRate1"),
      field(corp, "frm2551Qv2018:taxRate2"),
    ]).toEqual(["false", "false"]);
  });
});
