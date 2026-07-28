import { compute2551Q } from "./compute2551Q";
import type { FilingData } from "./types";

// Parity test — mirrors the Sentire generator's compute suite so the ported
// engine produces identical figures.
describe("compute2551Q — quarterly percentage tax", () => {
  it("sums per-line taxable × ATC rate", () => {
    const data: FilingData = {
      rows: [
        { atc: "PT010", taxable: "500000", rate: "3" },
        { atc: "PT040", taxable: "200000", rate: "1" },
      ],
    };
    const c = compute2551Q(data);
    expect(c.rows[0]!.due).toBe(15000); // 500k * 3%
    expect(c.rows[1]!.due).toBe(2000); // 200k * 1%
    expect(c.i14).toBe(17000); // total tax due
    expect(c.i24).toBe(17000); // total payable
  });

  it("nets credits and adds penalties into the amount payable", () => {
    const data: FilingData = {
      rows: [{ atc: "PT010", taxable: "1000000", rate: "3" }],
      i15: "5000", // creditable withholding
      i20: "300", // surcharge
    };
    const c = compute2551Q(data);
    expect(c.i14).toBe(30000); // 1M * 3%
    expect(c.i18).toBe(5000); // total credits
    expect(c.i19).toBe(25000); // tax still payable
    expect(c.i23).toBe(300); // total penalties
    expect(c.i24).toBe(25300); // total amount payable
  });

  it("applies BIR peso rounding on each line", () => {
    const data: FilingData = { rows: [{ atc: "PT010", taxable: "12345", rate: "3" }] };
    // 12345 * 3% = 370.35 → rounds to 370
    expect(compute2551Q(data).rows[0]!.due).toBe(370);
  });
});
