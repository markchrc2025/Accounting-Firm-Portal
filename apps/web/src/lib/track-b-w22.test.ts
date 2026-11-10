// W22: who is offered "Undo filing", and the owner's words (Track A U22). Invented data.
import { describe, expect, it } from "vitest";
import type { BirFormConfirmation, BirFormSummary } from "./api";
import {
  CONTACT_HINT,
  hasAmendmentIn,
  hasFilingHistory,
  offersUndo,
  UNDO_FILING_TEXT,
  UNDO_REASON_MIN_LENGTH,
} from "./undoFiling";

const conf = (kind: "bir_email" | "override"): BirFormConfirmation => ({
  id: "k1",
  kind,
  birFileName: null,
  receivedAt: null,
  filedOn: null,
  originalFilename: null,
  hasFile: false,
  warnings: [],
  overrideReason: kind === "override" ? "INVENTED REASON IN TRANSIT" : null,
  filedWithoutConfirmation: kind === "override",
  uploadedByUserId: "u1",
  uploadedAt: "2026-04-26T01:00:00.000Z",
});
const summary = (id: string, amendsId: string | null): BirFormSummary => ({
  id,
  clientId: "c1",
  clientName: "INVENTED CO",
  form: "2551Q",
  status: "draft",
  period: "2026-Q1",
  filedAt: null,
  createdAt: "2026-04-01T00:00:00.000Z",
  updatedAt: "2026-04-01T00:00:00.000Z",
  amendsId,
});

describe("W22 who is offered Undo filing", () => {
  const filedByOverride = { status: "filed", confirmation: conf("override") };
  it("a Super Admin, on a filed return filed without the BIR email, with no amendment", () => {
    expect(offersUndo(filedByOverride, true, false)).toBe(true);
  });
  it("not anyone else", () => {
    expect(offersUndo(filedByOverride, false, false)).toBe(false);
  });
  it("not a return with a BIR email", () => {
    expect(
      offersUndo({ status: "filed", confirmation: conf("bir_email") }, true, false),
    ).toBe(false);
  });
  it("not a return filed before there were confirmations (no confirmation)", () => {
    expect(offersUndo({ status: "filed", confirmation: null }, true, false)).toBe(false);
  });
  it("not a draft", () => {
    expect(offersUndo({ status: "draft", confirmation: null }, true, false)).toBe(false);
    expect(
      offersUndo({ status: "draft", confirmation: conf("override") }, true, false),
    ).toBe(false);
  });
  it("not a return that has an amendment", () => {
    expect(offersUndo(filedByOverride, true, true)).toBe(false);
  });
  it("when the amendments are not known the API decides, in its own words", () => {
    expect(offersUndo(filedByOverride, true, undefined)).toBe(true);
  });
});

describe("W22 amendments and history", () => {
  it("an amendment is a return in the client's list that names this one", () => {
    const list = [summary("a", null), summary("b", "a")];
    expect(hasAmendmentIn(list, "a")).toBe(true);
    expect(hasAmendmentIn(list, "b")).toBe(false);
    expect(hasAmendmentIn(list, "zzz")).toBe(false);
    expect(hasAmendmentIn(undefined, "a")).toBe(false);
  });
  it("history is any filing taken back", () => {
    expect(hasFilingHistory({})).toBe(false);
    expect(hasFilingHistory({ filingUndos: [] })).toBe(false);
    expect(
      hasFilingHistory({
        filingUndos: [
          {
            id: "x",
            reason: "r",
            filedAt: "2026-04-25T00:00:00.000Z",
            undoneAt: "2026-04-26T00:00:00.000Z",
            undoneByUserId: "u",
            overrideReason: null,
          },
        ],
      }),
    ).toBe(true);
  });
});

describe("W22 the owner's words", () => {
  it("the window says exactly what the owner wrote", () => {
    expect(UNDO_FILING_TEXT).toBe(
      "Use this only when the return never reached the BIR. The return goes back to draft with its figures as filed. The filing is kept in the return's history and cannot be deleted. Then mark it filed again with the BIR confirmation email.",
    );
  });
  it("the reason counter counts to 10, as the override box does", () => {
    expect(UNDO_REASON_MIN_LENGTH).toBe(10);
  });
  it("the phone hint", () => {
    expect(CONTACT_HINT).toBe("Contact number: 11 digits, like 09171234567");
  });
});
