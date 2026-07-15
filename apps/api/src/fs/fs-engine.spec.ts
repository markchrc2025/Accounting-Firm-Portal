import {
  adjustedBalances,
  buildBalanceSheet,
  buildIncomeStatement,
  classSign,
  type FsAccountMeta,
  type FsEngineInput,
  type FsPeriodMeta,
  type FsRow,
} from "./fs-engine";

// A compact synthetic chart that mirrors the real CoA structure: contra accounts
// parented to the account they offset (1901001→1003, 1902001→1007), so grouping
// nets them with no special cases.
const ACCOUNTS: FsAccountMeta[] = [
  { code: "1001", name: "Cash in Bank", class: "Asset", accountType: "Bank Accounts", parentCode: null, parentName: null },
  { code: "1007", name: "Trade Receivable - Client", class: "Asset", accountType: "Current Asset", parentCode: null, parentName: null },
  { code: "1902001", name: "Allowance for Doubtful Accounts", class: "Asset", accountType: "Current Asset", parentCode: "1007", parentName: "Trade Receivable - Client" },
  { code: "1003001", name: "Work Equipment", class: "Asset", accountType: "Fixed Asset", parentCode: "1003", parentName: "Property, Plant and Equipment" },
  { code: "1901001", name: "Accumulated Depreciation", class: "Asset", accountType: "Fixed Asset", parentCode: "1003", parentName: "Property, Plant and Equipment" },
  { code: "2001001", name: "Accounts Payable", class: "Liability", accountType: "Current Liability", parentCode: "2001", parentName: "Trade and Other Payables" },
  { code: "2501", name: "Loans Payable - Non-Current", class: "Liability", accountType: "Non-current Liability", parentCode: null, parentName: null },
  { code: "2901004", name: "Share Capital", class: "Equity", accountType: "Shareholders Equity", parentCode: null, parentName: null },
  { code: "2901003", name: "Retained Earnings", class: "Equity", accountType: "Shareholders Equity", parentCode: null, parentName: null },
  { code: "3001001", name: "Sales", class: "Revenue", accountType: "Operating Revenue", parentCode: null, parentName: null },
  { code: "3901001", name: "Sales Returns and Discounts", class: "Revenue", accountType: "Other Revenue", parentCode: null, parentName: null },
  { code: "4001", name: "Cost of Services", class: "Expense", accountType: "Direct Costs", parentCode: null, parentName: null },
  { code: "5001001", name: "Salaries and Wages", class: "Expense", accountType: "Operating Expense", parentCode: "5001", parentName: "Personnel Cost" },
  { code: "5002004", name: "Office Supplies", class: "Expense", accountType: "Operating Expense", parentCode: "5002", parentName: "General and Administrative Expenses" },
  { code: "5008", name: "Provision for Income Tax", class: "Expense", accountType: "Operating Expense", parentCode: null, parentName: null },
];

const P1: FsPeriodMeta = { id: "p1", label: "2025", sortOrder: 0 };

// Signed debit-positive balances that make the balance sheet tie (check = 0).
const TB: Array<[string, number]> = [
  ["1001", 100],
  ["1007", 200],
  ["1902001", -20], // contra: credit balance
  ["1003001", 300],
  ["1901001", -50], // contra: credit balance
  ["2001001", -60],
  ["2501", -40],
  ["2901004", -5],
  ["2901003", -425],
  ["3001001", -1000],
  ["3901001", 30], // contra revenue: debit balance
  ["4001", 400],
  ["5001001", 100],
  ["5002004", 50],
  ["5008", 20],
];

function input(overrides: Partial<FsEngineInput> = {}): FsEngineInput {
  return {
    accounts: ACCOUNTS,
    periods: [P1],
    tb: TB.map(([accountCode, amount]) => ({ periodId: "p1", accountCode, amount })),
    adjustments: [],
    ...overrides,
  };
}

const find = (rows: FsRow[], label: string) => rows.find((r) => r.label === label);
const amt = (rows: FsRow[], label: string, period = "p1") => find(rows, label)?.amounts?.[period];

