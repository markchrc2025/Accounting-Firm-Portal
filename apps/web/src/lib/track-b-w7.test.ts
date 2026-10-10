// track-b-w7.test.ts — the pure helpers behind W7: the COR's regime proposal
// (R1), the form-regime warnings (R2), the quarter the Expenses total covers
// (R3), the per-client permission check (R5) and the 2307 payor name (R6).
// All data is invented.

import { describe, expect, it } from "vitest";
import { registeredName } from "./birFiling";
import { manilaQuarter } from "./manilaQuarter";
import { permittedFor } from "./permissions";
import { formRegimeWarning, proposeRegime } from "./regime";
import type { PermissionsView } from "./api";

describe("proposeRegime — the regime a COR's tax types propose (R1)", () => {
  it("Value-Added Tax proposes VAT-registered, with or without income tax", () => {
    expect(proposeRegime(["Value-Added Tax"])).toBe("VAT");
    expect(proposeRegime(["Income Tax", "Value-Added Tax", "Registration Fee"])).toBe(
      "VAT",
    );
  });
  it("Percentage Tax proposes percentage tax", () => {
    expect(proposeRegime(["Income Tax", "Percentage Tax"])).toBe("PERCENTAGE");
  });
  it("income tax with neither business tax proposes exempt", () => {
    expect(proposeRegime(["Income Tax", "Withholding Tax - Expanded"])).toBe("EXEMPT");
  });
  it("anything ambiguous proposes nothing", () => {
    expect(proposeRegime(["Value-Added Tax", "Percentage Tax"])).toBeNull();
    expect(proposeRegime(["Registration Fee"])).toBeNull();
    expect(proposeRegime([])).toBeNull();
  });
  it("matches the reader's names regardless of case and spacing", () => {
    expect(proposeRegime([" value-added tax "])).toBe("VAT");
  });
});

describe("formRegimeWarning — warn, don't block (R2)", () => {
  const NOT_VAT =
    "This client is not VAT-registered. A 2550Q is normally filed only by VAT-registered taxpayers.";
  it("2550Q warns for every client that is not VAT-registered", () => {
    expect(formRegimeWarning("2550Q", "PERCENTAGE")).toBe(NOT_VAT);
    expect(formRegimeWarning("2550Q", null)).toBe(NOT_VAT);
    expect(formRegimeWarning("2550Q", "")).toBe(NOT_VAT);
    expect(formRegimeWarning("2550Q", "VAT")).toBeNull();
  });
  it("2551Q warns for an exempt client and for a VAT client, not for percentage tax", () => {
    expect(formRegimeWarning("2551Q", null)).toBe(
      "This client is exempt from business tax. A 2551Q is not normally filed for it.",
    );
    expect(formRegimeWarning("2551Q", "VAT")).toBe(
      "This client is VAT-registered. A 2551Q is normally filed by taxpayers under percentage tax.",
    );
    expect(formRegimeWarning("2551Q", "PERCENTAGE")).toBeNull();
  });
});

describe("manilaQuarter — the quarter the posted total covers (R3)", () => {
  it("gives the calendar quarter's first and last days", () => {
    expect(manilaQuarter(new Date("2026-08-14T04:00:00Z"))).toEqual({
      year: 2026,
      quarter: 3,
      dateFrom: "2026-07-01",
      dateTo: "2026-09-30",
    });
    expect(manilaQuarter(new Date("2028-02-10T04:00:00Z")).dateTo).toBe("2028-03-31");
  });
  it("reads the Manila calendar, not UTC's, at a quarter's edge", () => {
    // 2026-09-30 17:00 UTC is already Oct 1 in Manila (UTC+8).
    expect(manilaQuarter(new Date("2026-09-30T17:00:00Z")).quarter).toBe(4);
    expect(manilaQuarter(new Date("2026-09-30T15:00:00Z")).quarter).toBe(3);
  });
});

describe("permittedFor — the server's per-client answer (R5)", () => {
  const view = (
    global: string[],
    clients: PermissionsView["clients"] = [],
  ): PermissionsView => ({
    global,
    clients,
    assignedClientIds: [],
    canViewAllClients: false,
  });
  it("a permission held globally covers every client", () => {
    expect(permittedFor(view(["Expenses:Update"]), "Expenses:Update", "c-1")).toBe(true);
  });
  it("a permission held on a client's scope covers that client only", () => {
    const v = view([], [{ clientId: "c-2", permissions: ["Expenses:Update"] }]);
    expect(permittedFor(v, "Expenses:Update", "c-2")).toBe(true);
    expect(permittedFor(v, "Expenses:Update", "c-1")).toBe(false);
    expect(permittedFor(v, "Expenses:Update", "")).toBe(false);
  });
  it("no view, no permission", () => {
    expect(permittedFor(null, "Expenses:Update", "c-1")).toBe(false);
  });
});

describe("registeredName — the 2307's Item 7 (R6)", () => {
  it("an individual prints LAST, FIRST MIDDLE", () => {
    expect(
      registeredName({
        kind: "individual",
        lastName: "TESTPAYOR",
        firstName: "SAMPLE",
        middleName: "INVENTED",
        regName: "IGNORED",
      }),
    ).toBe("TESTPAYOR, SAMPLE INVENTED");
    expect(
      registeredName({ kind: "individual", lastName: "TESTPAYOR", firstName: "SAMPLE" }),
    ).toBe("TESTPAYOR, SAMPLE");
  });
  it("a non-individual prints its registered name", () => {
    expect(registeredName({ kind: "non-individual", regName: " INVENTED CORP " })).toBe(
      "INVENTED CORP",
    );
    expect(registeredName({ regName: "INVENTED CORP" })).toBe("INVENTED CORP");
  });
  it("empty when the fields it needs are empty — the caller refuses to print", () => {
    expect(registeredName({ kind: "non-individual", regName: "" })).toBe("");
    expect(registeredName({ kind: "individual", lastName: "TESTPAYOR" })).toBe("");
    expect(registeredName({ kind: "individual", firstName: "SAMPLE" })).toBe("");
    expect(registeredName({})).toBe("");
  });
});
