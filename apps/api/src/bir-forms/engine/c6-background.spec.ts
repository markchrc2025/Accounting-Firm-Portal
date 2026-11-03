// c6-background.spec.ts — C5/C6 (D55 and its amendment): the background items of the
// income-tax returns. Item 6 is the client's Classification, Item 7 (the ATC) is what the
// preparer chose, Item 16 is the client's civil status, and Items 17 and 18 are answered
// only for a married taxpayer — never read from the draft's figures or stale keys.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { build1701 } from "./build1701";
import { build1701A } from "./build1701A";
import { build1701Q } from "./build1701Q";
import { build1702Q } from "./build1702Q";
import { build1702RT } from "./build1702RT";
import { compute1701 } from "./compute1701";
import { compute1701A } from "./compute1701A";
import { compute1701Q } from "./compute1701Q";
import { compute1702Q } from "./compute1702Q";
import { compute1702RT } from "./compute1702RT";
import { ExportRefusal } from "./export-refusal";
import {
  INCOME_TAX_ATC,
  chosenAtc,
  civilStatusOf,
  taxpayerTypeOf,
  type IncomeTaxForm,
} from "./taxpayer-background";
import type { Filing, FilingData, Taxpayer } from "./types";

const person = (over: Partial<Taxpayer> = {}): Taxpayer => ({
  id: "t1",
  kind: "individual",
  regName: "",
  lastName: "HALIMBAWA",
  firstName: "JUANA",
  middleName: "SUBOK",
  tin: "000987654",
  branch: "00000",
  rdo: "045",
  address: "LOT 0 HALIMBAWA ST",
  city: "LUNGSOD NG HALIMBAWA",
  zip: "0000",
  birthdate: "1980-01-01",
  email: "juana@example.com",
  phone: "09000000000",
  citizenship: "FILIPINO",
  civilStatus: "Single",
  taxpayerType: "",
  classification: "Single Proprietorship",
  createdAt: 0,
  ...over,
});

const filing = (form: Filing["form"], data: FilingData, period: string): Filing => ({
  id: "f1",
  form,
  taxpayerId: "t1",
  status: "draft",
  period,
  data,
  createdAt: 0,
  updatedAt: 0,
});

/** The keys of an export whose value is "true". */
function ticked(xml: string, ns: string): string[] {
  return [...xml.matchAll(/<div>([^=]+)=true\1=<\/div>/g)]
    .map((m) => m[1]!)
    .filter((k) => k.startsWith(ns))
    .map((k) => k.slice(ns.length));
}

describe("civilStatusOf (Item 16)", () => {
  it.each([
    ["Single", "single"],
    ["MARRIED", "married"],
    ["married", "married"],
    ["Legally Separated", "separated"],
    ["legally-separated", "separated"],
    ["Widow/Widower", "widow"],
    ["Widow(er)", "widow"],
    ["widowed", "widow"],
  ])("%s → %s", (raw, box) => {
    expect(civilStatusOf(raw)).toBe(box);
  });
  it.each([
    [""],
    [null],
    [undefined],
    ["Separated"],
    ["Divorced"],
    ["Annulled"],
    ["Not set"],
  ])("%p ticks no box", (raw) => {
    expect(civilStatusOf(raw)).toBeNull();
  });
});

describe("taxpayerTypeOf (Item 6 is the client's Classification)", () => {
  it.each([
    ["Professional", "prof"],
    ["Single Proprietorship", "single"],
    ["professional", "prof"],
    ["PROFESSIONAL ", "prof"],
    ["  single   proprietorship ", "single"],
  ])("%p → %s", (raw, box) => {
    expect(taxpayerTypeOf(raw)).toBe(box);
  });
  it.each([
    [""],
    [null],
    [undefined],
    ["Not set"],
    ["Domestic Corporation"],
    ["Partnership"],
    ["Single Proprietor"],
    ["Estate"],
    ["Compensation Earner"],
  ])("%p ticks no box", (raw) => {
    expect(taxpayerTypeOf(raw)).toBeNull();
  });
});

