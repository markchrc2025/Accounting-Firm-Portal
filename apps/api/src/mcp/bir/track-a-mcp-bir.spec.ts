/**
 * track-a-mcp-bir.spec.ts — U20 (hermetic): the periods, the due dates and the needs the
 * connector builds, before any database. Invented clients only.
 */
import { SERVER_INSTRUCTIONS } from "./instructions";
import { birFormTypes, daysLeft, dueDateOf, periodFrom } from "./bir-form-types";
import {
  alphalistNeeds,
  choiceNeeds,
  clientNeeds,
  noRecordsNeed,
  typedNeeds,
  type ClientFacts,
} from "./needs";

const FULL: ClientFacts = {
  kind: "non-individual",
  tin: "111222333",
  rdo: "045",
  regName: "SAMPLE AGENT CORP",
  businessName: "Sample",
  lastName: null,
  firstName: null,
  address: "1 Invented St",
  zip: "1800",
  taxType: "VAT",
  civilStatus: null,
  classification: null,
  birthdate: null,
};
const keys = (needs: Array<{ key: string }>) => needs.map((n) => n.key);

describe("U20 · the forms and their periods", () => {
  it("lists every form the Portal can draft, and nothing it cannot", () => {
    const codes = birFormTypes().map((t) => t.code);
    expect(codes).toEqual(expect.arrayContaining(["2551Q", "2550Q", "0619E", "1601EQ", "1601C", "2307", "2316", "1701", "1701A", "1701Q", "1702Q", "1702RT"]));
    expect(new Set(codes).size).toBe(codes.length);
    for (const t of birFormTypes()) {
      expect(["month", "quarter", "year"]).toContain(t.periodKind);
      expect(["books", "typed"]).toContain(t.figures);
      expect(t.dueDateRule.length).toBeGreaterThan(10);
    }
  });

  it("names a period the way the Portal stores it", () => {
    expect(periodFrom("2551Q", { year: 2026, quarter: 3 })).toEqual({ period: "2026-Q3" });
    expect(periodFrom("0619E", { year: 2026, month: 8 })).toEqual({ period: "2026-08" });
    expect(periodFrom("1601C", { year: 2026, month: 12 })).toEqual({ period: "2026-12" });
    expect(periodFrom("1701A", { year: 2025 })).toEqual({ period: "2025" });
  });

  it("refuses a period the form does not take, and the third month of a quarter for a 0619-E with the Portal's own sentence", () => {
    expect(periodFrom("2551Q", { year: 2026 })).toEqual({ error: "The 2551Q is filed for a quarter; give quarter (1 to 4)." });
    expect(periodFrom("2551Q", { year: 2026, quarter: 5 })).toEqual({ error: "The 2551Q is filed for a quarter; give quarter (1 to 4)." });
    expect(periodFrom("2551Q", { year: 2026, quarter: 1, month: 1 })).toEqual({ error: "The 2551Q is filed for a quarter; give quarter (1 to 4), not month." });
    expect(periodFrom("0619E", { year: 2026, month: 6 })).toEqual({
      error: "The third month of a quarter is reported on the 1601-EQ, not on a 0619-E.",
    });
    expect(periodFrom("1601C", { year: 2026, month: 6 })).toEqual({ period: "2026-06" }); // every month is a 1601-C month
    expect(periodFrom("1701A", { year: 1999 })).toEqual({ error: "The year must be between 2000 and 2100." });
    expect(periodFrom("9999", { year: 2026 })).toEqual({ error: "Form 9999 is not available yet." });
  });

  it("gives the due dates the Portal already has, weekends moved, and none elsewhere", () => {
    expect(dueDateOf("2550Q", "2026-Q1", null)).toBe("2026-04-27");
    expect(dueDateOf("0619E", "2026-07", null)).toBe("2026-08-10");
    expect(dueDateOf("1601EQ", "2026-Q3", null)).toBe("2026-11-02");
    expect(dueDateOf("1601C", "2026-12", null)).toBe("2027-01-15");
    expect(dueDateOf("1701A", "2025", null)).toBeNull();
    expect(daysLeft("2026-11-10", "2026-11-06")).toBe(4);
    expect(daysLeft("2026-11-01", "2026-11-06")).toBe(-5);
  });
});

