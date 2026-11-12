// withholding-print.spec.ts — C9 (D57): the rows the print engine reads for the 0619-E,
// 1601-EQ and 1601-C. Invented taxpayers and figures only.
import { ExportRefusal } from "./export-refusal";
import type { FilingData, Taxpayer } from "./types";
import {
  build0619EPrintRows,
  build1601CPrintRows,
  build1601EQPrintRows,
  buildWithholdingPrintRows,
  negativeAmountSentence,
  withholdingPrintBaseName,
} from "./withholding-print";

const CORP: Taxpayer = {
  id: "c",
  kind: "non-individual",
  regName: "INVENTED CORP",
  lastName: "",
  firstName: "",
  middleName: "",
  tin: "123-456-789",
  branch: "00000",
  rdo: "044",
  address: "1 Invented St",
  city: "Halimbawa",
  zip: "1234",
  birthdate: "",
  email: "",
  phone: "",
  citizenship: "",
  civilStatus: "",
  taxpayerType: "",
  classification: "",
  createdAt: 0,
};
const PERSON: Taxpayer = {
  ...CORP,
  kind: "individual",
  regName: "",
  lastName: "SAMPLE",
  firstName: "TESTA",
  middleName: "INVENTED",
  tin: "987654321",
  branch: "00003",
};

const rowsOf = (r: [string, string][]) => Object.fromEntries(r);
const eq = (d: FilingData, tp = CORP, period = "2026-Q3") =>
  rowsOf(build1601EQPrintRows(d, tp, period));
const zeroC = (d: FilingData = {}, tp = CORP, period = "2026-08") =>
  rowsOf(build1601CPrintRows(d, tp, period));
const e0619 = (d: FilingData = {}, tp = CORP, period = "2026-08") =>
  rowsOf(build0619EPrintRows(d, tp, period));
const refusal = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(ExportRefusal);
    return (e as Error).message;
  }
  throw new Error("not refused");
};

describe("the refusal sentence (the owner's, C9 ruling 1)", () => {
  it("names the form as the paper does and the item", () => {
    expect(negativeAmountSentence("1601C", "Item 26")).toBe(
      "A negative amount cannot be printed on the 1601-C yet: the BIR blank has no place for a minus sign. Item 26 is negative.",
    );
    expect(negativeAmountSentence("1601C", "Schedule I row 2")).toBe(
      "A negative amount cannot be printed on the 1601-C yet: the BIR blank has no place for a minus sign. Schedule I row 2 is negative.",
    );
    expect(negativeAmountSentence("0619E", "Item 16")).toMatch(/on the 0619-E yet/);
    expect(negativeAmountSentence("1601EQ", "Item 31")).toMatch(/on the 1601-EQ yet/);
  });
});

