// build1701.spec.ts — asserts the authentic eBIRForms 1701 schema is reproduced.
// Ported from the Sentire suite (lib/xml/__tests__/build1701.test.ts).
import type { Filing, FilingData, Taxpayer } from "./types";
import { compute1701 } from "./compute1701";
import { build1701, fileName1701 } from "./build1701";

const tp: Taxpayer = {
  id: "t1",
  kind: "individual",
  regName: "",
  lastName: "GORGONIA",
  firstName: "ROGER",
  middleName: "ORSUA",
  tin: "218430523",
  branch: "0",
  rdo: "045",
  address: "B1 L2 P3 SANTA BARBARA VILLAS II STREET",
  city: "SAN MATEO RIZAL",
  zip: "1820",
  birthdate: "1983-09-18",
  email: "mcrc.business.solutions@gmail.com",
  phone: "09171102814",
  citizenship: "FILIPINO",
  civilStatus: "married",
  taxpayerType: "",
  classification: "",
  createdAt: 0,
};

const data: FilingData = {
  year: "2025",
  amended: "no",
  taxpayerType: "single",
  atc: "II011",
  rateA: "graduated",
  methodA: "osd",
  civil: "married",
  spouseIncome: "yes",
  filing: "separate",
};

const filing: Filing = {
  id: "f1",
  form: "1701",
  taxpayerId: "t1",
  status: "draft",
  period: "2025",
  data,
  createdAt: 0,
  updatedAt: 0,
};

describe("build1701", () => {
  const xml = build1701(filing, tp, compute1701(data));

  it("emits the frm1701 namespace and 3-part TIN keys", () => {
    expect(xml).toContain("frm1701:txtPg1I4TIN1=218frm1701:txtPg1I4TIN1=");
    expect(xml).toContain("frm1701:txtPg1I4TIN2=430frm1701:txtPg1I4TIN2=");
    expect(xml).toContain("frm1701:txtPg1I4TIN3=523frm1701:txtPg1I4TIN3=");
    expect(xml).toContain("frm1701:txtPg1I4BranchCode=000frm1701:txtPg1I4BranchCode=");
    expect(xml).toContain("frm1701:txtPg1I5RDOCode=045frm1701:txtPg1I5RDOCode=");
  });

  it("emits the 5 taxpayer-type radios with single→S selected", () => {
    expect(xml).toContain("frm1701:rdoPg1I6TaxpayerTypeS=truefrm1701:rdoPg1I6TaxpayerTypeS=");
    expect(xml).toContain("frm1701:rdoPg1I6TaxpayerTypeP=falsefrm1701:rdoPg1I6TaxpayerTypeP=");
    expect(xml).toContain("frm1701:rdoPg1I6TaxpayerTypeE=falsefrm1701:rdoPg1I6TaxpayerTypeE=");
    expect(xml).toContain("frm1701:rdoPg1I6TaxpayerTypeT=falsefrm1701:rdoPg1I6TaxpayerTypeT=");
    expect(xml).toContain("frm1701:rdoPg1I6TaxpayerTypeC=falsefrm1701:rdoPg1I6TaxpayerTypeC=");
  });

  it("selects the chosen ATC radio (II011) in the authentic order", () => {
    expect(xml).toContain("frm1701:rdoPg1I7ATC_II011=truefrm1701:rdoPg1I7ATC_II011=");
    expect(xml).toContain("frm1701:rdoPg1I7ATC_II012=falsefrm1701:rdoPg1I7ATC_II012=");
  });

  it("URL-encodes the page-1 name and emits raw last name on pages 2-4", () => {
    expect(xml).toContain(
      "frm1701:txtPg1I8TaxpayerName=GORGONIA%2C%20ROGER%20ORSUAfrm1701:txtPg1I8TaxpayerName=",
    );
    expect(xml).toContain("frm1701:txtPg2TaxpayerName=GORGONIAfrm1701:txtPg2TaxpayerName=");
    expect(xml).toContain("frm1701:txtPg3TaxpayerName=GORGONIAfrm1701:txtPg3TaxpayerName=");
    expect(xml).toContain("frm1701:txtPg4TaxpayerName=GORGONIAfrm1701:txtPg4TaxpayerName=");
  });

  it("emits Part II amount fields as 0.00 when the app has no figures", () => {
    expect(xml).toContain("frm1701:txtPg1I22ATaxDue=0.00frm1701:txtPg1I22ATaxDue=");
    expect(xml).toContain("frm1701:txtPg1I31ATotalAmtPyble=0.00frm1701:txtPg1I31ATotalAmtPyble=");
    expect(xml).toContain(
      "frm1701:txtPg1I32AggregateAmtPyble=0.00frm1701:txtPg1I32AggregateAmtPyble=",
    );
  });

  it("zero-pads the number of attachments to 2 digits", () => {
    expect(xml).toContain(
      "frm1701:txtPg1I33NumberOfAttachments=00frm1701:txtPg1I33NumberOfAttachments=",
    );
  });

  it("emits a page-3 and page-4 header key", () => {
    expect(xml).toContain("frm1701:txtPg3TIN1=218frm1701:txtPg3TIN1=");
    expect(xml).toContain("frm1701:txtPg4TIN1=218frm1701:txtPg4TIN1=");
  });

  it("emits the global txtEmail field (un-namespaced)", () => {
    expect(xml).toContain("<div>txtEmail=mcrc.business.solutions@gmail.comtxtEmail=</div>");
  });

  it("ends with the BIR 2012.0 tail", () => {
    expect(xml.trimEnd().endsWith("All Rights Reserved BIR 2012.0")).toBe(true);
  });

  it("produces exactly 837 <div> rows (matching the authentic sample)", () => {
    expect((xml.match(/<div>/g) || []).length).toBe(837);
  });

  it("builds the canonical eBIRForms filename", () => {
    expect(fileName1701(filing, tp)).toBe("2184305230001701v2018122025.xml");
  });

  it("wires Part IX reconciliation values into the txtPg4IPart9 keys", () => {
    const d: FilingData = {
      ...data,
      ix1A: "800000",
      ix2A: "50000",
      ix2descA: "Non-deductible interest",
      ix6A: "25000",
      ix6descA: "Interest income subjected to final tax",
    };
    const f: Filing = { ...filing, data: d };
    const x = build1701(f, tp, compute1701(d));
    expect(x).toContain("frm1701:txtPg4IPart9_1A=800,000.00frm1701:txtPg4IPart9_1A=");
    expect(x).toContain(
      "frm1701:txtPg4IPart9_2Particulars=Non-deductible%20interestfrm1701:txtPg4IPart9_2Particulars=",
    );
    expect(x).toContain("frm1701:txtPg4IPart9_2A=50,000.00frm1701:txtPg4IPart9_2A=");
    expect(x).toContain("frm1701:txtPg4IPart9_5A=850,000.00frm1701:txtPg4IPart9_5A="); // 1+2
    expect(x).toContain("frm1701:txtPg4IPart9_6A=25,000.00frm1701:txtPg4IPart9_6A=");
    expect(x).toContain("frm1701:txtPg4IPart9_10A=25,000.00frm1701:txtPg4IPart9_10A=");
    expect(x).toContain("frm1701:txtPg4IPart9_11A=825,000.00frm1701:txtPg4IPart9_11A="); // 5−10
    // Key count unchanged — same schema as the authentic sample.
    expect((x.match(/<div>/g) || []).length).toBe(837);
  });
});
