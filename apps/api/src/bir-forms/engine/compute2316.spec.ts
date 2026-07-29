import { compute2316 } from "./compute2316";

// Parity tests — mirror the Sentire compute suite for 2316 (Certificate of
// Compensation Payment / Tax Withheld).
describe("compute2316 — compensation certificate", () => {
  it("graduated tax on gross taxable compensation", () => {
    const c = compute2316({ year: "2024", i39: "500000", i29: "90000" });
    expect(c.i38).toBe(90000); // non-taxable (item 38)
    expect(c.i52).toBe(500000); // total taxable comp, present (item 52)
    expect(c.i23).toBe(500000); // gross taxable comp (item 23)
    expect(c.i24).toBe(42500); // grad(500k, 2024)
  });

  it("splits regular vs supplementary and sums them into item 52", () => {
    const c = compute2316({
      year: "2024",
      i39: "300000", // basic salary (regular)
      i40: "24000", // representation (regular)
      i44A: "6000", // other regular
      i45: "50000", // commission (supplementary)
      i48: "25000", // taxable 13th month (supplementary)
    });
    expect(c.reg).toBe(330000);
    expect(c.supp).toBe(75000);
    expect(c.i52).toBe(405000);
    expect(c.i19).toBe(405000); // gross comp = 38 + 52, with 38 = 0
    expect(c.i21).toBe(405000); // taxable comp, present
  });

  it("adds the previous employer's taxable comp before computing the tax", () => {
    const c = compute2316({ year: "2024", i39: "400000", i22: "200000" });
    expect(c.i21).toBe(400000);
    expect(c.i22).toBe(200000);
    expect(c.i23).toBe(600000); // gross taxable comp
    expect(c.i24).toBe(62500); // grad(600k, 2024) = 22,500 + 200k*20%
  });

  it("totals withheld tax across 25A/25B plus the PERA credit", () => {
    const c = compute2316({ year: "2024", i39: "500000", i25A: "30000", i25B: "12500", i27: "500" });
    expect(c.i26).toBe(42500); // 25A + 25B
    expect(c.i28).toBe(43000); // + PERA credit
  });
});
