import * as path from "path";
import {
  seedChartOfAccounts,
  type AccountTaxMappingRecord,
  type ChartAccountRecord,
  type CoaPrismaLike,
} from "./coa-seed";

const DATA_DIR = path.join(__dirname, "..", "..", "prisma", "data");

/** In-memory Prisma stand-in: upsert semantics over Maps, plus call counters,
 *  so the double-run assertions below prove real idempotency (same final state,
 *  zero creates on the second pass, no duplicates possible). */
function fakePrisma() {
  const accounts = new Map<string, ChartAccountRecord>();
  const mappings = new Map<string, AccountTaxMappingRecord>();
  const counters = { accountCreates: 0, accountUpdates: 0, mappingCreates: 0, mappingUpdates: 0 };
  const prisma: CoaPrismaLike = {
    chartAccount: {
      async upsert({ where, create, update }) {
        if (accounts.has(where.code)) {
          counters.accountUpdates += 1;
          accounts.set(where.code, { ...accounts.get(where.code)!, ...update });
        } else {
          counters.accountCreates += 1;
          accounts.set(where.code, create);
        }
        return accounts.get(where.code);
      },
    },
    accountTaxMapping: {
      async upsert({ where, create, update }) {
        const key = `${where.accountCode_taxCategory.accountCode}|${where.accountCode_taxCategory.taxCategory}`;
        if (mappings.has(key)) {
          counters.mappingUpdates += 1;
          mappings.set(key, { ...mappings.get(key)!, ...update });
        } else {
          counters.mappingCreates += 1;
          mappings.set(key, create);
        }
        return mappings.get(key);
      },
    },
  };
  return { prisma, accounts, mappings, counters };
}

describe("seedChartOfAccounts — idempotency against the real xlsx files", () => {
  it("seeds 116 accounts + 62 mappings (59 mapped), and a re-run is a no-op", async () => {
    const db = fakePrisma();

    const first = await seedChartOfAccounts(db.prisma, DATA_DIR);
    expect(first).toEqual({ accounts: 116, mappings: 62, mapped: 59 });
    expect(db.accounts.size).toBe(116);
    expect(db.mappings.size).toBe(62);
    expect(db.counters.accountCreates).toBe(116);
    expect(db.counters.mappingCreates).toBe(62);
    const snapshot = {
      accounts: JSON.parse(JSON.stringify([...db.accounts.entries()])),
      mappings: JSON.parse(JSON.stringify([...db.mappings.entries()])),
    };

    const second = await seedChartOfAccounts(db.prisma, DATA_DIR);
    expect(second).toEqual(first);
    // No new rows, no duplicates — every second-run write hit the upsert's
    // update branch and left the state byte-identical.
    expect(db.counters.accountCreates).toBe(116);
    expect(db.counters.mappingCreates).toBe(62);
    expect(db.accounts.size).toBe(116);
    expect(db.mappings.size).toBe(62);
    expect({
      accounts: JSON.parse(JSON.stringify([...db.accounts.entries()])),
      mappings: JSON.parse(JSON.stringify([...db.mappings.entries()])),
    }).toEqual(snapshot);
  });

  it("stores the three intentionally-unmapped rows with a NULL line under Regular", async () => {
    const db = fakePrisma();
    await seedChartOfAccounts(db.prisma, DATA_DIR);
    for (const code of ["4001", "4002", "5008"]) {
      const row = db.mappings.get(`${code}|Regular`);
      expect(row).toBeDefined();
      expect(row?.taxReturnLine).toBeNull();
    }
    // And a spot-check that a mapped row carries its 1701/1702 line verbatim.
    expect(db.mappings.get("5007001|Regular")?.taxReturnLine).toBe("Depreciation");
  });

  it("fails loudly when the data directory is missing", async () => {
    const db = fakePrisma();
    await expect(
      seedChartOfAccounts(db.prisma, path.join(DATA_DIR, "nope")),
    ).rejects.toThrow(/Chart_of_Accounts_Import\.xlsx not found/);
  });
});
