// track-b-w27.test.ts — W27 (Track A U27, D74): what the web reads of the ATC gate.
import { describe, expect, it } from "vitest";
import { ATC_CHOICES as SHARED, missingAtcs } from "@portal/shared";
import { ATC_CHOICES } from "./incomeTaxBackground";
import { offersUndo } from "./undoFiling";

const filed = (over: Record<string, unknown>) =>
  ({
    status: "filed",
    confirmation: null,
    confirmationRequired: true,
    ...over,
  }) as Parameters<typeof offersUndo>[0];

describe("W27 · Undo filing", () => {
  it("is offered on an override filing and on a return filed before the confirmation rule", () => {
    expect(offersUndo(filed({ confirmation: { kind: "override" } }), true, false)).toBe(
      true,
    );
    expect(offersUndo(filed({}), true, false)).toBe(true);
  });
  it("never on a BIR e-mail, a form filed without confirmations by design, a draft, an amended one, or for a non-Super Admin", () => {
    expect(offersUndo(filed({ confirmation: { kind: "bir_email" } }), true, false)).toBe(
      false,
    );
    expect(offersUndo(filed({ confirmationRequired: false }), true, false)).toBe(false);
    expect(offersUndo(filed({ status: "draft" }), true, false)).toBe(false);
    expect(offersUndo(filed({}), true, true)).toBe(false);
    expect(offersUndo(filed({}), false, false)).toBe(false);
  });
});

describe("W27 · the editors read the shared lists and sentences", () => {
  it("the ATC choices are @portal/shared's, not a copy", () => {
    expect(ATC_CHOICES).toBe(SHARED);
  });
  it("the sentence the buttons show is the API's", () => {
    expect(missingAtcs("1701Q", { salesA: "1" })).toEqual([
      "Choose the Item 8 ATC before this return leaves the Portal.",
    ]);
  });
});
