// PH SME Chart of Accounts + BIR income-tax mapping — xlsx parsing, field
// derivation, and convention validation.
//
// The xlsx files under prisma/data/ are the SINGLE SOURCE OF TRUTH: account
// lists are never hardcoded here — only the conventions that every account must
// satisfy. Changing the files and re-seeding updates the app without code
// changes; violating a convention fails loudly, naming the offending code.
//
// Conventions enforced (see validateChartOfAccounts / validateTaxMappings):
//   - Codes are 4-digit (top-level) or 7-digit (sub-account; first 4 digits are
//     the parent GROUP code — a grouping key, not a posting account).
//   - Code prefix ↔ class: 1xxx Asset · 2xxx Liability with the Equity block
//     exactly at 2901xxx · 3xxx Revenue · 4xxx/5xxx Expense · 8xxx (VAT) and
//     9xxx (deferred/creditable tax) Asset or Liability.
//   - Normal balance: Asset/Expense debit; Liability/Equity/Revenue credit —
//     except the contra accounts 1901001 & 1902001 (credit) and 3901001 (debit).
//   - Currency is PHP on every account.
//   - Every P&L posting account is mapped to a BIR tax-return line, or is in
//     the allowed-unmapped set {4001, 4002, 5008}.

import * as fs from "fs";
import * as XLSX from "xlsx";

export type NormalBalance = "debit" | "credit";

export interface CoaAccount {
  code: string;
  name: string;
  class: string; // Asset | Liability | Equity | Revenue | Expense
  accountType: string;
  parentCode: string | null; // derived: 7-digit codes → first 4 digits
  normalBalance: NormalBalance; // derived: class rule + contra exceptions
  currency: string;
  lockDate: string | null; // ISO yyyy-mm-dd
  monthlyMovement: boolean;
  description: string | null;
  /** Soft-deleted accounts keep their row but are exempt from P&L coverage. */
  archived?: boolean;
}

export interface CoaTaxMapping {
  accountCode: string;
  taxCategory: string; // blank in the file normalises to "Regular"
  accountName: string;
  taxReturnLine: string | null; // null = intentionally unmapped
}

export const COA_CLASSES = ["Asset", "Liability", "Equity", "Revenue", "Expense"] as const;
export const PL_CLASSES = ["Revenue", "Expense"] as const;

/** The equity block lives at 2901xxx (inside the 2xxx liability range). */
export const EQUITY_GROUP_PREFIX = "2901";

/** Contra accounts: normal balance opposite their class. */
export const CONTRA_NORMAL_BALANCE: Readonly<Record<string, NormalBalance>> = {
  "1901001": "credit", // Accumulated Depreciation
  "1902001": "credit", // Allowance for Doubtful Accounts
  "3901001": "debit", // Sales Returns, Allowances and Discounts
};

/** P&L accounts allowed to have no BIR tax-return line: 4001/4002 belong to the
 *  Cost of Sales section; 5008 (Provision for Income Tax) is below the line. */
export const ALLOWED_UNMAPPED_PL = ["4001", "4002", "5008"] as const;

const DEBIT_CLASSES = new Set(["Asset", "Expense"]);

/** Class rule + contra exceptions → the account's expected normal balance. */
export function expectedNormalBalance(cls: string, code: string): NormalBalance {
  const contra = CONTRA_NORMAL_BALANCE[code];
  if (contra) return contra;
  return DEBIT_CLASSES.has(cls) ? "debit" : "credit";
}

/** 7-digit sub-account → its 4-digit group code; 4-digit top-level → null. */
export function derivedParentCode(code: string): string | null {
  return /^\d{7}$/.test(code) ? code.slice(0, 4) : null;
}

// ------------------------------------------------------------------- parsing

type Row = Record<string, unknown>;

function text(v: unknown): string {
  return v === null || v === undefined ? "" : String(v).trim();
}

/** Yes/No/1/0/true/false → boolean (blank → false). */
function toBool(v: unknown): boolean {
  const s = text(v).toLowerCase();
  return s === "1" || s === "yes" || s === "y" || s === "true";
}

