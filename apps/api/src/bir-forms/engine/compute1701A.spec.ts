import { compute1701A } from "./compute1701A";

// Parity tests — mirror the Sentire compute suite for 1701A (annual ITR,
// individuals purely from business/profession).
describe("compute1701A — graduated + OSD path", () => {
  // ₱1,000,000 gross, 40% OSD → ₱600,000 taxable; 2024 (Table 2)
  const c = compute1701A({ taxRate: "graduated", year: "2024", i36A: "1000000" });

  it("applies OSD 40% of net sales", () => {
    expect(c.A.i38).toBe(1000000); // net sales
    expect(c.A.i39).toBe(400000); // OSD
    expect(c.A.i40).toBe(600000); // net income
    expect(c.A.i45).toBe(600000); // total taxable
  });

  it("computes graduated tax due (Item 46)", () => {
    expect(c.A.i46).toBe(62500); // 22,500 + 200,000*20%
    expect(c.A.taxDue).toBe(62500);
    expect(c.A.i20).toBe(62500);
  });

  it("rolls up to aggregate amount payable (Item 30)", () => {
    expect(c.A.i29).toBe(62500);
    expect(c.B.i29).toBe(0);
    expect(c.i30).toBe(62500);
  });
});

describe("compute1701A — 8% flat path", () => {
  // ₱1,000,000 gross, less ₱250,000 relief → ₱750,000 @ 8%
  const c = compute1701A({ taxRate: "eight", year: "2024", i47A: "1000000" });

  it("deducts the ₱250,000 relief then applies 8%", () => {
    expect(c.A.i49).toBe(1000000); // net sales
    expect(c.A.i53).toBe(1000000); // total taxable
    expect(c.A.i54).toBe(250000); // relief
    expect(c.A.i55).toBe(750000); // taxable income
    expect(c.A.i56).toBe(60000); // 750,000 * 8%
  });

  it("selects the 8% tax due", () => {
    expect(c.A.taxDue).toBe(60000);
    expect(c.i30).toBe(60000);
  });
});

describe("compute1701A — credits & net payable", () => {
  const c = compute1701A({
    taxRate: "graduated",
    year: "2024",
    i36A: "1000000",
    i58A: "20000", // quarterly payments
    i59A: "12500", // CWT
  });

  it("sums credits and nets them off tax due", () => {
    expect(c.A.i64).toBe(32500); // total credits
    expect(c.A.i65).toBe(62500 - 32500); // 30,000 net
    expect(c.A.i22).toBe(30000);
    expect(c.i30).toBe(30000);
  });
});
