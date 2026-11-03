/**
 * track-a-confirmation.spec.ts — U18 (hermetic): reading the BIR's confirmation e-mail
 * (a Gmail print saved as PDF) and checking it against a return. The real PDF reader
 * runs over fixture PDFs built with pdf-lib; every TIN, name and address is invented.
 *
 *   T-names   the file-name shapes: four VERIFIED, five DERIVED from the Portal's own
 *             fileName functions, the amended "V" suffix, branch 3 or 5 digits
 *   T-text    the date and time received (12 AM and 12 PM), the sender, the wrapping
 *   T-checks  every check, in order, with the exact words a person reads
 *   T-timing  the period's end and the due date (weekend moved), the late-days count
 */
import { confirmationPdf, VERIFIED } from "../../test/helpers/confirmation-pdf";
import {
  fileName1701,
  fileName1701A,
  fileName1701Q,
  fileName1702Q,
  fileName1702RT,
  fileName2550Q,
  fileName2551Q,
} from "../bir-forms/engine";
import type { Filing, Taxpayer } from "../bir-forms/engine";
import { parseBirFileName } from "./bir-file-name";
import {
  evaluateConfirmation,
  type DuplicateHit,
  type DuplicateQuery,
  type ExpectedReturn,
} from "./confirmation-checks";
import { CONFIRMATION_FORMS, MAX_CONFIRMATION_BYTES } from "./confirmation-forms";
import { parseReceived, readConfirmationText } from "./confirmation-text";
import { extractPdfText } from "./pdf-text";
import { dueDateFor, periodEndFor } from "./return-timing";

jest.setTimeout(60_000);

const NOW = new Date("2026-11-03T04:00:00.000Z"); // noon in Manila

const tp = { tin: "111222333", branch: "00000" } as Taxpayer;
const filing = (period: string, data: Record<string, unknown> = {}) =>
  ({ period, data }) as unknown as Filing;

const expected = (over: Partial<ExpectedReturn> = {}): ExpectedReturn => ({
  form: "2550Q",
  period: "2026-Q1",
  clientTin: "111222333",
  clientBranch: "00000",
  fyEndMonth: 12,
  fiscalYearStart: null,
  ...over,
});

async function run(
  spec: Parameters<typeof confirmationPdf>[0],
  exp: ExpectedReturn = expected(),
  find: (q: DuplicateQuery) => Promise<DuplicateHit | null> = async () => null,
) {
  const bytes = await confirmationPdf(spec);
  return evaluateConfirmation({ bytes, expected: exp, now: NOW, findDuplicate: find });
}
const byId = (r: Awaited<ReturnType<typeof run>>, id: string) =>
  r.checks.find((c) => c.id === id)!;

describe("U18 · the form list", () => {
  it("covers the nine returns and not the 1601C, the 2307 or the 2316", () => {
    expect([...CONFIRMATION_FORMS].sort()).toEqual(
      [
        "0619E",
        "1601EQ",
        "1701",
        "1701A",
        "1701Q",
        "1702Q",
        "1702RT",
        "2550Q",
        "2551Q",
      ].sort(),
    );
    for (const no of ["1601C", "2307", "2316"])
      expect(CONFIRMATION_FORMS.has(no)).toBe(false);
  });
});

