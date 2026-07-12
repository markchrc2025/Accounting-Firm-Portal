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
import { BIR_MAPPING_FILE, COA_FILE, loadChartOfAccountsData } from "./coa-seed";

const DATA_DIR = path.join(__dirname, "..", "..", "prisma", "data");

/** Minimal valid account for rule fixtures; override per test. Fixtures default
 *  to top-level (no parent) so a lone account never trips parent resolution. */
function acct(overrides: Partial<CoaAccount>): CoaAccount {
  const code = overrides.code ?? "5002001";
  const cls = overrides.class ?? "Expense";
  return {
    code,
    name: "Fixture Account",
    class: cls,
    accountType: "Operating Expense",
    parentCode: null,
    normalBalance: expectedNormalBalance(cls, code),
    currency: "PHP",
    lockDate: null,
    monthlyMovement: false,
    description: null,
    postable: true,
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

  it("passes every convention validation on the postable set alone", () => {
    // The postable accounts are all top-level here (parents come from the
    // hierarchy), so they validate on their own without parent-resolution noise.
    expect(validateChartOfAccounts(accounts)).toEqual([]);
    expect(validateTaxMappings(accounts, mappings)).toEqual([]);
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

describe("authoritative hierarchy — composed from CoA_Hierarchy.xlsx", () => {
  const { accounts } = loadChartOfAccountsData(DATA_DIR);
  const byCode = new Map(accounts.map((a) => [a.code, a]));

  it("ends at exactly 116 postable accounts + 15 non-postable headers", () => {
    const postable = accounts.filter((a) => a.postable);
    const headers = accounts.filter((a) => !a.postable);
    expect(postable).toHaveLength(116);
    expect(headers).toHaveLength(15);
    expect(headers.map((h) => h.code).sort()).toEqual(
      ["1002", "1003", "2001", "2002", "2003", "2004", "2008", "2009", "2101", "5001", "5002", "5003", "5004", "5005", "5007"].sort(),
    );
    expect(headers.every((h) => !h.postable)).toBe(true);
  });

  it("applies the parent map verbatim, incl. the cross-prefix contras", () => {
    expect(byCode.get("1002002")?.parentCode).toBe("1002");
    expect(byCode.get("5002004")?.parentCode).toBe("5002");
    // Contra accounts cross prefixes — the prefix rule would have mis-parented them.
    expect(byCode.get("1901001")?.parentCode).toBe("1003");
    expect(byCode.get("1902001")?.parentCode).toBe("1007");
    // Standalones (the 13 phantom prefixes) are top-level, not grouped.
    for (const code of ["8001001", "8002001", "2600001", "2700001", "2800001", "2901001", "3001001", "3901001", "9001001"]) {
      expect(byCode.get(code)?.parentCode).toBeNull();
    }
  });

  it("has zero phantom groups and zero nameless parents", () => {
    const codes = new Set(accounts.map((a) => a.code));
    const phantom = ["1901", "1902", "2600", "2700", "2800", "2901", "3001", "3002", "3901", "8001", "8002", "9001", "9002"];
    for (const p of phantom) {
      expect(accounts.some((a) => a.parentCode === p)).toBe(false);
    }
    // Every non-null parent resolves to a real record.
    for (const a of accounts) {
      if (a.parentCode !== null) expect(codes.has(a.parentCode)).toBe(true);
    }
  });

  it("uses exactly the 16 legitimate parents (15 headers + postable 1007)", () => {
    const parents = new Set(
      accounts.map((a) => a.parentCode).filter((p): p is string => p !== null),
    );
    expect([...parents].sort()).toEqual(
      ["1002", "1003", "1007", "2001", "2002", "2003", "2004", "2008", "2009", "2101", "5001", "5002", "5003", "5004", "5005", "5007"].sort(),
    );
    expect(byCode.get("1007")?.postable).toBe(true); // 1007 is a real posting account
  });

  it("passes every convention validation as a whole chart", () => {
    const mappings = parseBirTaxMapping(path.join(DATA_DIR, BIR_MAPPING_FILE));
    expect(validateChartOfAccounts(accounts)).toEqual([]);
    expect(validateTaxMappings(accounts, mappings)).toEqual([]);
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

  it("rejects a parent that resolves to no account or header", () => {
    const errors = validateChartOfAccounts([acct({ code: "5002001", parentCode: "9999" })]);
    expect(errors.join("\n")).toMatch(/5002001.*parent "9999" is not a defined account or group header/);
  });

  it("accepts a parent that resolves to a defined group header", () => {
    const header = acct({
      code: "5002",
      class: "Expense",
      accountType: "Operating Expense",
      postable: false,
    });
    expect(
      validateChartOfAccounts([header, acct({ code: "5002001", parentCode: "5002" })]),
    ).toEqual([]);
  });

  it("rejects an account that is its own parent", () => {
    const errors = validateChartOfAccounts([acct({ code: "5002001", parentCode: "5002001" })]);
    expect(errors.join("\n")).toMatch(/5002001.*cannot be its own parent/);
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

  it("exempts non-postable P&L group headers from mapping coverage", () => {
    // A 5xxx expense header would otherwise demand a BIR line; postable=false skips it.
    const header = acct({ code: "5001", class: "Expense", postable: false });
    expect(validateTaxMappings([header], [])).toEqual([]);
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
