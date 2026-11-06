// track-b-w19.test.ts — W19: the payee details on an expense and the alphalist step of
// filing a 1601-EQ. Pure rules; all data invented.

import { describe, expect, it } from "vitest";
import type { AlphalistCheck, PayeeDetails, PurchaseTxn } from "./api";
import {
  canDownload,
  mayFile,
  needsUnderstanding,
  showsSchedule2,
  VALIDATE_NOTE,
} from "./alphalist";
import {
  applyPrefill,
  isNineDigits,
  payeeBoxesBlank,
  payeeFieldsOf,
  payeeLine,
  payeePayload,
  PREFILL_NOTE,
  tinDigits,
  type PayeeFields,
} from "./payeeDetails";

const blank: PayeeFields = {
  vendor: "",
  branch: "",
  kind: "",
  lastName: "",
  firstName: "",
  middleName: "",
};
const found = (
  over: Partial<Extract<PayeeDetails, { found: true }>> = {},
): PayeeDetails => ({
  found: true,
  tin: "123456789",
  branch: "00001",
  payeeKind: "individual",
  registeredName: null,
  lastName: "DELA CRUZ",
  firstName: "JUAN",
  middleName: "SANTOS",
  vendor: "JUAN DELA CRUZ",
  ...over,
});

describe("W19 the TIN that asks for a prefill", () => {
  it("is exactly 9 digits, dashes and spaces allowed", () => {
    expect(isNineDigits("123-456-789")).toBe(true);
    expect(isNineDigits("123 456 789")).toBe(true);
    expect(isNineDigits("123456789")).toBe(true);
    expect(isNineDigits("123-456-78")).toBe(false);
    expect(isNineDigits("123-456-789-00000")).toBe(false);
    expect(isNineDigits("")).toBe(false);
    expect(tinDigits("123-456-789")).toBe("123456789");
  });
});

describe("W19 the prefill fills blanks and never overwrites", () => {
  it("fills every blank box from what was found", () => {
    const r = applyPrefill(blank, found());
    expect(r.filled).toBe(true);
    expect(r.fields).toEqual({
      vendor: "JUAN DELA CRUZ",
      branch: "00001",
      kind: "individual",
      lastName: "DELA CRUZ",
      firstName: "JUAN",
      middleName: "SANTOS",
    });
  });

  it("leaves a box the owner typed exactly as it is", () => {
    const typed: PayeeFields = {
      ...blank,
      vendor: "MY OWN NAME",
      lastName: "TYPED",
      branch: "00007",
    };
    const r = applyPrefill(typed, found());
    expect(r.fields.vendor).toBe("MY OWN NAME");
    expect(r.fields.lastName).toBe("TYPED");
    expect(r.fields.branch).toBe("00007");
    // …and fills only the rest.
    expect(r.fields.firstName).toBe("JUAN");
    expect(r.fields.kind).toBe("individual");
    expect(r.filled).toBe(true);
  });

  it("never overwrites a chosen kind, even with a different one on file", () => {
    const r = applyPrefill({ ...blank, kind: "non_individual" }, found());
    expect(r.fields.kind).toBe("non_individual");
  });

  it("changes nothing, and says it filled nothing, when every box is typed", () => {
    const typed: PayeeFields = {
      vendor: "A",
      branch: "00002",
      kind: "individual",
      lastName: "B",
      firstName: "C",
      middleName: "D",
    };
    const r = applyPrefill(typed, found());
    expect(r.filled).toBe(false);
    expect(r.fields).toBe(typed);
  });

  it("shows nothing for found:false", () => {
    const r = applyPrefill(blank, { found: false });
    expect(r.filled).toBe(false);
    expect(r.fields).toBe(blank);
  });

  it("skips what the API has no value for", () => {
    const r = applyPrefill(
      blank,
      found({ branch: null, middleName: null, vendor: null }),
    );
    expect(r.fields.branch).toBe("");
    expect(r.fields.middleName).toBe("");
    expect(r.fields.vendor).toBe("");
    expect(r.fields.lastName).toBe("DELA CRUZ");
  });

  it("says the note the owner asked for", () => {
    expect(PREFILL_NOTE).toBe("Filled from the latest expense with this TIN.");
  });

  it("asks only while the payee boxes are all blank (the supplier name does not count)", () => {
    expect(payeeBoxesBlank({ ...blank, vendor: "TYPED NAME" })).toBe(true);
    expect(payeeBoxesBlank({ ...blank, branch: "0" })).toBe(false);
    expect(payeeBoxesBlank({ ...blank, kind: "individual" })).toBe(false);
    expect(payeeBoxesBlank({ ...blank, firstName: " x " })).toBe(false);
    expect(payeeBoxesBlank({ ...blank, lastName: "   " })).toBe(true);
  });
});

