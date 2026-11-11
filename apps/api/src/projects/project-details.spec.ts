// project-details.spec.ts — PA8 (D70): the professional fee rule and the client name rule.
import { cleanClientName, FEE_SENTENCE, feeText, parseFee } from "./project-details";

describe("parseFee", () => {
  it.each([
    [12, "12.00"],
    ["12", "12.00"],
    [12.5, "12.50"],
    ["12.50", "12.50"],
    ["12.5", "12.50"],
    [0, "0.00"],
    ["0.00", "0.00"],
    ["007", "7.00"],
    ["1234567.89", "1234567.89"],
    ["9999999999999999.99", "9999999999999999.99"],
  ])("%p is %s", (input, kept) => {
    expect(parseFee(input)).toBe(kept);
  });
  it("not given is undefined; null and an empty string are no fee", () => {
    expect(parseFee(undefined)).toBeUndefined();
    expect(parseFee(null)).toBeNull();
    expect(parseFee("")).toBeNull();
  });
  it.each([
    12.505,
    "12.505",
    -1,
    "-1",
    "abc",
    "1e3",
    1e21,
    " 12",
    "12 ",
    "1,000",
    "12.",
    ".5",
    true,
    "10000000000000000",
    [12],
    { a: 1 },
    NaN,
    Infinity,
    0.1 + 0.2,
  ])("%p is refused with the one sentence", (input) => {
    expect(() => parseFee(input)).toThrow(FEE_SENTENCE);
  });
});

describe("cleanClientName / feeText", () => {
  it("trims, and an empty name is none", () => {
    expect(cleanClientName("  Dela Cruz  ")).toBe("Dela Cruz");
    expect(cleanClientName("   ")).toBeNull();
    expect(cleanClientName(null)).toBeNull();
    expect(cleanClientName(undefined)).toBeNull();
  });
  it("shows a Decimal with two decimals", () => {
    expect(feeText({ toFixed: (n) => (3500).toFixed(n) })).toBe("3500.00");
    expect(feeText(null)).toBeNull();
  });
});
