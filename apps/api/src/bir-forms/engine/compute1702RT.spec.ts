import { compute1702RT } from "./compute1702RT";

// Parity tests — mirror the Sentire compute suite for 1702-RT (annual ITR for
// corporations at the regular rate; MCIT-aware).
describe("compute1702RT — corporate, MCIT-aware", () => {
  it("uses the normal rate when it exceeds MCIT", () => {
    const c = compute1702RT({ i27: "2000000", i30: "1000000", method: "itemized", i34: "200000" });
    expect(c.rate).toBe(25); // default regular rate
    expect(c.i33).toBe(1000000); // gross income
    expect(c.i39).toBe(800000); // net taxable (itemized)
    expect(c.i41).toBe(200000); // normal tax 25%
    expect(c.i42).toBe(20000); // MCIT 2% of gross
    expect(c.i43).toBe(200000); // higher of the two
    expect(c.mcitApplies).toBe(false);
    expect(c.i21).toBe(200000); // total payable
  });

  it("uses MCIT when 2% of gross exceeds the normal tax", () => {
    const c = compute1702RT({ i27: "1000000", i30: "0", method: "itemized", i34: "980000" });
    expect(c.i39).toBe(20000); // net taxable after big deductions
    expect(c.i41).toBe(5000); // normal 25%
    expect(c.i42).toBe(20000); // MCIT 2% of 1M gross
    expect(c.i43).toBe(20000);
    expect(c.mcitApplies).toBe(true);
  });

  it("OSD = 40% of gross income for corporations", () => {
    const c = compute1702RT({ i27: "1000000", i30: "0", method: "osd" });
    expect(c.i33).toBe(1000000);
    expect(c.i38).toBe(400000); // OSD 40% of gross income
    expect(c.i39).toBe(600000); // net taxable
  });

  it("derives Item 34 from the Schedule I line detail when present", () => {
    const c = compute1702RT({
      i27: "2000000",
      i30: "1000000",
      method: "itemized",
      s1_1: "120000",
      s1_2: "80000",
      s1_17a: "50000",
    });
    expect(c.sch1Total).toBe(250000); // Schedule I Item 18
    expect(c.i34).toBe(250000); // schedule wins over the summary field
    expect(c.i39).toBe(750000); // 1,000,000 gross less 250,000
  });

  it("nets credits and penalties through Part II to total payable", () => {
    const c = compute1702RT({
      i27: "2000000",
      i30: "1000000",
      method: "itemized",
      i34: "200000", // tax due 200,000
      i45: "60000", // prior year's excess credits
      i46: "20000", // quarterly payments
      i17: "1000", // surcharge
      i18: "500", // interest
    });
    expect(c.i55).toBe(80000); // total credits
    expect(c.i16).toBe(120000); // net tax payable
    expect(c.i20).toBe(1500); // penalties
    expect(c.i21).toBe(121500); // total amount payable
  });
});
