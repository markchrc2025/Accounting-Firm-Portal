import { describe, expect, it } from "vitest";
import { defaultBillingLine, periodSuffix } from "../billing-prefill";
import type { Service } from "../api";

const services: Service[] = [
  {
    id: "s-monthly",
    name: "Monthly Bookkeeping and Tax Filing",
    description: "",
    defaultFee: "1500",
    billingMethod: "Monthly",
    linkedForm: null,
    status: "Active",
  },
  {
    id: "s-quarterly",
    name: "Quarterly VAT Filing",
    description: "",
    defaultFee: 3000,
    billingMethod: "Quarterly",
    linkedForm: "2550Q",
    status: "Active",
  },
  {
    id: "s-retired",
    name: "Old Retainer",
    description: "",
    defaultFee: 9999,
    billingMethod: "Monthly",
    linkedForm: null,
    status: "Retired",
  },
];

const JULY = new Date("2026-07-21T00:00:00.000Z");

describe("defaultBillingLine", () => {
  it("uses the client's default service and professional fee", () => {
    const line = defaultBillingLine(
      { defaultServiceId: "s-quarterly", billingMethod: "MONTHLY", professionalFee: "550" },
      services,
      JULY,
    );
    expect(line).toEqual({
      description: "Quarterly VAT Filing — July 2026",
      qty: 1,
      rate: 550,
    });
  });

  it("falls back to the billing-method match when no default service is set", () => {
    const line = defaultBillingLine(
      { defaultServiceId: null, billingMethod: "MONTHLY", professionalFee: null },
      services,
      JULY,
    );
    expect(line!.description).toBe("Monthly Bookkeeping and Tax Filing — July 2026");
    expect(line!.rate).toBe(1500); // the service's default fee
  });

  it("never picks a retired service", () => {
    const line = defaultBillingLine(
      { defaultServiceId: "s-retired", billingMethod: "AS_FILING", professionalFee: 800 },
      services,
      JULY,
    );
    // Retired default is ignored; AS_FILING matches nothing → generic label + client fee.
    expect(line).toEqual({ description: "Professional services", qty: 1, rate: 800 });
  });

  it("labels quarterly engagements with the quarter", () => {
    const line = defaultBillingLine(
      { defaultServiceId: "s-quarterly", billingMethod: "QUARTERLY", professionalFee: null },
      services,
      JULY,
    );
    expect(line!.description).toBe("Quarterly VAT Filing — Q3 2026");
    expect(line!.rate).toBe(3000);
  });

  it("returns null when there is no service and no fee to work from", () => {
    expect(
      defaultBillingLine(
        { defaultServiceId: null, billingMethod: "AS_FILING", professionalFee: null },
        services,
        JULY,
      ),
    ).toBeNull();
  });
});

describe("periodSuffix", () => {
  it("is empty for as-filing engagements", () => {
    expect(periodSuffix("AS_FILING", JULY)).toBe("");
    expect(periodSuffix(null, JULY)).toBe("");
  });
});