describe("what all three share", () => {
  it("the period column is the authority, never the typed year, month or quarter", () => {
    expect(e0619({ year: "1999", month: "01" })["f0619E:month"]).toBe("082026");
    expect(zeroC({ year: "1999", month: "01" })["f1601C:month"]).toBe("082026");
    const q = eq({ year: "1999", quarter: "1st" }, CORP, "2026-Q4");
    expect([q["f1601EQ:year"], q["f1601EQ:q4"], q["f1601EQ:q1"]]).toEqual([
      "2026",
      "true",
      undefined,
    ]);
  });

  it("the taxpayer block: TIN groups and branch, RDO, name, address with the city, ZIP", () => {
    const r = e0619({}, PERSON);
    expect([
      r["f0619E:tin1"],
      r["f0619E:tin2"],
      r["f0619E:tin3"],
      r["f0619E:branch"],
    ]).toEqual(["987", "654", "321", "00003"]);
    expect(r["f0619E:rdo"]).toBe("044");
    expect(r["f0619E:name"]).toBe("SAMPLE, TESTA INVENTED");
    expect(r["f0619E:address"]).toBe("1 Invented St, Halimbawa");
    expect(r["f0619E:zip"]).toBe("1234");
    expect(e0619({}, CORP)["f0619E:name"]).toBe("INVENTED CORP");
  });

  it("the signature goes on the For Individual or For Non-Individual side by the taxpayer's kind", () => {
    const d = {
      signatoryName: "A SIGNER",
      signatoryTitle: "OWNER",
      signatoryTin: "111222333",
    };
    const ind = e0619(d, PERSON);
    expect([
      ind["f0619E:sigIndName"],
      ind["f0619E:sigIndTitleTin"],
      ind["f0619E:sigNonName"],
    ]).toEqual(["A SIGNER", "OWNER / TIN 111-222-333", undefined]);
    const non = e0619(d, CORP);
    expect([non["f0619E:sigNonName"], non["f0619E:sigIndName"]]).toEqual([
      "A SIGNER",
      undefined,
    ]);
  });

  it("Yes and No come from the data; a return not marked amended is No; an unanswered 'any taxes withheld' ticks neither", () => {
    expect(e0619({ amended: "yes", anyWithheld: "yes" })).toMatchObject({
      "f0619E:amendedYes": "true",
      "f0619E:anyYes": "true",
    });
    const none = e0619({});
    expect([
      none["f0619E:amendedNo"],
      none["f0619E:anyYes"],
      none["f0619E:anyNo"],
    ]).toEqual(["true", undefined, undefined]);
    expect(e0619({ anyWithheld: "no" })["f0619E:anyNo"]).toBe("true");
  });

  it("category, contact and e-mail are what was typed; blanks are left out; case is kept", () => {
    const r = e0619({
      category: "government",
      contact: "0917-000-0000",
      email: "A@B.example",
    });
    expect([
      r["f0619E:catGovernment"],
      r["f0619E:catPrivate"],
      r["f0619E:contact"],
      r["f0619E:email"],
    ]).toEqual(["true", undefined, "0917-000-0000", "A@B.example"]);
    expect(e0619({})["f0619E:email"]).toBeUndefined();
  });

  it("the tax agent's dates print as MM/DD/YYYY; payments: dates too, amounts as typed, the tax debit memo's bank never", () => {
    const r = e0619({
      taxAgentNo: "TA-1",
      taxAgentIssueDate: "2025-01-15",
      taxAgentExpiryDate: "2028-01-14",
      payCashDate: "2026-09-09",
      payCashAmount: "1,000.50",
      payTaxDebitBank: "NOT PRINTED",
      payTaxDebitNumber: "T1",
    });
    expect([
      r["f0619E:agentIssue"],
      r["f0619E:agentExpiry"],
      r["f0619E:cashDate"],
    ]).toEqual(["01/15/2025", "01/14/2028", "09/09/2026"]);
    expect(r["f0619E:cashAmount"]).toBe("1,000.50");
    expect(r["f0619E:debitNumber"]).toBe("T1");
    expect(JSON.stringify(r)).not.toMatch(/NOT PRINTED/);
  });

  it("the ATC and tax type code the blanks pre-print are never emitted", () => {
    for (const r of [e0619({}), eq({}), zeroC({})])
      expect(Object.keys(r).filter((k) => /atc$|taxType|typeCode/i.test(k))).toEqual([]);
  });

  it("no key is emitted twice", () => {
    for (const rows of [
      build0619EPrintRows({ remittance: "1" }, CORP, "2026-08"),
      build1601EQPrintRows(
        { rows: [{ atc: "WC158", base: "1", rate: "1", withheld: "1" }] },
        CORP,
        "2026-Q3",
      ),
      build1601CPrintRows(
        { scheduleRows: [{ month: "2026-05", taxPaid: "1", shouldBe: "2" }] },
        CORP,
        "2026-08",
      ),
    ]) {
      const keys = rows.map(([k]) => k);
      expect(new Set(keys).size).toBe(keys.length);
    }
  });

  it("the file name is the TIN and branch, the form and the period; without a TIN, the form and period", () => {
    expect(withholdingPrintBaseName("0619E", "2026-08", PERSON)).toBe(
      "987654321003-0619E-2026-08",
    );
    expect(withholdingPrintBaseName("1601EQ", "2026-Q3", CORP)).toBe(
      "123456789000-1601EQ-2026-Q3",
    );
    expect(withholdingPrintBaseName("1601C", "2026-08", { ...CORP, tin: "" })).toBe(
      "1601C-2026-08",
    );
  });

  it("buildWithholdingPrintRows is the one door for all three", () => {
    for (const form of ["0619E", "1601EQ", "1601C"] as const)
      expect(
        buildWithholdingPrintRows(
          form,
          {},
          CORP,
          form === "1601EQ" ? "2026-Q3" : "2026-08",
        ).length,
      ).toBeGreaterThan(5);
  });
});