describe("chosenAtc (Item 7 is the preparer's choice)", () => {
  it.each([[""], ["   "], [undefined], [null]])(
    "%p: nothing chosen, nothing ticked",
    (raw) => {
      for (const f of ["1701", "1701A", "1701Q"] as const)
        expect(chosenAtc(raw, f)).toBeNull();
    },
  );

  it("every ATC the form prints is accepted for that form, in any case and with spaces", () => {
    for (const f of Object.keys(INCOME_TAX_ATC) as IncomeTaxForm[]) {
      for (const code of INCOME_TAX_ATC[f]) {
        expect(chosenAtc(code, f)).toBe(code);
        expect(chosenAtc(` ${code.toLowerCase()} `, f)).toBe(code);
      }
    }
  });

  it("an ATC the form does not print is refused, naming the ATC and the form", () => {
    expect(() => chosenAtc("II099", "1701")).toThrow(ExportRefusal);
    expect(() => chosenAtc("II099", "1701")).toThrow(
      "Item 7: the ATC II099 is not one of the ATC choices printed on BIR Form 1701. Choose Item 7 again, or clear it, then try again.",
    );
    // II013 is printed on the 1701 and 1701Q but not on the 1701A; II011 only on the 1701.
    expect(() => chosenAtc("II013", "1701A")).toThrow(
      "Item 7: the ATC II013 is not one of the ATC choices printed on BIR Form 1701A. Choose Item 7 again, or clear it, then try again.",
    );
    expect(() => chosenAtc("II011", "1701Q")).toThrow(
      "Item 8: the ATC II011 is not one of the ATC choices printed on BIR Form 1701Q. Choose Item 8 again, or clear it, then try again.",
    );
  });

  it("INCOME_TAX_ATC is exactly the ATC choices the committed print maps carry for the form", () => {
    const maps = join(
      __dirname,
      "..",
      "..",
      "..",
      "..",
      "..",
      "packages",
      "bir-pdf",
      "maps",
    );
    const item = { "1701": "7", "1701A": "7", "1701Q": "8" } as const;
    for (const f of ["1701", "1701A", "1701Q"] as const) {
      const map = JSON.parse(readFileSync(join(maps, `${f}-2018-01.json`), "utf8")) as {
        fields: { key: string; kind: string; item?: string }[];
      };
      const printed = map.fields
        .filter((m) => m.kind === "mark" && m.item?.startsWith(`${item[f]} II0`))
        .map((m) => m.item!.slice(item[f].length + 1));
      expect([...INCOME_TAX_ATC[f]].sort()).toEqual(printed.sort());
    }
  });
});

describe("build1701: Items 6, 7, 16, 17 and 18", () => {
  const xml = (tp: Taxpayer, d: FilingData) =>
    build1701(
      filing("1701", { year: "2026", ...d }, "2026"),
      tp,
      compute1701({ year: "2026", ...d }),
    );
  const background = (xmlText: string) =>
    ticked(xmlText, "frm1701:")
      .filter((k) => /^rdoPg1I(6|7|16|17|18)/.test(k))
      .sort();

  it("Single Proprietorship with compensation figures only and no d.atc: Single Proprietor, no ATC (the owner's client)", () => {
    const x = xml(person({ classification: "Single Proprietorship" }), {
      compA: "300000",
    });
    expect(background(x)).toEqual(["rdoPg1I16CivilStatusS", "rdoPg1I6TaxpayerTypeS"]);
  });

  it("adding business figures changes nothing about Items 6 and 7", () => {
    const x = xml(person(), { compA: "300000", salesA: "450000" });
    expect(background(x)).toEqual(["rdoPg1I16CivilStatusS", "rdoPg1I6TaxpayerTypeS"]);
  });

  it("the chosen ATC ticks exactly its own box", () => {
    for (const code of INCOME_TAX_ATC["1701"]) {
      const x = xml(person(), { compA: "300000", atc: code });
      expect(background(x)).toEqual(
        ["rdoPg1I16CivilStatusS", "rdoPg1I6TaxpayerTypeS", `rdoPg1I7ATC_${code}`].sort(),
      );
    }
  });

  it("Professional ticks Professional; Domestic Corporation, Partnership and Not set tick no Item 6 box", () => {
    expect(background(xml(person({ classification: "Professional" }), {}))).toEqual([
      "rdoPg1I16CivilStatusS",
      "rdoPg1I6TaxpayerTypeP",
    ]);
    for (const c of ["Domestic Corporation", "Partnership", ""]) {
      expect(background(xml(person({ classification: c }), { compA: "1" }))).toEqual([
        "rdoPg1I16CivilStatusS",
      ]);
    }
  });

  it("a stale taxpayerType, civil, spouse answer or ATC in the draft that is not a choice is not read as Item 6/16/17/18", () => {
    const x = xml(person(), {
      taxpayerType: "comp", // stale, ignored
      civil: "married", // stale, ignored
      spouseIncome: "yes", // client is Single: ignored
      filing: "joint", // client is Single: ignored
    });
    expect(background(x)).toEqual(["rdoPg1I16CivilStatusS", "rdoPg1I6TaxpayerTypeS"]);
  });

  it("an ATC the form does not print refuses the export", () => {
    expect(() => xml(person(), { atc: "II099" })).toThrow(ExportRefusal);
  });

  it("Married: Items 17 and 18 as answered; unanswered stays blank", () => {
    const married = person({ civilStatus: "Married" });
    expect(background(xml(married, { spouseIncome: "no", filing: "separate" }))).toEqual(
      [
        "rdoPg1I16CivilStatusM",
        "rdoPg1I17SpouseIncomeNo",
        "rdoPg1I18FilingStatusS",
        "rdoPg1I6TaxpayerTypeS",
      ].sort(),
    );
    expect(background(xml(married, {}))).toEqual(
      ["rdoPg1I16CivilStatusM", "rdoPg1I6TaxpayerTypeS"].sort(),
    );
  });
});

