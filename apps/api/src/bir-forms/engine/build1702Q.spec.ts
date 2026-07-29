// build1702Q.test.ts — verifies the authentic eBIRForms 1702Q XML export.
// Asserts the frm1702q namespace + lowercase txtTin keys, the literal-colon
// keys (itemFiscalStartMonth:_1, optQtr:_2, optTreaty), the BARE 1702q:
// method radios, the trailing-space txtAtc, the Codename globals, the global
// txtTaxRate/txtEmail, the "BIR 2012.0" tail and the canonical filename.

import type { Filing, Taxpayer } from "./types";
import { compute1702Q } from "./compute1702Q";
import { build1702Q, fileName1702Q } from "./build1702Q";

const tp: Taxpayer = {
  id: "tp1",
  kind: "non-individual",
  regName: "WORKSCALE RESOURCES INC.",
  lastName: "",
  firstName: "",
  middleName: "",
  tin: "626-027-978",
  branch: "0",
  rdo: "040",
  address: "76 CAMBRIDGE ST BRGY E RODRIGUEZ",
  city: "QUEZON CITY",
  zip: "1102",
  birthdate: "",
  incorpDate: "2020-01-01",
  email: "workscale.finance@gmail.com",
  phone: "09171102814",
  citizenship: "",
  civilStatus: "",
  taxpayerType: "",
  classification: "ACTIVITIES OF EMPLOYMENT PLACEMENT AGENCIES",
  createdAt: 0,
};

const filing: Filing = {
  id: "f1",
  form: "1702Q",
  taxpayerId: "tp1",
  status: "draft",
  period: "2025-Q2",
  data: { year: "2025", quarter: "2nd", method: "itemized", rate: "30" },
  createdAt: 0,
  updatedAt: 0,
};

const comp = compute1702Q(filing.data);
const xml = build1702Q(filing, tp, comp);
const lines = xml.split("\n");

/** True if some emitted <div> line carries exactly `key=value`. */
function has(key: string, value: string): boolean {
  return lines.some((l) => l.includes(`<div>${key}=${value}${key}=</div>`));
}

describe("build1702Q", () => {
  it("emits the frm1702q namespace with lowercase txtTin parts + RDO", () => {
    expect(has("frm1702q:txtTin1", "626")).toBe(true);
    expect(has("frm1702q:txtTin2", "027")).toBe(true);
    expect(has("frm1702q:txtTin3", "978")).toBe(true);
    expect(has("frm1702q:txtBranchCode", "000")).toBe(true);
    expect(has("frm1702q:txtRdoCode", "040")).toBe(true);
    expect(has("frm1702q:txtYearEnded", "2025")).toBe(true);
    expect(has("frm1702q:itemYearEndMonth", "12")).toBe(true);
  });

  it("emits the literal-colon keys (fiscal start, quarter, treaty)", () => {
    expect(has("frm1702q:itemFiscalStartMonth:_1", "true")).toBe(true);
    expect(has("frm1702q:itemFiscalStartMonth:_2", "false")).toBe(true);
    expect(has("frm1702q:optQtr:_1", "false")).toBe(true);
    expect(has("frm1702q:optQtr:_2", "true")).toBe(true);
    expect(has("frm1702q:optQtr:_3", "false")).toBe(true);
    expect(has("frm1702q:optTreaty:_2", "true")).toBe(true);
  });

  it("uses the BARE 1702q: namespace (no frm) for the method radios", () => {
    expect(has("1702q:OptMethodDeduct_1", "true")).toBe(true);
    expect(has("1702q:OptMethodDeduct_2", "false")).toBe(true);
  });

  it("keeps the trailing space in txtAtc and the odd 'Remender' spelling", () => {
    expect(has("frm1702q:txtAtc", "IC010 ")).toBe(true);
    expect(has("frm1702q:optRemenderRtn_1", "false")).toBe(true);
    expect(has("frm1702q:optRemenderRtn_2", "true")).toBe(true);
  });

  it("encodes the name / line of business / address", () => {
    expect(has("frm1702q:txtTaxpayerName", "WORKSCALE%20RESOURCES%20INC.")).toBe(true);
    expect(has("frm1702q:txtDescription", "ACTIVITIES%20OF%20EMPLOYMENT%20PLACEMENT%20AGENCIES")).toBe(true);
    expect(has("frm1702q:txtTaxPayerZip", "1102")).toBe(true);
  });

  it("emits the Codename globals (Codename1=true, rest false)", () => {
    expect(has("Codename1", "true")).toBe(true);
    expect(has("Codename2", "false")).toBe(true);
    expect(has("Codename18", "false")).toBe(true);
  });

  it("emits the global txtTaxRate, txtEmail and quarterly carry-forward", () => {
    expect(has("txtTaxRate", "2%")).toBe(true);
    expect(has("txtEmail", "workscale.finance@gmail.com")).toBe(true);
    expect(has("txt1stQtr", "0.00")).toBe(true);
    expect(has("txtTotal", "0.00")).toBe(true);
  });

  it("starts with the XML head and ends with the BIR 2012.0 tail", () => {
    expect(xml.startsWith("<?xml version='1.0'?>")).toBe(true);
    expect(xml.endsWith("All Rights Reserved BIR 2012.0")).toBe(true);
  });

  it("produces the canonical quarterly filename (no v2018, no mm)", () => {
    expect(fileName1702Q(filing, tp)).toBe("6260279780001702Q2025Q2.xml");
  });
});
