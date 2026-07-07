import { Prisma } from "@prisma/client";
import { dateToIso, decToNum, isoToDate } from "./serialization";

describe("financial serialization", () => {
  it("round-trips an ISO date through @db.Date without TZ drift", () => {
    const iso = "2026-03-31";
    const d = isoToDate(iso);
    expect(d.toISOString()).toBe("2026-03-31T00:00:00.000Z");
    expect(dateToIso(d)).toBe(iso);
  });

  it("converts Prisma.Decimal to a JSON number and null to undefined", () => {
    expect(decToNum(new Prisma.Decimal("48000.00"))).toBe(48000);
    expect(decToNum(new Prisma.Decimal("1500000.50"))).toBe(1500000.5);
    expect(decToNum(null)).toBeUndefined();
  });
});
