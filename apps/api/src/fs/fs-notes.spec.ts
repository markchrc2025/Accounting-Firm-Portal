import {
  buildAccountNotes,
  policyBlocksFor,
  renderTokens,
  type NoteMergeContext,
} from "./fs-notes";
import type { FsAccountMeta, FsEngineInput, FsPeriodMeta } from "./fs-engine";

const CTX: NoteMergeContext = {
  entityName: "Workscale Resources Inc.",
  secRegistrationNo: "2023-0001",
  registeredAddress: "76 Cambridge St, Quezon City",
  businessDescription: "private employment agency services",
  framework: "PFRS for Small Entities",
  functionalCurrency: "Philippine Peso (₱)",
  approvalDate: "2026-04-15",
  periodLabels: ["2025", "2024"],
};

describe("fs-notes — token merge & library", () => {
  it("fills merge tokens from the report context", () => {
    const block = policyBlocksFor("PFRS for Small Entities").find((b) => b.key === "corporate-information")!;
    const text = renderTokens(block.body, CTX);
    expect(text).toContain("Workscale Resources Inc.");
    expect(text).toContain("Registration No. 2023-0001");
    expect(text).toContain("private employment agency services");
    expect(text).not.toMatch(/\{\{/); // no unresolved tokens
  });

  it("shows a visible placeholder when a field is missing", () => {
    const text = renderTokens("SEC No. {{secRegistrationNo}}", { ...CTX, secRegistrationNo: null });
    expect(text).toBe("SEC No. [SEC Registration No.]");
  });

  it("falls back to the Small Entities library for an unknown framework", () => {
    expect(policyBlocksFor("Something Else").map((b) => b.key)).toEqual(
      policyBlocksFor("PFRS for Small Entities").map((b) => b.key),
    );
  });
});

const ACCOUNTS: FsAccountMeta[] = [
  { code: "1001", name: "Cash in Bank", class: "Asset", accountType: "Bank Accounts", parentCode: null, parentName: null },
  { code: "1007", name: "Trade Receivable - Client", class: "Asset", accountType: "Current Asset", parentCode: null, parentName: null },
  { code: "1902001", name: "Allowance for Doubtful Accounts", class: "Asset", accountType: "Current Asset", parentCode: "1007", parentName: "Trade Receivable - Client" },
  { code: "1003001", name: "Work Equipment", class: "Asset", accountType: "Fixed Asset", parentCode: "1003", parentName: "Property, Plant and Equipment" },
  { code: "1901001", name: "Accumulated Depreciation", class: "Asset", accountType: "Fixed Asset", parentCode: "1003", parentName: "Property, Plant and Equipment" },
  { code: "2501", name: "Loans Payable - Non-Current", class: "Liability", accountType: "Non-current Liability", parentCode: null, parentName: null },
  { code: "2901004", name: "Share Capital", class: "Equity", accountType: "Shareholders Equity", parentCode: null, parentName: null },
  { code: "2901003", name: "Retained Earnings", class: "Equity", accountType: "Shareholders Equity", parentCode: null, parentName: null },
];
const P1: FsPeriodMeta = { id: "p1", label: "2025", sortOrder: 0 };
const input: FsEngineInput = {
  accounts: ACCOUNTS,
  periods: [P1],
  tb: [
    { periodId: "p1", accountCode: "1001", amount: 500 },
    { periodId: "p1", accountCode: "1007", amount: 200 },
    { periodId: "p1", accountCode: "1902001", amount: -20 },
    { periodId: "p1", accountCode: "1003001", amount: 300 },
    { periodId: "p1", accountCode: "1901001", amount: -90 },
    { periodId: "p1", accountCode: "2501", amount: -150 },
    { periodId: "p1", accountCode: "2901004", amount: -100 },
    { periodId: "p1", accountCode: "2901003", amount: -610 },
  ],
  adjustments: [],
};

describe("fs-notes — numeric account notes", () => {
  const notes = buildAccountNotes(input);
  const note = (key: string) => notes.find((n) => n.key === key);
  const rowAmt = (key: string, label: string) =>
    note(key)?.table?.rows.find((r) => r.label === label)?.amounts.p1;

  it("breaks down cash and totals it", () => {
    expect(rowAmt("note-cash", "Cash in Bank")).toBe(500);
    expect(rowAmt("note-cash", "Total Cash and Cash Equivalents")).toBe(500);
  });

  it("nets receivables against the allowance", () => {
    expect(rowAmt("note-receivables", "Trade Receivable - Client")).toBe(200);
    expect(rowAmt("note-receivables", "Allowance for Doubtful Accounts")).toBe(-20);
    expect(rowAmt("note-receivables", "Net Trade and Other Receivables")).toBe(180);
  });

  it("shows PPE as cost, accumulated depreciation, and net", () => {
    expect(rowAmt("note-ppe", "Cost")).toBe(300);
    expect(rowAmt("note-ppe", "Less: Accumulated depreciation")).toBe(-90);
    expect(rowAmt("note-ppe", "Net carrying value")).toBe(210);
  });

  it("breaks out debt and equity", () => {
    expect(rowAmt("note-debt", "Total Loans and Borrowings")).toBe(150);
    expect(rowAmt("note-equity", "Total Equity")).toBe(710); // 100 + 610
  });

  it("omits notes for captions the report has no accounts for", () => {
    const bare = buildAccountNotes({ ...input, accounts: [ACCOUNTS[0]!], tb: [{ periodId: "p1", accountCode: "1001", amount: 500 }] });
    expect(bare.map((n) => n.key)).toEqual(["note-cash"]);
  });
});
