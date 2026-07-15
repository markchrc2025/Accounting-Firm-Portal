// Financial-statement rollup engine — pure, Prisma-free, and heavily tested
// (mirrors the aggregation engine's design). The service loads Chart-of-Accounts
// metadata + trial-balance rows (Decimal → number) and calls in here.
//
// Sign convention: trial-balance amounts are SIGNED debit-positive (a debit
// balance is +, a credit balance is −). Adjustments add (debit − credit).
// Presentation flips sign per statement section so every caption reads positive
// in its natural direction, and a contra account (whose balance is abnormal for
// its class) automatically shows negative and nets within its group.
//
// Grouping key is `parentCode ?? code` (the authoritative CoA hierarchy). That
// alone nets "PPE – net" (the accumulated-depreciation contra is parented to
// 1003) and "Trade Receivable, net of allowance" (allowance parented to 1007) —
// no special cases in the engine.

import { round2 } from "@portal/shared";

export interface FsAccountMeta {
  code: string;
  name: string;
  class: string; // Asset | Liability | Equity | Revenue | Expense
  accountType: string;
  parentCode: string | null;
  parentName: string | null;
}

export interface FsPeriodMeta {
  id: string;
  label: string;
  sortOrder: number; // 0 = current period; ascending = older comparatives
}

export interface TbRow {
  periodId: string;
  accountCode: string;
  amount: number; // signed debit-positive
}

export interface AdjustmentRow {
  periodId: string;
  accountCode: string;
  debit: number;
  credit: number;
}

export interface FsEngineInput {
  accounts: FsAccountMeta[];
  periods: FsPeriodMeta[];
  tb: TbRow[];
  adjustments: AdjustmentRow[];
}

export type FsRowKind = "section" | "group" | "line" | "subtotal" | "total" | "spacer";

export interface FsRow {
  kind: FsRowKind;
  label: string;
  level: number; // indentation depth for rendering
  code?: string; // present on "line" rows
  /** periodId → presented amount (positive in the caption's natural direction). */
  amounts?: Record<string, number>;
  emphasis?: boolean; // bold totals
}

/** +1 keeps debit balances positive (Asset/Expense); −1 flips credit balances
 *  positive (Liability/Equity/Revenue). */
export function classSign(cls: string): 1 | -1 {
  return cls === "Asset" || cls === "Expense" ? 1 : -1;
}

/** Adjusted signed (debit-positive) balance per period per account. */
export function adjustedBalances(input: FsEngineInput): Map<string, Map<string, number>> {
  const byPeriod = new Map<string, Map<string, number>>();
  for (const p of input.periods) byPeriod.set(p.id, new Map());
  const add = (periodId: string, code: string, delta: number) => {
    const m = byPeriod.get(periodId);
    if (!m) return; // row for an unknown period — ignore
    m.set(code, round2((m.get(code) ?? 0) + delta));
  };
  for (const r of input.tb) add(r.periodId, r.accountCode, r.amount);
  for (const a of input.adjustments) add(a.periodId, a.accountCode, a.debit - a.credit);
  return byPeriod;
}

const emptyAmounts = (periods: FsPeriodMeta[]): Record<string, number> =>
  Object.fromEntries(periods.map((p) => [p.id, 0]));

function sumAmounts(rows: Record<string, number>[], periods: FsPeriodMeta[]): Record<string, number> {
  const out = emptyAmounts(periods);
  for (const r of rows) for (const p of periods) out[p.id] = round2((out[p.id] ?? 0) + (r[p.id] ?? 0));
  return out;
}

/** Group a section's accounts by `parentCode ?? code`, presenting each with the
 *  section sign. Returns the ordered rows and the section total. Single
 *  top-level accounts render as a bare line; real groups get header + subtotal. */
