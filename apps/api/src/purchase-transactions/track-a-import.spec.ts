/**
 * track-a-import.spec.ts — hermetic tests for the Expenses import v2 (U6).
 *
 * Nothing here touches a database. The workbook the importer reads is built by
 * the same generator the API serves, then filled with exceljs — so every test
 * is also a round-trip of the template. Prisma is a hand-rolled stub that
 * records what the service asked it to write.
 */
import * as ExcelJS from "exceljs";
import { BadRequestException, ConflictException } from "@nestjs/common";
import { RegimeValidator } from "../financial/regime-validator";
import type { AuthUser } from "../common/auth/auth-user";
import type { AuditService } from "../audit/audit.service";
import type { CategoriesService } from "../categories/categories.service";
import type { ClientsService } from "../clients/clients.service";
import type { PrismaService } from "../prisma/prisma.service";
import type { RbacService } from "../rbac/rbac.service";
import {
  CLIENT_SHEET_KEYS,
  DOCUMENT_TYPES,
  EXPENSES_HEADERS,
  SHEET,
  TEMPLATE_VERSION,
  UNASSIGNED_CATEGORY,
} from "./import/expense-import.constants";
import {
  cellToIsoDate,
  footsToGross,
  normaliseTin,
  splitRow,
} from "./import/expense-import.rules";
import { buildExpenseTemplate, classifyAccounts, validationsOf } from "./import/expense-template";
import { ExpenseImportService } from "./import/expense-import.service";

type Header = (typeof EXPENSES_HEADERS)[number];
type RowInput = Partial<Record<Header, unknown>>;

const FIRM = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CLIENT_VAT = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const CLIENT_NONVAT = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const OTHER_CLIENT = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const actor: AuthUser = { id: "11111111-1111-4111-8111-111111111111", firmId: FIRM, userType: "FIRM", email: "t@example.com" };

/** Invented chart rows — the shape the service reads from prisma.chartAccount. */
const ACCOUNTS = [
  { code: "5999001", name: "Test Office Supplies", class: "Expense", accountType: "Operating Expense", postable: true, archived: false },
  { code: "5999002", name: "Owner's Personal Expenses", class: "Expense", accountType: "Other Expense", postable: true, archived: false },
  { code: "1999001", name: "Test Asset", class: "Asset", accountType: "Current Asset", postable: true, archived: false },
  { code: "5999003", name: "Archived Expense", class: "Expense", accountType: "Operating Expense", postable: true, archived: true },
  { code: "5000", name: "Operating Expenses (header)", class: "Expense", accountType: "Operating Expense", postable: false, archived: false },
];

function clientRow(id: string, taxType: "VAT" | "PERCENTAGE") {
  return {
    id,
    firmId: FIRM,
    businessName: taxType === "VAT" ? "Invented VAT Trading Co" : "Invented Sari-Sari Store",
    tin: "000111222",
    branch: "00000",
    taxType,
    kind: "non-individual",
    regName: null,
  };
}

/** The receipt every worked example uses: vatable 2,952.01 + VAT 354.24 + exempt 887.96 = 4,194.21. */
const SUPERMARKET: RowInput = {
  Date: new Date(Date.UTC(2026, 7, 14)),
  "Document Type": "SALES_INVOICE",
  "Vendor TIN": "000-222-333-00000",
  "Vendor Registered Name": "Invented Supermart Inc",
  "Reference Number": "00000000000000000012345",
  "Vatable Amount": 2952.01,
  "VAT Amount": 354.24,
  "VAT-Exempt Amount": 887.96,
  "Gross Total": 4194.21,
  Description: "Groceries and supplies",
  "COA Code": "5999001",
  "Source File": "IMG_0001.jpg",
};

const DELIVERY_NO_TIN: RowInput = {
  Date: new Date(Date.UTC(2026, 8, 2)),
  "Document Type": "DELIVERY_RECEIPT",
  "Vendor Registered Name": "Invented Water Delivery",
  "Other Non-vatable": 500,
  "Gross Total": 500,
  Description: "Water delivery",
  "COA Code": "5999001",
  "Source File": "IMG_0002.jpg",
};