describe("fs-engine — sign convention & adjustments", () => {
  it("classSign is debit-positive for Asset/Expense, credit-positive for the rest", () => {
    expect(classSign("Asset")).toBe(1);
    expect(classSign("Expense")).toBe(1);
    expect(classSign("Liability")).toBe(-1);
    expect(classSign("Equity")).toBe(-1);
    expect(classSign("Revenue")).toBe(-1);
  });

  it("folds adjustment debits/credits into the signed balance", () => {
    const bal = adjustedBalances(
      input({
        tb: [{ periodId: "p1", accountCode: "1001", amount: 100 }],
        adjustments: [
          { periodId: "p1", accountCode: "1001", debit: 30, credit: 0 },
          { periodId: "p1", accountCode: "1001", debit: 0, credit: 12.5 },
        ],
      }),
    );
    expect(bal.get("p1")?.get("1001")).toBe(117.5); // 100 + 30 − 12.5
  });
});

describe("fs-engine — Income Statement", () => {
  const { rows, netIncomeAfterTax } = buildIncomeStatement(input());

  it("nets contra revenue and totals revenue/COS/gross profit", () => {
    expect(amt(rows, "Total Revenues")).toBe(970); // 1000 − 30 returns
    expect(amt(rows, "Total Cost of Services")).toBe(400);
    expect(amt(rows, "GROSS PROFIT")).toBe(570);
  });

  it("groups operating expenses by CoA parent header and subtotals them", () => {
    expect(find(rows, "Personnel Cost")?.kind).toBe("group");
    expect(find(rows, "General and Administrative Expenses")?.kind).toBe("group");
    expect(amt(rows, "Total Personnel Cost")).toBe(100);
    expect(amt(rows, "Total General and Administrative Expenses")).toBe(50);
    expect(amt(rows, "Total Operating Expenses")).toBe(150);
  });

  it("carries Provision for Income Tax (5008) below the line, not in opex", () => {
    expect(amt(rows, "NET INCOME/(LOSS) BEFORE TAX")).toBe(420); // 570 − 150
    expect(amt(rows, "Provision for income tax/(credit)")).toBe(20);
    expect(amt(rows, "NET INCOME/(LOSS) AFTER TAX")).toBe(400); // 420 − 20
    expect(netIncomeAfterTax.p1).toBe(400);
  });
});

describe("fs-engine — Balance Sheet", () => {
  const bs = buildBalanceSheet(input());

  it("nets AR against its allowance and PPE against accumulated depreciation", () => {
    // Grouping by parentCode (1007 / 1003) nets the contras with no special case.
    expect(amt(bs.rows, "Total Trade Receivable - Client")).toBe(180); // 200 − 20
    expect(amt(bs.rows, "Total Property, Plant and Equipment")).toBe(250); // 300 − 50
  });

  it("splits current vs non-current and totals correctly", () => {
    expect(amt(bs.rows, "Total Current Assets")).toBe(280); // 100 cash + 180 AR-net
    expect(amt(bs.rows, "Total Non-Current Assets")).toBe(250);
    expect(bs.totalAssets.p1).toBe(530);
    expect(amt(bs.rows, "Total Current Liabilities")).toBe(60);
    expect(amt(bs.rows, "Total Non-Current Liabilities")).toBe(40);
    expect(amt(bs.rows, "TOTAL LIABILITIES")).toBe(100);
    expect(amt(bs.rows, "Total Equity")).toBe(430); // 5 + 425
  });

  it("balances: Assets = Liabilities + Equity (check = 0)", () => {
    expect(bs.totalLiabilitiesAndEquity.p1).toBe(530);
    expect(bs.balanceCheck.p1).toBe(0);
  });

  it("surfaces a non-zero balancing check when the TB does not tie", () => {
    const unbalanced = buildBalanceSheet(
      input({ tb: [{ periodId: "p1", accountCode: "1001", amount: 100 }] }),
    );
    expect(unbalanced.totalAssets.p1).toBe(100);
    expect(unbalanced.balanceCheck.p1).toBe(100); // no liab/equity entered
  });
});

describe("fs-engine — multi-period columns", () => {
  it("fans every statement line out to one column per period", () => {
    const p0: FsPeriodMeta = { id: "p0", label: "2024", sortOrder: 1 };
    const is = buildIncomeStatement(
      input({
        periods: [P1, p0],
        tb: [
          { periodId: "p1", accountCode: "3001001", amount: -1000 },
          { periodId: "p0", accountCode: "3001001", amount: -600 },
        ],
      }),
    );
    const rev = find(is.rows, "Total Revenues");
    expect(rev?.amounts?.p1).toBe(1000);
    expect(rev?.amounts?.p0).toBe(600);
  });
});
