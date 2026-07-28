import type { Filing, Taxpayer } from "./types";
import { compute2551Q } from "./compute2551Q";
import { build2551Q, fileName2551Q } from "./build2551Q";

// Parity test — reconstructs the real eBIRForms 2551Q sample (2026-Q1) and
// checks the ported builder reproduces its authentic field keys, namespace
// (frm2551Qv2018), the GLOBAL Schedule-1 ATC table fields, and the tail.
describe("build2551Q — matches the authentic eBIRForms 2551Q export", () => {
  const tp: Taxpayer = {
    id: "tp1",
    kind: "individual",
    regName: "",
    lastName: "FLORES",
    firstName: "RONORA GRACE",
    middleName: "SEALANA",
    tin: "652528538",
    branch: "00000",
    rdo: "027",
    address: "3723 Dahlia St., Sampaguita Subd., Brgy 178, Camarin",
    city: "Caloocan",
    zip: "1400",
    birthdate: "1990-01-01",
    email: "mcrc.business.solutions@gmail.com",
    phone: "09190660794",
    citizenship: "FILIPINO",
    civilStatus: "single",
    taxpayerType: "single",
    classification: "",
    createdAt: 0,
  };
  const f: Filing = {
    id: "f1",
    form: "2551Q",
    taxpayerId: "tp1",
    status: "filed",
    period: "2026-Q1",
    data: {
      year: "2026",
      quarter: "1st",
      amended: "no",
      periodType: "calendar",
      taxRelief: "no",
      itRate: "graduated",
      rows: [{ atc: "PT010", taxable: "0", rate: "3" }],
    },
    createdAt: 0,
    updatedAt: 0,
  };
  const xml = build2551Q(f, tp, compute2551Q(f.data));
  const has = (line: string) => expect(xml).toContain(`<div>${line}</div>`);

  it("uses the frm2551Qv2018 namespace and authentic period/TIN keys", () => {
    has("frm2551Qv2018:rtnMonth=12frm2551Qv2018:rtnMonth=");
    has("frm2551Qv2018:txtYear=2026frm2551Qv2018:txtYear=");
    has("frm2551Qv2018:txtTIN1=652frm2551Qv2018:txtTIN1=");
    has("frm2551Qv2018:txtTIN2=528frm2551Qv2018:txtTIN2=");
    has("frm2551Qv2018:txtTIN3=538frm2551Qv2018:txtTIN3=");
    has("frm2551Qv2018:txtBranchCode=000frm2551Qv2018:txtBranchCode=");
    has("frm2551Qv2018:txtRDOCode=027frm2551Qv2018:txtRDOCode=");
  });

  it("maps the quarter radios — sample is Q1", () => {
    has("frm2551Qv2018:qtr_1=truefrm2551Qv2018:qtr_1=");
    has("frm2551Qv2018:qtr_2=falsefrm2551Qv2018:qtr_2=");
    has("frm2551Qv2018:qtr_3=falsefrm2551Qv2018:qtr_3=");
    has("frm2551Qv2018:qtr_4=falsefrm2551Qv2018:qtr_4=");
  });

  it("encodes the registered name + address and emits raw Pg2 name", () => {
    has(
      "frm2551Qv2018:registeredName=FLORES%2C%20RONORA%20GRACE%20SEALANAfrm2551Qv2018:registeredName=",
    );
    has("frm2551Qv2018:txtPg2TaxpayerName=FLORES, RONORA GRACE SEALANAfrm2551Qv2018:txtPg2TaxpayerName=");
  });

  it("emits the Part II txtNN amounts formatted as 0.00", () => {
    has("frm2551Qv2018:txt14=0.00frm2551Qv2018:txt14=");
    has("frm2551Qv2018:txt24=0.00frm2551Qv2018:txt24=");
  });

  it("emits the GLOBAL Schedule-1 ATC table (no namespace)", () => {
    has("drpATC1=1drpATC1=");
    has("txtATCAmt1=0.00txtATCAmt1=");
    has("txtATCRate1=3.0txtATCRate1=");
    has("txtATCDue1=0.00txtATCDue1=");
    has("drpATC2=0drpATC2=");
    has("txtATCRate2=0.00txtATCRate2=");
    has("drpATC6=0drpATC6=");
    has("txtTotalSched1=0.00txtTotalSched1=");
  });

  it("emits the global (un-namespaced) txtEmail field", () => {
    has("txtEmail=mcrc.business.solutions@gmail.comtxtEmail=");
  });

  it("ends with the 2551Q package tail (BIR 2012.0)", () => {
    expect(xml.startsWith("<?xml version='1.0'?>")).toBe(true);
    expect(xml.trimEnd().endsWith("All Rights Reserved BIR 2012.0")).toBe(true);
  });

  it("produces the authentic filename", () => {
    expect(fileName2551Q(f, tp)).toBe("6525285380002551Qv2018122026Q1.xml");
  });
});
