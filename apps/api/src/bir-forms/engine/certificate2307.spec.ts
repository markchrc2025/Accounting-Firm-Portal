// certificate2307.spec.ts — C7 (D56): the rows the print engine reads for a 2307.
import {
  build2307PrintRows,
  certificateFileName,
  formatTin,
  mmddyyyy,
  registeredName,
  tin14,
} from "./certificate2307";
import { ExportRefusal } from "./export-refusal";
import type { FilingData } from "./types";

const PAYOR = {
  kind: "non-individual",
  regName: "HALIMBAWA TRADING CORP",
  businessName: "KUBO DISPLAY",
  tin: "000111222",
  branch: "00000",
  address: "12 Invented St",
  city: "Lungsod ng Halimbawa",
  zip: "0000",
};

const rowsOf = (data: FilingData, payor = PAYOR, filed = false, period = "2026-Q3") =>
  Object.fromEntries(build2307PrintRows(data, payor, { filed, period }));

describe("registeredName (W7 R6)", () => {
  it("an individual is LAST, FIRST MIDDLE; anyone else, the registered name; never a trade or display name", () => {
    expect(
      registeredName({
        kind: "individual",
        lastName: "A",
        firstName: "B",
        middleName: "C",
      }),
    ).toBe("A, B C");
    expect(registeredName({ kind: "individual", lastName: "A", firstName: "B" })).toBe(
      "A, B",
    );
    expect(registeredName({ kind: "individual", lastName: "A", firstName: "" })).toBe("");
    expect(registeredName({ kind: "non-individual", regName: " CORP " })).toBe("CORP");
    expect(
      registeredName({ kind: "non-individual", regName: "", businessName: "X" }),
    ).toBe("");
  });
});

describe("TIN, date and file-name helpers", () => {
  it("tin14: nine digits and the five-digit branch, from the TIN or the branch given", () => {
    expect(tin14("000-333-444", "00000")).toBe("00033344400000");
    expect(tin14("000333444007", "")).toBe("00033344400007");
    expect(tin14("000-333-444-00007", "00001")).toBe("00033344400007");
    expect(tin14("12345", "00000")).toBe("12345");
    expect(tin14("000333444", "")).toBe("000333444");
  });
  it("formatTin groups the digits", () => {
    expect(formatTin("00033344400000")).toBe("000-333-444-00000");
    expect(formatTin("000333444")).toBe("000-333-444");
    expect(formatTin("")).toBe("");
  });
  it("mmddyyyy: MM/DD/YYYY, an ISO date or digits; at most eight digits", () => {
    expect(mmddyyyy("01/15/2025")).toBe("01152025");
    expect(mmddyyyy("2025-01-15")).toBe("01152025");
    expect(mmddyyyy("0115202599")).toBe("01152025");
    expect(mmddyyyy("")).toBe("");
  });
  it("certificateFileName is the editor's own: payor TIN + branch, form, period", () => {
    expect(certificateFileName("2307", "2026-Q3", "000-111-222")).toBe(
      "000111222000-2307-2026-Q3.pdf",
    );
    expect(certificateFileName("2307", "2026-Q3", "000111222005")).toBe(
      "000111222005-2307-2026-Q3.pdf",
    );
    expect(certificateFileName("2307", "2026-Q3", null)).toBe("2307-2026-Q3.pdf");
  });
});