async function makeFile(
  client: ReturnType<typeof clientRow>,
  rows: RowInput[],
  opts: { periodFrom?: string; periodTo?: string; version?: string; clientId?: string } = {},
): Promise<Buffer> {
  const template = await buildExpenseTemplate({
    client: {
      id: client.id,
      tin: client.tin,
      branch: client.branch,
      businessName: client.businessName,
      regimeLabel: client.taxType === "VAT" ? "VAT-registered" : "Non-VAT (percentage tax)",
    },
    accounts: classifyAccounts(ACCOUNTS),
  });
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(template as unknown as ArrayBuffer);
  const clientSheet = wb.getWorksheet(SHEET.CLIENT)!;
  const setKey = (key: string, value: unknown) => {
    clientSheet.eachRow((r) => {
      if (String(r.getCell(1).value) === key) r.getCell(2).value = value as ExcelJS.CellValue;
    });
  };
  setKey(CLIENT_SHEET_KEYS.periodFrom, opts.periodFrom ?? "2026-07-01");
  setKey(CLIENT_SHEET_KEYS.periodTo, opts.periodTo ?? "2026-09-30");
  if (opts.version) setKey(CLIENT_SHEET_KEYS.version, opts.version);
  if (opts.clientId) setKey(CLIENT_SHEET_KEYS.clientId, opts.clientId);
  const sheet = wb.getWorksheet(SHEET.EXPENSES)!;
  for (const row of rows) {
    sheet.addRow(EXPENSES_HEADERS.map((h) => (row[h] === undefined ? null : row[h])) as ExcelJS.CellValue[]);
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

interface Harness {
  svc: ExpenseImportService;
  created: Record<string, unknown>[];
  tx: { purchaseTransaction: { create: jest.Mock } };
  prisma: Record<string, unknown>;
  audit: { record: jest.Mock };
  existing: Record<string, unknown>[];
}

function build(client: ReturnType<typeof clientRow>, existing: Record<string, unknown>[] = []): Harness {
  const created: Record<string, unknown>[] = [];
  let seq = 0;
  const tx = {
    purchaseTransaction: {
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const row = { id: `rec-${++seq}`, ...data };
        created.push(row);
        return row;
      }),
    },
  };
  const prisma = {
    chartAccount: { findMany: jest.fn(async () => ACCOUNTS) },
    birAtcCode: { findUnique: jest.fn(async ({ where }: { where: { atc: string } }) => (where.atc === "WC010" ? { atc: "WC010", classification: "ewt" } : null)) },
    purchaseTransaction: {
      findMany: jest.fn(async ({ where }: { where: Record<string, unknown> }) =>
        existing.filter((e) => e.clientId === where.clientId && e.vendorTin === where.vendorTin && e.referenceNo === where.referenceNo),
      ),
      findFirst: jest.fn(async () => null),
    },
    $transaction: jest.fn(async (cb: (t: typeof tx) => Promise<unknown>) => cb(tx)),
  };
  const clients = { assertInFirm: jest.fn(async (_f: string, id: string) => (id === client.id ? client : null)) };
  const categories = {
    resolveByName: jest.fn(async (_c: string, name: string) => ({ id: `cat-${name}`, name, isDeductible: true })),
  };
  const audit = { record: jest.fn(async () => undefined) };
  const rbac = { authorize: jest.fn(async () => true) };
  const svc = new ExpenseImportService(
    prisma as unknown as PrismaService,
    clients as unknown as ClientsService,
    categories as unknown as CategoriesService,
    new RegimeValidator(),
    audit as unknown as AuditService,
    rbac as unknown as RbacService,
  );
  return { svc, created, tx, prisma, audit, existing };
}

const upload = (buffer: Buffer) => ({ buffer, originalname: "expenses.xlsx", mimetype: "application/octet-stream", size: buffer.length });

// ---------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------

describe("rules: TIN normalisation (R5)", () => {
  it.each([
    ["000-222-333", "000222333", "00000"],
    ["000-222-333-000", "000222333", "00000"],
    ["000-222-333-00000", "000222333", "00000"],
    ["000222333-00000", "000222333", "00000"],
    ["000222333", "000222333", "00000"],
    ["000-222-333-001", "000222333", "00001"],
    ["000-222-333-00007", "000222333", "00007"],
  ])("%s → tin %s branch %s", (raw, tin, branch) => {
    expect(normaliseTin(raw, "")).toEqual({ tin, branch });
  });

  it("a three-digit Vendor Branch column is left-padded to five", () => {
    expect(normaliseTin("000-222-333", "7")).toEqual({ tin: "000222333", branch: "00007" });
    expect(normaliseTin("000-222-333", "012")).toEqual({ tin: "000222333", branch: "00012" });
  });

  it("rejects a TIN that is not 9, 12 or 14 digits", () => {
    expect(normaliseTin("12345", "")).toMatchObject({ error: expect.stringContaining("Vendor TIN") });
    expect(normaliseTin("000-222-333-0000", "")).toMatchObject({ error: expect.stringContaining("Vendor TIN") });
  });

  it("a blank TIN is allowed and yields no tin (D28 — the row is flagged elsewhere)", () => {
    expect(normaliseTin("", "")).toEqual({ tin: null, branch: null });
  });
});

describe("rules: footing (R4)", () => {
  it("accepts a breakdown that foots within 0.01", () => {
    expect(footsToGross([2952.01, 354.24, 887.96], 4194.21)).toBe(true);
    expect(footsToGross([2952.01, 354.24, 887.96], 4194.22)).toBe(true);
  });
  it("rejects a breakdown off by 0.02", () => {
    expect(footsToGross([2952.01, 354.24, 887.96], 4194.23)).toBe(false);
  });
});