/** Excel serial / Date / string → ISO yyyy-mm-dd, or null when blank. Date
 *  instances are formatted from their LOCAL parts: SheetJS (cellDates: true)
 *  builds local-calendar dates, so UTC formatting could shift a day westward. */
function toIsoDate(v: unknown): string | null {
  if (v === null || v === undefined || v === "") return null;
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    const m = String(v.getMonth() + 1).padStart(2, "0");
    const d = String(v.getDate()).padStart(2, "0");
    return `${v.getFullYear()}-${m}-${d}`;
  }
  if (typeof v === "number" && Number.isFinite(v)) {
    const d = new Date(Math.round((v - 25569) * 86400 * 1000));
    return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
  }
  const s = text(v);
  return s === "" ? null : s.slice(0, 10);
}

/** First sheet named `preferred` (trimmed match), else the workbook's first. */
function pickSheet(wb: XLSX.WorkBook, preferred: string): XLSX.WorkSheet {
  const byName = wb.SheetNames.find((n) => n.trim().toLowerCase() === preferred.toLowerCase());
  const name = byName ?? wb.SheetNames[0];
  const sheet = name ? wb.Sheets[name] : undefined;
  if (!sheet) throw new Error(`No readable sheet in workbook (wanted "${preferred}").`);
  return sheet;
}

function readRows(filePath: string, preferredSheet: string, requiredHeaders: string[]): Row[] {
  const wb = XLSX.read(fs.readFileSync(filePath), { type: "buffer", cellDates: true });
  const sheet = pickSheet(wb, preferredSheet);
  // Validate against the header ROW itself (header: 1), not the keyed rows —
  // a well-formed sheet with zero data rows must still pass the header check
  // so its emptiness surfaces as convention violations naming account codes.
  const headerRow = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1 })[0] ?? [];
  const headers = new Set(headerRow.map((h) => String(h ?? "").trim()));
  const missing = requiredHeaders.filter((h) => !headers.has(h));
  if (missing.length > 0) {
    throw new Error(
      `${filePath}: expected sheet "${preferredSheet}" with headers ` +
        `[${requiredHeaders.join(", ")}]; missing [${missing.join(", ")}].`,
    );
  }
  return XLSX.utils.sheet_to_json<Row>(sheet, { defval: "", raw: true });
}

/** Header-keyed cell lookup tolerant of stray whitespace in header names. */
function cell(row: Row, header: string): unknown {
  if (header in row) return row[header];
  const key = Object.keys(row).find((k) => k.trim() === header);
  return key === undefined ? "" : row[key];
}

/** Fail loudly on a row that has data but no Code (a silent drop would hide a
 *  half-deleted account in the source file); fully-blank rows are just noise. */
function requireCodes(rows: Row[], filePath: string): Row[] {
  const kept: Row[] = [];
  rows.forEach((r, i) => {
    const hasData = Object.values(r).some((v) => text(v) !== "");
    if (!hasData) return; // trailing empty row — skip
    if (text(cell(r, "Code")) === "") {
      throw new Error(
        `${filePath}: row ${i + 2} has data but a blank Code — fix or clear the row.`,
      );
    }
    kept.push(r);
  });
  return kept;
}

/** Parse Chart_of_Accounts_Import.xlsx (sheet "Accounts", or the first sheet). */
export function parseChartOfAccounts(filePath: string): CoaAccount[] {
  const rows = readRows(filePath, "Accounts", ["Code", "Name", "Class", "Account Type"]);
  return requireCodes(rows, filePath)
    .map((r) => {
      const code = text(cell(r, "Code"));
      const cls = text(cell(r, "Class"));
      return {
        code,
        name: text(cell(r, "Name")),
        class: cls,
        accountType: text(cell(r, "Account Type")),
        parentCode: derivedParentCode(code),
        normalBalance: expectedNormalBalance(cls, code),
        currency: text(cell(r, "Currency")) || "PHP",
        lockDate: toIsoDate(cell(r, "Lock Date")),
        monthlyMovement: toBool(cell(r, "Monthly Movement")),
        description: text(cell(r, "Description")) || null,
      };
    });
}

/** Parse BIR_Income_Tax_Mapping.xlsx (sheet "BIR Income Tax", or the first).
 *  Blank Tax Category normalises to "Regular"; blank Tax Return Line → null
 *  (the intentionally-unmapped rows keep a row so the set stays documented). */
