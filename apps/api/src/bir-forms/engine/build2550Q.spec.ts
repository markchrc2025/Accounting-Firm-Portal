import type { Filing, Taxpayer } from "./types";
import { compute2550Q } from "./compute2550Q";
import { build2550Q, fileName2550Q } from "./build2550Q";

// Parity test — reconstructs the real eBIRForms 2550Q sample (2026-Q1) and
// checks the ported builder reproduces its authentic field keys, namespace
// (frm2550qv2024 — lowercase q), the GLOBAL (un-namespaced) schedule fields,
// and the BIR 2012.0 tail.
describe("build2550Q — matches the authentic eBIRForms 2550Q export", () => {
  const tp: Taxpayer = {
    id: "tp1",
    kind: "non-individual",
    regName: "ST. JOSEPH FOOD AND BEVERAGE CORP.",
    lastName: "",
    firstName: "",
    middleName: "",
    tin: "010812973",
    branch: "00000",
    rdo: "038",
    address: "17 ST JOSEPH ST PARADISE VILLAGE, SANGANDAAN",
    city: "QUEZON CITY",
    zip: "1116",
    birthdate: "",
    email: "mcrc.business.solutions@gmail.com",
    phone: "09190660794",
    citizenship: "",
    civilStatus: "",
    taxpayerType: "",
    classification: "Micro",
    createdAt: 0,
  };
  const f: Filing = {
    id: "f1",
    form: "2550Q",
    taxpayerId: "tp1",
    status: "filed",
    period: "2026-Q1",
    data: {
      year: "2026",
      quarter: "1st",
      amended: "no",
      periodType: "calendar",
      shortPeriod: "no",
      classification: "Micro",
    },
    createdAt: 0,
    updatedAt: 0,
  };
  const xml = build2550Q(f, tp, compute2550Q(f.data));
  const has = (line: string) => expect(xml).toContain(`<div>${line}</div>`);

  it("uses the frm2550qv2024 namespace and authentic TIN / RDO keys", () => {
    has("frm2550qv2024:txtTIN1=010frm2550qv2024:txtTIN1=");
    has("frm2550qv2024:txtTIN2=812frm2550qv2024:txtTIN2=");
    has("frm2550qv2024:txtTIN3=973frm2550qv2024:txtTIN3=");
    has("frm2550qv2024:branchCode=000frm2550qv2024:branchCode=");
    has("frm2550qv2024:txtRDOCode=038frm2550qv2024:txtRDOCode=");
  });

  it("maps the period: month/year and the OptQuarter radios (sample is Q1)", () => {
    has("frm2550qv2024:selectedMonthNo2=12frm2550qv2024:selectedMonthNo2=");
    has("frm2550qv2024:txtYearNo2=2026frm2550qv2024:txtYearNo2=");
    has("frm2550qv2024:OptQuarter1=truefrm2550qv2024:OptQuarter1=");
    has("frm2550qv2024:OptQuarter2=falsefrm2550qv2024:OptQuarter2=");
    has("frm2550qv2024:OptQuarter3=falsefrm2550qv2024:OptQuarter3=");
    has("frm2550qv2024:OptQuarter4=falsefrm2550qv2024:OptQuarter4=");
  });

  it("emits the Return-Period date range for the quarter", () => {
    has("frm2550qv2024:RtnPeriodFromNo4=1/01/2026frm2550qv2024:RtnPeriodFromNo4=");
    has("frm2550qv2024:RtnPeriodToNo4=3/31/2026frm2550qv2024:RtnPeriodToNo4=");
  });

  it("encodes the page-1 name + address, and emits Pg2TaxPayer RAW", () => {
    has(
      "frm2550qv2024:taxpayerName=ST.%20JOSEPH%20FOOD%20AND%20BEVERAGE%20CORP.frm2550qv2024:taxpayerName=",
    );
    has(
      "frm2550qv2024:taxpayerAddress=17%20ST%20JOSEPH%20ST%20PARADISE%20VILLAGE%2C%20SANGANDAAN%2C%20QUEZON%20CITYfrm2550qv2024:taxpayerAddress=",
    );
    has("frm2550qv2024:Pg2TaxPayer=ST. JOSEPH FOOD AND BEVERAGE CORP.frm2550qv2024:Pg2TaxPayer=");
  });

  it("sets the classification radios (Micro)", () => {
    has("frm2550qv2024:taxPayerClassification1=truefrm2550qv2024:taxPayerClassification1=");
    has("frm2550qv2024:taxPayerClassification2=falsefrm2550qv2024:taxPayerClassification2=");
  });

  it("emits the Part IV netVatPayable and output fields formatted as 0.00", () => {
    has("frm2550qv2024:netVatPayable=0.00frm2550qv2024:netVatPayable=");
    has("frm2550qv2024:vatableSales=0.00frm2550qv2024:vatableSales=");
    has("frm2550qv2024:outputTaxDue=0.00frm2550qv2024:outputTaxDue=");
  });

  it("emits the GLOBAL (un-namespaced) schedule fields", () => {
    has("txtDatePurchase10=txtDatePurchase10=");
    has("txtAmountPurchase10=0.00txtAmountPurchase10=");
    has("sched1TotalBalPrev=0.00sched1TotalBalPrev=");
    has("txtDateCovered30=txtDateCovered30=");
    has("otherSpecify47B=0.00otherSpecify47B=");
  });

  it("ends with the 2550Q package tail (BIR 2012.0)", () => {
    expect(xml.startsWith("<?xml version='1.0'?>")).toBe(true);
    expect(xml.trimEnd().endsWith("All Rights Reserved BIR 2012.0")).toBe(true);
  });

  it("produces the authentic filename", () => {
    expect(fileName2550Q(f, tp)).toBe("0108129730002550Qv2024122026Q1.xml");
  });
});
