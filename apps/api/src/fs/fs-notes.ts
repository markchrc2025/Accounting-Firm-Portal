// Notes to Financial Statements — the disclosure engine (pure, Prisma-free).
//
// Three layers assemble into one numbered document:
//   1. Front-matter narrative — a firm-wide POLICY_LIBRARY keyed by reporting
//      framework, with {{merge tokens}} filled from the report's entity facts.
//      Seeded here from the sample PFRS-for-Small-Entities notes; the accountant
//      toggles or overrides blocks per report.
//   2. Account notes — numeric breakdowns generated from the trial balance
//      (cash, receivables, PPE, debt, equity), one column per period.
//   3. Custom notes — free text the accountant adds per report.
//
// The service merges these and numbers them 1..N.

import { round2 } from "@portal/shared";
import { adjustedBalances, classSign, type FsEngineInput, type FsAccountMeta } from "./fs-engine";

export interface PolicyBlock {
  key: string;
  title: string;
  body: string; // paragraphs separated by blank lines; may contain {{tokens}}
}

/** Merge context built from an FsReport. */
export interface NoteMergeContext {
  entityName: string;
  secRegistrationNo: string | null;
  registeredAddress: string | null;
  businessDescription: string | null;
  framework: string;
  functionalCurrency: string;
  approvalDate: string | null;
  periodLabels: string[]; // newest first
}

/** Replace {{token}} with the context value, or a visible [placeholder] the
 *  accountant can spot and fill when a field wasn't captured. */
export function renderTokens(text: string, ctx: NoteMergeContext): string {
  const map: Record<string, string> = {
    entityName: ctx.entityName || "[Entity name]",
    secRegistrationNo: ctx.secRegistrationNo || "[SEC Registration No.]",
    registeredAddress: ctx.registeredAddress || "[registered address]",
    businessDescription: ctx.businessDescription || "[principal business activity]",
    framework: ctx.framework,
    functionalCurrency: ctx.functionalCurrency || "Philippine Peso (₱)",
    approvalDate: ctx.approvalDate || "[BOD approval date]",
    currentPeriodLabel: ctx.periodLabels[0] ?? "[current period]",
    priorPeriodLabel: ctx.periodLabels[1] ?? "[prior period]",
    periodLabels: ctx.periodLabels.join(" and ") || "[reporting periods]",
  };
  return text.replace(/\{\{(\w+)\}\}/g, (_, k: string) => map[k] ?? `{{${k}}}`);
}

const SMALL_ENTITIES: PolicyBlock[] = [
  {
    key: "corporate-information",
    title: "Corporate Information",
    body: `{{entityName}} (the "Company") is registered with the Philippine Securities and Exchange Commission (SEC) under Registration No. {{secRegistrationNo}}. The Company's principal business activity is {{businessDescription}}.

The registered office address of the Company is at {{registeredAddress}}.

The financial statements were approved and authorized for issuance by the Board of Directors on {{approvalDate}}.`,
  },
  {
    key: "basis-of-preparation",
    title: "Basis of Preparation",
    body: `Statement of Compliance. The accompanying financial statements have been prepared in compliance with the {{framework}}, as approved by the Financial and Sustainability Reporting Standards Council and adopted by the SEC.

Basis of Measurement. The financial statements have been prepared on the historical cost basis. All values are rounded to the nearest Peso unless otherwise indicated.

Functional and Presentation Currency. The financial statements are presented in {{functionalCurrency}}, which is also the Company's functional currency.`,
  },
  {
    key: "significant-accounting-policies",
    title: "Significant Accounting Policies",
    body: `Financial Instruments. A financial instrument is recognized when the Company becomes a party to the contractual provisions of the instrument. The Company's basic financial instruments comprise cash, trade receivables and other payables, initially measured at the transaction price and subsequently at amortized cost less any impairment.

Impairment of Financial Instruments. At the end of each reporting period the Company assesses whether there is objective evidence of impairment; any impairment loss is recognized in profit or loss immediately.

Cash. Cash includes cash on hand and unrestricted cash in bank, stated at face value.

Trade and Other Receivables. Trade and other receivables are recognized initially at the transaction price and classified as current assets when expected to be realized within one year or the normal operating cycle; otherwise they are classified as non-current.

Prepaid Taxes. Prepaid taxes represent amounts paid in excess of the current income tax due and are deducted from income tax payable; they are carried at cost subject to impairment.

Other Noncurrent Assets. Other noncurrent assets, including advance rentals and security deposits, are recognized when future economic benefits are expected and the amount can be reliably measured.

Other Payables. Other payables are recognized at the transaction price and classified as current liabilities except for maturities greater than 12 months after the reporting period.

Related Parties. Parties are considered related if one has the ability, directly or indirectly, to control the other or exercise significant influence over it in making financial and operating decisions.

Capital Stock. Common shares are classified as equity. Incremental costs directly attributable to the issue of shares are recognized as a deduction from equity, net of tax.

Retained Earnings. Retained earnings (accumulated losses) represent the accumulated net income or losses, net of any dividend distributions and other capital adjustments.

Revenue Recognition. Revenue is measured at the fair value of the consideration received or receivable and recognized when it is probable that economic benefits will flow to the Company and the amount can be reliably measured. Revenue from services is recognized when the service is rendered. Interest income is recognized on a time-proportion basis using the effective interest method.

Cost and Expense Recognition. Costs and expenses are recognized on the accrual basis when incurred. Cost of services represents expenses associated with the rendering of services; operating expenses are costs attributable to administrative and other business activities.

Taxes. Current tax is the expected tax payable on the taxable income for the period using enacted or substantively enacted rates. Deferred tax is recognized on temporary differences using the liability method and measured at the rates expected to apply when the asset is realized or the liability settled.

Provisions. Provisions are recognized when a present legal or constructive obligation exists that will probably require an outflow of resources and can be reliably estimated, measured at the best estimate of the expenditure required to settle the obligation.

Contingencies. Contingent liabilities are not recognized but are disclosed unless the possibility of an outflow is remote; contingent assets are disclosed when an inflow of economic benefits is probable.

Events After the Reporting Date. Post year-end events that provide evidence of conditions at the reporting date (adjusting events) are reflected in the financial statements; non-adjusting events are disclosed when material.`,
  },
];