describe("0619-E", () => {
  it("Item 2 prints what was typed, else the month's default; typed amounts as typed, totals exact", () => {
    expect(e0619({ dueDate: "2026-09-11" })["f0619E:dueDate"]).toBe("09/11/2026");
    expect(e0619({})["f0619E:dueDate"]).toBe("09/10/2026");
    const r = e0619({
      remittance: "12,345.67",
      previouslyRemitted: "1000.00",
      surcharge: "0.1",
      interest: "0.2",
      compromise: "0",
    });
    expect([r["f0619E:i14"], r["f0619E:i15"], r["f0619E:i16"], r["f0619E:i17a"]]).toEqual(
      ["12,345.67", "1000.00", "11345.67", "0.1"],
    );
    expect([r["f0619E:i17d"], r["f0619E:i18"]]).toEqual(["0.30", "11345.97"]); // not 0.30000000000000004
  });

  it("an empty draft prints its computed totals as 0.00 and nothing typed", () => {
    const r = e0619({});
    expect([r["f0619E:i14"], r["f0619E:i16"], r["f0619E:i17d"], r["f0619E:i18"]]).toEqual(
      [undefined, "0.00", "0.00", "0.00"],
    );
  });

  it("a negative figure is refused, naming the first negative item", () => {
    const m = (item: string) => negativeAmountSentence("0619E", item);
    expect(refusal(() => e0619({ remittance: "100", previouslyRemitted: "500" }))).toBe(
      m("Item 16"),
    );
    expect(refusal(() => e0619({ remittance: "-1" }))).toBe(m("Item 14"));
    expect(refusal(() => e0619({ surcharge: "-1" }))).toBe(m("Item 17A"));
    expect(refusal(() => e0619({ payCheckAmount: "-5" }))).toBe(m("Item 20"));
    expect(refusal(() => e0619({ payOthersAmount: "-5" }))).toBe(m("Item 22"));
  });
});

