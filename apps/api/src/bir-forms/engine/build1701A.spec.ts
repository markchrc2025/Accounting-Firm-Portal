import type { Filing, FilingData, Taxpayer } from "./types";
import { compute1701A } from "./compute1701A";
import { build1701A, fileName1701A } from "./build1701A";

// Schema test for the ported 1701A builder: the frm1701A namespace, the
// annual month/year header, the Part II / Part IV item grids, the global
// txtEmail field, and the 1701A-specific "BIR 2014." tail.
describe("build1701A — reproduces the eBIRForms 1701A schema", () => {
  const tp: Taxpayer = {
    id: "tp1",
    kind: "individual",
    regName: "",
    lastName: "DELA CRUZ",
    firstName: "JUAN",
    middleName: "SANTOS",
    tin: "123456789",
    branch: "00000",
    rdo: "044",
    address: "1 MAIN ST",
    city: "MAKATI CITY",
    zip: "1200",
    birthdate: "1990-03-15",
    email: "juan@acme.test",
    phone: "09171234567",
    citizenship: "FILIPINO",
    civilStatus: "single",
    taxpayerType: "single",
    classification: "",
    createdAt: 0,
  };
  const data: FilingData = {
    year: "2025",
    amended: "no",
    taxpayerType: "single",
    atc: "II012",
    taxRate: "graduated",
    civil: "single",
    i36A: "1000000", // ₱1M gross → 40% OSD → ₱600k taxable → ₱62,500 due
  };
  const f: Filing = {
    id: "f1",
    form: "1701A",
    taxpayerId: "tp1",
    status: "filed",
    period: "2025",
    data,
    createdAt: 0,
    updatedAt: 0,
  };
  const xml = build1701A(f, tp, compute1701A(data));
  const has = (line: string) => expect(xml).toContain(`<div>${line}</div>`);

  it("uses the frm1701A namespace with the annual month/year header", () => {
    has("frm1701A:txtMonth=12frm1701A:txtMonth=");
    has("frm1701A:txtYear=2025frm1701A:txtYear=");
    has("frm1701A:txtTIN1=123frm1701A:txtTIN1=");
    has("frm1701A:txtTIN2=456frm1701A:txtTIN2=");
    has("frm1701A:txtTIN3=789frm1701A:txtTIN3=");
    has("frm1701A:txtBranchCode=000frm1701A:txtBranchCode=");
    has("frm1701A:txtRDOCode=044frm1701A:txtRDOCode=");
  });

  it("encodes the page-1 name and formats the birthdate mm/dd/yyyy", () => {
    has("frm1701A:txtTaxpayerName=DELA%20CRUZ%2C%20JUAN%20SANTOSfrm1701A:txtTaxpayerName=");
    has("frm1701A:txtBirthDate=03/15/1990frm1701A:txtBirthDate=");
    has("frm1701A:txtCitizenship=FILIPINOfrm1701A:txtCitizenship=");
  });

  it("selects the graduated tax-rate radio and the chosen ATC", () => {
    has("frm1701A:optTaxRate_1=truefrm1701A:optTaxRate_1=");
    has("frm1701A:optTaxRate_2=falsefrm1701A:optTaxRate_2=");
    has("frm1701A:optATC_1=truefrm1701A:optATC_1=");
  });

  it("carries the computed Part IV / Part II figures into the item grid", () => {
    has("frm1701A:txt38A=1,000,000.00frm1701A:txt38A="); // net sales
    has("frm1701A:txt39A=400,000.00frm1701A:txt39A="); // OSD 40%
    has("frm1701A:txt45A=600,000.00frm1701A:txt45A="); // total taxable
    has("frm1701A:txt46A=62,500.00frm1701A:txt46A="); // graduated tax due
    has("frm1701A:txt20A=62,500.00frm1701A:txt20A="); // Part II tax due
    has("frm1701A:txt30=62,500.00frm1701A:txt30="); // aggregate
  });

  it("emits the page-2 header with the raw last name", () => {
    has("frm1701A:txtPg2TIN1=123frm1701A:txtPg2TIN1=");
    has("frm1701A:txtPg2TaxpayerName=DELA CRUZfrm1701A:txtPg2TaxpayerName=");
  });

  it("emits the global (un-namespaced) txtEmail field", () => {
    has("txtEmail=juan@acme.testtxtEmail=");
  });

  it("ends with the 1701A package tail (BIR 2014.)", () => {
    expect(xml.startsWith("<?xml version='1.0'?>")).toBe(true);
    expect(xml.trimEnd().endsWith("All Rights Reserved BIR 2014.")).toBe(true);
  });

  it("produces the authentic filename", () => {
    expect(fileName1701A(f, tp)).toBe("1234567890001701A122025.xml");
  });
});
