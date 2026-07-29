import { compute1702Q } from "./compute1702Q";

// Parity tests — mirror the Sentire compute suite for 1702Q (quarterly ITR for
// corporations / partnerships / non-individuals; MCIT-aware).
describe("compute1702Q — quarterly corporate", () => {
  it("computes normal vs MCIT, picks higher", () => {
    const c = compute1702Q({ s2_1: "2000000", s2_2: "1000000", method: "itemized", s2_6: "200000" });
    expect(c.s2_5).toBe(1000000); // total gross income
    expect(c.s2_9).toBe(800000); // taxable to date
    expect(c.s2_11).toBe(200000); // normal 25%
    expect(c.mcit).toBe(20000); // MCIT 2%
    expect(c.s2_13).toBe(200000);
    expect(c.i14).toBe(200000);
  });

  it("falls back to MCIT when 2% of gross exceeds the normal tax", () => {
    const c = compute1702Q({ s2_1: "1000000", s2_2: "0", method: "itemized", s2_6: "980000" });
    expect(c.s2_9).toBe(20000); // taxable after big deductions
    expect(c.s2_11).toBe(5000); // normal 25%
    expect(c.mcit).toBe(20000); // MCIT 2% of 1M gross
    expect(c.s2_13).toBe(20000);
    expect(c.mcitApplies).toBe(true);
  });

  it("applies OSD as 40% of total gross income", () => {
    const c = compute1702Q({ s2_1: "1000000", s2_2: "0", method: "osd" });
    expect(c.s2_5).toBe(1000000);
    expect(c.s2_6).toBe(400000); // OSD 40%
    expect(c.s2_7).toBe(600000); // taxable this quarter
  });

  it("totals Schedule 4 credits and rolls Part II through to total payable", () => {
    const c = compute1702Q({
      s2_1: "2000000",
      s2_2: "1000000",
      method: "itemized",
      s2_6: "200000", // tax due 200,000
      sch4_2: "50000", // payments, previous quarters
      sch4_5: "25000", // CWT this quarter (2307)
      i21: "1000", // surcharge
      i22: "500", // interest
    });
    expect(c.sch4_7).toBe(75000); // total credits
    expect(c.i19).toBe(75000);
    expect(c.i20).toBe(125000); // net tax payable
    expect(c.i24).toBe(1500); // penalties
    expect(c.i25).toBe(126500); // total amount payable
  });

  it("adds the Schedule 1 special-rate tax due into Part II Item 17", () => {
    const c = compute1702Q({ sch1Rate: "10", sch1_1B: "500000" });
    expect(c.sch1_9B).toBe(500000);
    expect(c.sch1_11B).toBe(50000); // 10% of the special-rate income
    expect(c.sch1_13).toBe(50000);
    expect(c.i17).toBe(50000);
  });
});