/** Disclosure library keyed by reporting framework. Frameworks without a bespoke
 *  library fall back to the Small Entities set (the accountant can override). */
export const POLICY_LIBRARY: Record<string, PolicyBlock[]> = {
  "PFRS for Small Entities": SMALL_ENTITIES,
  "PFRS for SMEs": SMALL_ENTITIES,
  "Full PFRS": SMALL_ENTITIES,
};

export function policyBlocksFor(framework: string): PolicyBlock[] {
  return POLICY_LIBRARY[framework] ?? SMALL_ENTITIES;
}

// --------------------------------------------------------------- account notes

export interface FsNoteTableRow {
  label: string;
  amounts: Record<string, number>;
  emphasis?: boolean;
}

export interface FsNoteSection {
  key: string;
  kind: "policy" | "account" | "custom";
  title: string;
  paragraphs?: string[];
  table?: { rows: FsNoteTableRow[] };
}

const isCashAccount = (a: FsAccountMeta): boolean =>
  a.accountType === "Bank Accounts" || /cash|petty|undeposited|revolving fund/i.test(a.name);
const isFixedAsset = (a: FsAccountMeta): boolean => a.accountType === "Fixed Asset";
const isAccumDep = (a: FsAccountMeta): boolean =>
  /accumulated depreciation/i.test(a.name) || a.code.startsWith("1901");
const isReceivable = (a: FsAccountMeta): boolean =>
  /receivable|allowance for doubtful/i.test(a.name) ||
  /receivable/i.test(a.parentName ?? "");
const isDebt = (a: FsAccountMeta): boolean => /loan|borrow|debt|note payable/i.test(a.name);

/** Build the numeric account notes from the trial balance, one column per
 *  period. Present each account in its class's natural direction (contras net). */
export function buildAccountNotes(input: FsEngineInput): FsNoteSection[] {
  const periods = [...input.periods].sort((a, b) => a.sortOrder - b.sortOrder);
  const balances = adjustedBalances({ ...input, periods });

  const presentRow = (label: string, accts: FsAccountMeta[], emphasis = false): FsNoteTableRow => {
    const amounts: Record<string, number> = {};
    for (const p of periods) {
      amounts[p.id] = round2(
        accts.reduce((s, a) => s + classSign(a.class) * (balances.get(p.id)?.get(a.code) ?? 0), 0),
      );
    }
    return { label, amounts, emphasis };
  };
  const lines = (accts: FsAccountMeta[]): FsNoteTableRow[] =>
    [...accts].sort((a, b) => a.code.localeCompare(b.code)).map((a) => presentRow(a.name, [a]));

  const sections: FsNoteSection[] = [];
  const add = (key: string, title: string, accts: FsAccountMeta[], totalLabel: string) => {
    if (accts.length === 0) return;
    sections.push({
      key,
      kind: "account",
      title,
      table: { rows: [...lines(accts), presentRow(totalLabel, accts, true)] },
    });
  };

  const assets = input.accounts.filter((a) => a.class === "Asset");
  add("note-cash", "Cash and Cash Equivalents", assets.filter(isCashAccount), "Total Cash and Cash Equivalents");
  add("note-receivables", "Trade and Other Receivables", assets.filter(isReceivable), "Net Trade and Other Receivables");

  // PPE: cost, accumulated depreciation, and net carrying value.
  const fixed = assets.filter(isFixedAsset);
  if (fixed.length > 0) {
    const cost = fixed.filter((a) => !isAccumDep(a));
    const accum = fixed.filter(isAccumDep);
    const rows: FsNoteTableRow[] = [presentRow("Cost", cost)];
    if (accum.length > 0) rows.push(presentRow("Less: Accumulated depreciation", accum));
    rows.push(presentRow("Net carrying value", fixed, true));
    sections.push({ key: "note-ppe", kind: "account", title: "Property, Plant and Equipment", table: { rows } });
  }

  const liabilities = input.accounts.filter((a) => a.class === "Liability");
  add("note-debt", "Loans and Borrowings", liabilities.filter(isDebt), "Total Loans and Borrowings");
  add("note-equity", "Equity", input.accounts.filter((a) => a.class === "Equity"), "Total Equity");

  return sections;
}