describe("rules: split by treatment (D23, D24)", () => {
  const parts = { vatable: 2952.01, vat: 354.24, exempt: 887.96, zeroRated: 0, other: 0 };
  it("VAT client: net of VAT, input VAT claimable", () => {
    const out = splitRow(parts, "VAT");
    expect(out).toEqual([
      expect.objectContaining({ classification: "VATABLE", netAmount: 2952.01, inputVAT: 354.24, taxAmount: 354.24, inputVATCategory: "DOMESTIC_PURCHASES", vatClaimable: true }),
      expect.objectContaining({ classification: "VAT_EXEMPT", netAmount: 887.96, inputVATCategory: "DOMESTIC_NO_INPUT_TAX", vatClaimable: false }),
    ]);
  });
  it("non-VAT client: gross is the expense, VAT kept as a cost figure", () => {
    const out = splitRow(parts, "PERCENTAGE");
    expect(out).toEqual([
      expect.objectContaining({ classification: "VATABLE", netAmount: 3306.25, taxAmount: 354.24, vatClaimable: false }),
      expect.objectContaining({ classification: "VAT_EXEMPT", netAmount: 887.96, vatClaimable: false }),
    ]);
    // A non-VAT client never carries an input-VAT claim or category (the regime validator forbids both).
    expect(out[0]).not.toHaveProperty("inputVAT");
    expect(out[0]).not.toHaveProperty("inputVATCategory");
    expect(out[1]).not.toHaveProperty("inputVATCategory");
  });
});