describe("U18 T-names · the BIR file name", () => {
  it("reads the four VERIFIED shapes", () => {
    expect(parseBirFileName(VERIFIED["2550Q"])).toMatchObject({
      tin: "111222333",
      branch: 0,
      branchDigits: 3,
      form: "2550Q",
      version: "2024",
      fyEndMonth: 12,
      taxYear: 2026,
      quarter: 1,
      month: null,
      amendment: null,
      shape: "verified",
    });
    expect(parseBirFileName(VERIFIED["1701Q"])).toMatchObject({
      form: "1701Q",
      version: "2018",
      fyEndMonth: null,
      taxYear: 2025,
      quarter: 3,
      branchDigits: 3,
      shape: "verified",
    });
    expect(parseBirFileName(VERIFIED["1601EQ"])).toMatchObject({
      form: "1601EQ",
      version: null,
      taxYear: 2026,
      quarter: 3,
      branchDigits: 5,
      branch: 0,
      shape: "verified",
    });
    expect(parseBirFileName(VERIFIED["0619E"])).toMatchObject({
      form: "0619E",
      version: null,
      taxYear: 2026,
      month: 7,
      quarter: null,
      branchDigits: 5,
      shape: "verified",
    });
  });

  it("takes the first nine digits as the TIN and compares the branch as a number", () => {
    const a = parseBirFileName("111222333000-2550Qv2024-122026Q1.xml")!;
    const b = parseBirFileName("11122233300000-2550Qv2024-122026Q1.xml")!;
    const c = parseBirFileName("11122233300012-2550Qv2024-122026Q1.xml")!;
    expect(a.tin).toBe("111222333");
    expect(a.branch).toBe(b.branch); // 000 and 00000: the head office, both
    expect(c.branch).toBe(12);
    expect(c.tin).toBe("111222333");
  });

  it("reads the DERIVED shapes the Portal's own fileName functions write", () => {
    const cases: Array<[string, string, Partial<ReturnType<typeof parseBirFileName>>]> = [
      ["2551Q", fileName2551Q(filing("2026-Q1"), tp), { taxYear: 2026, quarter: 1 }],
      ["1701Q", fileName1701Q(filing("2026-Q2"), tp), { taxYear: 2026, quarter: 2 }],
      ["1701", fileName1701(filing("2025", { year: "2025" }), tp), { taxYear: 2025 }],
      ["1701A", fileName1701A(filing("2025", { year: "2025" }), tp), { taxYear: 2025 }],
      ["1702Q", fileName1702Q(filing("2026-Q3"), tp), { taxYear: 2026, quarter: 3 }],
      ["1702RT", fileName1702RT(filing("2025", { year: "2025" }), tp), { taxYear: 2025 }],
      ["2550Q", fileName2550Q(filing("2026-Q4"), tp), { taxYear: 2026, quarter: 4 }],
    ];
    for (const [form, name, want] of cases) {
      const parsed = parseBirFileName(name);
      expect({ name, parsed: parsed && { form: parsed.form } }).toEqual({
        name,
        parsed: { form },
      });
      expect(parsed).toMatchObject({ tin: "111222333", branch: 0, ...want });
    }
    // the shapes that are verified stay marked verified; the others are derived
    expect(parseBirFileName(fileName2551Q(filing("2026-Q1"), tp))!.shape).toBe("derived");
    expect(
      parseBirFileName(fileName1702RT(filing("2025", { year: "2025" }), tp))!.shape,
    ).toBe("derived");
  });

  it("accepts an optional V and a number just before .xml (unverified) and records it", () => {
    expect(parseBirFileName("111222333000-2550Qv2024-122026Q1V2.xml")).toMatchObject({
      form: "2550Q",
      amendment: 2,
    });
    expect(parseBirFileName("11122233300000-1601EQ-2026Q3V1.xml")).toMatchObject({
      form: "1601EQ",
      amendment: 1,
    });
  });

  it("refuses what does not parse", () => {
    for (const bad of [
      "",
      "report.xml",
      "111222333000-9999Q-2026Q1.xml",
      "1112223-2550Qv2024-122026Q1.xml",
      "111222333000-2550Qv2024-132026Q1.xml", // month 13
      "111222333000-2550Qv2024-122026Q5.xml", // quarter 5
      "11122233300000-0619E-132026.xml", // month 13
      "11122233300000-0619E-072026.pdf",
      "111222333000-2550Qv2024-122026Q1.xml.exe",
    ]) {
      expect({ bad, parsed: parseBirFileName(bad) }).toEqual({ bad, parsed: null });
    }
  });
});

