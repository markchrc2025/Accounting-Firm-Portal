// build1702RT.test.ts — verifies the authentic eBIRForms 1702-RT XML export.
// Asserts namespace + 4-part TIN keys, global BranchMask, page-1 encoded vs
// page-2 raw registered name, the I40 rate string, computed I-amount fields,
// the "BIR 2014.0" tail, and the canonical filename.

import type { Filing, Taxpayer } from "./types";
import { compute1702RT } from "./compute1702RT";
import { build1702RT, fileName1702RT } from "./build1702RT";

const tp: Taxpayer = {
  id: "tp1",
  kind: "non-individual",
  regName: "INITIA FIRST STEP CORP.",
  lastName: "",
  firstName: "",
  middleName: "",
  tin: "683-266-552",
  branch: "0",
  rdo: "25B",
  address: "2 STALL #2 QUARTZ ST. MERALCO VILLAGE LIAS",
  city: "MARILAO BULACAN",
  zip: "3019",
  birthdate: "",
  incorpDate: "2025-08-01",
  email: "mcrc.business.solutions@gmail.com",
  phone: "09190660794",
  citizenship: "",
  civilStatus: "",
  taxpayerType: "",
  classification: "",
  createdAt: 0,
};

const filing: Filing = {
  id: "f1",
  form: "1702RT",
  taxpayerId: "tp1",
  status: "draft",
  period: "2025",
  data: { year: "2025", method: "itemized", rate: "30", i27: "1000000", i30: "400000" },
  createdAt: 0,
  updatedAt: 0,
};

const comp = compute1702RT(filing.data);
const xml = build1702RT(filing, tp, comp);
const lines = xml.split("\n");

/** True if some emitted <div> line carries `key=value`. */
function has(key: string, value: string): boolean {
  return lines.some((l) => l.includes(`<div>${key}=${value}${key}=</div>`));
}

describe("build1702RT", () => {
  it("emits the frm1702RT namespace and 4-part TIN on every page", () => {
    expect(has("frm1702RT:txtPg1Pt1I6TIN1", "683")).toBe(true);
    expect(has("frm1702RT:txtPg1Pt1I6TIN2", "266")).toBe(true);
    expect(has("frm1702RT:txtPg1Pt1I6TIN3", "552")).toBe(true);
    expect(has("frm1702RT:txtPg1Pt1I6TIN4", "000")).toBe(true);
    expect(has("frm1702RT:txtPg2TIN1", "683")).toBe(true);
    expect(has("frm1702RT:txtPg3TIN1", "683")).toBe(true);
    expect(has("frm1702RT:txtPg4TIN4", "000")).toBe(true);
  });

  it("emits the global (un-namespaced) BranchMask fields", () => {
    expect(has("BranchMaskP1", "00000")).toBe(true);
    expect(has("txtBranchMaskP2", "00000")).toBe(true);
    expect(has("txtBranchMaskP3", "00000")).toBe(true);
    expect(has("txtBranchMaskP4", "00000")).toBe(true);
  });

  it("encodes the registered name on page 1 but keeps it raw on pages 2-4", () => {
    expect(has("frm1702RT:txtPg1Pt1I8Name1", "INITIA%20FIRST%20STEP%20CORP.")).toBe(true);
    expect(has("frm1702RT:txtPg2RegisteredName", "INITIA FIRST STEP CORP.")).toBe(true);
    expect(has("frm1702RT:txtPg3RegisteredName", "INITIA FIRST STEP CORP.")).toBe(true);
    expect(has("frm1702RT:txtPg4RegisteredName", "INITIA FIRST STEP CORP.")).toBe(true);
  });

  it("keeps email namespaced and RDO/year/period correct", () => {
    expect(has("frm1702RT:txtPg1Pt1I12Email", "mcrc.business.solutions@gmail.com")).toBe(true);
    expect(has("frm1702RT:txtRDO", "25B")).toBe(true);
    expect(has("frm1702RT:drpPg1Pt1I7RDOCode", "25B")).toBe(true);
    expect(has("frm1702RT:txtPg1I2Year", "25")).toBe(true);
    expect(has("frm1702RT:ddlPg1I2Month", "12")).toBe(true);
    expect(has("frm1702RT:rdoPg1I1Calendar", "true")).toBe(true);
  });

  it("emits the I40 rate as a percent string", () => {
    expect(has("frm1702RT:Pg2Pt4I40IncomeTaxRate", "30%")).toBe(true);
  });

  it("emits computed I-amount fields (net sales 1M; gross income 600,000)", () => {
    // i27=1,000,000, i28=0 → net sales 1,000,000; i30=400,000 → gross 600,000
    expect(has("frm1702RT:txtPg2Pt4I27Sales", "1,000,000.00")).toBe(true);
    expect(has("frm1702RT:txtPg2Pt4I29NetSales", "1,000,000.00")).toBe(true);
    expect(has("frm1702RT:txtPg2Pt4I31GrossIncome", "600,000.00")).toBe(true);
    expect(has("frm1702RT:txtPg2Pt4I33TotalGross", "600,000.00")).toBe(true);
    // empty numeric → bare "0", not "0.00"
    expect(has("frm1702RT:txtPg2Pt4I28LessSales", "0")).toBe(true);
    expect(has("frm1702RT:txtPg2Pt5I57SpecialAllowable", "0")).toBe(true);
  });

  it("ends with the BIR 2014.0 tail and an XML declaration head", () => {
    expect(xml.startsWith("<?xml version='1.0'?>")).toBe(true);
    expect(xml.endsWith("All Rights Reserved BIR 2014.0")).toBe(true);
  });

  it("emits the meta page counters", () => {
    expect(has("frm1702RT:txtCurrentPage", "1")).toBe(true);
    expect(has("frm1702RT:txtMaxPage", "4")).toBe(true);
  });

  it("produces the canonical annual filename", () => {
    expect(fileName1702RT(filing, tp)).toBe("6832665520001702RTv2018122025.xml");
  });
});
