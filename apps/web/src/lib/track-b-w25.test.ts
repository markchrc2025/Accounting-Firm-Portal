// track-b-w25.test.ts - W25: the contact number written as the API writes it (pinned to the same
// cases as apps/api/src/bir-forms/engine/contact-number.spec.ts), and the prefill's rule: blanks
// only, never a typed or saved value, and a client change refills only its own prefilled values.
import { describe, expect, it } from "vitest";
import { normalisedContact, partyPrefill, PREFILL_HINT } from "./contactNumber";

describe("W25 normalisedContact (the API's U22 rule, the same cases)", () => {
  it("drops spaces, dashes, dots and brackets; +63 or 63 and ten digits become 0 and the ten", () => {
    // the API spec's own cases
    expect(normalisedContact("0917 123 4567")).toBe("09171234567");
    expect(normalisedContact("(0917) 123-4567")).toBe("09171234567");
    expect(normalisedContact("+63 917-123-4567")).toBe("09171234567");
    expect(normalisedContact("639171234567")).toBe("09171234567");
    expect(normalisedContact("09171234567")).toBe("09171234567");
    expect(normalisedContact("63917123456")).toBe("63917123456"); // 11 digits: as typed
    expect(normalisedContact("n/a")).toBe("n/a");
    expect(normalisedContact("+0917")).toBe("+0917");
    expect(normalisedContact("   ")).toBe("");
  });
  it("the owner's cases", () => {
    expect(normalisedContact("+63 917 800 5122")).toBe("09178005122");
    expect(normalisedContact("0917-800-5122")).toBe("09178005122");
    expect(normalisedContact("(0917) 800 5122")).toBe("09178005122");
    expect(normalisedContact("63 917 800 5122")).toBe("09178005122");
    expect(normalisedContact("0917.800.5122")).toBe("09178005122");
    // not +63 or 63 and ten digits: no rewrite (only spacing dropped), as the API keeps it
    expect(normalisedContact("8123-4567 local 2")).toBe("81234567local2");
    expect(normalisedContact("81234567")).toBe("81234567");
  });
});

const A = { id: "a", phone: "+63 917 800 5122", email: " owner@alpha.example " };
const B = { id: "b", phone: "0918-111-2222", email: "pay@beta.example" };

describe("W25 the prefill", () => {
  it("fills blank boxes from the client record", () => {
    expect(partyPrefill({ contact: "", email: "  " }, A, null)).toEqual({
      patch: { contact: "09178005122", email: "owner@alpha.example" },
      prefill: { clientId: "a", contact: "09178005122", email: "owner@alpha.example" },
    });
  });
  it("never touches a typed or saved value", () => {
    expect(
      partyPrefill({ contact: "0999 000 1111", email: "mine@x.example" }, A, null),
    ).toEqual({
      patch: {},
      prefill: { clientId: "a" },
    });
    expect(partyPrefill({ contact: "", email: "mine@x.example" }, A, null).patch).toEqual(
      {
        contact: "09178005122",
      },
    );
  });
  it("a client with no phone or no email leaves that box blank and changes nothing else", () => {
    expect(
      partyPrefill(
        { contact: "", email: "" },
        { id: "c", phone: null, email: "e@c.example" },
        null,
      ),
    ).toEqual({
      patch: { email: "e@c.example" },
      prefill: { clientId: "c", email: "e@c.example" },
    });
    expect(
      partyPrefill({ contact: "", email: "" }, { id: "c", phone: "", email: "" }, null),
    ).toEqual({
      patch: {},
      prefill: { clientId: "c" },
    });
  });
  it("a client change refills what still holds the previous client's values, and blanks", () => {
    const first = partyPrefill({ contact: "", email: "" }, A, null);
    const second = partyPrefill(
      { contact: "09178005122", email: "typed@x.example" },
      B,
      first.prefill,
    );
    expect(second.patch).toEqual({ contact: "09181112222" });
    expect(second.prefill).toEqual({ clientId: "b", contact: "09181112222" });
  });
  it("a new client with no phone clears the previous client's prefilled phone", () => {
    const first = partyPrefill({ contact: "", email: "" }, A, null);
    const next = partyPrefill(
      { contact: "09178005122", email: "owner@alpha.example" },
      { id: "c", phone: null, email: null },
      first.prefill,
    );
    expect(next.patch).toEqual({ contact: "", email: "" });
  });
  it("says the hint in the owner's words", () => {
    expect(PREFILL_HINT).toBe("Filled from the client record.");
  });
});
