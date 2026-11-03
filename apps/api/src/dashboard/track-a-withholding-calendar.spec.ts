/**
 * track-a-withholding-calendar.spec.ts — U17 T3 (hermetic): the dashboard's filing
 * calendar lists the 0619-E (months 1 and 2 of each quarter), the 1601-EQ and the 1601-C
 * for clients whose registered tax types say they withhold, in the right months, with
 * the weekend rule; and it changes nothing for the 2550Q and 2551Q. The real
 * DashboardService over a Prisma stub, the clock driven. Invented clients only.
 */
import { Prisma } from "@prisma/client";
import { DashboardService } from "./dashboard.service";
import type { PrismaService } from "../prisma/prisma.service";

const EXPANDED = [
  { type: "Withholding Tax - Expanded", form: "0619E", frequency: "Monthly" },
];
const COMPENSATION = [
  { type: "Withholding Tax - Compensation", form: "1601C", frequency: "Monthly" },
];

const base = {
  id: "c-vat",
  businessName: "Bravo Invented VAT Co",
  taxType: "VAT",
  status: "ACTIVE",
};

function service(clients: unknown[]) {
  const zero = { _sum: { netAmount: new Prisma.Decimal(0) } };
  const prisma = {
    client: { findMany: jest.fn().mockResolvedValue(clients) },
    incomeTransaction: {
      aggregate: jest.fn().mockResolvedValue(zero),
      findMany: jest.fn().mockResolvedValue([]),
    },
    purchaseTransaction: {
      aggregate: jest.fn().mockResolvedValue(zero),
      findMany: jest.fn().mockResolvedValue([]),
    },
    bIRFiling: { count: jest.fn().mockResolvedValue(0) },
    auditLog: { findMany: jest.fn().mockResolvedValue([]) },
  };
  return { svc: new DashboardService(prisma as unknown as PrismaService), prisma };
}

/** The upcoming filings at a Manila date (noon, so the UTC date is the same day). */
async function at(manilaDate: string, clients: unknown[]) {
  jest.setSystemTime(new Date(`${manilaDate}T04:00:00.000Z`)); // 12:00 in Manila
  const { svc } = service(clients);
  return (await svc.firmOverview("f1", "all")).upcomingFilings;
}
const rows = (
  list: Array<{ client: string; form: string; period: string; due: string }>,
) => list.map((f) => [f.client, f.form, f.period, f.due]);