function buildSection(
  title: string,
  accounts: FsAccountMeta[],
  balances: Map<string, Map<string, number>>,
  sign: 1 | -1,
  periods: FsPeriodMeta[],
  baseLevel: number,
): { rows: FsRow[]; total: Record<string, number> } {
  const sorted = [...accounts].sort((a, b) => a.code.localeCompare(b.code));
  const groupKey = (a: FsAccountMeta) => a.parentCode ?? a.code;

  const order: string[] = [];
  const groups = new Map<string, FsAccountMeta[]>();
  for (const a of sorted) {
    const key = groupKey(a);
    if (!groups.has(key)) {
      groups.set(key, []);
      order.push(key);
    }
    groups.get(key)!.push(a);
  }

  const presented = (a: FsAccountMeta): Record<string, number> => {
    const amounts = emptyAmounts(periods);
    for (const p of periods) {
      const bal = balances.get(p.id)?.get(a.code) ?? 0;
      amounts[p.id] = round2(sign * bal);
    }
    return amounts;
  };

  const rows: FsRow[] = [];
  const groupTotals: Record<string, number>[] = [];

  for (const key of order) {
    const members = groups.get(key)!;
    const lineAmounts = members.map((a) => presented(a));
    const subtotal = sumAmounts(lineAmounts, periods);
    groupTotals.push(subtotal);

    const isBareLine = members.length === 1 && members[0]!.code === key && members[0]!.parentCode === null;
    if (isBareLine) {
      const a = members[0]!;
      rows.push({ kind: "line", label: a.name, level: baseLevel, code: a.code, amounts: lineAmounts[0] });
      continue;
    }
    // A real group: caption from the parent account's name (if it is one of the
    // members) else a child's parentName, else the key.
    const self = members.find((a) => a.code === key);
    const caption = self?.name ?? members.find((a) => a.parentName)?.parentName ?? key;
    rows.push({ kind: "group", label: caption, level: baseLevel });
    members.forEach((a, i) =>
      rows.push({ kind: "line", label: a.name, level: baseLevel + 1, code: a.code, amounts: lineAmounts[i] }),
    );
    rows.push({ kind: "subtotal", label: `Total ${caption}`, level: baseLevel, amounts: subtotal });
  }

  return { rows, total: sumAmounts(groupTotals, periods) };
}

const isNonCurrent = (accountType: string): boolean => /non-?current|fixed/i.test(accountType);

/** Build the Statement of Income: Revenue − Cost of Sales = Gross Profit;
 *  less Operating Expenses (grouped by CoA parent header) = Net Income Before
 *  Tax; less Provision for Income Tax (5008) = Net Income After Tax. */
export function buildIncomeStatement(input: FsEngineInput): {
  rows: FsRow[];
  netIncomeAfterTax: Record<string, number>;
} {
  const periods = [...input.periods].sort((a, b) => a.sortOrder - b.sortOrder);
  const balances = adjustedBalances({ ...input, periods });
  const byCode = new Map(input.accounts.map((a) => [a.code, a]));
  void byCode;

  const revenue = input.accounts.filter((a) => a.class === "Revenue");
  const costOfSales = input.accounts.filter((a) => a.class === "Expense" && a.code.startsWith("4"));
  const opex = input.accounts.filter(
    (a) => a.class === "Expense" && !a.code.startsWith("4") && a.code !== "5008",
  );
  const provisionAccts = input.accounts.filter((a) => a.code === "5008");

  const rows: FsRow[] = [];

  const rev = buildSection("REVENUES", revenue, balances, -1, periods, 1);
  rows.push({ kind: "section", label: "REVENUES", level: 0 });
  rows.push(...rev.rows);
  rows.push({ kind: "subtotal", label: "Total Revenues", level: 0, amounts: rev.total, emphasis: true });

  const cos = buildSection("COST OF SERVICES", costOfSales, balances, 1, periods, 1);
  rows.push({ kind: "spacer", label: "", level: 0 });
  rows.push({ kind: "section", label: "COST OF SERVICES", level: 0 });
  rows.push(...cos.rows);
  rows.push({ kind: "subtotal", label: "Total Cost of Services", level: 0, amounts: cos.total });

  const grossProfit = subtract(rev.total, cos.total, periods);
  rows.push({ kind: "total", label: "GROSS PROFIT", level: 0, amounts: grossProfit, emphasis: true });

  const oe = buildSection("OPERATING EXPENSES", opex, balances, 1, periods, 1);
  rows.push({ kind: "spacer", label: "", level: 0 });
  rows.push({ kind: "section", label: "OPERATING EXPENSES", level: 0 });
  rows.push(...oe.rows);
  rows.push({ kind: "subtotal", label: "Total Operating Expenses", level: 0, amounts: oe.total, emphasis: true });

  const nibt = subtract(grossProfit, oe.total, periods);
  rows.push({ kind: "total", label: "NET INCOME/(LOSS) BEFORE TAX", level: 0, amounts: nibt, emphasis: true });

  const provision = buildSection("PROVISION", provisionAccts, balances, 1, periods, 0);
  const provisionTotal = provision.total;
  rows.push({
    kind: "line",
    label: "Provision for income tax/(credit)",
    level: 0,
    amounts: provisionTotal,
  });

  const niat = subtract(nibt, provisionTotal, periods);
  rows.push({ kind: "total", label: "NET INCOME/(LOSS) AFTER TAX", level: 0, amounts: niat, emphasis: true });

  return { rows, netIncomeAfterTax: niat };
}

