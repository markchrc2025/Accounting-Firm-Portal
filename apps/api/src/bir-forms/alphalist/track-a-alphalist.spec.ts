/**
 * track-a-alphalist.spec.ts — U19 (hermetic): the 1601-EQ alphalist, the QAP .DAT file.
 * Golden files compared byte for byte (CRLF on every line, the last included); the BIR
 * Validation program's rules the Portal repeats; the payee details and their conflicts.
 * Every TIN, name and amount is INVENTED.
 */
import { Prisma } from "@prisma/client";
import {
  agentName,
  branch4,
  checkModel,
  checkTotals,
  convertName,
  dashedTin,
  formulaHolds,
} from "./qap-rules";
import { buildSchedule1, type BookRecord } from "./payees";
import { payeeDetailsOf } from "../../purchase-transactions/import/expense-import.rules";
import { qapFileName, totalsOf, writeQap, type AlphalistModel } from "./qap-writer";

const D = (v: string) => new Prisma.Decimal(v);
const CRLF = "\r\n";
const lines = (...l: string[]) => l.join(CRLF) + CRLF;

const AGENT = { tin: "111222333", branch: "0000", name: "SAMPLE AGENT CORP", rdo: "045" };

function model(over: Partial<AlphalistModel> = {}): AlphalistModel {
  return {
    version: 1,
    period: "09/2026",
    agent: AGENT,
    schedule1: [
      {
        seq: 1,
        tin: "123456789",
        branch: "0000",
        registeredName: "",
        lastName: "DELA CRUZ",
        firstName: "JUAN",
        middleName: "SANTOS",
        atc: "WC158",
        rate: "1.00",
        income: "300000.00",
        tax: "3000.00",
      },
      {
        seq: 2,
        tin: "987654321",
        branch: "0001",
        registeredName: "SAMPLE SUPPLIER INC",
        lastName: "",
        firstName: "",
        middleName: "",
        atc: "WC160",
        rate: "2.00",
        income: "300000.00",
        tax: "6000.00",
      },
    ],
    schedule2: [],
    ...over,
  };
}

const S1_ONLY = lines(
  'HQAP,H1601EQ,111222333,0000,"SAMPLE AGENT CORP",09/2026,045',
  'D1,1601EQ,1,123456789,0000,"","DELA CRUZ","JUAN","SANTOS",09/2026,WC158,1.00,300000.00,3000.00',
  'D1,1601EQ,2,987654321,0001,"SAMPLE SUPPLIER INC","","","",09/2026,WC160,2.00,300000.00,6000.00',
  "C1,1601EQ,111222333,0000,09/2026,600000.00,9000.00",
);