describe("W19 what an expense sends", () => {
  it("sends only the boxes that hold something, so a blank saves as it always did", () => {
    expect(payeePayload(blank)).toEqual({});
    expect(payeePayload({ ...blank, vendor: "NAME ONLY" })).toEqual({});
    expect(
      payeePayload({
        vendor: "",
        branch: " 00001 ",
        kind: "individual",
        lastName: " DELA CRUZ ",
        firstName: "JUAN",
        middleName: "",
      }),
    ).toEqual({
      vendorBranch: "00001",
      payeeKind: "individual",
      payeeLastName: "DELA CRUZ",
      payeeFirstName: "JUAN",
    });
    expect(payeePayload({ ...blank, kind: "non_individual" })).toEqual({
      payeeKind: "non_individual",
    });
  });

  it("reads a saved expense into the boxes", () => {
    const t = {
      vendor: "ACME",
      vendorBranch: "00003",
      payeeKind: "non_individual",
      payeeLastName: null,
    } as PurchaseTxn;
    expect(payeeFieldsOf(t)).toEqual({
      vendor: "ACME",
      branch: "00003",
      kind: "non_individual",
      lastName: "",
      firstName: "",
      middleName: "",
    });
    expect(payeeFieldsOf(undefined)).toEqual(blank);
  });
});

describe("W19 the payee line in the expense list", () => {
  const t = (over: Partial<PurchaseTxn>) => over as PurchaseTxn;
  it("shows the kind, the name parts and the branch, compactly", () => {
    expect(
      payeeLine(
        t({
          payeeKind: "individual",
          payeeLastName: "DELA CRUZ",
          payeeFirstName: "JUAN",
          payeeMiddleName: "SANTOS",
          vendorBranch: "00001",
        }),
      ),
    ).toBe("Individual · DELA CRUZ, JUAN SANTOS · branch 00001");
    expect(payeeLine(t({ payeeKind: "non_individual", vendorBranch: "00000" }))).toBe(
      "Company · branch 00000",
    );
    expect(payeeLine(t({}))).toBe("");
  });
});

describe("W19 the alphalist step", () => {
  const check = (over: Partial<AlphalistCheck> = {}): AlphalistCheck => ({
    ok: true,
    source: "books",
    fileName: "11122233300000920261601EQ.DAT",
    refusals: [],
    notes: [],
    schedule1: { rows: 2, income: "1000.00", tax: "20.00" },
    schedule2: { rows: 0, income: "0.00" },
    returnTotal: "20.00",
    ...over,
  });

  it("offers the download only when the API says the file can be made", () => {
    expect(canDownload(check())).toBe(true);
    expect(canDownload(check({ ok: false, fileName: null }))).toBe(false);
    // not ok is not ok, even if the API still sent a name
    expect(canDownload(check({ ok: false }))).toBe(false);
    expect(canDownload(check({ ok: true, fileName: null }))).toBe(false);
    expect(canDownload(undefined)).toBe(false);
  });

  it("shows Schedule 2 only when it has rows", () => {
    expect(showsSchedule2(check())).toBe(false);
    expect(showsSchedule2(check({ schedule2: { rows: 1, income: "5.00" } }))).toBe(true);
  });

  it("wants the owner's tick when the alphalist cannot be made, or the check could not run", () => {
    expect(needsUnderstanding(check(), false)).toBe(false);
    expect(needsUnderstanding(check({ ok: false }), false)).toBe(true);
    expect(needsUnderstanding(undefined, true)).toBe(true);
    expect(needsUnderstanding(undefined, false)).toBe(false);
  });

  it("lets filing go ahead only when there is nothing to understand, or he ticked", () => {
    expect(mayFile(check(), false, false, false)).toBe(true);
    expect(mayFile(check({ ok: false }), false, false, false)).toBe(false);
    expect(mayFile(check({ ok: false }), false, false, true)).toBe(true);
    expect(mayFile(undefined, true, false, false)).toBe(false);
    expect(mayFile(undefined, true, false, true)).toBe(true);
    // Still asking: not yet.
    expect(mayFile(undefined, false, true, true)).toBe(false);
  });

  it("says the validation note as the owner worded it", () => {
    expect(VALIDATE_NOTE).toBe(
      "Before eSubmission, open this file in the BIR Alphalist Validation program and validate it. Submit the validated file, not this one.",
    );
  });
});