/** Build the Statement of Financial Position with current/non-current splits
 *  and a balancing check (Assets − (Liabilities + Equity), 0 when balanced). */
export function buildBalanceSheet(input: FsEngineInput): {
  rows: FsRow[];
  totalAssets: Record<string, number>;
  totalLiabilitiesAndEquity: Record<string, number>;
  balanceCheck: Record<string, number>;
} {
  const periods = [...input.periods].sort((a, b) => a.sortOrder - b.sortOrder);
  const balances = adjustedBalances({ ...input, periods });

  const assets = input.accounts.filter((a) => a.class === "Asset");
  const liabilities = input.accounts.filter((a) => a.class === "Liability");
  const equity = input.accounts.filter((a) => a.class === "Equity");

  const rows: FsRow[] = [];

  // --- Assets ---
  rows.push({ kind: "section", label: "ASSETS", level: 0 });
  const curAssets = buildSection("Current Assets", assets.filter((a) => !isNonCurrent(a.accountType)), balances, 1, periods, 1);
  rows.push({ kind: "group", label: "Current Assets", level: 0 });
  rows.push(...curAssets.rows);
  rows.push({ kind: "subtotal", label: "Total Current Assets", level: 0, amounts: curAssets.total });
  const nonCurAssets = buildSection("Non-Current Assets", assets.filter((a) => isNonCurrent(a.accountType)), balances, 1, periods, 1);
  rows.push({ kind: "group", label: "Non-Current Assets", level: 0 });
  rows.push(...nonCurAssets.rows);
  rows.push({ kind: "subtotal", label: "Total Non-Current Assets", level: 0, amounts: nonCurAssets.total });
  const totalAssets = sumAmounts([curAssets.total, nonCurAssets.total], periods);
  rows.push({ kind: "total", label: "TOTAL ASSETS", level: 0, amounts: totalAssets, emphasis: true });

  // --- Liabilities & Equity ---
  rows.push({ kind: "spacer", label: "", level: 0 });
  rows.push({ kind: "section", label: "LIABILITIES & EQUITY", level: 0 });
  const curLiab = buildSection("Current Liabilities", liabilities.filter((a) => !isNonCurrent(a.accountType)), balances, -1, periods, 1);
  rows.push({ kind: "group", label: "Current Liabilities", level: 0 });
  rows.push(...curLiab.rows);
  rows.push({ kind: "subtotal", label: "Total Current Liabilities", level: 0, amounts: curLiab.total });
  const nonCurLiab = buildSection("Non-Current Liabilities", liabilities.filter((a) => isNonCurrent(a.accountType)), balances, -1, periods, 1);
  if (nonCurLiab.rows.length > 0) {
    rows.push({ kind: "group", label: "Non-Current Liabilities", level: 0 });
    rows.push(...nonCurLiab.rows);
    rows.push({ kind: "subtotal", label: "Total Non-Current Liabilities", level: 0, amounts: nonCurLiab.total });
  }
  const totalLiab = sumAmounts([curLiab.total, nonCurLiab.total], periods);
  rows.push({ kind: "subtotal", label: "TOTAL LIABILITIES", level: 0, amounts: totalLiab, emphasis: true });

  const eq = buildSection("Equity", equity, balances, -1, periods, 1);
  rows.push({ kind: "group", label: "Equity", level: 0 });
  rows.push(...eq.rows);
  rows.push({ kind: "subtotal", label: "Total Equity", level: 0, amounts: eq.total, emphasis: true });

  const totalLiabEquity = sumAmounts([totalLiab, eq.total], periods);
  rows.push({ kind: "total", label: "TOTAL LIABILITIES & EQUITY", level: 0, amounts: totalLiabEquity, emphasis: true });

  const balanceCheck = subtract(totalAssets, totalLiabEquity, periods);

  return { rows, totalAssets, totalLiabilitiesAndEquity: totalLiabEquity, balanceCheck };
}