describe("rules: date cells", () => {
  it("reads a Date, an Excel serial and an ISO string", () => {
    expect(cellToIsoDate(new Date(Date.UTC(2026, 6, 15)))).toBe("2026-07-15");
    expect(cellToIsoDate(46218)).toBe("2026-07-15");
    expect(cellToIsoDate("2026-07-15")).toBe("2026-07-15");
    expect(cellToIsoDate("")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Template (T6, hermetic)
// ---------------------------------------------------------------------------

describe("template", () => {
  let wb: ExcelJS.Workbook;
  beforeAll(async () => {
    const buf = await buildExpenseTemplate({
      client: { id: CLIENT_VAT, tin: "000111222", branch: "00000", businessName: "Invented VAT Trading Co", regimeLabel: "VAT-registered" },
      accounts: classifyAccounts(ACCOUNTS),
    });
    wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
  });

  it("has the five sheets in order", () => {
    expect(wb.worksheets.map((s) => s.name)).toEqual([SHEET.INSTRUCTIONS, SHEET.CLIENT, SHEET.EXPENSES, SHEET.REFERENCE, SHEET.COA]);
  });

  it("EXPENSES carries the 27 headers in order, frozen, and no data rows", () => {
    const ws = wb.getWorksheet(SHEET.EXPENSES)!;
    const header = (ws.getRow(1).values as unknown[]).slice(1);
    expect(header).toEqual([...EXPENSES_HEADERS]);
    expect(EXPENSES_HEADERS).toHaveLength(27);
    expect(ws.views[0]).toMatchObject({ state: "frozen", ySplit: 1 });
    expect(ws.actualRowCount).toBe(1);
  });

  it("text format on TIN, Branch, Postal Code, Reference Number and COA Code; two decimals on amounts", () => {
    const ws = wb.getWorksheet(SHEET.EXPENSES)!;
    const col = (h: Header) => ws.getColumn(EXPENSES_HEADERS.indexOf(h) + 1);
    for (const h of ["Vendor TIN", "Vendor Branch", "Postal Code", "Reference Number", "COA Code"] as Header[]) {
      expect(col(h).numFmt).toBe("@");
    }
    for (const h of ["Vatable Amount", "VAT Amount", "VAT-Exempt Amount", "Zero-rated Amount", "Other Non-vatable", "Gross Total", "Withholding Amount"] as Header[]) {
      expect(col(h).numFmt).toBe("#,##0.00");
    }
  });

  it("list validation on Document Type, Needs Review and COA Code", () => {
    const ws = wb.getWorksheet(SHEET.EXPENSES)!;
    const model = validationsOf(ws).model;
    const cellOf = (h: Header) => `${ws.getColumn(EXPENSES_HEADERS.indexOf(h) + 1).letter}2`;
    expect(model[cellOf("Document Type")]).toMatchObject({ type: "list", formulae: [expect.stringContaining(`${SHEET.REFERENCE}!`)] });
    expect(model[cellOf("Needs Review")]).toMatchObject({ type: "list", formulae: ['"Y,N"'] });
    expect(model[cellOf("COA Code")]).toMatchObject({ type: "list", formulae: [expect.stringContaining(`${SHEET.COA}!`)] });
  });

  it("CLIENT names the client and the template version; period cells are left for the encoder", () => {
    const ws = wb.getWorksheet(SHEET.CLIENT)!;
    const kv: Record<string, unknown> = {};
    ws.eachRow((r) => { kv[String(r.getCell(1).value)] = r.getCell(2).value; });
    expect(kv[CLIENT_SHEET_KEYS.clientId]).toBe(CLIENT_VAT);
    expect(kv[CLIENT_SHEET_KEYS.version]).toBe(TEMPLATE_VERSION);
    expect(kv[CLIENT_SHEET_KEYS.tin]).toBe("000-111-222-00000");
    expect(kv[CLIENT_SHEET_KEYS.periodFrom] ?? null).toBeNull();
    expect(kv[CLIENT_SHEET_KEYS.periodTo] ?? null).toBeNull();
  });

  it("COA lists only postable, non-archived accounts; every expense-class account is allowed, the asset is not, and no account is marked (U6-A2)", () => {
    const ws = wb.getWorksheet(SHEET.COA)!;
    const rows: Record<string, string>[] = [];
    ws.eachRow((r, n) => { if (n > 1) rows.push({ code: String(r.getCell(1).value), allowed: String(r.getCell(6).value), extra: String(r.getCell(7).value ?? "") }); });
    const byCode = Object.fromEntries(rows.map((r) => [r.code, r]));
    expect(byCode["5999001"]).toMatchObject({ allowed: "Y", extra: "" });
    expect(byCode["5999002"]).toMatchObject({ allowed: "Y", extra: "" }); // named "Personal" — no longer special
    expect(byCode["1999001"]).toMatchObject({ allowed: "N" });
    expect(byCode["5999003"]).toBeUndefined();
    expect(byCode["5000"]).toBeUndefined();
  });

  it("REFERENCE lists every Document Type and names the classifications from @portal/shared", () => {
    const ws = wb.getWorksheet(SHEET.REFERENCE)!;
    const text: string[] = [];
    ws.eachRow((r) => r.eachCell((c) => text.push(String(c.value))));
    for (const d of DOCUMENT_TYPES) expect(text).toContain(d.code);
    expect(text).toContain("DOMESTIC_PURCHASES");
    expect(text).toContain("DOMESTIC_NO_INPUT_TAX");
  });
});

// ---------------------------------------------------------------------------
// Importer (service with stubs) — T3
// ---------------------------------------------------------------------------

describe("importer: file-level rejections (R3)", () => {
  it("rejects a file whose CLIENT sheet names another client", async () => {
    const { svc } = build(clientRow(CLIENT_VAT, "VAT"));
    const buf = await makeFile(clientRow(CLIENT_VAT, "VAT"), [SUPERMARKET], { clientId: OTHER_CLIENT });
    await expect(svc.importFile(actor, CLIENT_VAT, upload(buf), true)).rejects.toThrow(/another client/i);
  });
  it("rejects an unknown template version", async () => {
    const { svc } = build(clientRow(CLIENT_VAT, "VAT"));
    const buf = await makeFile(clientRow(CLIENT_VAT, "VAT"), [SUPERMARKET], { version: "expenses-v9" });
    await expect(svc.importFile(actor, CLIENT_VAT, upload(buf), true)).rejects.toThrow(/template version/i);
  });
  it("rejects a file whose period cells are blank", async () => {
    const { svc } = build(clientRow(CLIENT_VAT, "VAT"));
    const buf = await makeFile(clientRow(CLIENT_VAT, "VAT"), [SUPERMARKET], { periodFrom: "", periodTo: "" });
    await expect(svc.importFile(actor, CLIENT_VAT, upload(buf), true)).rejects.toThrow(/Period From/i);
  });
});

describe("importer: row rules (R4, R5)", () => {
  it("footing off by 0.02 rejects the row", async () => {
    const { svc, created } = build(clientRow(CLIENT_VAT, "VAT"));
    const buf = await makeFile(clientRow(CLIENT_VAT, "VAT"), [{ ...SUPERMARKET, "Gross Total": 4194.23 }]);
    const res = await svc.importFile(actor, CLIENT_VAT, upload(buf), false);
    expect(res.rows[0]!).toMatchObject({ outcome: "rejected", messages: [expect.stringMatching(/foot/i)] });
    expect(created).toHaveLength(0);
  });

  it("a Date outside the declared period rejects; a missing Date rejects", async () => {
    const { svc } = build(clientRow(CLIENT_VAT, "VAT"));
    const buf = await makeFile(clientRow(CLIENT_VAT, "VAT"), [
      { ...SUPERMARKET, Date: new Date(Date.UTC(2026, 9, 1)) },
      { ...SUPERMARKET, Date: undefined, "Reference Number": "R-2" },
    ]);
    const res = await svc.importFile(actor, CLIENT_VAT, upload(buf), true);
    expect(res.rows[0]!).toMatchObject({ outcome: "rejected", messages: [expect.stringMatching(/outside the period/i)] });
    expect(res.rows[1]!).toMatchObject({ outcome: "rejected", messages: [expect.stringMatching(/Date is required/i)] });
  });

  it("a row without a Reference Number posts, whatever its Document Type (U6-A2, D37)", async () => {
    const { svc } = build(clientRow(CLIENT_VAT, "VAT"));
    const buf = await makeFile(clientRow(CLIENT_VAT, "VAT"), [
      { ...SUPERMARKET, "Reference Number": undefined },
      DELIVERY_NO_TIN,
    ]);
    const res = await svc.importFile(actor, CLIENT_VAT, upload(buf), true);
    expect(res.rows[0]!).toMatchObject({ outcome: "posted", messages: [] });
    expect(res.rows[1]!).toMatchObject({ outcome: "posted", needsReview: true });
  });

  it("an invalid TIN rejects; a 12-digit TIN stores a five-digit branch", async () => {
    const { svc, created } = build(clientRow(CLIENT_VAT, "VAT"));
    const buf = await makeFile(clientRow(CLIENT_VAT, "VAT"), [
      { ...SUPERMARKET, "Vendor TIN": "12-34" },
      { ...SUPERMARKET, "Vendor TIN": "000-222-333-001", "Reference Number": "R-2" },
    ]);
    const res = await svc.importFile(actor, CLIENT_VAT, upload(buf), false);
    expect(res.rows[0]!.outcome).toBe("rejected");
    expect(res.rows[1]!.outcome).toBe("posted");
    expect(created[0]).toMatchObject({ vendorTin: "000222333", vendorBranch: "00001" });
  });

  it("a Reference Number keeps its leading zeros", async () => {
    const { svc, created } = build(clientRow(CLIENT_VAT, "VAT"));
    const buf = await makeFile(clientRow(CLIENT_VAT, "VAT"), [SUPERMARKET]);
    await svc.importFile(actor, CLIENT_VAT, upload(buf), false);
    expect(created[0]).toMatchObject({ referenceNo: "00000000000000000012345" });
  });

  it("a COA Code that is not allowed on expense rows rejects; a blank COA Code holds", async () => {
    const { svc, created } = build(clientRow(CLIENT_VAT, "VAT"));
    const buf = await makeFile(clientRow(CLIENT_VAT, "VAT"), [
      { ...SUPERMARKET, "COA Code": "1999001" },
      { ...SUPERMARKET, "COA Code": undefined, "Reference Number": "R-2" },
      { ...SUPERMARKET, "COA Code": "0000000", "Reference Number": "R-3" },
    ]);
    const res = await svc.importFile(actor, CLIENT_VAT, upload(buf), false);
    expect(res.rows[0]!).toMatchObject({ outcome: "rejected", messages: [expect.stringMatching(/not allowed on expense rows/i)] });
    expect(res.rows[1]!).toMatchObject({ outcome: "held", messages: [expect.stringMatching(/COA Code is blank/i)] });
    expect(res.rows[2]!).toMatchObject({ outcome: "rejected", messages: [expect.stringMatching(/not on the chart/i)] });
    const held = created.filter((c) => c.status === "held");
    expect(held).toHaveLength(2);
    expect(held[0]).toMatchObject({ account: null, categoryId: `cat-${UNASSIGNED_CATEGORY}` });
  });

  it("an account named 'Personal' is an ordinary expense account: its records are deductible (U6-A2, D36)", async () => {
    const { svc, created } = build(clientRow(CLIENT_VAT, "VAT"));
    const buf = await makeFile(clientRow(CLIENT_VAT, "VAT"), [{ ...SUPERMARKET, "COA Code": "5999002" }]);
    await svc.importFile(actor, CLIENT_VAT, upload(buf), false);
    expect(created.every((c) => c.deductible === true)).toBe(true);
    expect(created[0]).toMatchObject({ account: "Owner's Personal Expenses" });
  });

  it("ATC must be a seeded code and must come with a Withholding Amount", async () => {
    const { svc, created } = build(clientRow(CLIENT_VAT, "VAT"));
    const buf = await makeFile(clientRow(CLIENT_VAT, "VAT"), [
      { ...SUPERMARKET, ATC: "ZZ999", "Withholding Amount": 10 },
      { ...SUPERMARKET, ATC: "WC010", "Reference Number": "R-2" },
      { ...SUPERMARKET, ATC: "WC010", "Withholding Amount": 29.52, "Reference Number": "R-3" },
    ]);
    const res = await svc.importFile(actor, CLIENT_VAT, upload(buf), false);
    expect(res.rows[0]!).toMatchObject({ outcome: "rejected", messages: [expect.stringMatching(/ATC/)] });
    expect(res.rows[1]!).toMatchObject({ outcome: "rejected", messages: [expect.stringMatching(/Withholding Amount/)] });
    expect(res.rows[2]!.outcome).toBe("posted");
    expect(created[0]).toMatchObject({ atc: "WC010", whtAmount: 29.52 });
  });
});

describe("importer: splitting and stamping (D23, D24)", () => {
  it("a mixed receipt for a VAT client becomes two records, VAT claimable on the vatable part", async () => {
    const { svc, created } = build(clientRow(CLIENT_VAT, "VAT"));
    const buf = await makeFile(clientRow(CLIENT_VAT, "VAT"), [SUPERMARKET]);
    const res = await svc.importFile(actor, CLIENT_VAT, upload(buf), false);
    expect(res.rows[0]!).toMatchObject({ outcome: "posted", needsReview: false });
    expect(res.rows[0]!.records).toEqual([
      { id: "rec-1", classification: "VATABLE", amount: 2952.01, vatAmount: 354.24, vatClaimable: true },
      { id: "rec-2", classification: "VAT_EXEMPT", amount: 887.96, vatAmount: 0, vatClaimable: false },
    ]);
    expect(created[0]).toMatchObject({ netAmount: 2952.01, inputVAT: 354.24, taxAmount: 354.24, inputVATCategory: "DOMESTIC_PURCHASES", vatClaimable: true, status: "posted", documentType: "SALES_INVOICE", sourceFile: "IMG_0001.jpg", vendor: "Invented Supermart Inc" });
    expect(created[1]).toMatchObject({ netAmount: 887.96, inputVAT: null, inputVATCategory: "DOMESTIC_NO_INPUT_TAX", vatClaimable: false });
    expect(created[0]!.importBatchId).toEqual(created[1]!.importBatchId);
    expect(res.totals).toEqual({ rows: 1, posted: 1, held: 0, rejected: 0, grossAmount: 4194.21 });
  });

  it("the same receipt for a non-VAT client: gross is the expense, VAT kept as a cost figure", async () => {
    const { svc, created } = build(clientRow(CLIENT_NONVAT, "PERCENTAGE"));
    const buf = await makeFile(clientRow(CLIENT_NONVAT, "PERCENTAGE"), [SUPERMARKET]);
    const res = await svc.importFile(actor, CLIENT_NONVAT, upload(buf), false);
    expect(res.rows[0]!.records).toEqual([
      { id: "rec-1", classification: "VATABLE", amount: 3306.25, vatAmount: 354.24, vatClaimable: false },
      { id: "rec-2", classification: "VAT_EXEMPT", amount: 887.96, vatAmount: 0, vatClaimable: false },
    ]);
    expect(created[0]).toMatchObject({ netAmount: 3306.25, inputVAT: null, taxAmount: 354.24, inputVATCategory: null, vatClaimable: false });
    expect(created[1]).toMatchObject({ netAmount: 887.96, inputVATCategory: null, vatClaimable: false });
  });

  it("a delivery receipt with no TIN becomes one posted, flagged record (U6-A2: D35, D28)", async () => {
    const { svc, created } = build(clientRow(CLIENT_VAT, "VAT"));
    const buf = await makeFile(clientRow(CLIENT_VAT, "VAT"), [DELIVERY_NO_TIN]);
    const res = await svc.importFile(actor, CLIENT_VAT, upload(buf), false);
    expect(res.rows[0]!).toMatchObject({ outcome: "posted", needsReview: true, messages: [expect.stringMatching(/no Vendor TIN/i)] });
    expect(res.rows[0]!.messages).toHaveLength(1);
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({ status: "posted", needsReview: true, vendorTin: null, netAmount: 500, vatClaimable: false, documentType: "DELIVERY_RECEIPT", deductible: true });
    // The classification is reported in the response and the audit row, never stored on the record.
    expect(created[0]).not.toHaveProperty("classification");
    expect(res.totals).toEqual({ rows: 1, posted: 1, held: 0, rejected: 0, grossAmount: 500 });
  });

  it("Needs Review = Y posts the row with the flag and remarks kept (D27)", async () => {
    const { svc, created } = build(clientRow(CLIENT_VAT, "VAT"));
    const buf = await makeFile(clientRow(CLIENT_VAT, "VAT"), [{ ...SUPERMARKET, "Needs Review": "Y", Remarks: "receipt is faded" }]);
    const res = await svc.importFile(actor, CLIENT_VAT, upload(buf), false);
    expect(res.rows[0]!).toMatchObject({ outcome: "posted", needsReview: true });
    expect(created[0]).toMatchObject({ status: "posted", needsReview: true, remarks: "receipt is faded" });
  });
});

describe("importer: duplicates (R6) and the dry run", () => {
  it("two identical rows in one file: the second is rejected naming the first", async () => {
    const { svc, created } = build(clientRow(CLIENT_VAT, "VAT"));
    const buf = await makeFile(clientRow(CLIENT_VAT, "VAT"), [SUPERMARKET, SUPERMARKET]);
    const res = await svc.importFile(actor, CLIENT_VAT, upload(buf), false);
    expect(res.rows[0]!.outcome).toBe("posted");
    expect(res.rows[1]!).toMatchObject({ outcome: "rejected", messages: [expect.stringMatching(/duplicate of row 2 in this file/i)] });
    expect(created).toHaveLength(2);
  });

  it("a row whose vendor TIN and reference already exist for this client is rejected naming the record", async () => {
    const existing = [{ id: "old-1", clientId: CLIENT_VAT, vendorTin: "000222333", referenceNo: "00000000000000000012345" }];
    const { svc, created } = build(clientRow(CLIENT_VAT, "VAT"), existing);
    const buf = await makeFile(clientRow(CLIENT_VAT, "VAT"), [SUPERMARKET]);
    const res = await svc.importFile(actor, CLIENT_VAT, upload(buf), false);
    expect(res.rows[0]!).toMatchObject({ outcome: "rejected", messages: [expect.stringContaining("old-1")] });
    expect(created).toHaveLength(0);
  });

  it("dryRun reports the same outcomes with null ids and writes nothing", async () => {
    const h = build(clientRow(CLIENT_VAT, "VAT"));
    const buf = await makeFile(clientRow(CLIENT_VAT, "VAT"), [SUPERMARKET, DELIVERY_NO_TIN]);
    const res = await h.svc.importFile(actor, CLIENT_VAT, upload(buf), true);
    expect(res.rows.map((r) => r.outcome)).toEqual(["posted", "posted"]); // U6-A2: the slip posts
    expect(res.rows.flatMap((r) => r.records.map((x) => x.id))).toEqual([null, null, null]);
    expect(h.created).toHaveLength(0);
    expect((h.prisma.$transaction as jest.Mock)).not.toHaveBeenCalled();
    expect(h.audit.record).not.toHaveBeenCalled();
  });

  it("a real run writes one audit row per record and one per batch with the counts", async () => {
    const h = build(clientRow(CLIENT_VAT, "VAT"));
    const buf = await makeFile(clientRow(CLIENT_VAT, "VAT"), [SUPERMARKET, DELIVERY_NO_TIN]);
    await h.svc.importFile(actor, CLIENT_VAT, upload(buf), false);
    const actions = h.audit.record.mock.calls.map((c) => c[0].action);
    expect(actions.filter((a) => a === "purchase.import.record")).toHaveLength(3);
    const batch = h.audit.record.mock.calls.map((c) => c[0]).find((e) => e.action === "purchase.import.batch");
    expect(batch?.metadata).toMatchObject({ clientId: CLIENT_VAT, fileName: "expenses.xlsx", totals: { rows: 2, posted: 2, held: 0, rejected: 0 } });
  });
});

describe("importer: a non-VAT client cannot be given a VAT-registered row by mistake", () => {
  it("the regime validator still runs on every part", async () => {
    const h = build(clientRow(CLIENT_NONVAT, "PERCENTAGE"));
    // Force the validator path: a PERCENTAGE client never gets an inputVATCategory.
    const buf = await makeFile(clientRow(CLIENT_NONVAT, "PERCENTAGE"), [SUPERMARKET]);
    const res = await h.svc.importFile(actor, CLIENT_NONVAT, upload(buf), false);
    expect(res.rows[0]!.outcome).toBe("posted");
    expect(h.created.every((c) => c.inputVATCategory === null && c.inputVAT === null)).toBe(true);
  });
});

describe("postHeld", () => {
  it("is exercised in the db-spec; here only the 409 contract on a posted record", async () => {
    const h = build(clientRow(CLIENT_VAT, "VAT"));
    (h.prisma.purchaseTransaction as { findFirst: jest.Mock }).findFirst = jest.fn(async () => ({ id: "x", clientId: CLIENT_VAT, status: "posted", account: "Test Office Supplies" }));
    await expect(h.svc.postHeld(actor, "x")).rejects.toThrow(ConflictException);
  });
  it("refuses to post a held record that still has no account (R4)", async () => {
    const h = build(clientRow(CLIENT_VAT, "VAT"));
    (h.prisma.purchaseTransaction as { findFirst: jest.Mock }).findFirst = jest.fn(async () => ({ id: "x", clientId: CLIENT_VAT, status: "held", account: null }));
    await expect(h.svc.postHeld(actor, "x")).rejects.toThrow(BadRequestException);
  });
});

// ---------------------------------------------------------------------------
// U6-A2 — document type decides nothing (D35); nothing non-deductible (D36);
// reference optional (D37). Written before the amendment: seen to fail.
// ---------------------------------------------------------------------------

describe("U6-A2 T2: what posts, what is held, nothing non-deductible", () => {
  it("a row with Document Type blank posts; documentType is stored null", async () => {
    const { svc, created } = build(clientRow(CLIENT_VAT, "VAT"));
    const buf = await makeFile(clientRow(CLIENT_VAT, "VAT"), [{ ...SUPERMARKET, "Document Type": undefined }]);
    const res = await svc.importFile(actor, CLIENT_VAT, upload(buf), false);
    expect(res.rows[0]!).toMatchObject({ outcome: "posted", messages: [] });
    expect(created[0]).toMatchObject({ status: "posted", documentType: null });
  });

  it('a row with Document Type "Delivery Receipt" and a reference posts, stored as its code', async () => {
    const { svc, created } = build(clientRow(CLIENT_VAT, "VAT"));
    const buf = await makeFile(clientRow(CLIENT_VAT, "VAT"), [{ ...SUPERMARKET, "Document Type": "Delivery Receipt" }]);
    const res = await svc.importFile(actor, CLIENT_VAT, upload(buf), false);
    expect(res.rows[0]!).toMatchObject({ outcome: "posted", messages: [] });
    expect(created[0]).toMatchObject({ status: "posted", documentType: "DELIVERY_RECEIPT" });
  });

  it('a row with Document Type "Sales Invoice" and no reference posts', async () => {
    const { svc, created } = build(clientRow(CLIENT_VAT, "VAT"));
    const buf = await makeFile(clientRow(CLIENT_VAT, "VAT"), [{ ...SUPERMARKET, "Document Type": "Sales Invoice", "Reference Number": undefined }]);
    const res = await svc.importFile(actor, CLIENT_VAT, upload(buf), false);
    expect(res.rows[0]!).toMatchObject({ outcome: "posted", messages: [] });
    expect(created[0]).toMatchObject({ status: "posted", referenceNo: null, documentType: "SALES_INVOICE" });
  });

  it("a blank COA Code is the only held outcome left", async () => {
    const { svc, created } = build(clientRow(CLIENT_VAT, "VAT"));
    const buf = await makeFile(clientRow(CLIENT_VAT, "VAT"), [
      { ...SUPERMARKET, "Document Type": "DELIVERY_RECEIPT", "Reference Number": undefined },  // formerly held (doc type)
      { ...SUPERMARKET, "Document Type": "CASH_SLIP", "Vendor TIN": undefined, "Reference Number": "CS-1" }, // formerly held (doc type), no TIN
      { ...SUPERMARKET, "Document Type": undefined, "Reference Number": "NO-DOC-1" },
      { ...SUPERMARKET, "COA Code": undefined, "Reference Number": "BLANK-COA-1" },                // still held
    ]);
    const res = await svc.importFile(actor, CLIENT_VAT, upload(buf), false);
    expect(res.rows.map((r) => r.outcome)).toEqual(["posted", "posted", "posted", "held"]);
    expect(res.rows[1]!).toMatchObject({ needsReview: true, messages: [expect.stringMatching(/no Vendor TIN/i)] });
    expect(res.rows[3]!.messages).toEqual([expect.stringMatching(/COA Code is blank/i)]);
    expect(created.filter((c) => c.status === "held").every((c) => c.account === null)).toBe(true);
    expect(res.totals).toMatchObject({ rows: 4, posted: 3, held: 1, rejected: 0 });
  });

  it("no row anywhere gets deductible = false — not even on an account named 'Personal'", async () => {
    const { svc, created } = build(clientRow(CLIENT_VAT, "VAT"));
    const buf = await makeFile(clientRow(CLIENT_VAT, "VAT"), [
      { ...SUPERMARKET, "COA Code": "5999002" },                                   // "Owner's Personal Expenses"
      { ...SUPERMARKET, "COA Code": "5999001", "Reference Number": "R-2" },
      { ...DELIVERY_NO_TIN, "COA Code": "5999002" },
      { ...SUPERMARKET, "COA Code": undefined, "Reference Number": "R-4" },         // held, still deductible
    ]);
    await svc.importFile(actor, CLIENT_VAT, upload(buf), false);
    expect(created.length).toBeGreaterThan(0);
    expect(created.every((c) => c.deductible === true)).toBe(true);
  });
});

describe("U6-A2 T3: the template carries no personal marker and describes the one hold reason", () => {
  let wb: ExcelJS.Workbook;
  beforeAll(async () => {
    const buf = await buildExpenseTemplate({
      client: { id: CLIENT_VAT, tin: "000111222", branch: "00000", businessName: "Invented VAT Trading Co", regimeLabel: "VAT-registered" },
      accounts: classifyAccounts(ACCOUNTS),
    });
    wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
  });
  const sheetText = (name: string): string => {
    const out: string[] = [];
    wb.getWorksheet(name)!.eachRow((r) => r.eachCell((c) => out.push(String(c.value ?? ""))));
    return out.join("\n");
  };

  it("has no ★ on any sheet", () => {
    for (const ws of wb.worksheets) expect(sheetText(ws.name)).not.toContain("★");
  });

  it('Instructions mention neither "personal" nor "non-deductible" nor "official invoice"', () => {
    const text = sheetText(SHEET.INSTRUCTIONS).toLowerCase();
    expect(text).not.toMatch(/personal/);
    expect(text).not.toMatch(/non-?deductible/);
    expect(text).not.toMatch(/official invoice/);
  });

  it("Instructions say a row is held only when the COA Code is blank", () => {
    expect(sheetText(SHEET.INSTRUCTIONS)).toMatch(/held only when .*COA Code.* blank|only .*COA Code is blank.* held/i);
  });

  it("the REFERENCE sheet's Document Type list is unchanged in content", () => {
    const codes: string[] = [];
    wb.getWorksheet(SHEET.REFERENCE)!.eachRow((r) => {
      const v = String(r.getCell(1).value ?? "");
      if (DOCUMENT_TYPES.some((d) => d.code === v)) codes.push(v);
    });
    expect(codes).toEqual([
      "SALES_INVOICE", "SERVICE_INVOICE", "OFFICIAL_RECEIPT", "DELIVERY_RECEIPT", "ACKNOWLEDGEMENT_RECEIPT",
      "COLLECTION_RECEIPT", "BILLING_STATEMENT", "PROVISIONAL_RECEIPT", "CASH_SLIP", "OTHER",
    ]);
  });

  it("the COA sheet has six columns and the 'Personal'-named account is an ordinary allowed account", () => {
    const coa = wb.getWorksheet(SHEET.COA)!;
    expect((coa.getRow(1).values as unknown[]).slice(1)).toEqual(["Code", "Account Name", "Class", "Account Type", "Use for", "Allowed on expense rows"]);
    const rows: Record<string, string[]> = {};
    coa.eachRow((r, n) => { if (n > 1) rows[String(r.getCell(1).value)] = (r.values as unknown[]).slice(1).map((v) => String(v ?? "")); });
    expect(rows["5999002"]).toEqual(["5999002", "Owner's Personal Expenses", "Expense", "Other Expense", "Expense rows.", "Y"]);
    expect(sheetText(SHEET.COA).toLowerCase()).not.toMatch(/non-?deductible/);
  });
});