export function parseBirTaxMapping(filePath: string): CoaTaxMapping[] {
  const rows = readRows(filePath, "BIR Income Tax", ["Name", "Code", "Tax Return Line"]);
  return requireCodes(rows, filePath)
    .map((r) => ({
      accountCode: text(cell(r, "Code")),
      taxCategory: text(cell(r, "Tax Category")) || "Regular",
      accountName: text(cell(r, "Name")),
      taxReturnLine: text(cell(r, "Tax Return Line")) || null,
    }));
}

// ---------------------------------------------------------------- validation

/** Class required for a code by the numbering scheme, or an explanation of the
 *  allowed set when more than one class is permitted (8xxx/9xxx). */
function prefixRule(code: string): { allowed: string[]; label: string } {
  if (code.startsWith(EQUITY_GROUP_PREFIX)) {
    return { allowed: ["Equity"], label: `${EQUITY_GROUP_PREFIX}xxx equity block` };
  }
  switch (code[0]) {
    case "1":
      return { allowed: ["Asset"], label: "1xxx assets" };
    case "2":
      return { allowed: ["Liability"], label: "2xxx liabilities" };
    case "3":
      return { allowed: ["Revenue"], label: "3xxx income" };
    case "4":
      return { allowed: ["Expense"], label: "4xxx cost of sales" };
    case "5":
      return { allowed: ["Expense"], label: "5xxx expenses" };
    case "8":
      return { allowed: ["Asset", "Liability"], label: "8xxx VAT accounts" };
    case "9":
      return { allowed: ["Asset", "Liability"], label: "9xxx deferred/creditable tax" };
    default:
      return { allowed: [], label: "unassigned code range" };
  }
}

/** Every convention violation in the chart, each message naming the code. */
export function validateChartOfAccounts(accounts: CoaAccount[]): string[] {
  const errors: string[] = [];
  const seen = new Map<string, number>();
  for (const a of accounts) seen.set(a.code, (seen.get(a.code) ?? 0) + 1);
  for (const [code, n] of seen) {
    if (n > 1) errors.push(`Account ${code}: duplicate code (${n} rows).`);
  }

  for (const a of accounts) {
    const where = `Account ${a.code} (${a.name})`;

    if (!/^\d{4}$/.test(a.code) && !/^\d{7}$/.test(a.code)) {
      errors.push(`${where}: code must be 4 digits (top-level) or 7 digits (sub-account).`);
      continue; // prefix/parent rules are meaningless on a malformed code
    }

    if (!(COA_CLASSES as readonly string[]).includes(a.class)) {
      errors.push(`${where}: unknown class "${a.class}".`);
    }

    const rule = prefixRule(a.code);
    if (rule.allowed.length === 0) {
      errors.push(`${where}: code prefix "${a.code[0]}" is not in the numbering scheme.`);
    } else if (!rule.allowed.includes(a.class)) {
      errors.push(
        `${where}: class "${a.class}" conflicts with ${rule.label} ` +
          `(expected ${rule.allowed.join(" or ")}).`,
      );
    }
    // The equity block must hold ALL equity: Equity outside 2901xxx is a breach.
    if (a.class === "Equity" && !a.code.startsWith(EQUITY_GROUP_PREFIX)) {
      errors.push(`${where}: Equity accounts must live in the ${EQUITY_GROUP_PREFIX}xxx block.`);
    }

    const expectedBalance = expectedNormalBalance(a.class, a.code);
    if (a.normalBalance !== expectedBalance) {
      const contra = CONTRA_NORMAL_BALANCE[a.code] ? " (contra account)" : "";
      errors.push(
        `${where}: normal balance "${a.normalBalance}" should be "${expectedBalance}"${contra}.`,
      );
    }

    if (a.currency !== "PHP") {
      errors.push(`${where}: currency must be PHP (found "${a.currency}").`);
    }

    // A malformed Lock Date would otherwise become an Invalid Date and crash
    // the seeder mid-upsert; validating here keeps the failure loud and atomic.
    if (
      a.lockDate !== null &&
      (!/^\d{4}-\d{2}-\d{2}$/.test(a.lockDate) || Number.isNaN(Date.parse(a.lockDate)))
    ) {
      errors.push(`${where}: lock date "${a.lockDate}" is not a valid yyyy-mm-dd date.`);
    }

    const expectedParent = derivedParentCode(a.code);
    if (a.parentCode !== expectedParent) {
      errors.push(
        `${where}: parentCode "${a.parentCode ?? "null"}" should be ` +
          `"${expectedParent ?? "null"}" (7-digit prefix rule).`,
      );
    }
  }

  // Parent group codes are HEADERS, not posting accounts: a 4-digit posting
  // account that is simultaneously the prefix of 7-digit sub-accounts would
  // double-count in rollups, so the collision fails loudly.
  const groupPrefixes = new Map<string, string>(); // prefix → first child code
  for (const a of accounts) {
    const parent = derivedParentCode(a.code);
    if (parent && !groupPrefixes.has(parent)) groupPrefixes.set(parent, a.code);
  }
  for (const a of accounts) {
    if (/^\d{4}$/.test(a.code) && groupPrefixes.has(a.code)) {
      errors.push(
        `Account ${a.code} (${a.name}): is a posting account AND the parent group of ` +
          `sub-account ${groupPrefixes.get(a.code)} — group codes must not be posting accounts.`,
      );
    }
  }
  return errors;
}

