/**
 * track-a-due-next.spec.ts — the dashboard shows the business-tax return whose
 * deadline comes next, by Manila date, and counts exempt clients (U9 R4, D45).
 * Hermetic: the real DashboardService over a Prisma stub, with the clock driven.
 */
import { Prisma } from "@prisma/client";
import { DashboardService } from "./dashboard.service";
import type { PrismaService } from "../prisma/prisma.service";

const CLIENTS = [
  {
    id: "c-vat",
    businessName: "Bravo Invented VAT Co",
    taxType: "VAT",
    status: "ACTIVE",
  },
  {
    id: "c-pct",
    businessName: "Alpha Invented Percentage Co",
    taxType: "PERCENTAGE",
    status: "ACTIVE",
  },
  {
    id: "c-exempt",
    businessName: "Charlie Invented Exempt Co",
    taxType: null,
    status: "ACTIVE",
  },
  {
    id: "c-exempt-off",
    businessName: "Delta Invented Archived Co",
    taxType: null,
    status: "ARCHIVED",
  },
];

function service(clients: unknown[] = CLIENTS) {
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
  return new DashboardService(prisma as unknown as PrismaService);
}

describe("U9 T6 · the dashboard shows what is due next", () => {
  beforeEach(() =>
    jest.useFakeTimers({ doNotFake: ["nextTick", "setImmediate", "queueMicrotask"] }),
  );
  afterEach(() => jest.useRealTimers());

  it("on 2026-10-10 (Manila) both clients show Q3 2026, due OCT 25, sorted by due date then name", async () => {
    const d =
      (jest.setSystemTime(new Date("2026-10-10T02:00:00.000Z")),
      await service().firmOverview("f1", "all"));
    expect(d.upcomingFilings.map((f) => [f.client, f.form, f.period, f.due])).toEqual([
      [
        "Alpha Invented Percentage Co",
        "2551Q",
        "Q3 2026 · Percentage return",
        "DUE OCT 25",
      ],
      ["Bravo Invented VAT Co", "2550Q", "Q3 2026 · VAT return", "DUE OCT 25"],
    ]);
  });

  it("the 25th itself in Manila still shows Q3 (the deadline has not passed)", async () => {
    // 2026-10-25T15:59Z is 23:59 on 25 October in Manila.
    const d =
      (jest.setSystemTime(new Date("2026-10-25T15:59:00.000Z")),
      await service().firmOverview("f1", "all"));
    expect(d.upcomingFilings.map((f) => [f.form, f.period, f.due])).toEqual([
      ["2551Q", "Q3 2026 · Percentage return", "DUE OCT 25"],
      ["2550Q", "Q3 2026 · VAT return", "DUE OCT 25"],
    ]);
  });

  it("shows six rows at most, the first six client names in order", async () => {
    const many = [8, 3, 7, 1, 6, 2, 5, 4].map((n) => ({
      id: `c-${n}`,
      businessName: `Invented Client 0${n}`,
      taxType: "VAT",
      status: "ACTIVE",
    }));
    const d =
      (jest.setSystemTime(new Date("2026-10-10T02:00:00.000Z")),
      await service(many).firmOverview("f1", "all"));
    expect(d.upcomingFilings.map((f) => f.client)).toEqual(
      [1, 2, 3, 4, 5, 6].map((n) => `Invented Client 0${n}`),
    );
  });

  it("at 2026-10-25T16:30Z (00:30 on 26 October in Manila) both show Q4 2026, due JAN 25", async () => {
    const d =
      (jest.setSystemTime(new Date("2026-10-25T16:30:00.000Z")),
      await service().firmOverview("f1", "all"));
    expect(d.upcomingFilings.map((f) => [f.form, f.period, f.due])).toEqual([
      ["2551Q", "Q4 2026 · Percentage return", "DUE JAN 25"],
      ["2550Q", "Q4 2026 · VAT return", "DUE JAN 25"],
    ]);
  });

  it("on 2027-01-10 (Manila) the return due is Q4 2026, due JAN 25", async () => {
    const d =
      (jest.setSystemTime(new Date("2027-01-10T00:00:00.000Z")),
      await service().firmOverview("f1", "all"));
    expect(d.upcomingFilings[0]).toMatchObject({
      period: "Q4 2026 · Percentage return",
      due: "DUE JAN 25",
    });
    expect(d.upcomingFilings[0]!.id).toBe("c-pct:2551Q:2026Q4");
  });

  it("regimeMix.exempt counts the active clients with no regime; exempt clients add no filing", async () => {
    const d =
      (jest.setSystemTime(new Date("2026-10-10T02:00:00.000Z")),
      await service().firmOverview("f1", "all"));
    expect(d.regimeMix).toEqual({ vat: 1, percentage: 1, exempt: 1 });
    expect(d.upcomingFilings.map((f) => f.client)).not.toContain(
      "Charlie Invented Exempt Co",
    );
  });
});