describe("1601-EQ", () => {
  const row = (atc: string, base: string, rate: string, withheld: string) => ({
    atc,
    base,
    rate,
    withheld,
  });

  it("each ATC row in its columns; a rate prints with its percent sign once; an unused row prints nothing", () => {
    const r = eq({
      rows: [
        row("WC158", "100000.00", "1", "1000.00"),
        row("WC050", "20,000.00", "0.5%", "100.00"),
        row("", "", "", ""),
      ],
    });
    expect([
      r["f1601EQ:r1Atc"],
      r["f1601EQ:r1Base"],
      r["f1601EQ:r1Rate"],
      r["f1601EQ:r1Withheld"],
    ]).toEqual(["WC158", "100000.00", "1%", "1000.00"]);
    expect([r["f1601EQ:r2Base"], r["f1601EQ:r2Rate"]]).toEqual(["20,000.00", "0.5%"]);
    expect(r["f1601EQ:r3Atc"]).toBeUndefined();
  });

  it("totals are the exact sums; typed amounts as typed; Items 25 and 31 follow", () => {
    const r = eq({
      rows: [
        row("WC158", "1", "1", "0.1"),
        row("WC160", "1", "2", "0.2"),
        row("WI010", "1", "5", "1234.56"),
      ],
      remittance1: "500",
      remittance2: "0.25",
      surcharge: "10",
    });
    expect([
      r["f1601EQ:i19"],
      r["f1601EQ:i20"],
      r["f1601EQ:i25"],
      r["f1601EQ:i26"],
      r["f1601EQ:i30"],
      r["f1601EQ:i31"],
    ]).toEqual(["1234.86", "500", "500.25", "734.61", "10.00", "744.61"]);
  });

  it("a seventh ATC is refused with the sentence the service already uses", () => {
    const rows = Array.from({ length: 7 }, (_, i) => row(`WC${i}00`, "1", "1", "1"));
    expect(refusal(() => eq({ rows }))).toBe("7 ATCs; the form has six rows.");
  });

  describe("an over-remittance (C9b): the figure in Items 26 and 31, one box ticked", () => {
    const OVER = {
      rows: [row("WC158", "100000.00", "1", "1000.00")],
      remittance1: "1,500.00",
      remittance2: "1,200.00",
    };
    const ticks = (r: Record<string, string>) =>
      ["overRefunded", "overTcc", "overCarried"].filter(
        (k) => r[`f1601EQ:${k}`] === "true",
      );

    it("Items 26 and 31 print the over-remittance as its absolute value, with no minus sign anywhere", () => {
      const r = eq({ ...OVER, overRemittanceChoice: "refunded" });
      expect([
        r["f1601EQ:i19"],
        r["f1601EQ:i25"],
        r["f1601EQ:i26"],
        r["f1601EQ:i30"],
        r["f1601EQ:i31"],
      ]).toEqual(["1000.00", "2700.00", "1700.00", "0.00", "1700.00"]);
      expect(Object.values(r).filter((v) => v.startsWith("-"))).toEqual([]);
    });

    it("the chosen box is ticked, and only that one: refunded, a tax credit certificate, carried over (quarters 1 to 3)", () => {
      for (const [choice, key] of [
        ["refunded", "overRefunded"],
        ["tcc", "overTcc"],
        ["carried", "overCarried"],
      ] as const) {
        for (const period of ["2026-Q1", "2026-Q2", "2026-Q3"])
          expect([
            choice,
            period,
            ticks(eq({ ...OVER, overRemittanceChoice: choice }, CORP, period)),
          ]).toEqual([choice, period, [key]]);
      }
    });

    it("an over-remittance with no box chosen is refused in the owner's words", () => {
      const sentence =
        "Choose what to do with the over-remittance: to be refunded, to be issued a Tax Credit Certificate, or to be carried over.";
      expect(refusal(() => eq({ ...OVER }))).toBe(sentence);
      expect(refusal(() => eq({ ...OVER, overRemittanceChoice: "" }))).toBe(sentence);
      expect(refusal(() => eq({ ...OVER, overRemittanceChoice: "somehow" }))).toBe(
        sentence,
      );
    });

    it("in the 4th quarter a saved 'carried' choice is already cleared, so it is refused like no choice; refunded and tcc print", () => {
      const sentence = refusal(() => eq({ ...OVER }, CORP, "2026-Q4"));
      expect(
        refusal(() => eq({ ...OVER, overRemittanceChoice: "carried" }, CORP, "2026-Q4")),
      ).toBe(sentence);
      // the period is the authority: a typed quarter of "3rd" does not bring "carried" back
      expect(
        refusal(() =>
          eq(
            { ...OVER, quarter: "3rd", overRemittanceChoice: "carried" },
            CORP,
            "2026-Q4",
          ),
        ),
      ).toBe(sentence);
      expect(
        ticks(eq({ ...OVER, overRemittanceChoice: "refunded" }, CORP, "2026-Q4")),
      ).toEqual(["overRefunded"]);
      expect(
        ticks(eq({ ...OVER, overRemittanceChoice: "tcc" }, CORP, "2026-Q4")),
      ).toEqual(["overTcc"]);
    });

    it("Item 26 negative but Item 31 positive (penalties larger than the over-remittance): Item 26 as its absolute value, Item 31 as tax due, nothing ticked, no choice needed", () => {
      const r = eq({
        ...OVER,
        surcharge: "1,000.00",
        interest: "500.00",
        compromise: "400.00",
        overRemittanceChoice: "refunded", // a stale choice is ignored: there is no over-remittance
      });
      expect([r["f1601EQ:i26"], r["f1601EQ:i30"], r["f1601EQ:i31"]]).toEqual([
        "1700.00",
        "1900.00",
        "200.00",
      ]);
      expect(ticks(r)).toEqual([]);
      expect(Object.values(r).filter((v) => v.startsWith("-"))).toEqual([]);
    });

    it("no over-remittance, no tick: tax still due prints as it did, a choice typed anyway is ignored", () => {
      const r = eq({
        rows: [row("WC158", "1", "1", "100")],
        remittance1: "40",
        overRemittanceChoice: "tcc",
      });
      expect([r["f1601EQ:i26"], r["f1601EQ:i31"]]).toEqual(["60.00", "60.00"]);
      expect(ticks(r)).toEqual([]);
    });
  });

  it("other negative items are still refused: a row's amount (Item 13+), a typed penalty (Item 28)", () => {
    const m = (item: string) => negativeAmountSentence("1601EQ", item);
    expect(refusal(() => eq({ rows: [row("WC158", "1", "1", "-1")] }))).toBe(
      m("Item 13"),
    );
    expect(
      refusal(() => eq({ rows: [row("a", "1", "1", "1"), row("b", "-5", "1", "1")] })),
    ).toBe(m("Item 14"));
    expect(
      refusal(() => eq({ rows: [row("WC158", "1", "1", "100")], interest: "-1" })),
    ).toBe(m("Item 28"));
  });

  it("page 2 carries the TIN with its branch and the name", () => {
    const r = eq({}, PERSON);
    expect([r["f1601EQ:p2Tin"], r["f1601EQ:p2Name"], r["f1601EQ:sheets"]]).toEqual([
      "98765432100003",
      "SAMPLE, TESTA INVENTED",
      undefined,
    ]);
    expect(eq({ sheetsAttached: "3 sheets" })["f1601EQ:sheets"]).toBe("3");
  });
});

