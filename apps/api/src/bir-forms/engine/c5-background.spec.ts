// c5-background.spec.ts — C5 (D55): the background items of the income-tax returns
// come from the client's record, the form's rules and the figures, never the draft.
import { build1701 } from "./build1701";
import { build1701A } from "./build1701A";
import { build1701Q } from "./build1701Q";
import { compute1701 } from "./compute1701";
import { compute1701A } from "./compute1701A";
import { compute1701Q } from "./compute1701Q";
import { civilStatusOf, deriveFiler } from "./taxpayer-background";
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

describe("deriveFiler (Items 6 and 7)", () => {
  const sp = person();
  const prof = person({ classification: "Professional" });
  const none = person({ classification: "" });
  const biz = { comp: 0, sales: 1, other: 0 };
  const comp = { comp: 1, sales: 0, other: 0 };
  const mixed = { comp: 1, sales: 1, other: 0 };

  it.each([
    ["single proprietor, graduated", sp, biz, "graduated", "single", "II012"],
    ["single proprietor, 8%", sp, biz, "eight", "single", "II015"],
    ["professional, graduated", prof, biz, "graduated", "prof", "II014"],
    ["professional, 8%", prof, biz, "eight", "prof", "II017"],
    ["mixed, graduated", sp, mixed, "graduated", "single", "II013"],
    ["mixed, 8%", prof, mixed, "eight", "prof", "II016"],
    [
      "mixed with other income only as the business",
      sp,
      { comp: 1, sales: 0, other: 5 },
      "graduated",
      "single",
      "II013",
    ],
    ["compensation only", none, comp, "graduated", "comp", "II011"],
    [
      "compensation only, even if the client is a professional",
      prof,
      comp,
      "graduated",
      "comp",
      "II011",
    ],
    [
      "no figures yet: the client's kind decides",
      sp,
      { comp: 0, sales: 0, other: 0 },
      "graduated",
      "single",
      "II012",
    ],
    ["business, classification not set: nothing", none, biz, "graduated", null, null],
    [
      "a corporation's classification is no individual type",
      person({ classification: "Domestic Corporation" }),
      biz,
      "graduated",
      null,
      null,
    ],
  ] as const)("%s", (_n, tp, mix, rate, type, atc) => {
    expect(deriveFiler(tp, mix, rate)).toEqual({ type, atc });
  });

  it("an estate or a trust: Item 6 says so, no ATC (the form lists none)", () => {
    const estate = person({
      kind: "non-individual",
      taxpayerType: "Estate",
      classification: "",
    });
    const trust = person({
      kind: "non-individual",
      taxpayerType: "TRUST",
      classification: "",
    });
    expect(deriveFiler(estate, biz, "graduated")).toEqual({ type: "estate", atc: null });
    expect(deriveFiler(trust, biz, "eight")).toEqual({ type: "trust", atc: null });
    expect(
      deriveFiler(person({ kind: "non-individual", taxpayerType: "" }), biz, "graduated"),
    ).toEqual({
      type: null,
      atc: null,
    });
  });

  it("the 1701A and 1701Q have no compensation or mixed filer: only the business kind", () => {
    const o = { allowComp: false, allowMixed: false };
    expect(deriveFiler(sp, mixed, "graduated", o)).toEqual({
      type: "single",
      atc: "II012",
    });
    expect(deriveFiler(none, comp, "graduated", o)).toEqual({ type: null, atc: null });
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

  it("a single professional at 8%: professional, II017, Single; 17 and 18 blank (a stale draft answer is ignored)", () => {
    const x = xml(person({ classification: "Professional", civilStatus: "Single" }), {
      taxRate: "eight",
      taxpayerType: "single", // stale, ignored
      atc: "II012", // stale, ignored
      civil: "married", // stale, ignored
      spouseIncome: "yes",
      filing: "joint",
    });
    expect(background(x)).toEqual(["optATC_4", "optCivilStatus_1", "optTaxType_2"]);
  });

  it("Married: Item 16 Married, and 17 and 18 as answered", () => {
    const x = xml(person({ civilStatus: "Married" }), {
      spouseIncome: "no",
      filing: "joint",
    });
    expect(background(x)).toEqual(
      [
        "optATC_1",
        "optCivilStatus_2",
        "optFilingStatus_1",
        "optSpouseIncome_2",
        "optTaxType_1",
      ].sort(),
    );
  });

  it("Married but unanswered: 17 and 18 blank", () => {
    const x = xml(person({ civilStatus: "Married" }), {});
    expect(background(x)).toEqual(["optATC_1", "optCivilStatus_2", "optTaxType_1"]);
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

  it("a professional at 8%: Item 7 Professional, Item 8 II017", () => {
    const k = run(person({ classification: "Professional" }), {
      rateA: "eight",
      methodA: "osd",
      filerType: "single", // stale, ignored
      atc: "II012", // stale, ignored
    });
    expect(k).toEqual(expect.arrayContaining(["optType_2", "optATC_5"]));
    expect(k).not.toContain("optType_1");
    expect(k).not.toContain("optATC_1");
  });

  it("an estate: Item 7 Estate; no ATC ticked", () => {
    const k = run(
      person({ kind: "non-individual", taxpayerType: "Estate", classification: "" }),
      { rateA: "graduated" },
    );
    expect(k).toContain("optType_3");
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