describe("U17 T3 · the filing calendar lists the withholding returns", () => {
  beforeEach(() =>
    jest.useFakeTimers({ doNotFake: ["nextTick", "setImmediate", "queueMicrotask"] }),
  );
  afterEach(() => jest.useRealTimers());

  const agent = {
    id: "c-a",
    businessName: "Alpha Invented Agent Co",
    taxType: null,
    status: "ACTIVE",
    taxTypesJson: [...EXPANDED, ...COMPENSATION],
  };

  it("on 27 October 2026 the agent shows the 1601-EQ for Q3 (due 2 November: 31 October is a Saturday), the 0619-E for October and the 1601-C for October", async () => {
    const list = await at("2026-10-27", [agent]);
    expect(rows(list)).toEqual([
      [
        "Alpha Invented Agent Co",
        "1601EQ",
        "Q3 2026 · Expanded withholding",
        "DUE NOV 2",
      ],
      [
        "Alpha Invented Agent Co",
        "0619E",
        "Oct 2026 · Expanded withholding",
        "DUE NOV 10",
      ],
      [
        "Alpha Invented Agent Co",
        "1601C",
        "Oct 2026 · Compensation withholding",
        "DUE NOV 10",
      ],
    ]);
    expect(list.map((f) => f.id)).toEqual([
      "c-a:1601EQ:2026-Q3",
      "c-a:0619E:2026-10",
      "c-a:1601C:2026-10",
    ]);
  });

  it("the 0619-E skips the 3rd month of a quarter: after the October return, the next is the November one, then January's", async () => {
    expect(rows(await at("2026-11-11", [agent])).filter((r) => r[1] === "0619E")).toEqual(
      [
        [
          "Alpha Invented Agent Co",
          "0619E",
          "Nov 2026 · Expanded withholding",
          "DUE DEC 10",
        ],
      ],
    );
    // 20 December: November's was due on the 10th; December is a 3rd month, so January's
    // (due 10 February) is next.
    expect(rows(await at("2026-12-20", [agent])).filter((r) => r[1] === "0619E")).toEqual(
      [
        [
          "Alpha Invented Agent Co",
          "0619E",
          "Jan 2027 · Expanded withholding",
          "DUE FEB 10",
        ],
      ],
    );
  });

  it("a 1601-C lists every month, and December is due 15 January", async () => {
    // 11 October: September's 1601-C, due Monday 12 October (the 10th is a Saturday).
    expect(rows(await at("2026-10-11", [agent])).filter((r) => r[1] === "1601C")).toEqual(
      [
        [
          "Alpha Invented Agent Co",
          "1601C",
          "Sep 2026 · Compensation withholding",
          "DUE OCT 12",
        ],
      ],
    );
    expect(rows(await at("2026-12-12", [agent])).filter((r) => r[1] === "1601C")).toEqual(
      [
        [
          "Alpha Invented Agent Co",
          "1601C",
          "Dec 2026 · Compensation withholding",
          "DUE JAN 15",
        ],
      ],
    );
    // 15 January 2028 is a Saturday: December 2027's return moves to Monday the 17th.
    expect(rows(await at("2028-01-03", [agent])).filter((r) => r[1] === "1601C")).toEqual(
      [
        [
          "Alpha Invented Agent Co",
          "1601C",
          "Dec 2027 · Compensation withholding",
          "DUE JAN 17",
        ],
      ],
    );
  });

  it("the due day itself still lists the return; the day after, the next one", async () => {
    const onTheDay = await at("2026-11-10", [agent]);
    expect(onTheDay.find((f) => f.form === "0619E")).toMatchObject({
      period: "Oct 2026 · Expanded withholding",
    });
    const after = await at("2026-11-11", [agent]);
    expect(after.find((f) => f.form === "0619E")).toMatchObject({
      period: "Nov 2026 · Expanded withholding",
    });
  });

  it("the 1601-EQ moves to the next quarter once its date has passed", async () => {
    // Q3 was due Monday 2 November; on the 3rd the next is Q4, due Monday 1 February 2027
    // (31 January is a Sunday).
    const list = await at("2026-11-03", [agent]);
    expect(list.find((f) => f.form === "1601EQ")).toMatchObject({
      period: "Q4 2026 · Expanded withholding",
      due: "DUE FEB 1",
    });
  });

  it("a Sunday due date moves: the April 2026 0619-E is due Monday 11 May", async () => {
    const list = await at("2026-05-02", [agent]);
    expect(list.find((f) => f.form === "0619E")).toMatchObject({
      period: "Apr 2026 · Expanded withholding",
      due: "DUE MAY 11",
    });
  });

  it("only a client whose registered tax types say so: the type decides, not the form", async () => {
    const only = (taxTypesJson: unknown) => ({
      id: "c-x",
      businessName: "Delta Invented Co",
      taxType: null,
      status: "ACTIVE",
      taxTypesJson,
    });
    const forms = async (taxTypesJson: unknown) =>
      (await at("2026-10-27", [only(taxTypesJson)])).map((f) => f.form).sort();
    expect(await forms(EXPANDED)).toEqual(["0619E", "1601EQ"]);
    expect(await forms(COMPENSATION)).toEqual(["1601C"]);
    // the form column is blank or hyphenated: the type is what counts
    expect(await forms([{ type: "Withholding Tax - Expanded", form: "" }])).toEqual([
      "0619E",
      "1601EQ",
    ]);
    expect(
      await forms([{ type: "Withholding Tax - Compensation", form: "1601-C" }]),
    ).toEqual(["1601C"]);
    // not registered, or registered for something else
    for (const none of [
      [],
      null,
      undefined,
      [{ type: "Withholding Tax - Final", form: "0619-F" }],
      [{ type: "Value-Added Tax", form: "2550Q" }],
      [{ type: "", form: "0619E" }],
      "text",
      {},
    ]) {
      expect(await forms(none)).toEqual([]);
    }
  });

  it("an archived client files nothing; a client with no regime but a registration does", async () => {
    const archived = {
      ...agent,
      id: "c-arch",
      businessName: "Echo Invented Archived Co",
      status: "ARCHIVED",
    };
    const list = await at("2026-10-27", [agent, archived]);
    expect(new Set(list.map((f) => f.client))).toEqual(
      new Set(["Alpha Invented Agent Co"]),
    );
    expect(agent.taxType).toBeNull(); // exempt from business tax, and still an agent
  });

  it("the 2550Q and 2551Q are exactly as they were for clients that withhold nothing, and sit beside the others by due date", async () => {
    const vatOnly = await at("2026-10-10", [base]);
    expect(rows(vatOnly)).toEqual([
      ["Bravo Invented VAT Co", "2550Q", "Q3 2026 · VAT return", "DUE OCT 25"],
    ]);
    // A VAT client that also withholds: its 2550Q (due 25 Oct) after the 1601-C (12 Oct) and
    // the 0619-E (10 Nov) ... sorted by due date.
    const both = { ...base, taxTypesJson: [...EXPANDED, ...COMPENSATION] };
    const list = await at("2026-10-10", [both]);
    expect(rows(list)).toEqual([
      [
        "Bravo Invented VAT Co",
        "1601C",
        "Sep 2026 · Compensation withholding",
        "DUE OCT 12",
      ],
      ["Bravo Invented VAT Co", "2550Q", "Q3 2026 · VAT return", "DUE OCT 25"],
      ["Bravo Invented VAT Co", "1601EQ", "Q3 2026 · Expanded withholding", "DUE NOV 2"],
      ["Bravo Invented VAT Co", "0619E", "Oct 2026 · Expanded withholding", "DUE NOV 10"],
    ]);
  });

  it("stays six rows at most", async () => {
    const many = [1, 2, 3, 4].map((n) => ({
      id: `c-${n}`,
      businessName: `Invented Agent 0${n}`,
      taxType: null,
      status: "ACTIVE",
      taxTypesJson: [...EXPANDED, ...COMPENSATION],
    }));
    expect(await at("2026-10-27", many)).toHaveLength(6);
  });

  it("asks the database for the registered tax types, nothing more", async () => {
    jest.setSystemTime(new Date("2026-10-27T04:00:00.000Z"));
    const { svc, prisma } = service([agent]);
    await svc.firmOverview("f1", "all");
    expect(prisma.client.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        select: {
          id: true,
          businessName: true,
          taxType: true,
          status: true,
          taxTypesJson: true,
        },
      }),
    );
  });
});