function subtract(a: Record<string, number>, b: Record<string, number>, periods: FsPeriodMeta[]): Record<string, number> {
  const out = emptyAmounts(periods);
  for (const p of periods) out[p.id] = round2((a[p.id] ?? 0) - (b[p.id] ?? 0));
  return out;
}

const signedBal = (balances: Map<string, Map<string, number>>, periodId: string, code: string): number =>
  balances.get(periodId)?.get(code) ?? 0;

/** Statement of Changes in Equity — a roll-forward per period column:
 *  beginning (the older period's ending equity) + net income (from the IS)
 *  + other changes (the reconciling plug: capital moves, dividends) = ending.
 *  The earliest period has no prior, so its beginning/other are left blank. */
export function buildChangesInEquity(input: FsEngineInput): { rows: FsRow[] } {
  const periods = [...input.periods].sort((a, b) => a.sortOrder - b.sortOrder);
  const balances = adjustedBalances({ ...input, periods });
  const equity = input.accounts.filter((a) => a.class === "Equity");
  const niat = buildIncomeStatement({ ...input, periods }).netIncomeAfterTax;
  const byOrder = new Map(periods.map((p) => [p.sortOrder, p]));

  const ending: Record<string, number> = {};
  for (const p of periods) {
    ending[p.id] = round2(equity.reduce((s, a) => s + -1 * signedBal(balances, p.id, a.code), 0));
  }
  const beginning: Record<string, number> = {};
  const netIncome: Record<string, number> = {};
  const other: Record<string, number> = {};
  for (const p of periods) {
    netIncome[p.id] = niat[p.id] ?? 0;
    const older = byOrder.get(p.sortOrder + 1);
    if (older) {
      beginning[p.id] = ending[older.id]!;
      other[p.id] = round2(ending[p.id]! - beginning[p.id]! - netIncome[p.id]!);
    }
  }

  return {
    rows: [
      { kind: "section", label: "STATEMENT OF CHANGES IN EQUITY", level: 0 },
      { kind: "line", label: "Balance, beginning of period", level: 1, amounts: beginning },
      { kind: "line", label: "Net income/(loss) for the period", level: 1, amounts: netIncome },
      { kind: "line", label: "Other changes in equity (capital, dividends)", level: 1, amounts: other },
      { kind: "total", label: "Balance, end of period", level: 0, amounts: ending, emphasis: true },
    ],
  };
}

const isCashAccount = (a: FsAccountMeta): boolean =>
  a.accountType === "Bank Accounts" || /cash|petty|undeposited|revolving fund/i.test(a.name);

type CfBucket = "operating" | "investing" | "financing" | "cash" | "exclude";

/** Classify a balance-sheet account into a cash-flow activity. P&L accounts are
 *  excluded (their movement isn't a balance change). The split only affects the
 *  subtotals — the net change in cash ties by construction (cash is the plug). */
export function classifyCashFlow(a: FsAccountMeta): CfBucket {
  if (a.class === "Revenue" || a.class === "Expense") return "exclude";
  if (a.class === "Asset") {
    if (isCashAccount(a)) return "cash";
    if (a.accountType === "Fixed Asset") {
      // Accumulated depreciation is a non-cash add-back → operating; PPE gross → investing.
      return /accumulated depreciation/i.test(a.name) || a.code.startsWith("1901")
        ? "operating"
        : "investing";
    }
    return "operating"; // current assets, deferred tax, other non-current assets
  }
  if (a.class === "Liability") {
    return /loan|borrow|debt|note payable/i.test(a.name) ? "financing" : "operating";
  }
  // Equity: retained earnings/deficit carries the period's earnings → operating;
  // contributed capital → financing.
  return /retained|accumulated earning|deficit|income/i.test(a.name) ? "operating" : "financing";
}

