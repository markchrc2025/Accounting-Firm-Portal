import { compute1701 } from "./compute1701";

// Parity tests — mirror the Sentire compute suite for 1701 (annual ITR,
// individuals with mixed compensation + business/professional income).
describe("compute1701 — mixed income", () => {
  it("graduated: comp + net business taxed together", () => {
    const c = compute1701({
      year: "2024",
      compA: "500000",
      salesA: "1000000",
      methodA: "osd",
      rateA: "graduated",
    });
    expect(c.A.deductions).toBe(400000); // OSD 40%
    expect(c.A.netBizTotal).toBe(600000);
    expect(c.A.taxableTotal).toBe(1100000);
    expect(c.A.taxDue).toBe(177500); // grad(1.1M, 2024) = 102.5k + 300k*25%
  });

  it("8%: graduated on comp + 8% on business", () => {
    const c = compute1701({ year: "2024", compA: "500000", salesA: "1000000", rateA: "eight" });
    expect(c.A.taxable8).toBe(750000);
    expect(c.A.tax8biz).toBe(60000);
    expect(c.A.taxDue).toBe(42500 + 60000); // grad(500k)=42,500 + 60,000
  });

  it("Part IX: reconciliation totals derive from items 1-4 and 6-9 per column", () => {
    const c = compute1701({
      year: "2024",
      ix1A: "800000", // net income per books
      ix2A: "50000", // add: non-deductible expense
      ix4A: "10000", // add: other
      ix6A: "25000", // less: income subjected to final tax
      ix8A: "5000", // less: special deduction
      ix1B: "100000",
      ix6B: "20000",
    });
    expect(c.A.ixTotalAdd).toBe(860000); // items 1+2+3+4
    expect(c.A.ixTotalLess).toBe(30000); // items 6+7+8+9
    expect(c.A.ixNetTaxable).toBe(830000); // 5 − 10
    expect(c.B.ixTotalAdd).toBe(100000);
    expect(c.B.ixTotalLess).toBe(20000);
    expect(c.B.ixNetTaxable).toBe(80000);
  });

  it("nets credits, installment and penalties into total payable", () => {
    const c = compute1701({
      year: "2024",
      compA: "500000",
      salesA: "1000000",
      methodA: "osd",
      rateA: "graduated", // taxDue 177,500
      prevPaidA: "50000",
      cwtA: "20000",
      installA: "10000",
      surchargeA: "2000",
      interestA: "500",
    });
    expect(c.A.credits).toBe(70000);
    expect(c.A.payable).toBe(107500); // 177,500 - 70,000
    expect(c.A.afterInstall).toBe(97500);
    expect(c.A.penalties).toBe(2500);
    expect(c.A.totalPayable).toBe(100000);
    expect(c.aggregate).toBe(100000);
  });
});
