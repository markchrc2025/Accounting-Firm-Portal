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

// C8 — block B (money payments subject to withholding of business tax) is totalled in
// exact decimals, to the centavo; block A is untouched.
describe("compute2307 — block B", () => {
  it("is empty when the certificate has no block B rows", () => {
    const c = compute2307({ rows: [{ m1: "1" }] });
    expect(c.blockB).toEqual({
      rows: [],
      totalIncome: 0,
      totalTax: 0,
      tM1: 0,
      tM2: 0,
      tM3: 0,
    });
  });

  it("totals each row and each column, never floating point: 0.1 + 0.2 + 0.3 is exactly 0.60", () => {
    const c = compute2307({
      rowsB: [
        { atc: "WB030", m1: "0.1", m2: "0.2", m3: "0.3", tax: "0.07" },
        { atc: "WV010", m1: "1,234.56", m2: "0.01", m3: "", tax: "61.73" },
      ],
    });
    expect(c.blockB.rows.map((r) => r.total)).toEqual([0.6, 1234.57]);
    expect(c.blockB.tM1).toBe(1234.66);
    expect(c.blockB.tM2).toBe(0.21);
    expect(c.blockB.tM3).toBe(0.3);
    expect(c.blockB.totalIncome).toBe(1235.17);
    expect(c.blockB.totalTax).toBe(61.8);
  });

  it("leaves block A exactly as it was, whatever block B holds", () => {
    const a = compute2307({ rows: [{ m1: "10", m2: "20", m3: "30", tax: "1" }] });
    const both = compute2307({
      rows: [{ m1: "10", m2: "20", m3: "30", tax: "1" }],
      rowsB: [{ m1: "99", tax: "9" }],
    });
    const { blockB: _ignored, ...bare } = both;
    const { blockB: _also, ...baseline } = a;
    expect(bare).toEqual(baseline);
    expect(both.totalIncome).toBe(60);
  });
});
