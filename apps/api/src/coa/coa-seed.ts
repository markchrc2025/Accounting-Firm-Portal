// Idempotent seeder for the PH SME Chart of Accounts + BIR income-tax mapping.
// Parses the xlsx files (single source of truth), validates every convention
// (failing loudly with the offending account codes), then UPSERTS — keyed on
// `code` for accounts and (accountCode, taxCategory) for mappings — so a re-run
// changes nothing and can never duplicate rows, while an edited xlsx updates
// the app on the next seed with no code changes.
//
// Takes a structural `CoaPrismaLike` rather than PrismaClient so tests can
// prove idempotency against an in-memory fake, and prisma/seed.ts passes the
// real client.

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
}

/** DB row shape for account_tax_mappings. */
export interface AccountTaxMappingRecord {
  accountCode: string;
  taxCategory: string;
  accountName: string;
  taxReturnLine: string | null;
}

/** The subset of PrismaClient the seeder needs (structurally satisfied by the
 *  real client and by the in-memory fake used in tests). */
export interface CoaPrismaLike {
  chartAccount: {
    upsert(args: {
      where: { code: string };
      create: ChartAccountRecord;
      update: Omit<ChartAccountRecord, "code">;
    }): Promise<unknown>;
  };
  accountTaxMapping: {
    upsert(args: {
      where: { accountCode_taxCategory: { accountCode: string; taxCategory: string } };
      create: AccountTaxMappingRecord;
      update: Omit<AccountTaxMappingRecord, "accountCode" | "taxCategory">;
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
  };
}

/** Seed (upsert) the full chart + mapping. Safe to run on every deploy. */
export async function seedChartOfAccounts(
  prisma: CoaPrismaLike,
  dataDir: string,
): Promise<{ accounts: number; mappings: number; mapped: number }> {
  if (!fs.existsSync(path.join(dataDir, COA_FILE))) {
    throw new Error(`Chart of Accounts seed: ${path.join(dataDir, COA_FILE)} not found.`);
  }
  const { accounts, mappings } = loadChartOfAccountsData(dataDir);

  for (const a of accounts) {
    const { code, ...rest } = toDbAccount(a);
    await prisma.chartAccount.upsert({
      where: { code },
      create: { code, ...rest },
      update: rest,
    });
  }
  for (const m of mappings) {
    const { accountCode, taxCategory, ...rest } = m;
    await prisma.accountTaxMapping.upsert({
      where: { accountCode_taxCategory: { accountCode, taxCategory } },
      create: { accountCode, taxCategory, ...rest },
      update: rest,
    });
  }
  return {
    accounts: accounts.length,
    mappings: mappings.length,
    mapped: mappings.filter((m) => m.taxReturnLine !== null).length,
  };
}
