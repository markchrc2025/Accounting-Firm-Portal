// contact-number.spec.ts — U21: a return does not leave the Portal without a contact
// number. Invented numbers only.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  CONTACT_FORMS,
  CONTACT_ITEM,
  CONTACT_NUMBER_REQUIRED,
  contactNumberOf,
  contactRefusal,
  printRowsWithContact,
} from "./contact-number";
import type { FilingData, Taxpayer } from "./types";
import { build0619EPrintRows } from "./withholding-print";
import { clientNeeds, type ClientFacts } from "../../mcp/bir/needs";

const SENTENCE =
  "Add the client's contact number before this return leaves the Portal. eBIRForms will not submit a return without one.";
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
    for (const blank of ["", "   ", "-", "( ) - + .", "n/a"]) {
      expect(contactRefusal(form, blank)).toBe(SENTENCE);
    }
  });

  it.each(TEN)("%s: a number with separators or up to 12 digits will do", (form) => {
    for (const ok of [
      "09171234567",
      "0917 123 4567",
      "(02) 8123-4567",
      "+63 917 123 4567",
      "123456789012",
    ]) {
      expect(contactRefusal(form, ok)).toBeNull();
    }
  });

  it("more than 12 digits is refused in the print engine's own words, naming the item", () => {
    expect(contactRefusal("0619E", "0917-123-4567-890")).toBe(
      '0619E 2018-01 f0619E:contact (item contact): "0917-123-4567-890" is 14 characters but the paper has 12 boxes',
    );
    expect(contactRefusal("2551Q", "1234567890123")).toBe(
      '2551Q 2018-01 frm2551Qv2018:telNo (item 10): "1234567890123" is 13 characters but the paper has 12 boxes',
    );
    expect(contactRefusal("1701Q", "1234567890123")).toBe(
      '1701Q contact number: "1234567890123" is 13 characters but the paper has 12 boxes',
    );
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

  it("a number the paper cannot carry is a need that says so", () => {
    const n = need("2551Q", { ...FULL, phone: "1234567890123" })!;
    expect(n.question).toContain("is 13 characters but the paper has 12 boxes");
    expect(n.question).toContain("What is the client's contact number");
    expect(n.setWith).toBe("portal_update_client field phone");
  });

  it("the certificates have none", () => {
    expect(need("2307", { ...FULL, phone: null })).toBeUndefined();
    expect(need("2316", { ...FULL, phone: null })).toBeUndefined();
  });
});
