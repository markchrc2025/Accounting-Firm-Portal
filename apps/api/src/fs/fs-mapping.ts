// COA → financial-statement caption mapping layer (pure).
//
// In "formal" presentation the face of the statements shows standard FS
// captions; each portal account maps to exactly one caption per statement
// area. System/plug accounts (opening-balance adjustments/offset, PDCs,
// OPC Owner's Equity) are NEVER printed on a formal face — they are folded
// into a caption per their nature, and a data-quality warning is emitted
// when their balance is nonzero. Unmapped accounts fall back to a caption
// by class and also warn, so the statements always tie while the log tells
// the accountant what to clean up.

import type { FsAccountMeta } from "./fs-engine";

export interface ExportWarning {
  code:
    | "system-account"
    | "unmapped-account"
    | "missing-profile-field"
    | "equity-plug"
    | "dividends-plug"
    | "notes-required";
  message: string;
}

/** BS caption ids in presentation order. */
export const BS_CAPTIONS = [
  // Current assets
  { id: "cash", label: "Cash and cash equivalents", section: "current-assets", noteKey: "cash" },
  { id: "receivables", label: "Trade and other receivables - net", section: "current-assets", noteKey: "receivables" },
  { id: "advances", label: "Advances to employees and officers", section: "current-assets", noteKey: "advances" },
  { id: "inventory", label: "Inventory", section: "current-assets", noteKey: null },
  { id: "prepaid", label: "Prepaid expenses", section: "current-assets", noteKey: null },
  { id: "vat-assets", label: "VAT and other current tax assets", section: "current-assets", noteKey: null },
  // Non-current assets
  { id: "ppe", label: "Property, plant and equipment - net", section: "noncurrent-assets", noteKey: "ppe" },
  { id: "dta", label: "Deferred tax asset", section: "noncurrent-assets", noteKey: "income-taxes" },
  { id: "other-noncurrent-assets", label: "Other non-current assets", section: "noncurrent-assets", noteKey: null },
  // Current liabilities
  { id: "payables", label: "Trade and other payables", section: "current-liabilities", noteKey: "payables" },
  { id: "statutory", label: "Accrued payroll and statutory payables", section: "current-liabilities", noteKey: "payables" },
  { id: "taxes-payable", label: "Income and other taxes payable", section: "current-liabilities", noteKey: "income-taxes" },
  { id: "vat-payable", label: "VAT payable", section: "current-liabilities", noteKey: null },
  { id: "unearned", label: "Unearned revenue", section: "current-liabilities", noteKey: null },
  { id: "loans-current", label: "Loans payable - current", section: "current-liabilities", noteKey: null },
  // Non-current liabilities
  { id: "loans-noncurrent", label: "Loans payable - non-current", section: "noncurrent-liabilities", noteKey: null },
  { id: "dtl", label: "Deferred tax liability", section: "noncurrent-liabilities", noteKey: "income-taxes" },
  // Equity
  { id: "share-capital", label: "Share capital", section: "equity", noteKey: "capital-stock" },
  { id: "apic", label: "Additional paid-in capital", section: "equity", noteKey: "capital-stock" },
  { id: "retained", label: "Retained earnings", section: "equity", noteKey: null },
] as const;

export type BsCaptionId = (typeof BS_CAPTIONS)[number]["id"];

/** IS caption ids (operating-expense captions in presentation order). */
export const IS_OPEX_CAPTIONS = [
  { id: "personnel", label: "Personnel cost" },
  { id: "gna", label: "General and administrative expenses" },
  { id: "utilities", label: "Utilities" },
  { id: "taxes-licenses", label: "Taxes and licenses" },
  { id: "depreciation", label: "Depreciation" },
  { id: "amortization", label: "Amortization" },
  { id: "bad-debt", label: "Bad debt expense" },
  { id: "fx", label: "Unrealized foreign exchange loss/(gain)" },
] as const;
export type IsOpexId = (typeof IS_OPEX_CAPTIONS)[number]["id"];

/** Cash-flow working-capital / activity bucket per BS caption. */
export type CfBucket =
  | "cash"
  | "wc-receivables"
  | "wc-advances"
  | "wc-prepaid"
  | "wc-inventory"
  | "wc-vat-assets"
  | "wc-payables"
  | "wc-statutory"
  | "wc-unearned"
  | "tax-paid" // income-tax accruals consumed by the "Income taxes paid" line
  | "inv-ppe"
  | "fin-loans"
  | "fin-capital"
  | "equity-re"; // retained earnings — replaced by net income + dividends plug

/** System accounts that must never appear on a formal face. */
const SYSTEM_ACCOUNTS: Record<string, { flag: ExportWarning["code"]; nature: string }> = {
  "2700001": { flag: "system-account", nature: "Opening Balance Adjustments → Trade and other payables" },
  "2800001": { flag: "system-account", nature: "Post-Dated Checks Issued → Trade and other payables" },
  "2901001": { flag: "system-account", nature: "Owner's Equity → Share capital" },
  "2901002": { flag: "system-account", nature: "Opening Balance Offset → Retained earnings" },
};

export interface AccountAssignment {
  bs: BsCaptionId | null; // null = P&L account
  cf: CfBucket | null;
  /** BS receivables caption nets the allowance; PPE nets accumulated dep. */
  contra: boolean;
  system: boolean;
}

const isCashName = (a: FsAccountMeta): boolean =>
  a.accountType === "Bank Accounts" || /cash|petty|undeposited|revolving fund/i.test(a.name);