describe("build1701A: Items 6, 7, 16, 17 and 18", () => {
  const xml = (tp: Taxpayer, d: FilingData) =>
    build1701A(
      filing("1701A", { year: "2025", ...d }, "2025"),
      tp,
      compute1701A({ year: "2025", ...d }),
    );
  const background = (xmlText: string) =>
    ticked(xmlText, "frm1701A:")
      .filter((k) => /^opt(TaxType|ATC|CivilStatus|SpouseIncome|FilingStatus)_/.test(k))
      .sort();

  it("a single professional at 8% who chose II017: Professional, II017, Single; 17 and 18 blank (a stale draft answer is ignored)", () => {
    const x = xml(person({ classification: "Professional", civilStatus: "Single" }), {
      taxRate: "eight",
      atc: "II017",
      taxpayerType: "single", // stale, ignored
      civil: "married", // stale, ignored
      spouseIncome: "yes",
      filing: "joint",
    });
    expect(background(x)).toEqual(["optATC_4", "optCivilStatus_1", "optTaxType_2"]);
  });

  it("nothing chosen: no ATC box, whatever the rate and figures", () => {
    const x = xml(person(), { taxRate: "eight", i36A: "450000" });
    expect(background(x)).toEqual(["optCivilStatus_1", "optTaxType_1"]);
  });

  it("an ATC the 1701A does not print (II013, II011) refuses the export", () => {
    expect(() => xml(person(), { atc: "II013" })).toThrow(ExportRefusal);
    expect(() => xml(person(), { atc: "II011" })).toThrow(ExportRefusal);
  });

  it("Married: Item 16 Married, and 17 and 18 as answered", () => {
    const x = xml(person({ civilStatus: "Married" }), {
      spouseIncome: "no",
      filing: "joint",
    });
    expect(background(x)).toEqual(
      [
        "optCivilStatus_2",
        "optFilingStatus_1",
        "optSpouseIncome_2",
        "optTaxType_1",
      ].sort(),
    );
  });

  it("Married but unanswered: 17 and 18 blank", () => {
    const x = xml(person({ civilStatus: "Married" }), {});
    expect(background(x)).toEqual(["optCivilStatus_2", "optTaxType_1"]);
  });

  it("no classification on the client: Items 6 and 7 blank", () => {
    const x = xml(person({ classification: "", civilStatus: "" }), {});
    expect(background(x)).toEqual([]);
  });
});

describe("build1701Q: Items 7 and 8, and a spouse's answers only for a spouse on the return", () => {
  const run = (tp: Taxpayer, d: FilingData) =>
    ticked(
      build1701Q(
        filing("1701Q", { year: "2026", ...d }, "2026-Q2"),
        tp,
        compute1701Q({ year: "2026", ...d }),
      ),
      "frm1701q:",
    );

  it("a professional at 8% who chose II017: Item 7 Professional, Item 8 II017", () => {
    const k = run(person({ classification: "Professional" }), {
      rateA: "eight",
      methodA: "osd",
      atc: "II017",
      filerType: "single", // stale, ignored
    });
    expect(k).toEqual(expect.arrayContaining(["optType_2", "optATC_5"]));
    expect(k).not.toContain("optType_1");
    expect(k).not.toContain("optATC_1");
  });

  it("nothing chosen: no ATC box; a stale filerType is not Item 7", () => {
    const k = run(person(), { rateA: "graduated", methodA: "osd", filerType: "prof" });
    expect(k).toContain("optType_1");
    expect(k).not.toContain("optType_2");
    expect(k.filter((x) => x.startsWith("optATC_"))).toEqual([]);
  });

  it("an ATC the 1701Q does not print (II011) refuses the export", () => {
    expect(() => run(person(), { rateA: "graduated", atc: "II011" })).toThrow(
      ExportRefusal,
    );
  });

  it("an estate or trust taxpayer type on the client is not the Classification: no Item 7 box", () => {
    const k = run(
      person({ kind: "non-individual", taxpayerType: "Estate", classification: "" }),
      { rateA: "graduated" },
    );
    expect(k.filter((x) => x.startsWith("optType_"))).toEqual([]);
    expect(k.filter((x) => x.startsWith("optATC_"))).toEqual([]);
  });

  it("no spouse on the return: the spouse's tax rate and foreign-credit answers are blank", () => {
    const k = run(person(), { rateA: "graduated", methodA: "osd" });
    expect(k.filter((x) => /^optSpouse(TaxRate|ForeignTaxCred)/.test(x))).toEqual([]);
  });

  it("a spouse on the return (the editor carries rateB): the spouse's answers print", () => {
    const k = run(person(), {
      rateA: "graduated",
      methodA: "osd",
      rateB: "eight",
      methodB: "osd",
    });
    expect(k).toEqual(
      expect.arrayContaining([
        "optSpouseTaxRate_2",
        "optSpouseForeignTaxCred_2",
        "optSpouseMethod:_2",
      ]),
    );
    expect(k).not.toContain("optSpouseTaxRate_1");
  });
});

