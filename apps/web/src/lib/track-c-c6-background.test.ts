// C5/C6 (D55 and its amendment): the editors' mirror of the server's background rules
// gives the same answer as the server's own module, and the ATC choices the editor lists
// are the ones the server accepts, form by form.
import { describe, expect, it } from "vitest";
import {
  ATC_ITEM,
  INCOME_TAX_ATC,
  civilStatusOf as serverCivil,
  taxpayerTypeOf as serverType,
} from "../../../api/src/bir-forms/engine/taxpayer-background";
import {
  ATC_CHOICES,
  CHOOSE_ATC,
  ITEM_NUMBERS,
  SET_CLASSIFICATION,
  civilStatusOf,
  taxpayerTypeOf,
  type AtcForm,
} from "./incomeTaxBackground";

const FORMS: AtcForm[] = ["1701", "1701A", "1701Q", "1702Q", "1702RT"];

describe("C6 · the editors' background rules mirror the server's", () => {
  it("taxpayerTypeOf gives the server's answer for every Classification the Client form stores and for odd records", () => {
    for (const raw of [
      "Professional",
      "Single Proprietorship",
      "Domestic Corporation",
      "Partnership",
      "",
      "professional",
      " SINGLE   PROPRIETORSHIP ",
      "Single Proprietor",
      "Estate",
      null,
      undefined,
    ]) {
      expect(taxpayerTypeOf(raw)).toBe(serverType(raw));
    }
  });

  it("civilStatusOf gives the server's answer for the Client form's options and for odd records", () => {
    for (const raw of [
      "Single",
      "Married",
      "Widow/Widower",
      "Legally Separated",
      "MARRIED",
      "widowed",
      "Separated",
      "",
      null,
      undefined,
      "Divorced",
    ]) {
      expect(civilStatusOf(raw)).toBe(serverCivil(raw));
    }
  });

  it("the selector lists exactly the ATC codes the server accepts for each form, in the template's order", () => {
    for (const f of FORMS) {
      expect(ATC_CHOICES[f].map((c) => c.code)).toEqual([...INCOME_TAX_ATC[f]]);
      // The 1702s print the code with a space ("IC 055"); the saved code has none.
      for (const c of ATC_CHOICES[f])
        expect(c.label.replace(/\s+/g, "").startsWith(c.code)).toBe(true);
    }
  });

  it("the form's own item numbers agree with the server's refusal message", () => {
    for (const f of FORMS) expect(ITEM_NUMBERS[f].atc).toBe(ATC_ITEM[f]);
  });

  it("the plain-text lines the editor shows", () => {
    expect(CHOOSE_ATC("1701")).toBe("Choose Item 7 (ATC).");
    expect(CHOOSE_ATC("1701A")).toBe("Choose Item 7 (ATC).");
    expect(CHOOSE_ATC("1701Q")).toBe("Choose Item 8 (ATC).");
    expect(CHOOSE_ATC("1702Q")).toBe("Choose the ATC.");
    expect(CHOOSE_ATC("1702RT")).toBe("Choose the ATC.");
    expect(SET_CLASSIFICATION).toBe(
      "Set this client's Classification on the Client page.",
    );
  });
});