/** Assign one account to its BS caption + CF bucket. Pure code-driven with
 *  name/class fallbacks; returns null for P&L accounts. */
export function assignAccount(a: FsAccountMeta): AccountAssignment | null {
  const code = a.code;
  if (a.class === "Revenue" || a.class === "Expense") return null;

  const mk = (bs: BsCaptionId, cf: CfBucket, contra = false): AccountAssignment => ({
    bs,
    cf,
    contra,
    system: code in SYSTEM_ACCOUNTS,
  });

  // --- explicit code map (the authoritative PH SME chart) --------------------
  if (isCashName(a) && a.class === "Asset" && !code.startsWith("1901") && !code.startsWith("1902"))
    return mk("cash", "cash");
  if (code === "1007") return mk("receivables", "wc-receivables");
  if (code === "1902001") return mk("receivables", "wc-receivables", true); // allowance
  if (code.startsWith("1002")) return mk("advances", "wc-advances");
  if (code === "1009") return mk("inventory", "wc-inventory");
  if (code === "1008") return mk("prepaid", "wc-prepaid");
  if (code === "8001001" || code === "8001002" || code === "9001002")
    return mk("vat-assets", "wc-vat-assets");
  if (code === "9001001") return mk("dta", "tax-paid");
  if (code.startsWith("1003") || (a.accountType === "Fixed Asset" && !code.startsWith("1901")))
    return mk("ppe", "inv-ppe");
  if (code === "1901001") return mk("ppe", "wc-payables", true); // handled as dep add-back; bucket unused
  if (code.startsWith("2001") || code.startsWith("2002") || code === "2700001" || code === "2800001")
    return mk("payables", "wc-payables");
  if (
    code.startsWith("2004") ||
    code.startsWith("2008") ||
    code.startsWith("2009") ||
    code.startsWith("2101") ||
    code === "2003003"
  )
    return mk("statutory", "wc-statutory");
  if (code === "2003002") return mk("taxes-payable", "tax-paid");
  if (code.startsWith("8002")) return mk("vat-payable", "wc-payables");
  if (code === "2600001") return mk("unearned", "wc-unearned");
  if (code === "2005") return mk("loans-current", "fin-loans");
  if (code === "2501") return mk("loans-noncurrent", "fin-loans");
  if (code === "9002001") return mk("dtl", "tax-paid");
  if (code === "2901004" || code === "2901001") return mk("share-capital", "fin-capital");
  if (code === "2901005" ) return mk("apic", "fin-capital");
  if (code === "2901002") return mk("retained", "equity-re");
  if (code === "2901003") return mk("retained", "equity-re");

  // --- fallback by class/type (unmapped → warn at call site) -----------------
  if (a.class === "Asset") {
    return /non-?current|fixed/i.test(a.accountType)
      ? mk("other-noncurrent-assets", "wc-receivables")
      : mk("receivables", "wc-receivables");
  }
  if (a.class === "Liability") {
    return /loan|borrow|debt|note payable/i.test(a.name)
      ? mk(/non-?current/i.test(a.accountType) ? "loans-noncurrent" : "loans-current", "fin-loans")
      : mk("payables", "wc-payables");
  }
  // Equity fallback
  return mk("retained", "equity-re");
}

/** True when assignAccount used a fallback rather than the explicit map. */
export function isFallbackAssignment(a: FsAccountMeta): boolean {
  const code = a.code;
  const explicit =
    (isCashName(a) && a.class === "Asset") ||
    [
      "1007", "1902001", "1009", "1008", "8001001", "8001002", "9001002", "9001001", "1901001",
      "2700001", "2800001", "2003002", "2003003", "2600001", "2005", "2501", "9002001",
      "2901001", "2901002", "2901003", "2901004", "2901005",
    ].includes(code) ||
    code.startsWith("1002") || code.startsWith("1003") ||
    code.startsWith("2001") || code.startsWith("2002") ||
    code.startsWith("2004") || code.startsWith("2008") || code.startsWith("2009") ||
    code.startsWith("2101") || code.startsWith("8002") ||
    a.accountType === "Fixed Asset";
  return !explicit && a.class !== "Revenue" && a.class !== "Expense";
}

/** IS operating-expense caption for an expense account (5xxx except below-the-
 *  line items), or null when the account is not an opex line. */
export function assignOpex(a: FsAccountMeta): IsOpexId | null {
  const code = a.code;
  if (a.class !== "Expense") return null;
  if (code.startsWith("4") || code === "5008" || code === "5004001") return null; // COS, provision, finance cost
  if (code === "5007001") return "depreciation";
  if (code === "5007002") return "bad-debt";
  if (code === "5004002") return "amortization";
  if (code === "5006") return "fx";
  if (code.startsWith("5001")) return "personnel";
  if (code.startsWith("5003")) return "utilities";
  if (code.startsWith("5005")) return "taxes-licenses";
  return "gna"; // 5002xxx and anything else
}

export function systemAccountWarning(a: FsAccountMeta, balance: number): ExportWarning | null {
  const sys = SYSTEM_ACCOUNTS[a.code];
  if (!sys || balance === 0) return null;
  return {
    code: sys.flag,
    message:
      `System account ${a.code} (${a.name}) has a nonzero balance of ${balance.toFixed(2)}; ` +
      `mapped per its nature (${sys.nature}) and kept off the formal face. Review and reclassify.`,
  };
}
