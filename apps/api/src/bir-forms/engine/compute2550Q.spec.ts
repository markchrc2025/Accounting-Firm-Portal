import type { FilingData } from "./types";
import { compute2550Q } from "./compute2550Q";

// Parity tests — mirror the Sentire compute suite for 2550Q (Quarterly VAT).
describe("compute2550Q — quarterly VAT", () => {
  it("output tax = 12% of VATable sales; net of allowable input", () => {
    const c = compute2550Q({ i31a: "1000000", i44b: "50000" });
    expect(c.i31b).toBe(120000); // 12% output
    expect(c.i34b).toBe(120000);
    expect(c.i37).toBe(120000); // adjusted output
    expect(c.i60).toBe(50000); // allowable input
    expect(c.i61).toBe(70000); // net VAT payable
    expect(c.i26).toBe(70000); // total payable
  });

  it("rolls output/credits/penalties through Part II to total payable", () => {
    const c = compute2550Q({
      i31a: "2000000", // output 240,000
      i44b: "40000", // current input tax
      i16: "10000", // creditable VAT withheld
      i22: "1000", // surcharge
      i23: "500", // interest
    });
    expect(c.i34b).toBe(240000);
    expect(c.i60).toBe(40000); // allowable input
    expect(c.i15).toBe(200000); // net VAT payable
    expect(c.i20).toBe(10000); // total credits
    expect(c.i21).toBe(190000); // tax still payable
    expect(c.i25).toBe(1500); // total penalties
    expect(c.i26).toBe(191500); // total amount payable
  });

  it("derives Part V schedule totals from stored rows and feeds the line items", () => {
    const data: FilingData = {
      i31a: "500000",
      // Schedule 3 (creditable VAT withheld): c2 income payment, c3 tax withheld.
      sch3: [
        { c2: "100000", c3: "3000" },
        { c2: "50000", c3: "1500" },
      ],
      // Schedule 4 (advance VAT): c4 amount paid.
      sch4: [{ c4: "2000" }],
    };
    const c = compute2550Q(data);
    expect(c.sch3TotalC).toBe(150000);
    expect(c.sch3TotalD).toBe(4500);
    expect(c.i16).toBe(4500); // Schedule 3 Col D -> Item 16
    expect(c.sch4Total).toBe(2000);
    expect(c.i17).toBe(2000); // Schedule 4 Col E -> Item 17
    expect(c.i20).toBe(6500); // total credits
  });

  it("falls back to flat fields when a schedule has no rows", () => {
    const c = compute2550Q({ i31a: "1000000", i16: "7000", i17: "3000" });
    expect(c.i16).toBe(7000);
    expect(c.i17).toBe(3000);
    expect(c.i20).toBe(10000);
  });
});
