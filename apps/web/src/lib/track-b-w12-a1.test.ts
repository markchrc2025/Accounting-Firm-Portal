// track-b-w12-a1.test.ts — W12-A1: the picker takes any photo or PDF (R1) and
// a saved "percentage" rule is named for what it is, with the API's own
// sentence beside it (R3).

import { describe, expect, it } from "vitest";
import { ACCEPTED_FILES, estimateCounts, localRefusal } from "./receiptScans";
import { methodLabel, methodNote } from "./taxEstimate";

describe("the picker takes any photo or PDF (W12-A1 R1)", () => {
  it("accepts exactly what the ruling lists", () => {
    expect(ACCEPTED_FILES).toBe("image/*,.heic,.heif,.pdf,application/pdf");
  });

  it("refuses no file for its type: only the count and the size", () => {
    const f = (name: string, type: string, size = 1000) => ({ name, type, size });
    expect(
      localRefusal([
        f("IMG_0001.HEIC", ""),
        f("scan.tiff", "image/tiff"),
        f("photo.avif", "image/avif"),
        f("old.bmp", "image/bmp"),
        f("anim.gif", "image/gif"),
        f("notes.txt", "text/plain"),
      ]),
    ).toBeNull();
    expect(
      estimateCounts([f("IMG_0001.HEIC", ""), f("scan.tiff", "image/tiff")]),
    ).toEqual({
      images: 2,
      pdfs: 0,
    });
  });
});

describe("a saved percentage rule (W12-A1 R3)", () => {
  const SENTENCE =
    "This client's saved rule is 'Percentage', which describes percentage tax (a business tax), not an income-tax method; income tax is shown on the graduated TRAIN rates. Choose the income-tax method on Tax Rules.";
  const assumptions = ["INVENTED ONE.", SENTENCE, "INVENTED TWO."];

  it("is named Percentage, never 'Rate on gross receipts'", () => {
    const label = methodLabel({ name: "percentage", source: "saved", rate: null });
    expect(label).toBe("Percentage");
    expect(label).not.toContain("Rate on gross receipts");
  });

  it("carries the API's own sentence about the rule, word for word", () => {
    expect(
      methodNote({
        method: { name: "percentage", source: "saved", rate: null },
        assumptions,
      }),
    ).toBe(SENTENCE);
  });

  it("has no note for any other method", () => {
    expect(
      methodNote({
        method: { name: "graduated", source: "saved", rate: null },
        assumptions,
      }),
    ).toBeNull();
  });
});
