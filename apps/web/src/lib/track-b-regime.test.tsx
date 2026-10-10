import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { RegimeChip } from "../components/ui";
import { EXEMPT_LABEL, isExempt, isVatRegistered, regimeLabel } from "./regime";

// T3 (W6 R1, D39): one helper names a client's tax regime everywhere.

describe("T3 regimeLabel names a client's tax regime", () => {
  it("names VAT, PERCENTAGE and null as the ruling says", () => {
    expect(regimeLabel("VAT")).toBe("VAT-registered");
    expect(regimeLabel("PERCENTAGE")).toBe("Percentage tax");
    expect(regimeLabel(null)).toBe("Exempt from business tax");
    expect(EXEMPT_LABEL).toBe("Exempt from business tax");
  });

  it("reads undefined, empty and blank as exempt — never 'not set' or a dash", () => {
    for (const t of [undefined, "", "   "]) {
      expect(regimeLabel(t)).toBe("Exempt from business tax");
      expect(isExempt(t)).toBe(true);
    }
    expect(isExempt("VAT")).toBe(false);
    expect(isExempt("PERCENTAGE")).toBe(false);
  });

  it("shows an unknown string as stored, never guessed into a regime", () => {
    expect(regimeLabel("NON-VAT")).toBe("NON-VAT");
    expect(regimeLabel("Mixed")).toBe("Mixed");
    expect(isExempt("NON-VAT")).toBe(false);
  });

  it("ignores case and surrounding spaces on the known values", () => {
    expect(regimeLabel(" vat ")).toBe("VAT-registered");
    expect(regimeLabel("percentage")).toBe("Percentage tax");
  });

  it("records VAT only for a VAT-registered client", () => {
    expect(isVatRegistered("VAT")).toBe(true);
    expect(isVatRegistered("PERCENTAGE")).toBe(false);
    expect(isVatRegistered(null)).toBe(false);
    expect(isVatRegistered("NON-VAT")).toBe(false);
  });
});

describe("T3 RegimeChip prints the helper's label in its regime's colour", () => {
  it.each([
    ["VAT", "VAT-registered", "bg-vatchip-bg"],
    ["PERCENTAGE", "Percentage tax", "bg-warn-bg-2"],
    [null, "Exempt from business tax", "bg-neutralchip-bg"],
    [undefined, "Exempt from business tax", "bg-neutralchip-bg"],
  ] as const)("taxType %s reads %s", (taxType, label, colour) => {
    render(<RegimeChip regime={taxType} />);
    const chip = screen.getByText(label);
    // Exempt is neutral, never the percentage-tax gold.
    expect(chip.className).toContain(colour);
    expect(screen.queryByText("—")).toBeNull();
  });
});