describe("U19 · the QAP file, byte for byte", () => {
  it("Schedule 1 only: header, one line per payee and ATC and rate, the control line; CRLF on every line, the last too", () => {
    const text = writeQap(model());
    expect(text).toBe(S1_ONLY);
    // no bare LF anywhere, and the file ends with CRLF
    expect((text.match(/\n/g) ?? []).length).toBe((text.match(/\r\n/g) ?? []).length);
    expect(text.endsWith("\r\n")).toBe(true);
    expect(Buffer.from(text, "ascii").subarray(-2)).toEqual(Buffer.from([0x0d, 0x0a]));
  });

  it("Schedules 1 and 2: Schedule 2 follows the Schedule 1 control line, with 12 and 6 fields", () => {
    const m = model({
      schedule2: [
        {
          seq: 1,
          tin: "123456789",
          branch: "0000",
          registeredName: "",
          lastName: "DELA CRUZ",
          firstName: "JUAN",
          middleName: "SANTOS",
          atc: "DI900",
          income: "300000.00",
        },
      ],
    });
    const text = writeQap(m);
    expect(text).toBe(
      S1_ONLY +
        lines(
          'D2,1601EQ,1,123456789,0000,"","DELA CRUZ","JUAN","SANTOS",09/2026,DI900,300000.00',
          "C2,1601EQ,111222333,0000,09/2026,300000.00",
        ),
    );
    const d2 = text.split(CRLF).find((l) => l.startsWith("D2,"))!;
    expect(d2.split(",")).toHaveLength(12);
    expect(
      text
        .split(CRLF)
        .find((l) => l.startsWith("C2,"))!
        .split(","),
    ).toHaveLength(6);
  });

  it("Schedule 2 only is a file too; a file with neither schedule is not", () => {
    const m = model({
      schedule1: [],
      schedule2: [
        {
          seq: 1,
          tin: "987654321",
          branch: "0001",
          registeredName: "SAMPLE SUPPLIER INC",
          lastName: "",
          firstName: "",
          middleName: "",
          atc: "EI900",
          income: "1250.50",
        },
      ],
    });
    expect(writeQap(m)).toBe(
      lines(
        'HQAP,H1601EQ,111222333,0000,"SAMPLE AGENT CORP",09/2026,045',
        'D2,1601EQ,1,987654321,0001,"SAMPLE SUPPLIER INC","","","",09/2026,EI900,1250.50',
        "C2,1601EQ,111222333,0000,09/2026,1250.50",
      ),
    );
    expect(checkModel(model({ schedule1: [], schedule2: [] }))).toEqual([
      "The alphalist has no payees to list.",
    ]);
  });

  it("the field counts: header 7, D1 14, C1 7", () => {
    const rows = writeQap(model()).split(CRLF);
    expect(rows[0]!.split(",")).toHaveLength(7);
    expect(rows[1]!.split(",")).toHaveLength(14);
    expect(rows[3]!.split(",")).toHaveLength(7);
  });

  it("the file name: agent TIN 9, branch 4, MMYYYY, 1601EQ.DAT", () => {
    expect(qapFileName(model())).toBe("11122233300000920261601EQ.DAT");
    expect(
      qapFileName(model({ period: "12/2027", agent: { ...AGENT, branch: "0012" } })),
    ).toBe("11122233300121220271601EQ.DAT");
  });

  it("control totals are the sums of the detail lines, exactly (no float drift)", () => {
    const m = model();
    m.schedule1 = [0.1, 0.2, 0.3, 0.4].map((x, i) => ({
      ...m.schedule1[0]!,
      seq: i + 1,
      income: (x * 1000).toFixed(2),
      tax: x.toFixed(2),
      rate: "0.04",
    }));
    expect(totalsOf(m).schedule1).toEqual({ rows: 4, income: "1000.00", tax: "1.00" });
    expect(writeQap(m)).toContain("C1,1601EQ,111222333,0000,09/2026,1000.00,1.00" + CRLF);
  });
});

describe("U19 · branch codes and names", () => {
  it("000, 0000 and 00000 are all 0000; typed digits read as a number; more than 4 significant digits is refused", () => {
    for (const same of ["000", "0000", "00000", "", null, undefined, "0"]) {
      expect({ same, got: branch4(same) }).toEqual({ same, got: "0000" });
    }
    expect(branch4("00012")).toBe("0012");
    expect(branch4("1")).toBe("0001");
    expect(branch4("9999")).toBe("9999");
    expect(branch4("12345")).toBeNull();
    expect(branch4("0A1")).toBeNull();
  });

  it("TINs are shown 123-456-789", () => {
    expect(dashedTin("123456789")).toBe("123-456-789");
  });

  it("upper-cases, converts the enye (both cases) to N and says so; refuses every other forbidden character", () => {
    expect(convertName("dela Peña")).toEqual({
      value: "DELA PENA",
      enye: true,
      bad: null,
    });
    expect(convertName("Niño")).toEqual({ value: "NINO", enye: true, bad: null });
    expect(convertName("  Sample  Co  ")).toEqual({
      value: "SAMPLE  CO",
      enye: false,
      bad: null,
    });
    for (const c of ['"', "&", "'", ",", "|", "é", "€", "\t"]) {
      expect({ c, bad: convertName(`AB${c}CD`).bad }).toEqual({ c, bad: c });
    }
    expect(convertName("A-B. C/D (E) #1 +2 @3").bad).toBeNull(); // printable ASCII is fine
  });

  it("the agent's name: a company's registered name; an individual's LAST FIRST MIDDLE, single spaces, no comma", () => {
    expect(
      agentName({
        kind: "non-individual",
        regName: "Sample Agent Corp",
        businessName: "x",
      }),
    ).toBe("Sample Agent Corp");
    expect(
      agentName({ kind: "non-individual", regName: null, businessName: "Trade Name Co" }),
    ).toBe("Trade Name Co");
    expect(
      agentName({
        kind: "individual",
        businessName: "x",
        lastName: "Dela  Cruz",
        firstName: "Juan",
        middleName: "Santos",
      }),
    ).toBe("Dela Cruz Juan Santos");
    expect(
      agentName({
        kind: "individual",
        businessName: "x",
        lastName: "Reyes",
        firstName: "Ana",
        middleName: null,
      }),
    ).toBe("Reyes Ana");
  });
});