describe("build2307PrintRows", () => {
  it("Item 1 is the quarter's first and last day on the calendar year; no quarter means the first", () => {
    for (const [q, from, to] of [
      ["1", "01012026", "03312026"],
      ["2", "04012026", "06302026"],
      ["3", "07012026", "09302026"],
      ["4", "10012026", "12312026"],
      ["", "01012026", "03312026"],
    ] as const) {
      const r = rowsOf({ year: "2026", quarter: q });
      expect([r["c2307:periodFrom"], r["c2307:periodTo"]]).toEqual([from, to]);
    }
    // read from the period when the data does not carry them
    const p = rowsOf({}, PAYOR, false, "2025-Q2");
    expect([p["c2307:periodFrom"], p["c2307:periodTo"]]).toEqual([
      "04012025",
      "06302025",
    ]);
    expect(rowsOf({ year: "" }, PAYOR, false, "")["c2307:periodFrom"]).toBeUndefined();
  });

  it("the payor: the registered name, never the business name; the address joins address and city", () => {
    const r = rowsOf({ year: "2026" });
    expect(r["c2307:payorName"]).toBe("HALIMBAWA TRADING CORP");
    expect(r["c2307:payorAddress"]).toBe("12 Invented St, Lungsod ng Halimbawa");
    expect([
      r["c2307:payorTin1"],
      r["c2307:payorTin2"],
      r["c2307:payorTin3"],
      r["c2307:payorBranch"],
    ]).toEqual(["000", "111", "222", "00000"]);
  });

  it("a draft without its payor's BIR name is refused in the editor's words; an issued certificate falls back to its business name", () => {
    const bare = { ...PAYOR, regName: "" };
    expect(() => rowsOf({ year: "2026" }, bare, false)).toThrow(ExportRefusal);
    expect(() => rowsOf({ year: "2026" }, bare, false)).toThrow(
      "Complete the client's registered name (or last and first name for an individual) before printing this certificate.",
    );
    expect(rowsOf({ year: "2026" }, bare, true)["c2307:payorName"]).toBe("KUBO DISPLAY");
    // …and an issued certificate with no name at all still prints (blank), never refused
    expect(
      rowsOf({ year: "2026" }, { ...bare, businessName: "" }, true)["c2307:payorName"],
    ).toBeUndefined();
  });

  it("the payee's CONFORME block falls back to the payee's own name and TIN; the payor's does not", () => {
    const r = rowsOf({
      year: "2026",
      payeeName: "DELA CRUZ, JUANA",
      payeeTin: "000-333-444",
      payeeBranch: "00000",
      payeeSignatoryName: "",
      payeeSignatoryTitle: "",
      payeeSignatoryTin: "",
      payorSignatoryName: "",
      payorSignatoryTin: "",
    });
    expect(r["c2307:payeeSigName"]).toBe("DELA CRUZ, JUANA");
    expect(r["c2307:payeeSigTitleTin"]).toBe("TIN 000-333-444-00000");
    expect(r["c2307:payorSigName"]).toBeUndefined();
    expect(r["c2307:payorSigTitleTin"]).toBeUndefined();
  });

  it("signatory lines are read under the older keys too (a certificate issued before the replica)", () => {
    const r = rowsOf({
      payorName: "OLD SIGNER",
      payorTitle: "OWNER",
      payorTaxAgentNo: "TA-1",
    });
    expect(r["c2307:payorSigName"]).toBe("OLD SIGNER");
    expect(r["c2307:payorSigTitleTin"]).toBe("OWNER");
    expect(r["c2307:payorAgentNo"]).toBe("TA-1");
  });

  it("a certificate with nothing in 4A, 5, a branch or block B prints without error and leaves them out", () => {
    const r = rowsOf({
      year: "2025",
      quarter: "4",
      payeeName: "X",
      payeeTin: "000123456",
      rows: [{ atc: "WI010", m1: "100" }],
    });
    for (const k of [
      "payeeZip",
      "payeeForeignAddress",
      "payeeBranch",
      "b1Desc",
      "bTotalIncome",
      "bTotalTax",
    ])
      expect([k, r[`c2307:${k}`]]).toEqual([k, undefined]);
    expect(r["c2307:aTotalIncome"]).toBe("100.00");
  });

  it("block A: a row's total is the sum of its three months, written to the centavo; floats do not leak", () => {
    const r = rowsOf({
      rows: [
        { atc: "WI010", desc: "A", m1: "0.1", m2: "0.2", m3: "0.3", tax: "0.07" },
        { atc: "WI010", desc: "B", m1: "1,234.56", m2: "0.01", m3: "", tax: "12.34" },
      ],
    });
    expect(r["c2307:a1Total"]).toBe("0.60"); // 0.1 + 0.2 + 0.3 = 0.6000000000000001 in floats
    expect(r["c2307:a2Total"]).toBe("1234.57");
    expect(r["c2307:aTotalM1"]).toBe("1234.66");
    expect(r["c2307:aTotalM2"]).toBe("0.21");
    expect(r["c2307:aTotalM3"]).toBe("0.30");
    expect(r["c2307:aTotalIncome"]).toBe("1235.17");
    expect(r["c2307:aTotalTax"]).toBe("12.41");
  });

  it("an untouched row prints no total, and a block with no amount prints no Total row", () => {
    const r = rowsOf({ rows: [{ atc: "WI010", desc: "ONLY A LABEL" }], rowsB: [{}] });
    expect(r["c2307:a1Desc"]).toBe("ONLY A LABEL");
    expect(r["c2307:a1Total"]).toBeUndefined();
    expect(r["c2307:aTotalIncome"]).toBeUndefined();
    expect(r["c2307:bTotalIncome"]).toBeUndefined();
  });

  it("amounts are passed through as typed: the print engine writes the centavos; nothing is rounded here", () => {
    const r = rowsOf({ rows: [{ atc: "WI010", m1: "12.345", tax: "1,000.5" }] });
    expect(r["c2307:a1M1"]).toBe("12.345");
    expect(r["c2307:a1Tax"]).toBe("1,000.5");
  });

  it("block B is read from rowsB, with its own Total row", () => {
    const r = rowsOf({
      rowsB: [
        { atc: "WB010", desc: "MONEY", m1: "10", m2: "20.50", m3: "0.25", tax: "1" },
      ],
    });
    expect(r["c2307:b1Total"]).toBe("30.75");
    expect(r["c2307:bTotalIncome"]).toBe("30.75");
    expect(r["c2307:bTotalTax"]).toBe("1.00");
    expect(r["c2307:aTotalIncome"]).toBeUndefined();
  });

  it("more rows than the form has room for is refused, naming the block", () => {
    const eleven = Array.from({ length: 11 }, () => ({ atc: "WI010", m1: "1" }));
    expect(() => rowsOf({ rows: eleven })).toThrow(/block A.*room for 10/);
    expect(() => rowsOf({ rowsB: eleven })).toThrow(/block B.*room for 10/);
  });

  it("no key is emitted twice", () => {
    const rows = build2307PrintRows(
      {
        year: "2026",
        quarter: "2",
        rows: [{ atc: "WI010", m1: "1" }],
        rowsB: [{ m1: "2" }],
      },
      PAYOR,
      { filed: false },
    );
    const keys = rows.map(([k]) => k);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
