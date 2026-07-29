import type { Filing, Taxpayer } from "./types";
import { compute1701Q } from "./compute1701Q";
import { build1701Q, fileName1701Q } from "./build1701Q";

// Parity test — reconstructs the real eBIRForms 1701Q sample (2025-Q2) and
// checks the ported builder reproduces its authentic field keys, namespace
// (frm1701q), the global txtEmail field, and the BIR 2012.0 tail.
describe("build1701Q — matches the authentic eBIRForms 1701Q export", () => {
  const tp: Taxpayer = {
    id: "tp1", kind: "individual", regName: "",
    lastName: "CANLUBO", firstName: "CHRISTIAN", middleName: "R",
    tin: "474079835", branch: "00000", rdo: "045",
    address: "80 DRAGON ST BARANGAY SAN ROQUE", city: "MARIKINA CITY", zip: "1800",
    birthdate: "1995-07-02", email: "mark.canlubo@gmail.com",
    phone: "09190660794", citizenship: "FILIPINO", civilStatus: "single",
    taxpayerType: "single", classification: "", createdAt: 0,
  };
  const f: Filing = {
    id: "f1", form: "1701Q", taxpayerId: "tp1", status: "filed", period: "2025-Q2",
    data: {
      year: "2025", quarter: "2nd", amended: "yes", filerType: "single",
      atc: "II012", rateA: "graduated", methodA: "itemized", foreignCredit: "no",
    },
    createdAt: 0, updatedAt: 0,
  };
  const xml = build1701Q(f, tp, compute1701Q(f.data));
  const has = (line: string) => expect(xml).toContain(`<div>${line}</div>`);

  it("uses the frm1701q namespace and authentic background/TIN keys", () => {
    has("frm1701q:txtYear=2025frm1701q:txtYear=");
    has("frm1701q:txtTIN1=474frm1701q:txtTIN1=");
    has("frm1701q:txtTIN2=079frm1701q:txtTIN2=");
    has("frm1701q:txtTIN3=835frm1701q:txtTIN3=");
    has("frm1701q:txtBranchCode=000frm1701q:txtBranchCode=");
    has("frm1701q:txtRDOCode=045frm1701q:txtRDOCode=");
  });

  it("maps the quarter radio (Q1/Q2/Q3) — sample is Q2", () => {
    has("frm1701q:DateQuarter_1=falsefrm1701q:DateQuarter_1=");
    has("frm1701q:DateQuarter_2=truefrm1701q:DateQuarter_2=");
    has("frm1701q:DateQuarter_3=falsefrm1701q:DateQuarter_3=");
  });

  it("encodes the page-1 name and emits the split birthdate", () => {
    has("frm1701q:txtTaxpayerName=CANLUBO%2C%20CHRISTIAN%2C%20Rfrm1701q:txtTaxpayerName=");
    has("frm1701q:txtBirthMonth=07frm1701q:txtBirthMonth=");
    has("frm1701q:txtBirthDay=02frm1701q:txtBirthDay=");
    has("frm1701q:txtBirthYear=1995frm1701q:txtBirthYear=");
    has("frm1701q:txtCitizenship=FILIPINOfrm1701q:txtCitizenship=");
  });

  it("emits the page-2 header keys (raw last name)", () => {
    has("frm1701q:txtPg2TIN1=474frm1701q:txtPg2TIN1=");
    has("frm1701q:txtPg2BranchCode=000frm1701q:txtPg2BranchCode=");
    has("frm1701q:txtPg2TaxpayerName=CANLUBOfrm1701q:txtPg2TaxpayerName=");
  });

  it("emits the txtNN amount fields formatted as 0.00", () => {
    has("frm1701q:txt26A=0.00frm1701q:txt26A=");
    has("frm1701q:txt31=0.00frm1701q:txt31=");
    has("frm1701q:txt36A=0.00frm1701q:txt36A=");
    has("frm1701q:txt68B=0.00frm1701q:txt68B=");
  });

  it("emits the global (un-namespaced) txtEmail field", () => {
    has("txtEmail=mark.canlubo@gmail.comtxtEmail=");
  });

  it("ends with the 1701Q package tail (BIR 2012.0)", () => {
    expect(xml.startsWith("<?xml version='1.0'?>")).toBe(true);
    expect(xml.trimEnd().endsWith("All Rights Reserved BIR 2012.0")).toBe(true);
  });

  it("produces the authentic filename", () => {
    expect(fileName1701Q(f, tp)).toBe("4740798350001701Qv20182025Q2.xml");
  });
});