describe("U19 · the BIR Validation program's rules, repeated", () => {
  const msg = (m: AlphalistModel) => checkModel(m, new Set(["WC158", "WC160", "WI010"]));
  const row1 = (over: Record<string, string>) =>
    model({ schedule1: [{ ...model().schedule1[0]!, ...over }] });

  it("a clean model has no refusals", () => {
    expect(msg(model())).toEqual([]);
  });

  it("the agent: TIN 9 digits and not a dummy, branch 4 digits, RDO exactly 3 characters", () => {
    const withAgent = (a: Partial<typeof AGENT>) => model({ agent: { ...AGENT, ...a } });
    expect(msg(withAgent({ tin: "12345678" }))).toEqual([
      "The client's TIN must be exactly 9 digits.",
    ]);
    expect(msg(withAgent({ tin: "999999999" }))).toEqual([
      "The client's TIN 999-999-999 is not accepted by the BIR alphalist.",
    ]);
    expect(msg(withAgent({ tin: "111111111" }))).toEqual([
      "The client's TIN 111-111-111 is not accepted by the BIR alphalist.",
    ]);
    expect(msg(withAgent({ rdo: "" }))).toEqual([
      "Add the client's RDO code before making the alphalist.",
    ]);
    expect(msg(withAgent({ rdo: "45" }))).toEqual([
      "The client's RDO code must be 3 characters.",
    ]);
    expect(msg(withAgent({ name: "SAMPLE & CO" }))).toEqual([
      "The name of the client contains &, which the BIR alphalist does not accept. Correct the name in the client record.",
    ]);
  });

  it("a payee's TIN: 9 digits, never 999999999 or 111111111", () => {
    expect(msg(row1({ tin: "12345678" }))).toEqual([
      "Payee 12345678 WC158: the TIN must be exactly 9 digits.",
    ]);
    expect(msg(row1({ tin: "999999999" }))).toEqual([
      "Payee 999-999-999 WC158: the TIN is not accepted by the BIR alphalist.",
    ]);
    expect(msg(row1({ tin: "111111111" }))).toEqual([
      "Payee 111-111-111 WC158: the TIN is not accepted by the BIR alphalist.",
    ]);
  });

  it("a payee needs a name; its characters are checked", () => {
    expect(
      msg(row1({ registeredName: "", lastName: "", firstName: "", middleName: "" })),
    ).toEqual(["Payee 123-456-789 WC158: the payee has no name."]);
    expect(msg(row1({ lastName: "DELA, CRUZ" }))).toEqual([
      "The name of payee 123-456-789 contains ,, which the BIR alphalist does not accept. Correct the name in the payee record.",
    ]);
  });

  it("the ATC must be in the table; the rate at most 99", () => {
    expect(msg(row1({ atc: "WC999" }))).toEqual([
      "Payee 123-456-789 WC999: the ATC is not in the BIR ATC table.",
    ]);
    expect(msg(row1({ rate: "99.00", tax: "297000.00" }))).toEqual([]);
    expect(msg(row1({ rate: "99.01", tax: "297030.00" }))).toEqual([
      "Payee 123-456-789 WC158: the rate 99.01% is more than 99.",
    ]);
  });

  it("Schedule 1 income and tax are not zero; Schedule 2 income is not zero", () => {
    expect(msg(row1({ income: "0.00", tax: "0.00" }))).toEqual([
      "Payee 123-456-789 WC158: the income payment and the tax withheld must not be zero.",
    ]);
    expect(msg(row1({ tax: "0.00" }))[0]).toBe(
      "Payee 123-456-789 WC158: the income payment and the tax withheld must not be zero.",
    );
    const s2 = model({
      schedule1: [],
      schedule2: [
        {
          seq: 1,
          tin: "123456789",
          branch: "0000",
          registeredName: "X",
          lastName: "",
          firstName: "",
          middleName: "",
          atc: "DI900",
          income: "0.00",
        },
      ],
    });
    expect(msg(s2)).toEqual([
      "Payee 123-456-789 DI900: the income payment must not be zero.",
    ]);
    // Schedule 2's ATC is checked for shape only: the seed holds none
    const odd = { ...s2, schedule2: [{ ...s2.schedule2[0]!, atc: "", income: "5.00" }] };
    expect(msg(odd)).toEqual(["Payee 123-456-789: the Schedule 2 ATC is blank."]);
    expect(
      msg({
        ...s2,
        schedule2: [{ ...s2.schedule2[0]!, atc: "di 900", income: "5.00" }],
      })[0],
    ).toContain("Schedule 2 ATC");
  });

  it("the formula: income x rate / 100 equals the tax, after dropping centavos or after rounding (the BIR's own check)", () => {
    // 300000.00 at 2.00% is 6000.00
    expect(formulaHolds(D("300000.00"), D("2"), D("6000.00")).ok).toBe(true);
    // dropping centavos: 100.50 x 3% = 3.015 -> whole 3; tax 3.40 -> whole 3: holds
    expect(formulaHolds(D("100.50"), D("3"), D("3.40"))).toEqual({
      ok: true,
      computed: "3.02",
    });
    // rounding to 2 decimals: 3.015 -> 3.02 (half up); tax 3.02 holds
    expect(formulaHolds(D("100.50"), D("3"), D("3.02")).ok).toBe(true);
    // holds only by rounding: 66.50 x 3% = 1.995, rounded 2.00; dropping centavos gives 1 against 2
    expect(formulaHolds(D("66.50"), D("3"), D("2.00")).ok).toBe(true);
    // neither: 6000.00 vs 6001.00
    expect(formulaHolds(D("300000.00"), D("2"), D("6001.00"))).toEqual({
      ok: false,
      computed: "6000.00",
    });
    expect(msg(row1({ rate: "2.00", tax: "6001.00" }))).toEqual([
      "Payee 123-456-789 WC158: 300000.00 at 2.00% is 6000.00, but the tax withheld is 6001.00.",
    ]);
  });

  it("the Schedule 1 total tax must equal the return's Item 19, both figures in the refusal", () => {
    expect(checkTotals(model(), "9000.00")).toBeNull();
    expect(checkTotals(model(), "9100.00")).toBe(
      "The alphalist's total tax withheld is 9000.00, but the 1601-EQ's total taxes withheld (Item 19) is 9100.00.",
    );
    expect(checkTotals(model({ schedule1: [] }), "0.00")).toBeNull();
  });
});