describe("build1701: the spouse's tax rate on page 2 follows the editor's rateB/methodB", () => {
  it("rateB eight → Item 12 8%; rateB graduated with itemized → Itemized", () => {
    const eight = build1701(
      filing("1701", { year: "2026", rateB: "eight", methodB: "osd" }, "2026"),
      person(),
      compute1701({ year: "2026", rateB: "eight", methodB: "osd" }),
    );
    expect(ticked(eight, "frm1701:")).toContain("rdoPg2I12TaxRateP");
    const grad = build1701(
      filing("1701", { year: "2026", rateB: "graduated", methodB: "itemized" }, "2026"),
      person(),
      compute1701({ year: "2026", rateB: "graduated", methodB: "itemized" }),
    );
    expect(ticked(grad, "frm1701:")).toEqual(
      expect.arrayContaining(["rdoPg2I12TaxRateG", "rdoPg2I12AMethodDeductionI"]),
    );
  });
  it("no spouse in the draft: Item 12 stays blank", () => {
    const x = build1701(
      filing("1701", { year: "2026" }, "2026"),
      person(),
      compute1701({ year: "2026" }),
    );
    expect(ticked(x, "frm1701:").filter((k) => k.startsWith("rdoPg2I12"))).toEqual([]);
  });
});

describe("1702Q and 1702RT: the ATC is the preparer's choice, never defaulted (D55 amendment)", () => {
  const corp = person({
    kind: "non-individual",
    regName: "INVENTED TEST CORP.",
    lastName: "",
    firstName: "",
    classification: "Domestic Corporation",
    civilStatus: "",
  });
  const q = (d: FilingData) =>
    build1702Q(
      filing("1702Q", { year: "2026", ...d }, "2026-Q3"),
      corp,
      compute1702Q({ year: "2026", ...d }),
    );
  const rt = (d: FilingData) =>
    build1702RT(
      filing("1702RT", { year: "2026", ...d }, "2026"),
      corp,
      compute1702RT({ year: "2026", ...d }),
    );
  const value = (xml: string, key: string) =>
    new RegExp(`<div>${key}=(.*?)${key}=</div>`).exec(xml)?.[1];

  it("both forms print one ATC choice, IC055 (the MCIT), and Item 5 is the form's ATC item", () => {
    expect(INCOME_TAX_ATC["1702Q"]).toEqual(["IC055"]);
    expect(INCOME_TAX_ATC["1702RT"]).toEqual(["IC055"]);
    expect(chosenAtc("ic 055", "1702Q")).toBe("IC055");
    expect(() => chosenAtc("IC010", "1702RT")).toThrow(
      "Item 5: the ATC IC010 is not one of the ATC choices printed on BIR Form 1702RT. Choose Item 5 again, or clear it, then try again.",
    );
  });

  it("1702Q: nothing chosen writes nothing (no IC010, no trailing space); IC055 is written as IC055", () => {
    expect(value(q({}), "frm1702q:txtAtc")).toBe("");
    expect(value(q({ atc: "IC055" }), "frm1702q:txtAtc")).toBe("IC055");
    expect(() => q({ atc: "IC010" })).toThrow(ExportRefusal);
  });

  it("1702RT: nothing chosen ticks nothing and writes nothing; IC055 ticks the MCIT box alone", () => {
    const none = rt({});
    expect(value(none, "frm1702RT:rdoPg1I5Atc")).toBe("false");
    expect(value(none, "frm1702RT:rdoPg1I5AtcOther")).toBe("false");
    expect(value(none, "frm1702RT:drpPg1I5AtcOther")).toBe("");
    const mcit = rt({ atc: "IC055" });
    expect(value(mcit, "frm1702RT:rdoPg1I5Atc")).toBe("true");
    expect(value(mcit, "frm1702RT:rdoPg1I5AtcOther")).toBe("false");
    expect(value(mcit, "frm1702RT:drpPg1I5AtcOther")).toBe("");
    expect(() => rt({ atc: "IC010" })).toThrow(ExportRefusal);
  });
});