/** Mapping-coverage violations: every P&L account mapped or allowed-unmapped;
 *  mapping rows must reference existing P&L accounts; no duplicate keys. */
export function validateTaxMappings(
  accounts: CoaAccount[],
  mappings: CoaTaxMapping[],
): string[] {
  const errors: string[] = [];
  const byCode = new Map(accounts.map((a) => [a.code, a]));
  const allowedUnmapped = new Set<string>(ALLOWED_UNMAPPED_PL);

  const seen = new Set<string>();
  for (const m of mappings) {
    const key = `${m.accountCode}|${m.taxCategory}`;
    if (seen.has(key)) {
      errors.push(`Mapping ${m.accountCode} [${m.taxCategory}]: duplicate mapping row.`);
    }
    seen.add(key);

    // This dataset is keyed on Tax Category "Regular" (blanks normalise to it);
    // any other category is a typo that would slip past the coverage check.
    if (m.taxCategory !== "Regular") {
      errors.push(
        `Mapping ${m.accountCode} (${m.accountName}): tax category "${m.taxCategory}" ` +
          `is not supported — expected "Regular".`,
      );
    }

    const account = byCode.get(m.accountCode);
    if (!account) {
      errors.push(`Mapping ${m.accountCode} (${m.accountName}): no such account in the chart.`);
      continue;
    }
    if (!(PL_CLASSES as readonly string[]).includes(account.class)) {
      errors.push(
        `Mapping ${m.accountCode} (${m.accountName}): account is ${account.class}, ` +
          `but BIR income-tax lines only apply to P&L (Revenue/Expense) accounts.`,
      );
    }
    if (m.taxReturnLine === null && !allowedUnmapped.has(m.accountCode)) {
      errors.push(
        `Mapping ${m.accountCode} (${m.accountName}): blank Tax Return Line is only ` +
          `allowed for {${ALLOWED_UNMAPPED_PL.join(", ")}}.`,
      );
    }
  }

  const mappedWithLine = new Set(
    mappings.filter((m) => m.taxReturnLine !== null).map((m) => m.accountCode),
  );
  for (const a of accounts) {
    if (!(PL_CLASSES as readonly string[]).includes(a.class)) continue;
    if (a.archived) continue; // archived accounts don't require a mapping
    if (mappedWithLine.has(a.code) || allowedUnmapped.has(a.code)) continue;
    errors.push(
      `Account ${a.code} (${a.name}): P&L account has no BIR tax-return line and is ` +
        `not in the allowed-unmapped set {${ALLOWED_UNMAPPED_PL.join(", ")}}.`,
    );
  }
  return errors;
}

/** Throw a single loud error aggregating every violation. */
export function assertValid(errors: string[], context: string): void {
  if (errors.length === 0) return;
  throw new Error(
    `${context}: ${errors.length} convention violation(s):\n - ${errors.join("\n - ")}`,
  );
}