describe("1601-C", () => {
  it("the computed Part II totals and the specify lines; a relief answer ticks Yes or No", () => {
    const r = zeroC({
      compensation: "250,000.00",
      mwe: "20000",
      otherNonTaxable: "1000.00",
      otherNonTaxableSpecify: "TRANSPORTATION",
      taxesWithheld: "15000.00",
      otherRemittances: "500.00",
      otherRemittancesSpecify: "ADVANCE",
      reliefYesNo: "yes",
    });
    expect([
      r["f1601C:i14"],
      r["f1601C:i21"],
      r["f1601C:i22"],
      r["f1601C:i27"],
      r["f1601C:i30"],
      r["f1601C:i31"],
      r["f1601C:i36"],
    ]).toEqual([
      "250,000.00",
      "21000.00",
      "229000.00",
      "15000.00",
      "500.00",
      "14500.00",
      "14500.00",
    ]);
    expect([
      r["f1601C:i20Specify"],
      r["f1601C:i29Specify"],
      r["f1601C:reliefYes"],
      r["f1601C:reliefNo"],
    ]).toEqual(["TRANSPORTATION", "ADVANCE", "true", undefined]);
  });

  it("Schedule I: a row prints when it holds anything, its adjustment is 6 less 5 to the centavo, the total when any row prints", () => {
    expect(zeroC({})["f1601C:sTotal"]).toBeUndefined();
    const r = zeroC({
      scheduleRows: [
        {
          month: "2026-05",
          datePaid: "2026-06-10",
          bank: "B",
          number: "N",
          taxPaid: "1000.10",
          shouldBe: "1250.85",
        },
        { month: "", datePaid: "", bank: "", number: "", taxPaid: "", shouldBe: "" },
        { month: "2026-07", taxPaid: "0.1", shouldBe: "0.4" },
      ],
    });
    expect([
      r["f1601C:s1Month"],
      r["f1601C:s1DatePaid"],
      r["f1601C:s1Adjustment"],
    ]).toEqual(["052026", "06/10/2026", "250.75"]);
    expect(r["f1601C:s2Adjustment"]).toBeUndefined();
    expect([r["f1601C:s3Adjustment"], r["f1601C:sTotal"], r["f1601C:i26"]]).toEqual([
      "0.30",
      "251.05",
      "251.05",
    ]);
  });

  it("negatives: the first negative item names itself; a Schedule I cell names its row", () => {
    const m = (where: string) => negativeAmountSentence("1601C", where);
    expect(refusal(() => zeroC({ compensation: "-1" }))).toBe(m("Item 14"));
    // the schedule's total is negative: Item 26 (Part II comes before Schedule I)
    expect(
      refusal(() => zeroC({ scheduleRows: [{ taxPaid: "10", shouldBe: "5" }] })),
    ).toBe(m("Item 26"));
    expect(refusal(() => zeroC({ taxesWithheld: "100", otherRemittances: "500" }))).toBe(
      m("Item 31"),
    );
    expect(
      refusal(() =>
        zeroC({
          scheduleRows: [
            { taxPaid: "100", shouldBe: "600" },
            { taxPaid: "300", shouldBe: "200" },
          ],
        }),
      ),
    ).toBe(m("Schedule I row 2"));
    expect(refusal(() => zeroC({ payCashAmount: "-1" }))).toBe(m("Item 37"));
  });

  it("zero is not negative, and -0.00 is not either", () => {
    expect(() => zeroC({ compensation: "0.00", taxesWithheld: "-0.00" })).not.toThrow();
  });
});