describe("U18 T-text · the date and time received", () => {
  it("reads dates like 25 April 2026 and times like 11:40 AM and 02:44 PM", () => {
    expect(parseReceived("25 April 2026", "11:40 AM")).toMatchObject({
      ok: true,
      date: "2026-04-25",
      time: "11:40",
    });
    expect(parseReceived("5 August 2026", "02:44 PM")).toMatchObject({
      ok: true,
      date: "2026-08-05",
      time: "14:44",
    });
  });

  it("handles 12 AM and 12 PM correctly, in Manila time", () => {
    const am = parseReceived("1 July 2026", "12:05 AM");
    const pm = parseReceived("1 July 2026", "12:05 PM");
    expect(am).toMatchObject({ ok: true, time: "00:05" });
    expect(pm).toMatchObject({ ok: true, time: "12:05" });
    if (am.ok && pm.ok) {
      expect(am.at.toISOString()).toBe("2026-06-30T16:05:00.000Z"); // 00:05 +08:00
      expect(pm.at.toISOString()).toBe("2026-07-01T04:05:00.000Z"); // 12:05 +08:00
    }
  });

  it("refuses what it cannot read", () => {
    for (const [d, t] of [
      ["31 February 2026", "11:40 AM"],
      ["25 Aprilx 2026", "11:40 AM"],
      ["25 April 2026", "13:40 PM"],
      ["25 April 2026", "11:75 AM"],
      ["25 April 2026", "noon"],
      ["", "11:40 AM"],
      ["25 April 2026", ""],
    ] as const) {
      expect({ d, t, ok: parseReceived(d, t).ok }).toEqual({ d, t, ok: false });
    }
  });

  it("finds the sender, the title, the sentence, the file name and the received lines", async () => {
    const text = await extractPdfText(await confirmationPdf({ splitRuns: true }));
    expect(readConfirmationText(text)).toEqual({
      fromBir: true,
      fileName: "111222333000-2550Qv2024-122026Q1.xml",
      dateText: "25 April 2026",
      timeText: "11:40 AM",
    });
  });

  it("reads a file name that the print wrapped over two lines", async () => {
    const text = await extractPdfText(await confirmationPdf({ wrapFileName: true }));
    expect(readConfirmationText(text).fileName).toBe(
      "111222333000-2550Qv2024-122026Q1.xml",
    );
  });

  it("is not from the BIR unless the sender, the title and the sentence are all there", async () => {
    for (const spec of [
      { sender: null },
      { title: null },
      { sentence: null },
      { sender: "someone@example.test" },
    ]) {
      const t = readConfirmationText(await extractPdfText(await confirmationPdf(spec)));
      expect({ spec, fromBir: t.fromBir }).toEqual({ spec, fromBir: false });
    }
  });
});