describe("U20 · the needs", () => {
  it("a complete company has no client needs", () => {
    expect(clientNeeds("2550Q", FULL)).toEqual([]);
  });

  it("asks for each missing client field, in plain words, with the tool that writes it", () => {
    const n = clientNeeds("1601EQ", { ...FULL, tin: null, rdo: " ", regName: null, address: "", zip: null });
    expect(keys(n)).toEqual(["client.tin", "client.regName", "client.rdo", "client.address", "client.zip"]);
    expect(n.map((x) => x.setWith)).toEqual([
      "portal_update_client field tin",
      "portal_update_client field regName",
      "portal_update_client field rdo",
      "portal_update_client field address",
      "portal_update_client field zip",
    ]);
    expect(n[0]).toMatchObject({ kind: "tin", question: "What is the client's TIN (9 digits)?" });
  });

  it("an individual is asked for last and first name, not a registered name", () => {
    const n = clientNeeds("1601EQ", { ...FULL, kind: "individual", regName: null, lastName: "Reyes", firstName: null });
    expect(keys(n)).toEqual(["client.name"]);
  });

  it("the regime is asked only for the return that needs one, and only when none is set", () => {
    expect(keys(clientNeeds("2550Q", { ...FULL, taxType: null }))).toEqual(["client.taxType"]);
    expect(clientNeeds("2550Q", { ...FULL, taxType: null })[0]!.options).toEqual(["VAT", "PERCENTAGE"]);
    expect(keys(clientNeeds("1601C", { ...FULL, taxType: null }))).toEqual([]);
  });

  it("an individual's income-tax return asks for date of birth, civil status (1701 and 1701A) and classification", () => {
    const ind = { ...FULL, kind: "individual", regName: null, lastName: "R", firstName: "A" };
    expect(keys(clientNeeds("1701A", ind))).toEqual(["client.birthdate", "client.civilStatus", "client.classification"]);
    expect(keys(clientNeeds("1701Q", ind))).toEqual(["client.birthdate", "client.classification"]);
    expect(keys(clientNeeds("1702Q", { ...FULL }))).toEqual([]);
  });

  it("the typed returns ask for what is empty and nothing that is typed", () => {
    expect(keys(typedNeeds("1601C", {}))).toEqual(["data.compensation", "data.taxesWithheld"]);
    expect(keys(typedNeeds("1601C", { compensation: "1.00" }))).toEqual(["data.taxesWithheld"]);
    expect(typedNeeds("1601C", { compensation: "1.00", taxesWithheld: "0.00" })).toEqual([]);
    expect(typedNeeds("0619E", {})).toEqual([]); // fed from the books
    expect(keys(typedNeeds("2307", { payeeName: "X", payeeTin: "1", payeeBranch: "00000", payeeAddress: "A", rows: [{}] }))).toEqual([]);
  });

  it("an over-remittance asks the choice, with the amount and the Portal's own values; the 4th quarter cannot carry over", () => {
    const over = { rows: [{ atc: "WC158", base: "100.00", rate: "1", withheld: "1.00" }], remittance1: "5.00", remittance2: "5.00" };
    const q2 = choiceNeeds("1601EQ", over, "2026-Q2");
    expect(q2).toHaveLength(1);
    expect(q2[0]).toMatchObject({
      key: "data.overRemittanceChoice",
      question: "Item 31 is an over-remittance of 9.00. Should it be refunded, issued as a Tax Credit Certificate, or carried over to the next quarter?",
      options: ["refunded", "tcc", "carried"],
      kind: "choice",
    });
    expect(choiceNeeds("1601EQ", over, "2026-Q4")[0]!.options).toEqual(["refunded", "tcc"]);
    expect(choiceNeeds("1601EQ", { ...over, overRemittanceChoice: "tcc" }, "2026-Q2")).toEqual([]);
    expect(choiceNeeds("1601EQ", { rows: [], remittance1: "", remittance2: "" }, "2026-Q2")).toEqual([]);
  });

  it("an income-tax return asks for its ATC from the choices the form prints, and never picks one", () => {
    const n = choiceNeeds("1701Q", {}, "2026-Q1");
    expect(n).toHaveLength(1);
    expect(n[0]).toMatchObject({ key: "data.atc", kind: "atc", options: ["II012", "II014", "II013", "II015", "II017", "II016"] });
    expect(n[0]!.question).toContain("Item 8");
    expect(choiceNeeds("1701Q", { atc: "II012" }, "2026-Q1")).toEqual([]);
    expect(choiceNeeds("1702Q", {}, "2026-Q1")[0]!.options).toEqual(["IC055"]);
  });

  it("the alphalist: one need per payee, in the Portal's words", () => {
    const n = alphalistNeeds(
      [
        { tin: "123456789", branch: "0000", type: "details", missing: ["kind"], expenseIds: ["e1", "e2"], shown: "123-456-789" },
        { tin: "987654321", branch: "0000", type: "details", missing: ["last", "first"], expenseIds: ["e3"], shown: "987-654-321" },
        { tin: "555666777", branch: "0000", type: "details", missing: ["company"], expenseIds: ["e4"], shown: "555-666-777" },
        { tin: "222333444", branch: "0000", type: "conflict", missing: [], expenseIds: ["e5", "e6"], shown: "222-333-444" },
      ],
      [
        "These payees need details before the alphalist can be made: 123-456-789 (choose individual or company).",
        "Payee 123-456-789 WC158: 100000.00 at 1.00% is 1000.00, but the tax withheld is 1001.00.",
      ],
    );
    expect(keys(n)).toEqual([
      "payee.123456789.payeeKind",
      "payee.987654321.payeeLastName",
      "payee.555666777.vendor",
      "payee.222333444.conflict",
      "alphalist.1",
    ]);
    expect(n[0]).toMatchObject({ question: "Is payee 123-456-789 an individual or a company?", options: ["individual", "non_individual"], refs: { expenseIds: ["e1", "e2"] } });
    expect(n[1]!.question).toBe("What is the last and first name of payee 987-654-321?");
    expect(n[4]).toMatchObject({ question: "Payee 123-456-789 WC158: 100000.00 at 1.00% is 1000.00, but the tax withheld is 1001.00.", setWith: null });
  });

  it("no posted records: a question, not a guess", () => {
    expect(noRecordsNeed("0619E", true).question).toContain("Should the figures be typed instead, or are records missing?");
    expect(noRecordsNeed("0619E", false).question).toContain("Are records missing?");
  });
});

describe("U20 · the instructions", () => {
  it("say what Claude does, in order, and what it never does", () => {
    for (const line of [
      "First call portal_bir_form_requirements".replace("First call", "Call"),
      "Ask the owner every question in `needs` in ONE message",
      "Never invent a figure, an ATC, a TIN, a name or a choice",
      "then call portal_get_bir_form again, and repeat until `needs` is empty",
      "filing is done in the Portal with the BIR confirmation email",
      "never files, never seals, never uploads a BIR confirmation, never deletes a return and never makes the clear (final) copy",
      "Figures that come from the client's posted records (the books) are not asked for",
    ]) {
      expect(SERVER_INSTRUCTIONS).toContain(line);
    }
  });
});
