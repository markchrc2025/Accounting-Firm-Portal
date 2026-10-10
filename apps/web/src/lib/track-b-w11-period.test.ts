// track-b-w11-period.test.ts — W11 R1: the tax pages open on the most recent
// quarter that has ended, by the Manila date, and offer the years the API
// accepts; they word the API's method, source and business-tax sentence.

import { describe, expect, it } from "vitest";
import type { TaxEstimate } from "./api";
import { businessTaxNote, methodLabel, sourceLabel } from "./taxEstimate";
import { estimateQuery, lastEndedQuarter, yearOptions } from "./taxPeriod";

const manila = (iso: string) => new Date(`${iso}+08:00`);

describe("lastEndedQuarter (W11 R1)", () => {
  it("is Q3 2026 on 10 October 2026", () => {
    expect(lastEndedQuarter(manila("2026-10-10T10:00:00"))).toEqual({
      year: 2026,
      quarter: 3,
    });
  });

  it("follows the Manila date at a quarter's turn, not the UTC one", () => {
    // 00:30 on 1 April in Manila is 16:30 on 31 March in UTC.
    expect(lastEndedQuarter(manila("2026-04-01T00:30:00"))).toEqual({
      year: 2026,
      quarter: 1,
    });
    // 23:30 on 31 March in Manila: Q1 has not ended yet.
    expect(lastEndedQuarter(manila("2026-03-31T23:30:00"))).toEqual({
      year: 2025,
      quarter: 4,
    });
  });

  it("is the year before's Q4 in January, Q1 in April, Q2 in July", () => {
    expect(lastEndedQuarter(manila("2027-01-01T00:00:00"))).toEqual({
      year: 2026,
      quarter: 4,
    });
    expect(lastEndedQuarter(manila("2026-04-15T12:00:00"))).toEqual({
      year: 2026,
      quarter: 1,
    });
    expect(lastEndedQuarter(manila("2026-07-01T00:00:00"))).toEqual({
      year: 2026,
      quarter: 2,
    });
    expect(lastEndedQuarter(manila("2026-12-31T23:59:00"))).toEqual({
      year: 2026,
      quarter: 3,
    });
  });
});

describe("yearOptions (W11 R1)", () => {
  it("runs from the Manila year down to 2018, the first year the API accepts", () => {
    expect(yearOptions(manila("2026-10-10T10:00:00"))).toEqual([
      2026, 2025, 2024, 2023, 2022, 2021, 2020, 2019, 2018,
    ]);
    // 00:30 on 1 January 2027 in Manila is still 2026 in UTC.
    expect(yearOptions(manila("2027-01-01T00:30:00"))[0]).toBe(2027);
  });
});

describe("estimateQuery (W11 R1)", () => {
  it("sends the quarter when one is chosen, and none for the whole year", () => {
    expect(estimateQuery(2026, 3)).toBe("year=2026&quarter=3");
    expect(estimateQuery(2025, null)).toBe("year=2025");
  });
});

describe("the estimate's wording (W11 R1)", () => {
  const base: TaxEstimate = {
    basis: "management-estimate",
    notice: "INVENTED NOTICE",
    client: { id: "c1", businessName: "INVENTED STORE", regime: "EXEMPT" },
    period: {
      year: 2026,
      quarter: 3,
      label: "Q3 2026",
      incomeTaxFrom: "2026-01-01",
      incomeTaxTo: "2026-09-30",
      businessTaxFrom: "2026-07-01",
      businessTaxTo: "2026-09-30",
    },
    method: { name: "graduated", source: "saved", rate: null },
    incomeTax: { grossIncome: 0, deductibleExpenses: 0, taxableIncome: 0, due: 0 },
    businessTax: {
      kind: "none",
      grossReceipts: 0,
      outputVAT: 0,
      inputVAT: 0,
      rate: null,
      due: 0,
    },
    assumptions: ["INVENTED ONE.", "No business tax: INVENTED REASON.", "INVENTED LAST."],
    filedForms: [],
  };

  it("names the source: Saved rule or Default (TRAIN)", () => {
    expect(sourceLabel("saved")).toBe("Saved rule");
    expect(sourceLabel("default")).toBe("Default (TRAIN)");
  });

  it("names the method, with the API's rate when it sends one", () => {
    expect(methodLabel({ name: "graduated", source: "saved", rate: null })).toBe(
      "Graduated rates",
    );
    expect(methodLabel({ name: "flat", source: "saved", rate: 1.5 })).toBe(
      "Flat rate on taxable income · 1.5%",
    );
    expect(methodLabel({ name: "invented-method", source: "saved", rate: null })).toBe(
      "invented-method",
    );
  });

  it("takes the business-tax sentence from the API's assumptions", () => {
    expect(businessTaxNote(base)).toBe("No business tax: INVENTED REASON.");
    expect(
      businessTaxNote({
        ...base,
        businessTax: { ...base.businessTax, kind: "percentage" },
        assumptions: ["No percentage tax: INVENTED OPTION."],
      }),
    ).toBe("No percentage tax: INVENTED OPTION.");
    // No sentence that opens that way: the last assumption, for "none" only.
    expect(
      businessTaxNote({ ...base, assumptions: ["INVENTED ONE.", "INVENTED LAST."] }),
    ).toBe("INVENTED LAST.");
    expect(
      businessTaxNote({
        ...base,
        businessTax: { ...base.businessTax, kind: "vat" },
        assumptions: ["INVENTED ONE."],
      }),
    ).toBeNull();
  });
});
