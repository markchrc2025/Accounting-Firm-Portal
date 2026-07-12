import * as path from "path";
import {
  ALLOWED_UNMAPPED_PL,
  expectedNormalBalance,
  parseBirTaxMapping,
  parseChartOfAccounts,
  validateChartOfAccounts,
  validateTaxMappings,
  type CoaAccount,
  type CoaTaxMapping,
} from "./coa-import";
import { BIR_MAPPING_FILE, COA_FILE } from "./coa-seed";

const DATA_DIR = path.join(__dirname, "..", "..", "prisma", "data");

/** Minimal valid account for rule fixtures; override per test. */
function acct(overrides: Partial<CoaAccount>): CoaAccount {
  const code = overrides.code ?? "5002001";
  const cls = overrides.class ?? "Expense";
  return {
    code,
    name: "Fixture Account",
    class: cls,
    accountType: "Operating Expense",
    parentCode: /^\d{7}$/.test(code) ? code.slice(0, 4) : null,
    normalBalance: expectedNormalBalance(cls, code),
    currency: "PHP",
    lockDate: null,
    monthlyMovement: false,
    description: null,
    ...overrides,
  };
}

function mapping(overrides: Partial<CoaTaxMapping>): CoaTaxMapping {
  return {
    accountCode: "5002001",
    taxCategory: "Regular",
    accountName: "Fixture Account",
    taxReturnLine: "Advertising and Promotions",
    ...overrides,
  };
}

describe("Chart of Accounts import — real xlsx files (source of truth)", () => {
  const accounts = parseChartOfAccounts(path.join(DATA_DIR, COA_FILE));
  const mappings = parseBirTaxMapping(path.join(DATA_DIR, BIR_MAPPING_FILE));

  it("loads exactly 116 posting accounts with unique codes", () => {
    expect(accounts).toHaveLength(116);
    expect(new Set(accounts.map((a) => a.code)).size).toBe(116);
  });

  it("loads 62 mapping rows: 59 mapped, 3 intentionally blank (4001, 4002, 5008)", () => {
    expect(mappings).toHaveLength(62);
    const mapped = mappings.filter((m) => m.taxReturnLine !== null);
    expect(mapped).toHaveLength(59);
    const blanks = mappings.filter((m) => m.taxReturnLine === null).map((m) => m.accountCode);
    expect(blanks.sort()).toEqual([...ALLOWED_UNMAPPED_PL].sort());
  });

  it("normalises blank Tax Category to Regular on every row", () => {
    expect(mappings.every((m) => m.taxCategory === "Regular")).toBe(true);
  });

  it("passes every convention validation", () => {
    expect(validateChartOfAccounts(accounts)).toEqual([]);
    expect(validateTaxMappings(accounts, mappings)).toEqual([]);
  });

  it("is PHP-only and reconstructs the 7-digit prefix hierarchy", () => {
    expect(accounts.every((a) => a.currency === "PHP")).toBe(true);
    const sevens = accounts.filter((a) => a.code.length === 7);
    const fours = accounts.filter((a) => a.code.length === 4);
    expect(sevens).toHaveLength(103);
    expect(fours).toHaveLength(13);
    expect(sevens.every((a) => a.parentCode === a.code.slice(0, 4))).toBe(true);
    expect(fours.every((a) => a.parentCode === null)).toBe(true);
  });

  it("derives normal balances incl. the three contra exceptions", () => {
    const byCode = new Map(accounts.map((a) => [a.code, a]));
    expect(byCode.get("1901001")?.normalBalance).toBe("credit"); // Accumulated Depreciation
    expect(byCode.get("1902001")?.normalBalance).toBe("credit"); // Allowance for Doubtful Accts
    expect(byCode.get("3901001")?.normalBalance).toBe("debit"); // Sales Returns…
    expect(byCode.get("1001")?.normalBalance).toBe("debit"); // Asset
    expect(byCode.get("4001")?.normalBalance).toBe("debit"); // Direct Costs (Expense)
    expect(byCode.get("2001001")?.normalBalance).toBe("credit"); // Liability
    expect(byCode.get("2901003")?.normalBalance).toBe("credit"); // Equity
    expect(byCode.get("3001001")?.normalBalance).toBe("credit"); // Revenue
  });

  it("keeps the equity block exactly at 2901xxx", () => {
    const equity = accounts.filter((a) => a.class === "Equity");
    expect(equity.length).toBeGreaterThan(0);
    expect(equity.every((a) => a.code.startsWith("2901"))).toBe(true);
  });
});

