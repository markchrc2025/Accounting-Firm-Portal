import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as XLSX from "xlsx";
import {
  seedChartOfAccounts,
  type AccountTaxMappingRecord,
  type ChartAccountRecord,
  type CoaPrismaLike,
} from "./coa-seed";

const DATA_DIR = path.join(__dirname, "..", "..", "prisma", "data");

type StoredAccount = ChartAccountRecord & { editedAt: Date | null };
type StoredMapping = AccountTaxMappingRecord & { editedAt: Date | null };

/** In-memory Prisma stand-in with find/create/update semantics and counters,
 *  so the assertions below prove real idempotency (identical final state, zero
 *  creates on the second pass) and edit-preservation (edited rows untouched). */
function fakePrisma() {
  const accounts = new Map<string, StoredAccount>();
  const mappings = new Map<string, StoredMapping>();
  const counters = { accountCreates: 0, accountUpdates: 0, mappingCreates: 0, mappingUpdates: 0 };
  const mapKey = (w: { accountCode: string; taxCategory: string }) =>
    `${w.accountCode}|${w.taxCategory}`;
  const prisma: CoaPrismaLike = {
    chartAccount: {
      async findUnique({ where }) {
        return accounts.get(where.code) ?? null;
      },
      async create({ data }) {
        counters.accountCreates += 1;
        accounts.set(data.code, { ...data, editedAt: null });
        return data;
      },
      async update({ where, data }) {
        counters.accountUpdates += 1;
        accounts.set(where.code, { ...accounts.get(where.code)!, ...data });
        return accounts.get(where.code);
      },
    },
    accountTaxMapping: {
      async findUnique({ where }) {
        return mappings.get(mapKey(where.accountCode_taxCategory)) ?? null;
      },
      async create({ data }) {
        counters.mappingCreates += 1;
        mappings.set(mapKey(data), { ...data, editedAt: null });
        return data;
      },
      async update({ where, data }) {
        const key = mapKey(where.accountCode_taxCategory);
        counters.mappingUpdates += 1;
        mappings.set(key, { ...mappings.get(key)!, ...data });
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
    expect(first).toEqual({ accounts: 116, mappings: 62, mapped: 59, preserved: 0 });
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
    // No new rows, no duplicates — every second-run write hit the update
    // branch and left the state byte-identical.
    expect(db.counters.accountCreates).toBe(116);
    expect(db.counters.mappingCreates).toBe(62);
    expect(db.accounts.size).toBe(116);
    expect(db.mappings.size).toBe(62);
    expect({
      accounts: JSON.parse(JSON.stringify([...db.accounts.entries()])),
      mappings: JSON.parse(JSON.stringify([...db.mappings.entries()])),
    }).toEqual(snapshot);
  });

  it("preserves rows edited in-app: the xlsx never overwrites a user's change", async () => {
    const db = fakePrisma();
    await seedChartOfAccounts(db.prisma, DATA_DIR);

    // Simulate an in-app rename + archive of a seeded account and a mapping edit.
    const edited = db.accounts.get("5002004")!;
    db.accounts.set("5002004", {
      ...edited,
      name: "Office & Pantry Supplies",
      editedAt: new Date(),
    });
    const mEdited = db.mappings.get("5002004|Regular")!;
    db.mappings.set("5002004|Regular", {
      ...mEdited,
      taxReturnLine: "Office Supplies (custom)",
      editedAt: new Date(),
    });

    const result = await seedChartOfAccounts(db.prisma, DATA_DIR);
    expect(result.preserved).toBe(2);
    expect(db.accounts.get("5002004")?.name).toBe("Office & Pantry Supplies");
    expect(db.mappings.get("5002004|Regular")?.taxReturnLine).toBe("Office Supplies (custom)");
    // Untouched rows still refresh from the xlsx as usual.
    expect(db.accounts.get("1001")?.name).toBe("Cash in Bank");
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

// ---------------------------------------------------------------------------
// Validation is WIRED THROUGH the seed path (the review's mutation test showed
// that deleting the seeder's assertValid call left every prior test green —
// these workbooks make that regression impossible to ship silently again).
// ---------------------------------------------------------------------------

const COA_HEADERS = [
  "Code", "Name", "Class", "Account Type", "Lock Date", "Monthly Movement", "Currency", "Description",
];
const MAP_HEADERS = ["Name", "Code", "Tax Category", "Tax Return Line"];

/** Write a COA + mapping workbook pair into a fresh temp dir. */
function writeDataDir(
  accountRows: (string | number)[][],
  mappingRows: (string | number)[][],
): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "coa-seed-spec-"));
  const coa = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(coa, XLSX.utils.aoa_to_sheet([COA_HEADERS, ...accountRows]), "Accounts");
  XLSX.writeFile(coa, path.join(dir, "Chart_of_Accounts_Import.xlsx"));
  const map = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(map, XLSX.utils.aoa_to_sheet([MAP_HEADERS, ...mappingRows]), "BIR Income Tax");
  XLSX.writeFile(map, path.join(dir, "BIR_Income_Tax_Mapping.xlsx"));
  return dir;
}

describe("seedChartOfAccounts — validation is enforced on the seed path itself", () => {
  it("rejects a rule-violating workbook, naming the offending code, and writes NOTHING", async () => {
    // 1001 in USD + a P&L account with no mapping row: two distinct violations.
    const dir = writeDataDir(
      [
        ["1001", "Cash in Bank", "Asset", "Bank Accounts", "", 0, "USD", ""],
        ["5002001", "Office Supplies", "Expense", "Operating Expense", "", 0, "PHP", ""],
      ],
      [],
    );
    const db = fakePrisma();
    await expect(seedChartOfAccounts(db.prisma, dir)).rejects.toThrow(
      /convention violation[\s\S]*1001[\s\S]*currency must be PHP[\s\S]*5002001.*no BIR tax-return line/,
    );
    expect(db.accounts.size).toBe(0);
    expect(db.mappings.size).toBe(0);
  });

  it("rejects a workbook row that has data but a blank Code", async () => {
    const dir = writeDataDir(
      [["", "Ghost Account", "Asset", "Current Asset", "", 0, "PHP", ""]],
      [],
    );
    const db = fakePrisma();
    await expect(seedChartOfAccounts(db.prisma, dir)).rejects.toThrow(
      /row 2 has data but a blank Code/,
    );
  });

  it("accepts a valid mini-workbook end-to-end (parse → validate → write)", async () => {
    const dir = writeDataDir(
      [
        ["1001", "Cash in Bank", "Asset", "Bank Accounts", "", 0, "PHP", ""],
        ["5002001", "Office Supplies", "Expense", "Operating Expense", "", 0, "PHP", ""],
      ],
      [["Office Supplies", "5002001", "Regular", "Office Supplies"]],
    );
    const db = fakePrisma();
    await expect(seedChartOfAccounts(db.prisma, dir)).resolves.toEqual({
      accounts: 2,
      mappings: 1,
      mapped: 1,
      preserved: 0,
    });
    expect(db.accounts.get("5002001")?.parentCode).toBe("5002");
    expect(db.accounts.get("1001")?.normalBalance).toBe("debit");
    expect(db.accounts.get("1001")?.source).toBe("seed");
  });
});
