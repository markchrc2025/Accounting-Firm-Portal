import { describe, expect, it } from "vitest";
import { FIXED_THRESHOLD, OTSU_MAX, OTSU_MIN, otsuThreshold } from "../binarize";
import { isStrongExtract, scoreExtract, type ExtractedCor } from "../parseCor";

function hist(pairs: Array<[number, number]>): number[] {
  const h = new Array<number>(256).fill(0);
  for (const [bin, count] of pairs) h[bin] = count;
  return h;
}

describe("otsuThreshold — adaptive binarization cut", () => {
  it("splits a bimodal document histogram between ink and paper", () => {
    // Dark photo: ink cluster ~60, paper cluster ~170 (fixed 160 would flood).
    const t = otsuThreshold(hist([[55, 800], [60, 1200], [65, 700], [165, 4000], [170, 5000], [175, 3000]]), 14700);
    expect(t).toBeGreaterThan(65);
    expect(t).toBeLessThan(165);
  });

  it("clamps to the sane document range on skewed histograms", () => {
    // Nearly all-dark image — the raw Otsu cut would be far too low.
    const dark = otsuThreshold(hist([[10, 100000], [30, 90000], [250, 10]]), 190010);
    expect(dark).toBeGreaterThanOrEqual(OTSU_MIN);
    // Nearly all-light image — the raw cut would be far too high.
    const light = otsuThreshold(hist([[240, 100000], [250, 90000], [5, 10]]), 190010);
    expect(light).toBeLessThanOrEqual(OTSU_MAX);
  });

  it("falls back to the fixed threshold on a degenerate histogram", () => {
    expect(otsuThreshold(hist([]), 0)).toBe(FIXED_THRESHOLD);
  });
});

describe("scoreExtract / isStrongExtract — two-pass OCR arbitration", () => {
  const empty: ExtractedCor = { taxTypes: [], rawText: "" };
  const full: ExtractedCor = {
    taxTypes: [
      { type: "Income Tax", form: "1701Q", frequency: "Quarterly", startDate: "" },
      { type: "Percentage Tax", form: "2551Q", frequency: "Quarterly", startDate: "" },
    ],
    rawText: "",
    tin: "123456789",
    branch: "00000",
    rdo: "045",
    kind: "individual",
    lastName: "SANTOS",
    address: "SOMEWHERE, PHILIPPINES",
    zip: "1800",
    tradeName: "SOME STORE",
  };

  it("scores a complete extract far above an empty one (TIN weighs most)", () => {
    expect(scoreExtract(empty)).toBe(0);
    expect(scoreExtract(full)).toBeGreaterThanOrEqual(12);
    expect(scoreExtract({ ...empty, tin: "123456789" })).toBe(3);
  });

  it("only a TIN + RDO + ≥2 tax rows extract skips the second OCR pass", () => {
    expect(isStrongExtract(full)).toBe(true);
    expect(isStrongExtract({ ...full, rdo: undefined })).toBe(false);
    expect(isStrongExtract({ ...full, tin: undefined })).toBe(false);
    expect(isStrongExtract({ ...full, taxTypes: full.taxTypes.slice(0, 1) })).toBe(false);
  });
});
