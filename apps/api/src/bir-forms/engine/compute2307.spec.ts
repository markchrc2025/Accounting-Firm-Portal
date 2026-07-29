import type { FilingData } from "./types";
import { compute2307 } from "./compute2307";

// Parity tests — mirror the Sentire compute suite for 2307 (Certificate of
// Creditable Tax Withheld at Source).
describe("compute2307 — creditable tax withheld", () => {
  it("totals monthly income payments and tax", () => {
    const data: FilingData = {
      rows: [
        { atc: "WI010", m1: "100000", m2: "100000", m3: "100000", tax: "15000" },
        { atc: "WI020", m1: "50000", m2: "0", m3: "0", tax: "2500" },
      ],
    };
    const c = compute2307(data);
    expect(c.rows[0]!.total).toBe(300000);
    expect(c.rows[1]!.total).toBe(50000);
    expect(c.totalIncome).toBe(350000);
    expect(c.totalTax).toBe(17500);
    expect(c.tM1).toBe(150000);
  });

  it("returns zeroed totals when there are no rows", () => {
    const c = compute2307({});
    expect(c.rows).toEqual([]);
    expect(c.totalIncome).toBe(0);
    expect(c.totalTax).toBe(0);
    expect(c.tM1).toBe(0);
    expect(c.tM2).toBe(0);
    expect(c.tM3).toBe(0);
  });

  it("keeps the per-month column totals independent", () => {
    const c = compute2307({
      rows: [
        { m1: "10", m2: "20", m3: "30", tax: "1" },
        { m1: "5", m2: "0", m3: "0", tax: "2" },
      ],
    });
    expect(c.tM1).toBe(15);
    expect(c.tM2).toBe(20);
    expect(c.tM3).toBe(30);
    expect(c.totalIncome).toBe(65);
    expect(c.totalTax).toBe(3);
  });
});