describe("U18 T-checks · all nine, in order", () => {
  it("passes a right confirmation: every check ok, overall ok, the Manila date to file on", async () => {
    const r = await run({});
    expect(r.ok).toBe(true);
    expect(r.checks.map((c) => [c.n, c.id, c.status])).toEqual([
      [1, "bir-email", "ok"],
      [2, "file-name", "ok"],
      [3, "taxpayer", "ok"],
      [4, "form", "ok"],
      [5, "period", "ok"],
      [6, "received", "ok"],
      [7, "duplicate", "ok"],
      [8, "timing", "ok"], // received 25 April, after the quarter and before the 27 April due date
      [9, "upload", "ok"],
    ]);
    expect(r.errors).toEqual([]);
    expect(r.filedOn).toBe("2026-04-25");
    expect(r.parsed).toMatchObject({
      birFileName: "111222333000-2550Qv2024-122026Q1.xml",
      form: "2550Q",
      taxYear: 2026,
      quarter: 1,
      fyEndMonth: 12,
      receivedAt: "2026-04-25T03:40:00.000Z",
    });
    expect(r.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("1. not from the BIR", async () => {
    const r = await run({ sender: "someone@example.test" });
    expect(r.ok).toBe(false);
    expect(byId(r, "bir-email")).toMatchObject({
      status: "error",
      message: "This is not a BIR eBIRForms confirmation email.",
    });
  });

  it("2. a file name that does not parse", async () => {
    for (const fileName of [null, "report.xml"]) {
      const r = await run({ fileName });
      expect(byId(r, "file-name")).toMatchObject({
        status: "error",
        message:
          "The BIR file name could not be read. Upload the confirmation email printed from Gmail as a PDF.",
      });
    }
  });

  it("3. the wrong TIN; the wrong branch; 3 and 5 digits of a head office are the same", async () => {
    const wrongTin = await run({ fileName: "999888777000-2550Qv2024-122026Q1.xml" });
    expect(byId(wrongTin, "taxpayer")).toMatchObject({
      status: "error",
      message: "The confirmation is for TIN 999-888-777-000, not this client.",
    });
    const wrongBranch = await run({ fileName: "111222333001-2550Qv2024-122026Q1.xml" });
    expect(byId(wrongBranch, "taxpayer")).toMatchObject({
      status: "error",
      message: "The confirmation is for TIN 111-222-333-001, not this client.",
    });
    const five = await run({ fileName: "11122233300000-2550Qv2024-122026Q1.xml" });
    expect(byId(five, "taxpayer").status).toBe("ok"); // 00000 = 000, the head office
    expect(
      byId(
        await run(
          { fileName: "11122233300012-2550Qv2024-122026Q1.xml" },
          expected({ clientBranch: "012" }),
        ),
        "taxpayer",
      ).status,
    ).toBe("ok"); // branch 12 whichever way it is written
    // a client with no TIN cannot be matched
    const none = await run({}, expected({ clientTin: null }));
    expect(byId(none, "taxpayer")).toMatchObject({
      status: "error",
      message:
        "This client has no TIN on file, so the confirmation cannot be matched to it.",
    });
  });

  it("4. the wrong form", async () => {
    const r = await run({ fileName: VERIFIED["1701Q"] });
    expect(byId(r, "form")).toMatchObject({
      status: "error",
      message: "The confirmation is for form 1701Q, not 2550Q.",
    });
  });

  it("5. the wrong year, quarter, month and fiscal-year-end month", async () => {
    expect(
      byId(await run({ fileName: "111222333000-2550Qv2024-122025Q1.xml" }), "period"),
    ).toMatchObject({
      status: "error",
      message: "The confirmation is for 2025 Q1, this return is 2026 Q1.",
    });
    expect(
      byId(
        await run(
          { fileName: "111222333000-2550Qv2024-122026Q1.xml" },
          expected({ period: "2026-Q3" }),
        ),
        "period",
      ),
    ).toMatchObject({
      status: "error",
      message: "The confirmation is for 2026 Q1, this return is 2026 Q3.",
    });
    // the 2550Q's file name carries the fiscal-year-end month; the client's is June
    expect(
      byId(
        await run(
          { fileName: "111222333000-2550Qv2024-122026Q1.xml" },
          expected({ fyEndMonth: 6 }),
        ),
        "period",
      ),
    ).toMatchObject({
      status: "error",
      message:
        "The confirmation is for a fiscal year ending in December, this client's fiscal year ends in June.",
    });
    expect(
      byId(
        await run(
          { fileName: "111222333000-2550Qv2024-062026Q1.xml" },
          expected({ fyEndMonth: 6 }),
        ),
        "period",
      ).status,
    ).toBe("ok");
    // the 0619E: the month
    const july = expected({ form: "0619E", period: "2026-08" });
    expect(
      byId(await run({ fileName: VERIFIED["0619E"] }, july), "period"),
    ).toMatchObject({
      status: "error",
      message: "The confirmation is for July 2026, this return is August 2026.",
    });
    // the 1701Q has no fiscal-year-end month in its file name: nothing to compare
    expect(
      byId(
        await run(
          { fileName: VERIFIED["1701Q"] },
          expected({ form: "1701Q", period: "2025-Q3", fyEndMonth: 6 }),
        ),
        "period",
      ).status,
    ).toBe("ok");
    // an annual form: the year
    const annual = expected({ form: "1701A", period: "2025" });
    const derived = fileName1701A(filing("2024", { year: "2024" }), tp);
    expect(byId(await run({ fileName: derived }, annual), "period")).toMatchObject({
      status: "error",
      message: "The confirmation is for 2024, this return is 2025.",
    });
  });

  it("6. a date or time that is missing, unreadable, or in the future", async () => {
    const words =
      "The date and time the BIR received the return could not be read. Upload the confirmation email printed from Gmail as a PDF.";
    for (const spec of [
      { date: null },
      { time: null },
      { date: "31 February 2026" },
      { time: "25:00 AM" },
    ]) {
      const r = await run(spec);
      expect({ spec, check: byId(r, "received") }).toEqual({
        spec,
        check: expect.objectContaining({ status: "error", message: words }),
      });
      expect(r.filedOn).toBeNull();
    }
    const future = await run({ date: "4 November 2026", time: "11:40 AM" });
    expect(byId(future, "received")).toMatchObject({
      status: "error",
      message: "The date the BIR received the return is in the future.",
    });
  });

  it("6. uses the Date and Time received lines, never the sent line (received before it was sent)", async () => {
    const ok = await run(
      {
        fileName: VERIFIED["0619E"],
        date: "18 August 2026",
        time: "11:17 PM",
        sentOn: "Wed, 19 Aug 2026, 1:44 am",
      },
      expected({ form: "0619E", period: "2026-07" }),
    );
    expect(ok.filedOn).toBe("2026-08-18");
    expect(ok.parsed!.receivedAt).toBe("2026-08-18T15:17:00.000Z");
  });

  it("the four verified shapes pass against their own returns", async () => {
    const cases: Array<
      [keyof typeof VERIFIED, ExpectedReturn, { date: string; time: string }]
    > = [
      [
        "2550Q",
        expected({ form: "2550Q", period: "2026-Q1" }),
        { date: "27 April 2026", time: "09:15 AM" },
      ],
      [
        "1701Q",
        expected({ form: "1701Q", period: "2025-Q3" }),
        { date: "10 November 2025", time: "02:44 PM" },
      ],
      [
        "1601EQ",
        expected({ form: "1601EQ", period: "2026-Q3" }),
        { date: "2 November 2026", time: "12:05 PM" },
      ],
      [
        "0619E",
        expected({ form: "0619E", period: "2026-07" }),
        { date: "10 August 2026", time: "12:05 AM" },
      ],
    ];
    for (const [form, exp, when] of cases) {
      const r = await run({ fileName: VERIFIED[form], ...when }, exp);
      expect({ form, errors: r.errors }).toEqual({ form, errors: [] });
      expect(r.ok).toBe(true);
    }
  });

  it("7. a confirmation already attached to another return", async () => {
    const seen: Array<{ birFileName: string; receivedAt: string; sha256: string }> = [];
    const r = await run({}, expected(), async (q) => {
      seen.push({
        birFileName: q.birFileName!,
        receivedAt: q.receivedAt!.toISOString(),
        sha256: q.sha256,
      });
      return { form: "2550Q", clientName: "Invented Trading Co", period: "2026-Q1" };
    });
    expect(byId(r, "duplicate")).toMatchObject({
      status: "error",
      message:
        "This confirmation is already attached to 2550Q, Invented Trading Co, 2026-Q1.",
    });
    expect(r.ok).toBe(false);
    expect(seen).toEqual([
      {
        birFileName: "111222333000-2550Qv2024-122026Q1.xml",
        receivedAt: "2026-04-25T03:40:00.000Z",
        sha256: expect.stringMatching(/^[0-9a-f]{64}$/),
      },
    ]);
  });

  it("8. warns when received before the period ended, and after the due date with the days late", async () => {
    // 0619E for July 2026 received on 20 July: before the period (31 July) ended
    const early = await run(
      { fileName: VERIFIED["0619E"], date: "20 July 2026", time: "10:00 AM" },
      expected({ form: "0619E", period: "2026-07" }),
    );
    expect(early.ok).toBe(true);
    expect(byId(early, "timing")).toMatchObject({
      status: "warning",
      message:
        "The BIR received this return on 20 July 2026, before the period ended on 31 July 2026.",
    });
    // due 10 August 2026 (a Monday); received 12 August: 2 days late
    const late = await run(
      { fileName: VERIFIED["0619E"], date: "12 August 2026", time: "10:00 AM" },
      expected({ form: "0619E", period: "2026-07" }),
    );
    expect(late.ok).toBe(true);
    expect(byId(late, "timing")).toMatchObject({
      status: "warning",
      message:
        "The BIR received this return on 12 August 2026, 2 days after the due date of 10 August 2026.",
    });
    // one day late is "1 day"
    const one = await run(
      { fileName: VERIFIED["0619E"], date: "11 August 2026", time: "10:00 AM" },
      expected({ form: "0619E", period: "2026-07" }),
    );
    expect(byId(one, "timing").message).toContain("1 day after the due date");
    // on the due date: no warning
    const onTime = await run(
      { fileName: VERIFIED["0619E"], date: "10 August 2026", time: "11:59 PM" },
      expected({ form: "0619E", period: "2026-07" }),
    );
    expect(byId(onTime, "timing")).toMatchObject({ status: "ok" });
    // 2550Q for Q1 2026 is due 25 April, a Saturday, so Monday 27 April; 30 April is 3 days late
    const q1 = await run({ date: "30 April 2026", time: "10:00 AM" });
    expect(byId(q1, "timing").message).toBe(
      "The BIR received this return on 30 April 2026, 3 days after the due date of 27 April 2026.",
    );
    // the 1601-EQ for Q2 2026 is due 31 July 2026, a Friday; 3 August is 3 days late
    const eq = await run(
      {
        fileName: "11122233300000-1601EQ-2026Q2.xml",
        date: "3 August 2026",
        time: "10:00 AM",
      },
      expected({ form: "1601EQ", period: "2026-Q2" }),
    );
    expect(byId(eq, "timing").message).toContain(
      "3 days after the due date of 31 July 2026",
    );
    // warnings never block
    expect(eq.ok).toBe(true);
    expect(eq.warnings.length).toBe(1);
  });

  it("8. a form the Portal has no due date for gets no late warning", async () => {
    const past = await run(
      {
        fileName: fileName1701Q(filing("2026-Q2"), tp),
        date: "1 October 2026",
        time: "10:00 AM",
      },
      expected({ form: "1701Q", period: "2026-Q2" }),
    );
    expect(past.errors).toEqual([]);
    expect(byId(past, "timing").status).toBe("ok");
  });

  it("9. not a PDF, too large, or a picture", async () => {
    const notPdf = await evaluateConfirmation({
      bytes: Buffer.from("MZ not a pdf at all, just text and bytes"),
      expected: expected(),
      now: NOW,
      findDuplicate: async () => null,
    });
    expect(notPdf.ok).toBe(false);
    expect(byId(notPdf, "upload")).toMatchObject({
      status: "error",
      message: "The file is not a PDF.",
    });
    // the other checks are skipped, not reported against nothing
    expect(
      notPdf.checks.filter((c) => c.id !== "upload").every((c) => c.status === "skipped"),
    ).toBe(true);
    expect(notPdf.parsed).toBeNull();

    const big = await run({ padToBytes: MAX_CONFIRMATION_BYTES + 1 });
    expect(byId(big, "upload")).toMatchObject({
      status: "error",
      message: "The PDF is larger than 5 MB.",
    });
    const justRight = await run({ padToBytes: MAX_CONFIRMATION_BYTES });
    expect(byId(justRight, "upload").status).toBe("ok");

    const picture = await run({ pictureOnly: true });
    expect(byId(picture, "upload")).toMatchObject({
      status: "error",
      message:
        "This PDF is a picture. Print the email to PDF from Gmail instead of scanning it.",
    });
  });

  it("returns nothing of the header: no recipient name or address anywhere in the result", async () => {
    const r = await run({});
    const json = JSON.stringify(r);
    expect(json).not.toContain("owner@example.test");
    expect(json).not.toContain("Invented Recipient");
  });
});

describe("U18 T-timing · period end and due date", () => {
  it("the end of each period", () => {
    expect(periodEndFor("2550Q", "2026-Q1", null)).toBe("2026-03-31");
    expect(periodEndFor("2551Q", "2026-Q3", null)).toBe("2026-09-30");
    expect(periodEndFor("1701Q", "2026-Q2", null)).toBe("2026-06-30");
    expect(periodEndFor("1601EQ", "2026-Q4", null)).toBe("2026-12-31");
    expect(periodEndFor("0619E", "2026-02", null)).toBe("2026-02-28");
    expect(periodEndFor("0619E", "2028-02", null)).toBe("2028-02-29");
    expect(periodEndFor("1701", "2025", null)).toBe("2025-12-31");
    // a 2550Q of a fiscal year that began 1 June 2025 (ends May 2026): Q1 = Jun–Aug 2025
    expect(periodEndFor("2550Q", "2026-Q1", "2025-06-01")).toBe("2025-08-31");
    expect(periodEndFor("2550Q", "2026-Q4", "2025-06-01")).toBe("2026-05-31");
  });

  it("the due date, a weekend moved to the Monday, only where the Portal has one", () => {
    expect(dueDateFor("2550Q", "2026-Q1", null)).toBe("2026-04-27"); // 25th is a Saturday
    expect(dueDateFor("2551Q", "2026-Q2", null)).toBe("2026-07-27"); // 25 July 2026 is a Saturday
    expect(dueDateFor("0619E", "2026-07", null)).toBe("2026-08-10");
    expect(dueDateFor("1601EQ", "2026-Q3", null)).toBe("2026-11-02");
    expect(dueDateFor("1601EQ", "2026-Q4", null)).toBe("2027-02-01"); // 31 Jan 2027 is a Sunday
    for (const none of ["1701Q", "1701A", "1701", "1702Q", "1702RT"]) {
      expect({
        none,
        due: dueDateFor(none, none === "1701Q" ? "2026-Q1" : "2025", null),
      }).toEqual({
        none,
        due: null,
      });
    }
  });
});
