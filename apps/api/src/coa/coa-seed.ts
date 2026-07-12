// Idempotent seeder for the PH SME Chart of Accounts + BIR income-tax mapping.
// Parses the xlsx files (single source of truth for UNTOUCHED rows), validates
// every convention (failing loudly with the offending account codes), then
// writes keyed on `code` / (accountCode, taxCategory):
//   - missing row            → created (source: "seed")
//   - row exists, never edited in-app (editedAt null) → updated from the xlsx
//   - row exists, edited in-app (editedAt set)        → left alone (user wins)
// So a re-run changes nothing, an edited xlsx updates only untouched rows, and
// in-app CRUD survives every redeploy.
//
// Takes a structural `CoaPrismaLike` rather than PrismaClient so tests can
// prove idempotency + edit-preservation against an in-memory fake.

import * as fs from "fs";
import * as path from "path";
import {
  assertValid,
  parseBirTaxMapping,
  parseChartOfAccounts,
  validateChartOfAccounts,
  validateTaxMappings,
  type CoaAccount,
  type CoaTaxMapping,
} from "./coa-import";

export const COA_FILE = "Chart_of_Accounts_Import.xlsx";
export const BIR_MAPPING_FILE = "BIR_Income_Tax_Mapping.xlsx";

/** DB row shape for chart_accounts (create payload; update omits the key). */
export interface ChartAccountRecord {
  code: string;
  name: string;
  class: string;
  accountType: string;
  parentCode: string | null;
  normalBalance: string;
  currency: string;
  lockDate: Date | null;
  monthlyMovement: boolean;
  description: string | null;
  source: string;
}

/** DB row shape for account_tax_mappings. */
export interface AccountTaxMappingRecord {
  accountCode: string;
  taxCategory: string;
  accountName: string;
  taxReturnLine: string | null;
  source: string;
}

/** The subset of PrismaClient the seeder needs (structurally satisfied by the
 *  real client and by the in-memory fake used in tests). */
export interface CoaPrismaLike {
  chartAccount: {
    findUnique(args: { where: { code: string } }): Promise<{ editedAt: Date | null } | null>;
    create(args: { data: ChartAccountRecord }): Promise<unknown>;
    update(args: {
      where: { code: string };
      data: Omit<ChartAccountRecord, "code">;
    }): Promise<unknown>;
  };
  accountTaxMapping: {
    findUnique(args: {
      where: { accountCode_taxCategory: { accountCode: string; taxCategory: string } };
    }): Promise<{ editedAt: Date | null } | null>;
    create(args: { data: AccountTaxMappingRecord }): Promise<unknown>;
    update(args: {
      where: { accountCode_taxCategory: { accountCode: string; taxCategory: string } };
      data: Omit<AccountTaxMappingRecord, "accountCode" | "taxCategory">;
    }): Promise<unknown>;
  };
}

/** Parse + derive + validate both files. Exposed for tests and the seeder. */
export function loadChartOfAccountsData(dataDir: string): {
  accounts: CoaAccount[];
  mappings: CoaTaxMapping[];
} {
  const accounts = parseChartOfAccounts(path.join(dataDir, COA_FILE));
  const mappings = parseBirTaxMapping(path.join(dataDir, BIR_MAPPING_FILE));
  assertValid(
    [...validateChartOfAccounts(accounts), ...validateTaxMappings(accounts, mappings)],
    "Chart of Accounts seed",
  );
  return { accounts, mappings };
}

function toDbAccount(a: CoaAccount): ChartAccountRecord {
  return {
    code: a.code,
    name: a.name,
    class: a.class,
    accountType: a.accountType,
    parentCode: a.parentCode,
    normalBalance: a.normalBalance,
    currency: a.currency,
    lockDate: a.lockDate ? new Date(`${a.lockDate}T00:00:00.000Z`) : null,
    monthlyMovement: a.monthlyMovement,
    description: a.description,
    source: "seed",
  };
}

export interface CoaSeedResult {
  accounts: number;
  mappings: number;
  mapped: number;
  /** Rows left untouched because they were edited in-app (user edits win). */
  preserved: number;
}

/** Seed the full chart + mapping. Safe to run on every deploy. */
export async function seedChartOfAccounts(
  prisma: CoaPrismaLike,
  dataDir: string,
): Promise<CoaSeedResult> {
  if (!fs.existsSync(path.join(dataDir, COA_FILE))) {
    throw new Error(`Chart of Accounts seed: ${path.join(dataDir, COA_FILE)} not found.`);
  }
  const { accounts, mappings } = loadChartOfAccountsData(dataDir);
  let preserved = 0;

  for (const a of accounts) {
    const record = toDbAccount(a);
    const existing = await prisma.chartAccount.findUnique({ where: { code: a.code } });
    if (!existing) {
      await prisma.chartAccount.create({ data: record });
    } else if (existing.editedAt === null) {
      const { code, ...rest } = record;
      void code;
      await prisma.chartAccount.update({ where: { code: a.code }, data: rest });
    } else {
      preserved += 1; // edited in-app — the user's version wins
    }
  }

  for (const m of mappings) {
    const where = {
      accountCode_taxCategory: { accountCode: m.accountCode, taxCategory: m.taxCategory },
    };
    const record: AccountTaxMappingRecord = { ...m, source: "seed" };
    const existing = await prisma.accountTaxMapping.findUnique({ where });
    if (!existing) {
      await prisma.accountTaxMapping.create({ data: record });
    } else if (existing.editedAt === null) {
      const { accountCode, taxCategory, ...rest } = record;
      void accountCode;
      void taxCategory;
      await prisma.accountTaxMapping.update({ where, data: rest });
    } else {
      preserved += 1;
    }
  }

  return {
    accounts: accounts.length,
    mappings: mappings.length,
    mapped: mappings.filter((m) => m.taxReturnLine !== null).length,
    preserved,
  };
}
