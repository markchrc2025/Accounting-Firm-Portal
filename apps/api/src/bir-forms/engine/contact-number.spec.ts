// contact-number.spec.ts — U21: a return does not leave the Portal without a contact
// number. Invented numbers only.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  CONTACT_FORMS,
  CONTACT_ITEM,
  CONTACT_NUMBER_REQUIRED,
  contactNumberOf,
  emailOf,
  contactRefusal,
  normalisedContact,
  printRowsWithContact,
} from "./contact-number";
import type { FilingData, Taxpayer } from "./types";
import { build0619EPrintRows } from "./withholding-print";
import { clientNeeds, type ClientFacts } from "../../mcp/bir/needs";

const SENTENCE =
  "Add the client's contact number before this return leaves the Portal. eBIRForms will not submit a return without one.";
const MUST_BE_11 =
  "The client's contact number must be 11 digits, like 09171234567. eBIRForms accepts no other form.";
const TEN = [
  "2551Q",
  "2550Q",
  "1701",
  "1701A",
  "1701Q",
  "1702Q",
  "1702RT",
  "0619E",
  "1601EQ",
  "1601C",
];

describe("U21 · the contact number rule", () => {
  it("the sentence is the one the owner gave, word for word", () => {
    expect(CONTACT_NUMBER_REQUIRED).toBe(SENTENCE);
  });

  it("the ten returns that print a contact number, and no others", () => {
    expect([...CONTACT_FORMS].sort()).toEqual([...TEN].sort());
    expect(contactRefusal("2307", "")).toBeNull();
    expect(contactRefusal("2316", "")).toBeNull();
  });

  it.each(TEN)("%s: a blank contact number is refused with the one sentence", (form) => {
    for (const blank of ["", "   ", "-", "( ) - .", " . . "]) {
      expect(contactRefusal(form, blank)).toBe(SENTENCE);
    }
  });

  it.each(TEN)(
    "%s: eleven digits, written plainly or with spaces, dashes, dots or brackets, will do",
    (form) => {
      for (const ok of [
        "09171234567",
        "0917 123 4567",
        "0917-123-4567",
        "(0917) 123-4567",
        "0917.123.4567",
        "+639171234567",
        "639171234567",
        "+63 917 123 4567",
        "12345678901",
      ]) {
        expect([ok, contactRefusal(form, ok)]).toEqual([ok, null]);
      }
    },
  );

  it.each(TEN)(
    "%s: anything but eleven digits is refused with the 11-digit sentence",
    (form) => {
      for (const bad of [
        "0917123456", // 10 digits
        "091712345678", // 12 digits
        "0917abc4567",
        "n/a",
        "0917 123 4567 8901",
        "+0917 123 4567", // a plus is only the +63 form
        "+63 917 123 456", // 9 digits after 63
        "6391712345678", // 11 digits after 63
        "(02) 8123-4567", // a landline is 10 digits
      ]) {
        expect([bad, contactRefusal(form, bad)]).toEqual([bad, MUST_BE_11]);
      }
    },
  );

  it("normalising: separators dropped; +63 or 63 and ten digits become 0 and those ten; anything else as typed", () => {
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

  it("the table of items is the print maps' own (keys and item numbers)", () => {
    const maps = join(__dirname, "../../../../../packages/bir-pdf/maps");
    for (const [form, at] of Object.entries(CONTACT_ITEM)) {
      const map = JSON.parse(
        readFileSync(join(maps, `${form}-${at.version}.json`), "utf8"),
      );
      const field = map.fields.find((f: { key: string }) => f.key === at.key);
      expect(field).toBeDefined();
      expect(String(field.item)).toBe(at.item);
    }
  });

  it("the withholding returns use the number typed in the draft, else the client's; the others the client's", () => {
    expect(contactNumberOf("1601EQ", { contact: " 0917 000 0000 " }, "")).toBe(
      "0917 000 0000",
    );
    expect(contactNumberOf("1601EQ", { contact: "" }, "0918 111 1111")).toBe(
      "0918 111 1111",
    );
    expect(contactNumberOf("0619E", { contact: "0917" }, "0918")).toBe("0917");
    expect(contactNumberOf("2551Q", { contact: "0917" }, "")).toBe("");
    expect(contactNumberOf("2551Q", {}, null)).toBe("");
  });

  it("a withholding return prints the client's number when none was typed; the typed one wins", () => {
    const tp = {
      phone: "09181111111",
      kind: "non-individual",
      tin: "123456789",
    } as Taxpayer;
    const rows = (d: FilingData) =>
      Object.fromEntries(build0619EPrintRows(d, tp, "2026-08"));
    expect(rows({})["f0619E:contact"]).toBe("09181111111");
    expect(rows({ contact: "09170000000" })["f0619E:contact"]).toBe("09170000000");
  });
});

describe("U21 · the print of the seven eBIRForms returns", () => {
  it("drops the separators from the contact number's row only; the XML is not touched here", () => {
    const rows: [string, string][] = [
      ["frm2551Qv2018:telNo", "(02) 8123-4567"],
      ["frm2551Qv2018:registeredName", "A B-C (D)"],
    ];
    expect(printRowsWithContact("2551Q", rows)).toEqual([
      ["frm2551Qv2018:telNo", "0281234567"],
      ["frm2551Qv2018:registeredName", "A B-C (D)"],
    ]);
    expect(printRowsWithContact("1701Q", rows)).toEqual(rows); // no box for it
    expect(rows[0]![1]).toBe("(02) 8123-4567");
  });
});

describe("U21 · the connector's need", () => {
  const FULL: ClientFacts = {
    kind: "non-individual",
    tin: "111222333",
    rdo: "045",
    regName: "SAMPLE CORP",
    businessName: "Sample",
    lastName: null,
    firstName: null,
    address: "1 Invented St",
    zip: "1800",
    phone: "09171234567",
    taxType: "VAT",
    civilStatus: "Single",
    classification: "Professional",
    birthdate: new Date("1990-01-01"),
  };
  const need = (form: string, c: ClientFacts, data?: Record<string, unknown>) =>
    clientNeeds(form, c, data).find((n) => n.key === "client.contactNumber");

  it.each(TEN)(
    "%s: a blank client contact number is a need, written with portal_update_client field phone",
    (form) => {
      expect(need(form, { ...FULL, phone: null })).toEqual({
        key: "client.contactNumber",
        question: "What is the client's contact number (landline or mobile)?",
        why: expect.stringContaining("eBIRForms will not submit a return without one"),
        setWith: "portal_update_client field phone",
        kind: "text",
      });
      expect(need(form, { ...FULL, phone: "  " })).toBeDefined();
      expect(need(form, FULL)).toBeUndefined();
    },
  );

  it("the three withholding returns do not ask when the draft has a number typed", () => {
    for (const form of ["0619E", "1601EQ", "1601C"]) {
      expect(
        need(form, { ...FULL, phone: null }, { contact: "0917 000 0000" }),
      ).toBeUndefined();
    }
    expect(
      need("2551Q", { ...FULL, phone: null }, { contact: "0917 000 0000" }),
    ).toBeDefined();
  });

  it("a number that is set but not 11 digits is a need too, asked as 11 digits", () => {
    for (const phone of ["1234567890123", "0917 123 456", "n/a", "(02) 8123-4567"]) {
      expect(need("2551Q", { ...FULL, phone })).toEqual({
        key: "client.contactNumber",
        question:
          "What is the client's contact number as 11 digits (for example 09171234567)?",
        why: expect.stringContaining("eBIRForms"),
        setWith: "portal_update_client field phone",
        kind: "text",
      });
    }
    // a number written with spaces or +63 is fine as it is
    expect(need("2551Q", { ...FULL, phone: "+63 917 123 4567" })).toBeUndefined();
  });

  it("the certificates have none", () => {
    expect(need("2307", { ...FULL, phone: null })).toBeUndefined();
    expect(need("2316", { ...FULL, phone: null })).toBeUndefined();
  });
});

describe("U24 · the e-mail a return prints", () => {
  it("the withholding returns: the e-mail typed in the draft, else the client's", () => {
    for (const form of ["0619E", "1601EQ", "1601C"]) {
      expect(
        emailOf(form, { email: " typed@example.test " }, "client@example.test"),
      ).toBe("typed@example.test");
      expect(emailOf(form, { email: "" }, "client@example.test")).toBe(
        "client@example.test",
      );
      expect(emailOf(form, { email: "   " }, " client@example.test ")).toBe(
        "client@example.test",
      );
      expect(emailOf(form, {}, "client@example.test")).toBe("client@example.test");
      expect(emailOf(form, null, "client@example.test")).toBe("client@example.test");
      expect(emailOf(form, { email: "" }, null)).toBe("");
      expect(emailOf(form, { email: 42 }, "client@example.test")).toBe(
        "client@example.test",
      );
    }
  });
  it("the other returns print the client's e-mail; nothing typed in the draft is read", () => {
    expect(emailOf("2551Q", { email: "typed@example.test" }, "client@example.test")).toBe(
      "client@example.test",
    );
    expect(emailOf("1702RT", {}, undefined)).toBe("");
  });
});
