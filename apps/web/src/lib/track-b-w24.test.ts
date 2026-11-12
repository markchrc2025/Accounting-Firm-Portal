// track-b-w24.test.ts - W24: a full TIN (with its branch) typed into the TIN box is split into
// the 9-digit TIN and the branch. All data is invented.
import { describe, expect, it } from "vitest";
import {
  branchConflictMessage,
  BRANCH_HINT,
  formatTin9,
  SPLIT_NOTE,
  splitTin,
  TIN_HINT,
  TIN_PLACEHOLDER,
} from "./payeeDetails";

describe("W24 splitTin", () => {
  it("leaves 9 digits alone, with or without dashes", () => {
    expect(splitTin("123456789", "")).toEqual({ kind: "none" });
    expect(splitTin("123-456-789", "00001")).toEqual({ kind: "none" });
  });
  it("leaves any other length alone (10, 11, 13, 15 digits, empty)", () => {
    for (const t of ["1234567890", "12345678901", "1234567890123", "123456789012345", ""])
      expect(splitTin(t, "")).toEqual({ kind: "none" });
  });
  it("splits 14 digits, with or without dashes and spaces, when Branch is empty", () => {
    const want = { kind: "split", tin: "123-456-789", branch: "00012" };
    expect(splitTin("12345678900012", "")).toEqual(want);
    expect(splitTin("123-456-789-00012", "")).toEqual(want);
    expect(splitTin(" 123 456 789 00012 ", "  ")).toEqual(want);
  });
  it("splits 12 digits (a 3-digit branch), with or without dashes, when Branch is empty", () => {
    const want = { kind: "split", tin: "123-456-789", branch: "000" };
    expect(splitTin("123456789000", "")).toEqual(want);
    expect(splitTin("123-456-789-000", "")).toEqual(want);
  });
  it("splits when Branch already holds the same digits", () => {
    expect(splitTin("123-456-789-00012", "00012")).toEqual({
      kind: "split",
      tin: "123-456-789",
      branch: "00012",
    });
    expect(splitTin("123456789000", "000")).toEqual({
      kind: "split",
      tin: "123-456-789",
      branch: "000",
    });
  });
  it("does not split when Branch holds other digits, and names the TIN's branch", () => {
    expect(splitTin("123-456-789-00012", "00001")).toEqual({
      kind: "conflict",
      branch: "00012",
    });
    // the same branch written another way is still other digits: the person checks it
    expect(splitTin("123-456-789-000", "00000")).toEqual({
      kind: "conflict",
      branch: "000",
    });
  });
  it("formats 9 digits as 123-456-789", () => {
    expect(formatTin9("987654321")).toBe("987-654-321");
  });
  it("says the sentences the owner asked for", () => {
    expect(SPLIT_NOTE).toBe("Branch moved to the Branch field.");
    expect(branchConflictMessage("00012")).toBe(
      "The TIN includes a branch (00012) that differs from the Branch field. Check which is right.",
    );
    expect(TIN_PLACEHOLDER).toBe("123-456-789");
    expect(TIN_HINT).toBe("9 digits, for example 123-456-789.");
    expect(BRANCH_HINT).toBe("Up to 5 digits.");
  });
});
