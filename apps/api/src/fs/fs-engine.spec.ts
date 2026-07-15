import {
  adjustedBalances,
  buildBalanceSheet,
  buildCashFlow,
  buildChangesInEquity,
  buildIncomeStatement,
  classSign,
  classifyCashFlow,
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

// A clean, internally-consistent two-period set: retained earnings rolls forward
// by net income (no dividends), each period's balance sheet ties, so the cash
// flow reconciles exactly. p1 is the current year, p0 the prior comparative.
const CF_ACCOUNTS: FsAccountMeta[] = [
  { code: "1001", name: "Cash in Bank", class: "Asset", accountType: "Bank Accounts", parentCode: null, parentName: null },
  { code: "1007", name: "Trade Receivable - Client", class: "Asset", accountType: "Current Asset", parentCode: null, parentName: null },
  { code: "1003001", name: "Work Equipment", class: "Asset", accountType: "Fixed Asset", parentCode: "1003", parentName: "Property, Plant and Equipment" },
  { code: "1901001", name: "Accumulated Depreciation", class: "Asset", accountType: "Fixed Asset", parentCode: "1003", parentName: "Property, Plant and Equipment" },
  { code: "2501", name: "Loans Payable - Non-Current", class: "Liability", accountType: "Non-current Liability", parentCode: null, parentName: null },
  { code: "2901004", name: "Share Capital", class: "Equity", accountType: "Shareholders Equity", parentCode: null, parentName: null },
  { code: "2901003", name: "Retained Earnings", class: "Equity", accountType: "Shareholders Equity", parentCode: null, parentName: null },
  { code: "3001001", name: "Sales", class: "Revenue", accountType: "Operating Revenue", parentCode: null, parentName: null },
  { code: "5007001", name: "Depreciation", class: "Expense", accountType: "Operating Expense", parentCode: "5007", parentName: "Non Cash Expenses" },
];
const CUR: FsPeriodMeta = { id: "p1", label: "2025", sortOrder: 0 };
const PRIOR: FsPeriodMeta = { id: "p0", label: "2024", sortOrder: 1 };
const CF_TB: Array<[string, string, number]> = [
  // [periodId, code, signed debit-positive]
  ["p0", "1001", 200], ["p0", "1007", 100], ["p0", "1003001", 200], ["p0", "1901001", -40],
  ["p0", "2501", -100], ["p0", "2901004", -100], ["p0", "2901003", -260],
  ["p0", "3001001", -300], ["p0", "5007001", 40],
  ["p1", "1001", 500], ["p1", "1007", 150], ["p1", "1003001", 300], ["p1", "1901001", -90],
  ["p1", "2501", -150], ["p1", "2901004", -100], ["p1", "2901003", -610],
  ["p1", "3001001", -400], ["p1", "5007001", 50],
];
const cfInput = (): FsEngineInput => ({
  accounts: CF_ACCOUNTS,
  periods: [CUR, PRIOR],
  tb: CF_TB.map(([periodId, accountCode, amount]) => ({ periodId, accountCode, amount })),
  adjustments: [],
});

describe("fs-engine — cash-flow classification", () => {
  it("routes each balance-sheet account to the right activity", () => {
    const c = (code: string) => classifyCashFlow(CF_ACCOUNTS.find((a) => a.code === code)!);
    expect(c("1001")).toBe("cash");
    expect(c("1007")).toBe("operating");
    expect(c("1003001")).toBe("investing"); // PPE gross
    expect(c("1901001")).toBe("operating"); // accumulated depreciation add-back
    expect(c("2501")).toBe("financing"); // a loan
    expect(c("2901004")).toBe("financing"); // share capital
    expect(c("2901003")).toBe("operating"); // retained earnings (earnings)
    expect(c("3001001")).toBe("exclude"); // P&L
  });
});

describe("fs-engine — Statement of Cash Flows (indirect)", () => {
  const cf = buildCashFlow(cfInput());
  const amt = (label: string) => find(cf.rows, label)?.amounts?.p1;

  it("ties to the actual change in cash (check = 0)", () => {
    expect(cf.check.p1).toBe(0);
    expect(amt("NET INCREASE/(DECREASE) IN CASH")).toBe(300); // 500 − 200
    expect(amt("Cash, beginning of period")).toBe(200);
    expect(amt("Cash, end of period")).toBe(500);
  });

  it("buckets depreciation add-back + net income into operating, PPE into investing, loans into financing", () => {
    expect(amt("Net cash from operating activities")).toBe(350); // −50 AR +50 dep +350 RE
    expect(amt("Net cash from investing activities")).toBe(-100); // PPE acquisition
    expect(amt("Net cash from financing activities")).toBe(50); // loan drawdown
  });

  it("omits the earliest period (no prior to difference against)", () => {
    expect(find(cf.rows, "Cash, end of period")?.amounts?.p0).toBeUndefined();
  });
});

describe("fs-engine — Statement of Changes in Equity", () => {
  const { rows } = buildChangesInEquity(cfInput());
  const row = (label: string) => find(rows, label);

  it("rolls equity forward: beginning + net income + other = ending", () => {
    expect(row("Balance, end of period")?.amounts?.p1).toBe(710); // 100 SC + 610 RE
    expect(row("Balance, beginning of period")?.amounts?.p1).toBe(360); // prior ending (100 + 260)
    expect(row("Net income/(loss) for the period")?.amounts?.p1).toBe(350);
    expect(row("Other changes in equity (capital, dividends)")?.amounts?.p1).toBe(0);
  });

  it("leaves the earliest period's beginning blank (no prior)", () => {
    expect(row("Balance, end of period")?.amounts?.p0).toBe(360);
    expect(row("Balance, beginning of period")?.amounts?.p0).toBeUndefined();
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