/** Statement of Cash Flows (indirect, movement-based). For each period that has
 *  an older comparative, every balance-sheet account's movement becomes a cash
 *  impact (−Δ of its debit-positive balance), bucketed O/I/F. The sum equals the
 *  actual change in cash whenever the trial balance ties each period; the `check`
 *  row surfaces any residual. The earliest period has no prior, so no column. */
export function buildCashFlow(input: FsEngineInput): {
  rows: FsRow[];
  check: Record<string, number>;
} {
  const periods = [...input.periods].sort((a, b) => a.sortOrder - b.sortOrder);
  const balances = adjustedBalances({ ...input, periods });
  const byOrder = new Map(periods.map((p) => [p.sortOrder, p]));
  const priorOf = (p: FsPeriodMeta) => byOrder.get(p.sortOrder + 1);
  const withPrior = periods.filter((p) => priorOf(p));

  const cashImpact = (code: string, p: FsPeriodMeta): number => {
    const prior = priorOf(p)!;
    return round2(-(signedBal(balances, p.id, code) - signedBal(balances, prior.id, code)));
  };
  const amountsFor = (code: string): Record<string, number> => {
    const out: Record<string, number> = {};
    for (const p of withPrior) out[p.id] = cashImpact(code, p);
    return out;
  };
  const sumOver = (accts: FsAccountMeta[]): Record<string, number> => {
    const out: Record<string, number> = {};
    for (const p of withPrior) out[p.id] = round2(accts.reduce((s, a) => s + cashImpact(a.code, p), 0));
    return out;
  };

  const bucket = (name: CfBucket) => input.accounts.filter((a) => classifyCashFlow(a) === name);
  const operating = bucket("operating");
  const investing = bucket("investing");
  const financing = bucket("financing");
  const cash = bucket("cash");

  const rows: FsRow[] = [];
  const emitSection = (title: string, accts: FsAccountMeta[]): Record<string, number> => {
    rows.push({ kind: "section", label: title, level: 0 });
    for (const a of [...accts].sort((x, y) => x.code.localeCompare(y.code))) {
      rows.push({ kind: "line", label: a.name, level: 1, code: a.code, amounts: amountsFor(a.code) });
    }
    const total = sumOver(accts);
    rows.push({ kind: "subtotal", label: `Net cash from ${title.toLowerCase()}`, level: 0, amounts: total, emphasis: true });
    return total;
  };

  const op = emitSection("Operating Activities", operating);
  rows.push({ kind: "spacer", label: "", level: 0 });
  const inv = emitSection("Investing Activities", investing);
  rows.push({ kind: "spacer", label: "", level: 0 });
  const fin = emitSection("Financing Activities", financing);

  const netChange: Record<string, number> = {};
  const beginningCash: Record<string, number> = {};
  const endingCash: Record<string, number> = {};
  for (const p of withPrior) {
    netChange[p.id] = round2((op[p.id] ?? 0) + (inv[p.id] ?? 0) + (fin[p.id] ?? 0));
    const prior = priorOf(p)!;
    beginningCash[p.id] = round2(cash.reduce((s, a) => s + signedBal(balances, prior.id, a.code), 0));
    endingCash[p.id] = round2(cash.reduce((s, a) => s + signedBal(balances, p.id, a.code), 0));
  }
  const check: Record<string, number> = {};
  for (const p of withPrior) {
    check[p.id] = round2(netChange[p.id]! - (endingCash[p.id]! - beginningCash[p.id]!));
  }

  rows.push({ kind: "total", label: "NET INCREASE/(DECREASE) IN CASH", level: 0, amounts: netChange, emphasis: true });
  rows.push({ kind: "line", label: "Cash, beginning of period", level: 0, amounts: beginningCash });
  rows.push({ kind: "total", label: "Cash, end of period", level: 0, amounts: endingCash, emphasis: true });

  return { rows, check };
}