describe("U19 · Schedule 1 from the books: payees, details, conflicts", () => {
  let n = 0;
  const rec = (over: Partial<BookRecord>): BookRecord => ({
    tin: "123-456-789",
    branch: "00000",
    vendor: "DELA CRUZ JUAN",
    kind: "individual",
    last: "dela cruz",
    first: "juan",
    middle: null,
    atc: "WC158",
    ratePct: D("1"),
    net: D("100000.00"),
    wht: D("1000.00"),
    at: new Date(Date.UTC(2026, 6, 1, 0, 0, n++)),
    ...over,
  });
  const build = (records: BookRecord[]) =>
    buildSchedule1(records, new Set(["WC158", "WC160"]));

  it("groups by payee TIN, branch, ATC and rate, sums income and tax exactly, orders by TIN, numbers from 1", () => {
    const r = build([
      rec({
        tin: "987654321",
        branch: "00001",
        vendor: "SAMPLE SUPPLIER INC",
        kind: "non_individual",
        last: null,
        first: null,
        atc: "WC160",
        ratePct: D("2"),
        net: D("300000.00"),
        wht: D("6000.00"),
      }),
      rec({ net: D("100000.10"), wht: D("1000.00") }),
      rec({ net: D("199999.90"), wht: D("2000.00") }),
    ]);
    expect(r.refusals).toEqual([]);
    expect(r.rows).toEqual([
      {
        seq: 1,
        tin: "123456789",
        branch: "0000",
        registeredName: "",
        lastName: "DELA CRUZ",
        firstName: "JUAN",
        middleName: "",
        atc: "WC158",
        rate: "1.00",
        income: "300000.00",
        tax: "3000.00",
      },
      {
        seq: 2,
        tin: "987654321",
        branch: "0001",
        registeredName: "SAMPLE SUPPLIER INC",
        lastName: "",
        firstName: "",
        middleName: "",
        atc: "WC160",
        rate: "2.00",
        income: "300000.00",
        tax: "6000.00",
      },
    ]);
  });

  it("two rates under one ATC are two rows", () => {
    const r = build([
      rec({ ratePct: D("1") }),
      rec({ ratePct: D("2"), net: D("50000.00"), wht: D("1000.00") }),
    ]);
    expect(r.rows.map((x) => [x.atc, x.rate, x.income, x.tax])).toEqual([
      ["WC158", "1.00", "100000.00", "1000.00"],
      ["WC158", "2.00", "50000.00", "1000.00"],
    ]);
  });

  it("the same TIN under different branches are different payees", () => {
    const r = build([rec({ branch: "000" }), rec({ branch: "00002" })]);
    expect(r.rows.map((x) => x.branch)).toEqual(["0000", "0002"]);
  });

  it("rows with blank details take the details of rows that have them", () => {
    const r = build([
      rec({}),
      rec({ kind: null, last: null, first: null }),
      rec({ kind: null, last: null, first: null, vendor: null }),
    ]);
    expect(r.refusals).toEqual([]);
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]!.lastName).toBe("DELA CRUZ");
  });

  it("converts the enye and reports it as a note, not a refusal", () => {
    const r = build([rec({ last: "Peña" })]);
    expect(r.refusals).toEqual([]);
    expect(r.rows[0]!.lastName).toBe("PENA");
    expect(r.notes).toEqual(["The name of payee 123-456-789 had Ñ; it is written as N."]);
  });

  it("refuses a forbidden character with the BIR's sentence", () => {
    const r = build([rec({ first: "juan & sons" })]);
    expect(r.refusals).toEqual([
      "The name of payee 123-456-789 contains &, which the BIR alphalist does not accept. Correct the name in the payee record.",
    ]);
  });

  it("one 409 lists every payee that needs details", () => {
    const r = build([
      rec({ kind: null, last: null, first: null }),
      rec({ tin: "987654321", kind: "individual", last: "Reyes", first: null }),
      rec({ tin: "555666777", kind: "individual", last: null, first: "Ana" }),
      rec({
        tin: "444555666",
        kind: "non_individual",
        vendor: " ",
        last: null,
        first: null,
      }),
      rec({ tin: "321654987", kind: null, last: "Lopez", first: "Mia" }),
    ]);
    expect(r.refusals).toEqual([
      "These payees need details before the alphalist can be made: 123-456-789 (choose individual or company), 321-654-987 (choose individual or company), 444-555-666 (company name), 555-666-777 (last name), 987-654-321 (first name).",
    ]);
    expect(r.rows).toEqual([]);
  });

  it("an individual with neither name part given needs 'last and first name'", () => {
    const r = build([
      rec({ tin: "987654321", kind: "individual", last: null, first: null, vendor: "X" }),
      rec({ tin: "987654321", kind: "individual", last: " ", first: "", vendor: "X" }),
    ]);
    expect(r.refusals[0]).toContain("987-654-321 (last and first name)");
  });

  it("rows that HAVE details and disagree are refused, in one sentence for every such payee", () => {
    const r = build([
      rec({}),
      rec({}),
      rec({ middle: "S" }),
      rec({
        tin: "222333444",
        kind: "non_individual",
        vendor: "ACME INC",
        last: null,
        first: null,
      }),
      rec({ tin: "222333444", kind: "individual", last: "Acme", first: "Joe" }),
    ]);
    expect(r.refusals).toEqual([
      "These payees have different details on different expenses: 123-456-789 (DELA CRUZ JUAN on 2 expenses, DELA CRUZ JUAN S on 1 expense), 222-333-444 (company ACME INC on 1 expense, individual ACME JOE on 1 expense). Make them the same, then try again.",
    ]);
  });

  it("agreement after upper-casing and trimming is not a conflict", () => {
    const r = build([
      rec({ last: " dela cruz ", first: "JUAN" }),
      rec({ last: "DELA CRUZ", first: "juan " }),
    ]);
    expect(r.refusals).toEqual([]);
  });

  it("vendor names that differ for one company TIN are also a conflict; blank vendors are ignored", () => {
    const co = { kind: "non_individual", last: null, first: null } as const;
    const r = build([
      rec({ ...co, tin: "777888999", vendor: "ACME INC" }),
      rec({ ...co, tin: "777888999", vendor: "Acme Inc " }),
      rec({ ...co, tin: "777888999", vendor: null }),
      rec({ ...co, tin: "888999000", vendor: "BETA CORP" }),
      rec({ ...co, tin: "888999000", vendor: "BETA CORPORATION" }),
    ]);
    expect(r.refusals).toEqual([
      "These payees have different details on different expenses: 888-999-000 (BETA CORP on 1 expense, BETA CORPORATION on 1 expense). Make them the same, then try again.",
    ]);
  });

  it("a payee's TIN that is not 9 digits is refused by the expense it is on", () => {
    const r = build([rec({ tin: "12345" }), rec({ tin: null, vendor: "NO TIN CO" })]);
    expect(r.refusals).toEqual([
      "An expense for DELA CRUZ JUAN has a vendor TIN that is not 9 digits (12345). Correct it on the expense.",
      "An expense for NO TIN CO has no vendor TIN. Add it on the expense.",
    ]);
  });

  it("refuses a branch of more than 4 significant digits, a missing rate, and a row that fails the formula", () => {
    expect(build([rec({ branch: "12345" })]).refusals).toEqual([
      "Payee 123-456-789: the branch code 12345 has more than 4 significant digits.",
    ]);
    expect(build([rec({ ratePct: null })]).refusals).toEqual([
      "Payee 123-456-789 WC158: the ATC table has no rate for WC158.",
    ]);
    expect(build([rec({ wht: D("1001.00") })]).refusals).toEqual([
      "Payee 123-456-789 WC158: 100000.00 at 1.00% is 1000.00, but the tax withheld is 1001.00.",
    ]);
    expect(build([rec({ net: D("0.00"), wht: D("5.00") })]).refusals).toEqual([
      "Payee 123-456-789 WC158: the income payment and the tax withheld must not be zero.",
    ]);
  });
});

describe("U19 · the Expenses import keeps the payee's name columns as the alphalist reads them", () => {
  it("a registered name is a company; a last or first name is an individual; nothing given is nothing", () => {
    expect(payeeDetailsOf({ regName: " Sample Supplier Inc ", lastName: "x" })).toEqual({
      payeeKind: "non_individual",
      payeeLastName: null,
      payeeFirstName: null,
      payeeMiddleName: null,
    });
    expect(
      payeeDetailsOf({ lastName: "Dela Cruz", firstName: "Juan", middleName: "" }),
    ).toEqual({
      payeeKind: "individual",
      payeeLastName: "Dela Cruz",
      payeeFirstName: "Juan",
      payeeMiddleName: null,
    });
    expect(payeeDetailsOf({ lastName: "Reyes" }).payeeKind).toBe("individual");
    expect(payeeDetailsOf({ tradeName: "Only A Trade Name" } as never)).toEqual({
      payeeKind: null,
      payeeLastName: null,
      payeeFirstName: null,
      payeeMiddleName: null,
    });
    expect(payeeDetailsOf({}).payeeKind).toBeNull();
  });
});