describe("U24 · the e-mail: the one typed in the draft, else the client's", () => {
  const withEmail = { ...CORP, email: "books@client.example", phone: "09181111111" };
  const cases: Array<[string, (d: FilingData, tp: Taxpayer) => Record<string, string>]> =
    [
      ["0619E", (d, tp) => e0619(d, tp)],
      ["1601EQ", (d, tp) => eq(d, tp)],
      ["1601C", (d, tp) => zeroC(d, tp)],
    ];
  it.each(cases)(
    "%s: a blank e-mail prints the client's; a typed one wins",
    (form, rows) => {
      const key = `f${form}:email`;
      expect(rows({}, withEmail)[key]).toBe("books@client.example");
      expect(rows({ email: "" }, withEmail)[key]).toBe("books@client.example");
      expect(rows({ email: "   " }, withEmail)[key]).toBe("books@client.example");
      expect(rows({ email: "typed@other.example" }, withEmail)[key]).toBe(
        "typed@other.example",
      );
    },
  );
  it.each(cases)(
    "%s: no e-mail anywhere leaves the item empty, and nothing is refused",
    (form, rows) => {
      expect(rows({}, CORP)[`f${form}:email`]).toBeUndefined();
    },
  );
  it.each(cases)(
    "%s: the contact number is unchanged (typed, else the client's)",
    (form, rows) => {
      const key = `f${form}:contact`;
      expect(rows({}, withEmail)[key]).toBe("09181111111");
      expect(rows({ contact: "09170000000" }, withEmail)[key]).toBe("09170000000");
    },
  );
});
