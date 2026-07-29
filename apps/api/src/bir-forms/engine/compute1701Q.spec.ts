import { compute1701Q } from "./compute1701Q";

// Parity tests — mirror the Sentire compute suite for 1701Q (quarterly ITR).
describe("compute1701Q — quarterly individual", () => {
  it("graduated cumulative with OSD", () => {
    const c = compute1701Q({
      year: "2024",
      quarter: "Q1",
      salesA: "500000",
      methodA: "osd",
      rateA: "graduated",
    });
    expect(c.A.deductions).toBe(200000); // 40% OSD of 500k
    expect(c.A.taxableCum).toBe(300000);
    expect(c.A.gradTax).toBe(7500); // (300k-250k) * 15% (2023+ table)
    expect(c.A.taxDue).toBe(7500);
  });

  it("8% with ₱250k relief on the filer column only", () => {
    const c = compute1701Q({ year: "2024", salesA: "500000", rateA: "eight" });
    expect(c.A.reduce8).toBe(250000);
    expect(c.A.taxable8).toBe(250000);
    expect(c.A.tax8).toBe(20000);
    expect(c.A.taxDue).toBe(20000);
  });

  it("nets credits and penalties through to total payable + aggregate", () => {
    const c = compute1701Q({
      year: "2024",
      salesA: "500000",
      rateA: "eight", // taxDue 20,000
      cwtA: "5000", // creditable withholding this quarter
      surchargeA: "1000",
      interestA: "500",
    });
    expect(c.A.credits).toBe(5000);
    expect(c.A.payable).toBe(15000); // 20,000 - 5,000
    expect(c.A.penalties).toBe(1500);
    expect(c.A.totalPayable).toBe(16500);
    expect(c.aggregate).toBe(16500); // B column all zero
  });
});