describe("validateChartOfAccounts — one failing fixture per rule", () => {
  it("rejects duplicate codes", () => {
    const errors = validateChartOfAccounts([acct({ code: "1001", class: "Asset" }), acct({ code: "1001", class: "Asset" })]);
    expect(errors.join("\n")).toMatch(/1001.*duplicate code/);
  });

  it("rejects codes that are not 4 or 7 digits", () => {
    for (const code of ["123", "12345", "12345678", "5A02001"]) {
      const errors = validateChartOfAccounts([acct({ code, parentCode: null })]);
      expect(errors.join("\n")).toMatch(new RegExp(`${code}.*4 digits.*7 digits`));
    }
  });

  it("rejects a class that conflicts with its code prefix", () => {
    const errors = validateChartOfAccounts([
      acct({ code: "1001", class: "Liability", normalBalance: "credit" }),
    ]);
    expect(errors.join("\n")).toMatch(/1001.*conflicts with 1xxx assets/);
  });

  it("rejects Equity outside the 2901xxx block (and non-Equity inside it)", () => {
    const outside = validateChartOfAccounts([
      acct({ code: "2101001", class: "Equity", normalBalance: "credit" }),
    ]);
    expect(outside.join("\n")).toMatch(/2101001.*Equity.*2901xxx/);
    const inside = validateChartOfAccounts([
      acct({ code: "2901001", class: "Liability", normalBalance: "credit" }),
    ]);
    expect(inside.join("\n")).toMatch(/2901001.*2901xxx equity block/);
  });

  it("rejects prefixes outside the numbering scheme", () => {
    const errors = validateChartOfAccounts([acct({ code: "6001", class: "Expense" })]);
    expect(errors.join("\n")).toMatch(/6001.*prefix "6"/);
  });

  it("rejects every other class-vs-prefix conflict (3xxx, 4xxx, 5xxx, 8xxx, 9xxx)", () => {
    const cases: Array<[string, string, RegExp]> = [
      ["3001001", "Asset", /3001001.*conflicts with 3xxx income.*expected Revenue/],
      ["4001", "Revenue", /4001.*conflicts with 4xxx cost of sales.*expected Expense/],
      ["5002001", "Revenue", /5002001.*conflicts with 5xxx expenses.*expected Expense/],
      ["8001001", "Expense", /8001001.*conflicts with 8xxx VAT accounts.*Asset or Liability/],
      ["9001001", "Revenue", /9001001.*conflicts with 9xxx deferred\/creditable tax.*Asset or Liability/],
    ];
    for (const [code, cls, pattern] of cases) {
      const errors = validateChartOfAccounts([
        acct({ code, class: cls, normalBalance: expectedNormalBalance(cls, code) }),
      ]);
      expect(errors.join("\n")).toMatch(pattern);
    }
  });

  it("rejects a 4-digit posting account that collides with a 7-digit group prefix", () => {
    const errors = validateChartOfAccounts([
      acct({ code: "5002", parentCode: null }),
      acct({ code: "5002001" }),
    ]);
    expect(errors.join("\n")).toMatch(/5002.*posting account AND the parent group.*5002001/);
  });

  it("rejects a wrong normal balance, honouring the contra exceptions", () => {
    // Contra account forced to its class default → violation.
    const contra = validateChartOfAccounts([
      acct({ code: "1901001", class: "Asset", normalBalance: "debit" }),
    ]);
    expect(contra.join("\n")).toMatch(/1901001.*should be "credit".*contra/);
    // Plain asset forced to credit → violation.
    const plain = validateChartOfAccounts([
      acct({ code: "1004", class: "Asset", normalBalance: "credit" }),
    ]);
    expect(plain.join("\n")).toMatch(/1004.*should be "debit"/);
  });

  it("rejects non-PHP currency", () => {
    const errors = validateChartOfAccounts([acct({ currency: "USD" })]);
    expect(errors.join("\n")).toMatch(/5002001.*currency must be PHP.*USD/);
  });

  it("rejects a malformed lock date before it can crash the seeder mid-upsert", () => {
    const errors = validateChartOfAccounts([acct({ lockDate: "12/31/2026" })]);
    expect(errors.join("\n")).toMatch(/5002001.*lock date "12\/31\/2026" is not a valid/);
    expect(validateChartOfAccounts([acct({ lockDate: "2026-12-31" })])).toEqual([]);
  });

  it("rejects a parentCode that breaks the 7-digit prefix rule", () => {
    const errors = validateChartOfAccounts([acct({ code: "5002001", parentCode: "9999" })]);
    expect(errors.join("\n")).toMatch(/5002001.*parentCode "9999" should be "5002"/);
  });
});

describe("validateTaxMappings — one failing fixture per rule", () => {
  it("flags a P&L account with no tax-return line outside the allowed set", () => {
    const errors = validateTaxMappings([acct({ code: "5002001" })], []);
    expect(errors.join("\n")).toMatch(/5002001.*no BIR tax-return line.*4001, 4002, 5008/);
  });

  it("allows exactly the allowed-unmapped set to stay unmapped", () => {
    const accounts = ALLOWED_UNMAPPED_PL.map((code) =>
      acct({ code, class: "Expense", accountType: "Direct Costs", parentCode: null }),
    );
    expect(validateTaxMappings(accounts, [])).toEqual([]);
  });

  it("flags a blank line on a mapping row outside the allowed set", () => {
    const errors = validateTaxMappings(
      [acct({ code: "5002001" })],
      [mapping({ accountCode: "5002001", taxReturnLine: null })],
    );
    expect(errors.join("\n")).toMatch(/5002001.*blank Tax Return Line/);
  });

  it("flags a mapping to a code missing from the chart", () => {
    const errors = validateTaxMappings([], [mapping({ accountCode: "5099001" })]);
    expect(errors.join("\n")).toMatch(/5099001.*no such account/);
  });

  it("flags a mapping to a balance-sheet account", () => {
    const errors = validateTaxMappings(
      [acct({ code: "1001", class: "Asset", accountType: "Bank Accounts", parentCode: null })],
      [mapping({ accountCode: "1001" })],
    );
    expect(errors.join("\n")).toMatch(/1001.*is Asset.*only apply to P&L/);
  });

  it("flags duplicate (code, category) mapping rows", () => {
    const errors = validateTaxMappings(
      [acct({ code: "5002001" })],
      [mapping({}), mapping({})],
    );
    expect(errors.join("\n")).toMatch(/5002001 \[Regular\]: duplicate mapping row/);
  });

  it("flags a tax category other than Regular", () => {
    const errors = validateTaxMappings(
      [acct({ code: "5002001" })],
      [mapping({ taxCategory: "Special" })],
    );
    expect(errors.join("\n")).toMatch(/5002001.*"Special" is not supported.*"Regular"/);
  });
});
