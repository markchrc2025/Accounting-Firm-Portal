// Financial-statement EXPORT MODEL builder (pure, library-free).
//
// Turns the adjusted trial balance + CoA metadata + report profile into a
// semantic workbook model: five sheets of typed rows where every subtotal /
// total / cross-statement tie carries a structured FORMULA SPEC (materialised
// to real Excel formulas by the renderer, with server-computed cached values),
// plus the export warning log.
//
// Key accounting mechanics:
//  - Presentation-level closing: each column's Retained Earnings caption folds
//    in that period's P&L balances, so the BS ties by construction on a normal
//    pre-closing trial balance.
//  - The Statement of Cash Flows is a true indirect method (§B): NIBT from the
//    IS, non-cash add-backs, working-capital changes by mapped caption, taxes
//    paid derived from the provision and the movement in tax accruals. Every
//    non-cash balance-sheet account contributes exactly once, so the net
//    change ALWAYS ties to the cash delta.
//  - The CE is a Share Capital / APIC / Retained Earnings / Total matrix,
//    one year-block per presented column, ending rows/columns as formulas.

import { round2 } from "@portal/shared";
import { adjustedBalances, type FsAccountMeta, type FsEngineInput } from "./fs-engine";
import {
  BS_CAPTIONS,
  IS_OPEX_CAPTIONS,
  assignAccount,
  assignOpex,
  isFallbackAssignment,
  systemAccountWarning,
  type BsCaptionId,
  type CfBucket,
  type ExportWarning,
  type IsOpexId,
} from "./fs-mapping";

// ------------------------------------------------------------------ interfaces

export interface FsExportOptions {
  presentation: "formal" | "detailed";
  includeComparative: boolean;
  suppressZeroRows: boolean;
  /** Statutory income-tax rate for the Note reconciliation (CREATE: 0.20/0.25). */
  statutoryRate: number;
}

export const DEFAULT_EXPORT_OPTIONS: FsExportOptions = {
  presentation: "formal",
  includeComparative: true,
  suppressZeroRows: true,
  statutoryRate: 0.25,
};

export interface ExportProfile {
  entityName: string;
  secRegistrationNo: string | null;
  registeredAddress: string | null;
  businessDescription: string | null;
  framework: string;
  functionalCurrency: string;
  approvalDate: string | null; // ISO
  authorizedShares: number | null;
  issuedShares: number | null;
  parValue: number | null;
}

export interface ExportPeriod {
  id: string;
  label: string;
  endDate: string | null; // ISO
  periodType: string; // "FY" | "Interim"
  sortOrder: number;
}

export interface PolicyNoteText {
  title: string;
  body: string; // token-merged; paragraphs separated by blank lines
}

export interface CustomNoteText {
  title: string;
  body: string;
}

export interface ModelInput {
  profile: ExportProfile;
  periods: ExportPeriod[]; // sortOrder ascending (current first)
  engine: FsEngineInput; // accounts + ALL periods' tb + adjustments
  policyNotes: PolicyNoteText[]; // included blocks, already merged
  customNotes: CustomNoteText[];
  /** Generate the Notes sheet + Note reference column (default true). Entities
   *  with gross sales/revenue of P3,000,000 and above are REQUIRED to present
   *  Notes — exporting without them emits a "notes-required" warning. */
  includeNotes?: boolean;
  options: FsExportOptions;
}

/** Structured formula, materialised by the renderer. `col` refers to the
 *  target sheet's amount-column index; omitted = the cell's own column. */
export type FormulaSpec =
  | { t: "sum"; ids: string[] }
  | { t: "terms"; terms: { s: 1 | -1; sheet?: SheetName; id: string; col?: number }[]; round?: boolean };

export interface XCell {
  v: number | null; // cached value (null = truly empty cell)
  f?: FormulaSpec;
}

export type RowKind =
  | "section" // ASSETS / CASH FLOWS FROM …  (bold, caps)
  | "group" // Current Assets (bold)
  | "caption" // an amount line
  | "less" // contra amount line (label already carries "Less: ")
  | "subtotal" // bold + single top border
  | "total" // grand total: bold + top border + double bottom border
  | "check" // tie-out check row
  | "blocktitle" // CE year-block heading
  | "tablehead" // note/CE column-header row
  | "notetitle"
  | "para" // notes paragraph (merged + wrapped)
  | "spacer";

export interface XRow {
  kind: RowKind;
  label: string;
  indent: number; // alignment indent level — labels NEVER carry spaces
  note?: string; // note number shown in the Note column (BS/IS)
  cells?: (XCell | null)[];
  /** Head labels for tablehead rows (rendered across the amount columns). */
  heads?: string[];
  id?: string;
}

export type SheetName = "BS" | "IS" | "CF" | "CE" | "Notes";

export interface XSheet {
  name: SheetName;
  titles: string[]; // company, statement, date line, "(Amounts in Philippine Peso)"
  /** Column headers for the amount columns (empty string = blank head cell). */
  amountHeads: string[];
  /** Number of amount columns (cells arrays use this length). */
  amountCols: number;
  /** True when the sheet has a Note reference column between labels and amounts. */
  hasNoteCol: boolean;
  rows: XRow[];
}

export interface ExportModel {
  sheets: XSheet[];
  warnings: ExportWarning[];
  /** For the filename / metadata. */
  currentLabel: string;
}

// ------------------------------------------------------------------- helpers

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export function longDate(iso: string | null): string {
  if (!iso) return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  const month = MONTHS[Number(m[2]) - 1];
  return month ? `${month} ${Number(m[3])}, ${m[1]}` : iso;
}

/** "For the year ended …" / "For the years ended … and …" per period type. */
function forLine(periods: ExportPeriod[]): string {
  const unit = periods.every((p) => p.periodType === "FY") ? "year" : "period";
  const dates = periods.map((p) => longDate(p.endDate) || p.label);
  if (dates.length === 1) return `For the ${unit} ended ${dates[0]}`;
  return `For the ${unit}s ended ${dates.join(" and ")}`;
}

/** PH SEC/BIR rule of thumb: Notes are required at P3,000,000 gross revenue. */
export const NOTES_REQUIRED_THRESHOLD = 3_000_000;

const cell = (v: number, f?: FormulaSpec): XCell => ({ v: round2(v), f });
const zeros = (n: number): XCell[] => Array.from({ length: n }, () => cell(0));

function allZero(cells: (XCell | null)[]): boolean {
  return cells.every((c) => c === null || c.v === null || c.v === 0);
}

// ---------------------------------------------------------------- balance core

interface Balances {
  /** Presentation-closed signed (debit-positive) balance per period column. */
  closed(periodIdx: number, code: string): number;
  /** Raw signed balance (P&L accounts keep their own balance). */
  raw(periodIdx: number, code: string): number;
}

function buildBalances(input: ModelInput): Balances {
  const byPeriod = adjustedBalances({
    ...input.engine,
    periods: input.periods.map((p) => ({ id: p.id, label: p.label, sortOrder: p.sortOrder })),
  });
  const plCodes = input.engine.accounts
    .filter((a) => a.class === "Revenue" || a.class === "Expense")
    .map((a) => a.code);
  const periodIds = input.periods.map((p) => p.id);
  const raw = (i: number, code: string): number =>
    byPeriod.get(periodIds[i] ?? "")?.get(code) ?? 0;
  return {
    raw,
    closed(i: number, code: string): number {
      if (code !== "2901003") return raw(i, code);
      // Fold the column's P&L balances into Retained Earnings (presentation
      // closing) so the balance sheet ties on a pre-closing trial balance.
      return round2(raw(i, code) + plCodes.reduce((s, c) => s + raw(i, c), 0));
    },
  };
}

// ------------------------------------------------------------------- assembly

interface Ctx {
  input: ModelInput;
  bal: Balances;
  faceCols: number; // 1 or 2 presented period columns
  warnings: ExportWarning[];
  noteNo: Map<string, number>; // noteKey → assigned note number
  accountsByCaption: Map<BsCaptionId, FsAccountMeta[]>;
  cfBucket: Map<CfBucket, FsAccountMeta[]>;
  /** IS per-column values reused across statements. */
  is: {
    niat: number[];
    nibt: number[];
    provision: number[];
    depreciation: number[];
    amortization: number[];
    badDebt: number[];
    financeCost: number[];
    interestIncome: number[];
  };
  /** CE per-face-column figures. */
  ce: {
    dividends: number[]; // credit-positive distribution amount (plug)
  };
}

/** Credit-positive P&L value of a set of codes for a face column. */
function plValue(ctx: Ctx, col: number, codes: string[], sign: 1 | -1): number {
  return round2(sign * codes.reduce((s, c) => s + ctx.bal.raw(col, c), 0));
}

function opexAccounts(ctx: Ctx, id: IsOpexId): FsAccountMeta[] {
  return ctx.input.engine.accounts.filter((a) => assignOpex(a) === id);
}

/** Caption amount, presentation-signed (assets debit-positive; liabilities &
 *  equity credit-positive). */
function captionAmount(ctx: Ctx, capId: BsCaptionId, col: number): number {
  const accounts = ctx.accountsByCaption.get(capId) ?? [];
  const def = BS_CAPTIONS.find((c) => c.id === capId)!;
  const sign = def.section.endsWith("assets") ? 1 : -1;
  return round2(sign * accounts.reduce((s, a) => s + ctx.bal.closed(col, a.code), 0));
}

function buildContext(input: ModelInput): Ctx {
  const bal = buildBalances(input);
  const faceCols = Math.min(input.options.includeComparative ? 2 : 1, input.periods.length);
  const warnings: ExportWarning[] = [];

  const accountsByCaption = new Map<BsCaptionId, FsAccountMeta[]>();
  const cfBucket = new Map<CfBucket, FsAccountMeta[]>();
  for (const a of input.engine.accounts) {
    const assignment = assignAccount(a);
    if (!assignment) continue;
    if (assignment.bs) {
      if (!accountsByCaption.has(assignment.bs)) accountsByCaption.set(assignment.bs, []);
      accountsByCaption.get(assignment.bs)!.push(a);
    }
    if (assignment.cf) {
      if (!cfBucket.has(assignment.cf)) cfBucket.set(assignment.cf, []);
      cfBucket.get(assignment.cf)!.push(a);
    }
    const sysWarn = systemAccountWarning(a, bal.raw(0, a.code));
    if (sysWarn) warnings.push(sysWarn);
    if (isFallbackAssignment(a) && bal.raw(0, a.code) !== 0) {
      warnings.push({
        code: "unmapped-account",
        message:
          `Account ${a.code} (${a.name}) has no explicit FS mapping; presented under a ` +
          `fallback caption by class. Add it to the mapping layer.`,
      });
    }
  }

  const cols = Array.from({ length: faceCols }, (_, i) => i);
  const rev = (i: number) =>
    plValue(ctx0, i, input.engine.accounts.filter((a) => a.class === "Revenue").map((a) => a.code), -1);
  const exp = (i: number) =>
    plValue(ctx0, i, input.engine.accounts.filter((a) => a.class === "Expense").map((a) => a.code), 1);

  // Two-phase: ctx0 first so plValue can use bal; then fill IS aggregates.
  const ctx0 = {
    input, bal, faceCols, warnings, accountsByCaption, cfBucket,
    noteNo: new Map<string, number>(),
    is: { niat: [], nibt: [], provision: [], depreciation: [], amortization: [], badDebt: [], financeCost: [], interestIncome: [] },
    ce: { dividends: [] },
  } as Ctx;

  for (const i of cols) {
    const provision = plValue(ctx0, i, ["5008"], 1);
    const niat = round2(rev(i) - exp(i));
    ctx0.is.provision.push(provision);
    ctx0.is.niat.push(niat);
    ctx0.is.nibt.push(round2(niat + provision));
    ctx0.is.depreciation.push(plValue(ctx0, i, ["5007001"], 1));
    ctx0.is.amortization.push(plValue(ctx0, i, ["5004002"], 1));
    ctx0.is.badDebt.push(plValue(ctx0, i, ["5007002"], 1));
    ctx0.is.financeCost.push(plValue(ctx0, i, ["5004001"], 1));
    ctx0.is.interestIncome.push(plValue(ctx0, i, ["3002001"], -1));
  }

  // Dividends plug per face column: closedRE(prior) + NIAT(col) − closedRE(col),
  // in credit-positive terms; 0 when no older period exists.
  for (const i of cols) {
    const cur = -captionSignedRe(ctx0, i);
    if (i + 1 >= input.periods.length) {
      ctx0.ce.dividends.push(0);
      continue;
    }
    const prior = -captionSignedRe(ctx0, i + 1);
    const d = round2(prior + (ctx0.is.niat[i] ?? 0) - cur);
    ctx0.ce.dividends.push(d);
    if (d !== 0) {
      warnings.push({
        code: "dividends-plug",
        message:
          `Retained-earnings movement for ${input.periods[i]?.label} includes ${d.toFixed(2)} ` +
          `not explained by net income; presented as "Dividends declared". Verify.`,
      });
    }
  }
  return ctx0;
}

/** Signed (debit-positive) retained-earnings caption total for a column. */
function captionSignedRe(ctx: Ctx, col: number): number {
  const accounts = ctx.accountsByCaption.get("retained") ?? [];
  return round2(accounts.reduce((s, a) => s + ctx.bal.closed(col, a.code), 0));
}

// -------------------------------------------------------------------- BS sheet

function accountLineLabel(a: FsAccountMeta, contra: boolean): string {
  return contra ? `Less: ${a.name}` : a.name;
}

function buildBs(ctx: Ctx): XSheet {
  const { input, faceCols } = ctx;
  const periods = input.periods.slice(0, faceCols);
  const rows: XRow[] = [];
  const detailed = input.options.presentation === "detailed";

  const captionIdsBySection = (section: string): BsCaptionId[] =>
    BS_CAPTIONS.filter((c) => c.section === section).map((c) => c.id);

  const emitCaption = (capId: BsCaptionId): string[] => {
    const def = BS_CAPTIONS.find((c) => c.id === capId)!;
    const amounts = Array.from({ length: faceCols }, (_, i) => captionAmount(ctx, capId, i));
    const note = def.noteKey && ctx.noteNo.has(def.noteKey) ? String(ctx.noteNo.get(def.noteKey)) : undefined;
    if (amounts.every((v) => v === 0) && input.options.suppressZeroRows && capId !== "cash" && capId !== "retained") {
      return [];
    }
    if (!detailed) {
      const id = `bs.${capId}`;
      if (capId === "retained") {
        // BS Retained Earnings ties to the CE ending balance (A.2).
        rows.push({
          kind: "caption", label: def.label, indent: 1, note, id,
          cells: amounts.map((v, i) => cell(v, { t: "terms", terms: [{ s: 1, sheet: "CE", id: `ce.end.${i}`, col: 2 }] })),
        });
      } else {
        rows.push({ kind: "caption", label: def.label, indent: 1, note, id, cells: amounts.map((v) => cell(v)) });
      }
      return [id];
    }
    // Detailed: account lines + caption subtotal (formula).
    const sign = def.section.endsWith("assets") ? 1 : -1;
    const lineIds: string[] = [];
    const accounts = (ctx.accountsByCaption.get(capId) ?? []).sort((a, b) => a.code.localeCompare(b.code));
    for (const a of accounts) {
      const vals = Array.from({ length: faceCols }, (_, i) => round2(sign * ctx.bal.closed(i, a.code)));
      const contra = assignAccount(a)?.contra ?? false;
      if (vals.every((v) => v === 0) && input.options.suppressZeroRows) continue;
      const id = `bs.acct.${a.code}`;
      rows.push({
        kind: contra ? "less" : "caption",
        label: accountLineLabel(a, contra), indent: 2, cells: vals.map((v) => cell(v)), id,
      });
      lineIds.push(id);
    }
    const id = `bs.${capId}`;
    rows.push({
      kind: "subtotal", label: def.label, indent: 1, note, id,
      cells: amounts.map((v) => cell(v, lineIds.length ? { t: "sum", ids: lineIds } : undefined)),
    });
    return [id];
  };

  const emitSection = (
    title: string, section: string, subtotalLabel: string, subtotalId: string,
  ): void => {
    rows.push({ kind: "group", label: title, indent: 0 });
    const ids = captionIdsBySection(section).flatMap(emitCaption);
    const totals = Array.from({ length: faceCols }, (_, i) =>
      round2(captionIdsBySection(section).reduce((s, c) => s + captionAmount(ctx, c, i), 0)),
    );
    rows.push({
      kind: "subtotal", label: subtotalLabel, indent: 0, id: subtotalId,
      cells: totals.map((v) => cell(v, ids.length ? { t: "sum", ids } : undefined)),
    });
    rows.push({ kind: "spacer", label: "", indent: 0 });
  };

  rows.push({ kind: "section", label: "ASSETS", indent: 0 });
  emitSection("Current Assets", "current-assets", "Total Current Assets", "bs.tca");
  emitSection("Non-Current Assets", "noncurrent-assets", "Total Non-Current Assets", "bs.tnca");
  const totalAssets = Array.from({ length: faceCols }, (_, i) =>
    round2(
      captionIdsBySection("current-assets").concat(captionIdsBySection("noncurrent-assets"))
        .reduce((s, c) => s + captionAmount(ctx, c, i), 0),
    ),
  );
  rows.push({
    kind: "total", label: "TOTAL ASSETS", indent: 0, id: "bs.ta",
    cells: totalAssets.map((v) => cell(v, { t: "terms", terms: [{ s: 1, id: "bs.tca" }, { s: 1, id: "bs.tnca" }] })),
  });
  rows.push({ kind: "spacer", label: "", indent: 0 });

  rows.push({ kind: "section", label: "LIABILITIES AND EQUITY", indent: 0 });
  emitSection("Current Liabilities", "current-liabilities", "Total Current Liabilities", "bs.tcl");
  emitSection("Non-Current Liabilities", "noncurrent-liabilities", "Total Non-Current Liabilities", "bs.tncl");
  const totalLiab = Array.from({ length: faceCols }, (_, i) =>
    round2(
      captionIdsBySection("current-liabilities").concat(captionIdsBySection("noncurrent-liabilities"))
        .reduce((s, c) => s + captionAmount(ctx, c, i), 0),
    ),
  );
  rows.push({
    kind: "subtotal", label: "TOTAL LIABILITIES", indent: 0, id: "bs.tl",
    cells: totalLiab.map((v) => cell(v, { t: "terms", terms: [{ s: 1, id: "bs.tcl" }, { s: 1, id: "bs.tncl" }] })),
  });
  rows.push({ kind: "spacer", label: "", indent: 0 });

  rows.push({ kind: "group", label: "Equity", indent: 0 });
  const equityIds = captionIdsBySection("equity").flatMap(emitCaption);
  const totalEquity = Array.from({ length: faceCols }, (_, i) =>
    round2(captionIdsBySection("equity").reduce((s, c) => s + captionAmount(ctx, c, i), 0)),
  );
  rows.push({
    kind: "subtotal", label: "Total Equity", indent: 0, id: "bs.te",
    cells: totalEquity.map((v) => cell(v, { t: "sum", ids: equityIds })),
  });
  const totalLe = Array.from({ length: faceCols }, (_, i) => round2(totalLiab[i]! + totalEquity[i]!));
  rows.push({
    kind: "total", label: "TOTAL LIABILITIES AND EQUITY", indent: 0, id: "bs.tle",
    cells: totalLe.map((v) => cell(v, { t: "terms", terms: [{ s: 1, id: "bs.tl" }, { s: 1, id: "bs.te" }] })),
  });
  rows.push({ kind: "spacer", label: "", indent: 0 });
  rows.push({
    kind: "check", label: "Check (must be 0)", indent: 0, id: "bs.check",
    cells: totalAssets.map((v, i) =>
      cell(round2(v - totalLe[i]!), {
        t: "terms", round: true,
        terms: [{ s: 1, id: "bs.ta" }, { s: -1, id: "bs.tle" }],
      }),
    ),
  });

  return {
    name: "BS",
    titles: [
      input.profile.entityName,
      "STATEMENT OF FINANCIAL POSITION",
      `As of ${longDate(periods[0]?.endDate ?? null) || periods[0]?.label || ""}`,
      "(Amounts in Philippine Peso)",
    ],
    amountHeads: periods.map((p) => p.label),
    amountCols: faceCols,
    hasNoteCol: input.includeNotes !== false,
    rows,
  };
}

// -------------------------------------------------------------------- IS sheet

function buildIs(ctx: Ctx): XSheet {
  const { input, faceCols } = ctx;
  const periods = input.periods.slice(0, faceCols);
  const rows: XRow[] = [];
  const accounts = input.engine.accounts;
  const cols = Array.from({ length: faceCols }, (_, i) => i);

  // --- Revenues --------------------------------------------------------------
  rows.push({ kind: "section", label: "REVENUES", indent: 0 });
  const revenueAccounts = accounts
    .filter((a) => a.class === "Revenue" && a.code !== "3002001" && a.code !== "3901001")
    .sort((a, b) => a.code.localeCompare(b.code));
  const revIds: string[] = [];
  for (const a of revenueAccounts) {
    const vals = cols.map((i) => plValue(ctx, i, [a.code], -1));
    if (vals.every((v) => v === 0) && input.options.suppressZeroRows) continue;
    const id = `is.rev.${a.code}`;
    rows.push({ kind: "caption", label: a.name, indent: 1, id, cells: vals.map((v) => cell(v)) });
    revIds.push(id);
  }
  const returns = cols.map((i) => plValue(ctx, i, ["3901001"], 1)); // debit balance, deducted
  if (!(returns.every((v) => v === 0) && input.options.suppressZeroRows)) {
    rows.push({
      kind: "less", label: "Less: Sales returns, allowances and discounts", indent: 1,
      id: "is.returns", cells: returns.map((v) => cell(-v)),
    });
    revIds.push("is.returns");
  }
  const netRev = cols.map((i) =>
    round2(revenueAccounts.reduce((s, a) => s + plValue(ctx, i, [a.code], -1), 0) - (returns[i] ?? 0)),
  );
  rows.push({
    kind: "subtotal", label: "Net revenues", indent: 0, id: "is.netrev",
    cells: netRev.map((v) => cell(v, { t: "sum", ids: revIds })),
  });
  rows.push({ kind: "spacer", label: "", indent: 0 });

  // --- Cost of sales / services (conditional heading, §E.2) ------------------
  const cogs = accounts.filter((a) => a.code === "4001");
  const cosv = accounts.filter((a) => a.code === "4002");
  const cogsActive = cols.some((i) => plValue(ctx, i, cogs.map((a) => a.code), 1) !== 0);
  const cosvActive = cols.some((i) => plValue(ctx, i, cosv.map((a) => a.code), 1) !== 0);
  const costHeading =
    cogsActive && cosvActive ? "COST OF SALES AND SERVICES" : cogsActive ? "COST OF SALES" : "COST OF SERVICES";
  rows.push({ kind: "section", label: costHeading, indent: 0 });
  const costIds: string[] = [];
  for (const a of [...cogs, ...cosv]) {
    const vals = cols.map((i) => plValue(ctx, i, [a.code], 1));
    if (vals.every((v) => v === 0) && input.options.suppressZeroRows) continue;
    const id = `is.cost.${a.code}`;
    rows.push({ kind: "caption", label: a.name, indent: 1, id, cells: vals.map((v) => cell(v)) });
    costIds.push(id);
  }
  const costTotal = cols.map((i) => plValue(ctx, i, [...cogs, ...cosv].map((a) => a.code), 1));
  rows.push({
    kind: "subtotal", label: `Total ${costHeading.toLowerCase().replace(/^cost/, "cost")}`, indent: 0,
    id: "is.cost", cells: costTotal.map((v) => cell(v, costIds.length ? { t: "sum", ids: costIds } : undefined)),
  });
  const grossProfit = cols.map((i) => round2((netRev[i] ?? 0) - (costTotal[i] ?? 0)));
  rows.push({
    kind: "total", label: "GROSS PROFIT", indent: 0, id: "is.gp",
    cells: grossProfit.map((v) => cell(v, { t: "terms", terms: [{ s: 1, id: "is.netrev" }, { s: -1, id: "is.cost" }] })),
  });
  rows.push({ kind: "spacer", label: "", indent: 0 });

  // --- Operating expenses ----------------------------------------------------
  rows.push({ kind: "section", label: "OPERATING EXPENSES", indent: 0 });
  const opexIds: string[] = [];
  const ppeNote = ctx.noteNo.get("ppe");
  for (const capDef of IS_OPEX_CAPTIONS) {
    const capAccounts = opexAccounts(ctx, capDef.id);
    const vals = cols.map((i) => plValue(ctx, i, capAccounts.map((a) => a.code), 1));
    if (input.options.presentation === "detailed") {
      const lineIds: string[] = [];
      for (const a of capAccounts.sort((x, y) => x.code.localeCompare(y.code))) {
        const lv = cols.map((i) => plValue(ctx, i, [a.code], 1));
        if (lv.every((v) => v === 0) && input.options.suppressZeroRows) continue;
        const id = `is.opex.${a.code}`;
        rows.push({ kind: "caption", label: a.name, indent: 2, id, cells: lv.map((v) => cell(v)) });
        lineIds.push(id);
      }
      if (lineIds.length === 0 && input.options.suppressZeroRows) continue;
      const id = `is.opexcap.${capDef.id}`;
      rows.push({
        kind: "subtotal", label: capDef.label, indent: 1, id,
        note: capDef.id === "depreciation" && ppeNote ? String(ppeNote) : undefined,
        cells: vals.map((v) => cell(v, lineIds.length ? { t: "sum", ids: lineIds } : undefined)),
      });
      opexIds.push(id);
    } else {
      if (vals.every((v) => v === 0) && input.options.suppressZeroRows) continue;
      const id = `is.opexcap.${capDef.id}`;
      rows.push({
        kind: "caption", label: capDef.label, indent: 1, id,
        note: capDef.id === "depreciation" && ppeNote ? String(ppeNote) : undefined,
        cells: vals.map((v) => cell(v)),
      });
      opexIds.push(id);
    }
  }
  const opexTotal = cols.map((i) =>
    round2(IS_OPEX_CAPTIONS.reduce((s, d) => s + plValue(ctx, i, opexAccounts(ctx, d.id).map((a) => a.code), 1), 0)),
  );
  rows.push({
    kind: "subtotal", label: "Total operating expenses", indent: 0, id: "is.opex",
    cells: opexTotal.map((v) => cell(v, { t: "sum", ids: opexIds })),
  });
  const ifo = cols.map((i) => round2((grossProfit[i] ?? 0) - (opexTotal[i] ?? 0)));
  rows.push({
    kind: "total", label: "INCOME FROM OPERATIONS", indent: 0, id: "is.ifo",
    cells: ifo.map((v) => cell(v, { t: "terms", terms: [{ s: 1, id: "is.gp" }, { s: -1, id: "is.opex" }] })),
  });
  rows.push({ kind: "spacer", label: "", indent: 0 });

  // --- Other income / (charges): interest income moved here (§E.3) ----------
  rows.push({ kind: "section", label: "OTHER INCOME (CHARGES)", indent: 0 });
  const otherIds: string[] = [];
  const intInc = ctx.is.interestIncome;
  if (!(intInc.every((v) => v === 0) && input.options.suppressZeroRows)) {
    rows.push({ kind: "caption", label: "Interest income", indent: 1, id: "is.intinc", cells: intInc.map((v) => cell(v)) });
    otherIds.push("is.intinc");
  }
  const finCost = ctx.is.financeCost;
  if (!(finCost.every((v) => v === 0) && input.options.suppressZeroRows)) {
    rows.push({ kind: "caption", label: "Finance cost", indent: 1, id: "is.fincost", cells: finCost.map((v) => cell(-v)) });
    otherIds.push("is.fincost");
  }
  const otherTotal = cols.map((i) => round2((intInc[i] ?? 0) - (finCost[i] ?? 0)));
  rows.push({
    kind: "subtotal", label: "Total other income (charges)", indent: 0, id: "is.other",
    cells: otherTotal.map((v) => cell(v, otherIds.length ? { t: "sum", ids: otherIds } : undefined)),
  });
  rows.push({ kind: "spacer", label: "", indent: 0 });

  const nibt = ctx.is.nibt;
  rows.push({
    kind: "total", label: "NET INCOME/(LOSS) BEFORE TAX", indent: 0, id: "is.nibt",
    cells: nibt.map((v) => cell(v, { t: "terms", terms: [{ s: 1, id: "is.ifo" }, { s: 1, id: "is.other" }] })),
  });
  const taxNote = ctx.noteNo.get("income-taxes");
  rows.push({
    kind: "caption", label: "Provision for income tax", indent: 0, id: "is.provision",
    note: taxNote ? String(taxNote) : undefined,
    cells: ctx.is.provision.map((v) => cell(v)),
  });
  rows.push({
    kind: "total", label: "NET INCOME/(LOSS) AFTER TAX", indent: 0, id: "is.niat",
    cells: ctx.is.niat.map((v) => cell(v, { t: "terms", terms: [{ s: 1, id: "is.nibt" }, { s: -1, id: "is.provision" }] })),
  });

  return {
    name: "IS",
    titles: [
      input.profile.entityName,
      "STATEMENT OF INCOME",
      forLine(periods),
      "(Amounts in Philippine Peso)",
    ],
    amountHeads: periods.map((p) => p.label),
    amountCols: faceCols,
    hasNoteCol: input.includeNotes !== false,
    rows,
  };
}

// -------------------------------------------------------------------- CF sheet

function buildCf(ctx: Ctx): XSheet {
  const { input, bal } = ctx;
  // A CF column exists for each presented period that has an older comparative.
  const pairCols = Math.min(ctx.faceCols, input.periods.length - 1);
  const cols = Array.from({ length: pairCols }, (_, i) => i);
  const rows: XRow[] = [];

  /** −Δ of the signed closed balance over the pair (cash-flow contribution). */
  const contribution = (codes: string[], i: number): number =>
    round2(-codes.reduce((s, c) => s + (bal.closed(i, c) - bal.closed(i + 1, c)), 0));
  const bucketCodes = (b: CfBucket): string[] => (ctx.cfBucket.get(b) ?? []).map((a) => a.code);

  const line = (
    label: string, id: string, vals: number[], opts: { indent?: number; f?: (i: number) => FormulaSpec | undefined } = {},
  ): string | null => {
    if (vals.every((v) => v === 0) && input.options.suppressZeroRows) return null;
    rows.push({
      kind: "caption", label, indent: opts.indent ?? 1, id,
      cells: vals.map((v, i) => cell(v, opts.f?.(i))),
    });
    return id;
  };

  // --- Operating -------------------------------------------------------------
  rows.push({ kind: "section", label: "CASH FLOWS FROM OPERATING ACTIVITIES", indent: 0 });
  const opIds: string[] = [];
  const push = (id: string | null) => id && opIds.push(id);

  push(line("Net income/(loss) before tax", "cf.nibt", cols.map((i) => ctx.is.nibt[i] ?? 0), {
    f: (i) => ({ t: "terms", terms: [{ s: 1, sheet: "IS", id: "is.nibt", col: i }] }),
  }));
  rows.push({ kind: "caption", label: "Adjustments for:", indent: 1 });

  // Depreciation / amortization / bad debt from the IS, with any residual vs
  // the movement in the contra accounts shown transparently (keeps exact ties).
  const accumDelta = cols.map((i) => contribution(["1901001"], i));
  const dep = cols.map((i) => ctx.is.depreciation[i] ?? 0);
  const amort = cols.map((i) => ctx.is.amortization[i] ?? 0);
  const depResidual = cols.map((i) => round2((accumDelta[i] ?? 0) - (dep[i] ?? 0) - (amort[i] ?? 0)));
  push(line("Depreciation", "cf.dep", dep, { indent: 2 }));
  push(line("Amortization", "cf.amort", amort, { indent: 2 }));
  push(line("Other movements in accumulated depreciation", "cf.depresid", depResidual, { indent: 2 }));

  const allowDelta = cols.map((i) => contribution(["1902001"], i));
  const badDebt = cols.map((i) => ctx.is.badDebt[i] ?? 0);
  const badDebtResidual = cols.map((i) => round2((allowDelta[i] ?? 0) - (badDebt[i] ?? 0)));
  push(line("Bad debt expense", "cf.baddebt", badDebt, { indent: 2 }));
  push(line("Other movements in allowance for doubtful accounts", "cf.badresid", badDebtResidual, { indent: 2 }));

  push(line("Finance cost", "cf.fincost", cols.map((i) => ctx.is.financeCost[i] ?? 0), { indent: 2 }));
  push(line("Interest income", "cf.intinc", cols.map((i) => -(ctx.is.interestIncome[i] ?? 0)), { indent: 2 }));

  const owc = cols.map((i) => round2(opIds.reduce((s, id) => s + rowVal(rows, id, i), 0)));
  rows.push({
    kind: "subtotal", label: "Operating income before working capital changes", indent: 1,
    id: "cf.owc", cells: owc.map((v) => cell(v, { t: "sum", ids: [...opIds] })),
  });

  const wcIds: string[] = ["cf.owc"];
  const wc = (label: string, id: string, bucket: CfBucket, excludeCodes: string[] = []) => {
    const codes = bucketCodes(bucket).filter((c) => !excludeCodes.includes(c));
    const vals = cols.map((i) => contribution(codes, i));
    const rid = line(label, id, vals);
    if (rid) wcIds.push(rid);
  };
  wc("(Increase)/decrease in trade and other receivables", "cf.wc.recv", "wc-receivables", ["1902001"]);
  wc("(Increase)/decrease in advances to employees and officers", "cf.wc.adv", "wc-advances");
  wc("(Increase)/decrease in prepaid expenses", "cf.wc.prepaid", "wc-prepaid");
  wc("(Increase)/decrease in inventory", "cf.wc.inv", "wc-inventory");
  wc("(Increase)/decrease in VAT and other tax assets", "cf.wc.vat", "wc-vat-assets");
  wc("Increase/(decrease) in trade and other payables", "cf.wc.pay", "wc-payables", ["1901001"]);
  wc("Increase/(decrease) in accrued payroll and statutory payables", "cf.wc.stat", "wc-statutory");
  wc("Increase/(decrease) in unearned revenue", "cf.wc.unearned", "wc-unearned");

  const cgo = cols.map((i) => round2(wcIds.reduce((s, id) => s + rowVal(rows, id, i), 0)));
  rows.push({
    kind: "subtotal", label: "Cash generated from/(used in) operations", indent: 1,
    id: "cf.cgo", cells: cgo.map((v) => cell(v, { t: "sum", ids: wcIds.filter((x) => x !== "cf.owc").concat("cf.owc") })),
  });

  const tailIds: string[] = ["cf.cgo"];
  const intRecv = cols.map((i) => ctx.is.interestIncome[i] ?? 0);
  const intPaid = cols.map((i) => -(ctx.is.financeCost[i] ?? 0));
  // Income taxes paid = provision − contribution of the income-tax accrual
  // accounts (DTA / DTL / income tax payable), shown as an outflow.
  const taxCodes = bucketCodes("tax-paid");
  const taxesPaid = cols.map((i) => round2(-((ctx.is.provision[i] ?? 0) - contribution(taxCodes, i))));
  for (const [label, id, vals] of [
    ["Interest received", "cf.intrecv", intRecv],
    ["Interest paid", "cf.intpaid", intPaid],
    ["Income taxes paid", "cf.taxpaid", taxesPaid],
  ] as const) {
    const rid = line(label, id, vals);
    if (rid) tailIds.push(rid);
  }
  const netOp = cols.map((i) => round2(tailIds.reduce((s, id) => s + rowVal(rows, id, i), 0)));
  rows.push({
    kind: "subtotal", label: "Net cash provided by/(used in) operating activities", indent: 0,
    id: "cf.op", cells: netOp.map((v) => cell(v, { t: "sum", ids: tailIds })),
  });
  rows.push({ kind: "spacer", label: "", indent: 0 });

  // --- Investing -------------------------------------------------------------
  rows.push({ kind: "section", label: "CASH FLOWS FROM INVESTING ACTIVITIES", indent: 0 });
  const ppeCodes = bucketCodes("inv-ppe");
  const ppeContribution = cols.map((i) => contribution(ppeCodes, i)); // −Δ gross
  const additions = cols.map((i) => Math.min(ppeContribution[i] ?? 0, 0));
  const proceeds = cols.map((i) => Math.max(ppeContribution[i] ?? 0, 0));
  const invIds: string[] = [];
  {
    const a = line("Additions to property, plant and equipment", "cf.ppeadd", additions);
    if (a) invIds.push(a);
    const p = line("Proceeds from disposal of property, plant and equipment", "cf.ppedisp", proceeds);
    if (p) invIds.push(p);
  }
  const netInv = cols.map((i) => round2((additions[i] ?? 0) + (proceeds[i] ?? 0)));
  rows.push({
    kind: "subtotal", label: "Net cash provided by/(used in) investing activities", indent: 0,
    id: "cf.inv", cells: netInv.map((v) => cell(v, invIds.length ? { t: "sum", ids: invIds } : undefined)),
  });
  rows.push({ kind: "spacer", label: "", indent: 0 });

  // --- Financing -------------------------------------------------------------
  rows.push({ kind: "section", label: "CASH FLOWS FROM FINANCING ACTIVITIES", indent: 0 });
  const finIds: string[] = [];
  {
    const loans = line("Proceeds from/(payments of) loans", "cf.loans",
      cols.map((i) => contribution(bucketCodes("fin-loans"), i)));
    if (loans) finIds.push(loans);
    const capital = line("Proceeds from issuance of share capital", "cf.capital",
      cols.map((i) => contribution(bucketCodes("fin-capital"), i)));
    if (capital) finIds.push(capital);
    const dividends = line("Dividends paid", "cf.dividends", cols.map((i) => round2(-(ctx.ce.dividends[i] ?? 0))));
    if (dividends) finIds.push(dividends);
  }
  const netFin = cols.map((i) => round2(finIds.reduce((s, id) => s + rowVal(rows, id, i), 0)));
  rows.push({
    kind: "subtotal", label: "Net cash provided by/(used in) financing activities", indent: 0,
    id: "cf.fin", cells: netFin.map((v) => cell(v, finIds.length ? { t: "sum", ids: finIds } : undefined)),
  });
  rows.push({ kind: "spacer", label: "", indent: 0 });

  // --- Net change + reconciliation ------------------------------------------
  const netChange = cols.map((i) => round2((netOp[i] ?? 0) + (netInv[i] ?? 0) + (netFin[i] ?? 0)));
  rows.push({
    kind: "total", label: "NET INCREASE/(DECREASE) IN CASH", indent: 0, id: "cf.net",
    cells: netChange.map((v) =>
      cell(v, { t: "terms", terms: [{ s: 1, id: "cf.op" }, { s: 1, id: "cf.inv" }, { s: 1, id: "cf.fin" }] })),
  });
  const cashCodes = bucketCodes("cash");
  const beginningCash = cols.map((i) => round2(cashCodes.reduce((s, c) => s + bal.closed(i + 1, c), 0)));
  const endingCash = cols.map((i) => round2(cashCodes.reduce((s, c) => s + bal.closed(i, c), 0)));
  rows.push({
    kind: "caption", label: "Cash and cash equivalents, beginning of period", indent: 0,
    id: "cf.begin", cells: beginningCash.map((v) => cell(v)),
  });
  rows.push({
    kind: "total", label: "Cash and cash equivalents, end of period", indent: 0, id: "cf.end",
    cells: endingCash.map((v) => cell(v, { t: "terms", terms: [{ s: 1, id: "cf.net" }, { s: 1, id: "cf.begin" }] })),
  });
  rows.push({ kind: "spacer", label: "", indent: 0 });
  rows.push({
    kind: "check", label: "Check vs BS cash (must be 0)", indent: 0, id: "cf.check",
    cells: cols.map((i) =>
      i < ctx.faceCols
        ? cell(0, { t: "terms", round: true, terms: [{ s: 1, id: "cf.end" }, { s: -1, sheet: "BS", id: "bs.cash", col: i }] })
        : cell(round2((endingCash[i] ?? 0) - (endingCash[i] ?? 0))),
    ),
  });

  const periods = input.periods.slice(0, pairCols);
  return {
    name: "CF",
    titles: [
      input.profile.entityName,
      "STATEMENT OF CASH FLOWS",
      forLine(periods),
      "(Amounts in Philippine Peso)",
    ],
    amountHeads: periods.map((p) => p.label),
    amountCols: pairCols,
    hasNoteCol: false,
    rows,
  };
}

/** Cached value of a previously-emitted row (by id) at a column. */
function rowVal(rows: XRow[], id: string, col: number): number {
  const row = rows.find((r) => r.id === id);
  return row?.cells?.[col]?.v ?? 0;
}

// -------------------------------------------------------------------- CE sheet

function buildCe(ctx: Ctx): XSheet {
  const { input, bal } = ctx;
  const rows: XRow[] = [];
  const heads = ["Share Capital", "Additional Paid-in Capital", "Retained Earnings", "Total"];

  const capCodes = (ctx.accountsByCaption.get("share-capital") ?? []).map((a) => a.code);
  const apicCodes = (ctx.accountsByCaption.get("apic") ?? []).map((a) => a.code);
  const creditPos = (codes: string[], col: number): number =>
    round2(-codes.reduce((s, c) => s + bal.closed(col, c), 0));

  // One year-block per presented face column, oldest first (reads forward).
  const blockCols = Array.from({ length: ctx.faceCols }, (_, i) => i).reverse();
  let firstBlock = true;
  for (const k of blockCols) {
    const period = input.periods[k]!;
    if (!firstBlock) rows.push({ kind: "spacer", label: "", indent: 0 });
    firstBlock = false;
    rows.push({
      kind: "blocktitle",
      label: period.periodType === "FY"
        ? `For the year ended ${longDate(period.endDate) || period.label}`
        : `For the period ended ${longDate(period.endDate) || period.label}`,
      indent: 0,
    });

    const hasOlder = k + 1 < input.periods.length;
    const olderRendered = blockCols.includes(k + 1);
    const endSc = creditPos(capCodes, k);
    const endApic = creditPos(apicCodes, k);
    const endRe = -captionSignedRe(ctx, k);
    const niat = ctx.is.niat[k] ?? 0;
    const dividends = ctx.ce.dividends[k] ?? 0;
    const begSc = hasOlder ? creditPos(capCodes, k + 1) : endSc;
    const begApic = hasOlder ? creditPos(apicCodes, k + 1) : endApic;
    const begRe = hasOlder ? -captionSignedRe(ctx, k + 1) : round2(endRe - niat + dividends);
    const issueSc = round2(endSc - begSc);
    const issueApic = round2(endApic - begApic);

    const rowIds: string[] = [];
    const matrixRow = (
      label: string, id: string, sc: XCell, apic: XCell, re: XCell, kind: RowKind = "caption",
    ) => {
      const total = round2((sc.v ?? 0) + (apic.v ?? 0) + (re.v ?? 0));
      rows.push({
        kind, label, indent: kind === "caption" ? 1 : 0, id,
        cells: [sc, apic, re, cell(total, { t: "terms", terms: [
          { s: 1, id, col: 0 }, { s: 1, id, col: 1 }, { s: 1, id, col: 2 },
        ] })],
      });
      if (kind === "caption") rowIds.push(id);
    };

    matrixRow(
      "Balance at beginning of period", `ce.beg.${k}`,
      olderRendered ? cell(begSc, { t: "terms", terms: [{ s: 1, id: `ce.end.${k + 1}`, col: 0 }] }) : cell(begSc),
      olderRendered ? cell(begApic, { t: "terms", terms: [{ s: 1, id: `ce.end.${k + 1}`, col: 1 }] }) : cell(begApic),
      olderRendered ? cell(begRe, { t: "terms", terms: [{ s: 1, id: `ce.end.${k + 1}`, col: 2 }] }) : cell(begRe),
    );
    matrixRow("Issuance of share capital", `ce.issue.${k}`, cell(issueSc), cell(issueApic), cell(0));
    matrixRow(
      "Net income/(loss) for the period", `ce.ni.${k}`,
      cell(0), cell(0),
      cell(niat, { t: "terms", terms: [{ s: 1, sheet: "IS", id: "is.niat", col: k }] }),
    );
    matrixRow("Dividends declared", `ce.div.${k}`, cell(0), cell(0), cell(-dividends));

    // Ending row: column-sum formulas for SC/APIC/RE; row-sum for Total.
    const endTotal = round2(endSc + endApic + endRe);
    rows.push({
      kind: "total", label: "Balance at end of period", indent: 0, id: `ce.end.${k}`,
      cells: [
        cell(endSc, { t: "sum", ids: rowIds }),
        cell(endApic, { t: "sum", ids: rowIds }),
        cell(endRe, { t: "sum", ids: rowIds }),
        cell(endTotal, { t: "terms", terms: [
          { s: 1, id: `ce.end.${k}`, col: 0 }, { s: 1, id: `ce.end.${k}`, col: 1 }, { s: 1, id: `ce.end.${k}`, col: 2 },
        ] }),
      ],
    });
    // Alias id for the BS Retained Earnings tie (col 2 of ce.end.<k>).
    const endRow = rows[rows.length - 1]!;
    endRow.id = `ce.end.${k}`;
  }

  const periods = input.periods.slice(0, ctx.faceCols);
  return {
    name: "CE",
    titles: [
      input.profile.entityName,
      "STATEMENT OF CHANGES IN EQUITY",
      forLine(periods),
      "(Amounts in Philippine Peso)",
    ],
    amountHeads: heads,
    amountCols: 4,
    hasNoteCol: false,
    rows,
  };
}

// ----------------------------------------------------------------- Notes sheet

interface NoteSpec {
  key: string;
  title: string;
  build: (ctx: Ctx, rows: XRow[]) => void;
  /** Include even when all balances are zero. */
  always?: boolean;
}

function tableHead(ctx: Ctx): XRow {
  return {
    kind: "tablehead", label: "", indent: 1,
    heads: ctx.input.periods.slice(0, ctx.faceCols).map((p) => p.label),
  };
}

function accountTable(
  ctx: Ctx, rows: XRow[], accounts: FsAccountMeta[], sign: 1 | -1, totalLabel: string, keyPrefix: string,
): void {
  rows.push(tableHead(ctx));
  const ids: string[] = [];
  const sorted = [...accounts].sort((a, b) => a.code.localeCompare(b.code));
  for (const a of sorted) {
    const contra = assignAccount(a)?.contra ?? false;
    const vals = Array.from({ length: ctx.faceCols }, (_, i) => round2(sign * ctx.bal.closed(i, a.code)));
    if (vals.every((v) => v === 0) && ctx.input.options.suppressZeroRows) continue;
    const id = `${keyPrefix}.${a.code}`;
    rows.push({
      kind: contra ? "less" : "caption", label: accountLineLabel(a, contra), indent: 1, id,
      cells: vals.map((v) => cell(v)),
    });
    ids.push(id);
  }
  const totals = Array.from({ length: ctx.faceCols }, (_, i) =>
    round2(sorted.reduce((s, a) => s + sign * ctx.bal.closed(i, a.code), 0)),
  );
  rows.push({
    kind: "subtotal", label: totalLabel, indent: 1, id: `${keyPrefix}.total`,
    cells: totals.map((v) => cell(v, ids.length ? { t: "sum", ids } : undefined)),
  });
}

function buildNoteSpecs(ctx: Ctx): NoteSpec[] {
  const { input } = ctx;
  const p = input.profile;
  const specs: NoteSpec[] = [];

  // 1–3: narrative policy notes (already merged; placeholders warned by caller).
  for (const policy of input.policyNotes) {
    specs.push({
      key: `policy.${policy.title}`, title: policy.title, always: true,
      build: (_c, rows) => {
        for (const para of policy.body.split(/\n\s*\n/).map((s) => s.trim()).filter(Boolean)) {
          rows.push({ kind: "para", label: para, indent: 0 });
        }
      },
    });
  }

  specs.push({
    key: "cash", title: "Cash and Cash Equivalents", always: true,
    build: (c, rows) => accountTable(c, rows, c.accountsByCaption.get("cash") ?? [], 1, "Total cash and cash equivalents", "n.cash"),
  });
  specs.push({
    key: "receivables", title: "Trade and Other Receivables",
    build: (c, rows) => accountTable(c, rows, c.accountsByCaption.get("receivables") ?? [], 1, "Trade and other receivables - net", "n.recv"),
  });
  specs.push({
    key: "advances", title: "Advances to Employees and Officers",
    build: (c, rows) => accountTable(c, rows, c.accountsByCaption.get("advances") ?? [], 1, "Total advances", "n.adv"),
  });

  // PPE rollforward by class (§F.2) — current year, Total column formulas.
  specs.push({
    key: "ppe", title: "Property, Plant and Equipment",
    build: (c, rows) => {
      const classes = (c.accountsByCaption.get("ppe") ?? [])
        .filter((a) => !(assignAccount(a)?.contra ?? false))
        .sort((a, b) => a.code.localeCompare(b.code));
      const hasPrior = c.input.periods.length > 1;
      const heads = [...classes.map((a) => a.name), "Total"];
      rows.push({ kind: "para", label: "The rollforward of this account for the current period follows:", indent: 0 });
      rows.push({ kind: "tablehead", label: "", indent: 1, heads });
      const n = classes.length;
      const rowOf = (label: string, id: string, per: (a: FsAccountMeta) => number, kind: RowKind = "caption") => {
        const vals = classes.map(per).map(round2);
        const total = round2(vals.reduce((s, v) => s + v, 0));
        rows.push({
          kind, label, indent: 1, id,
          cells: [
            ...vals.map((v) => cell(v)),
            cell(total, { t: "terms", terms: vals.map((_, ci) => ({ s: 1 as const, id, col: ci })) }),
          ],
        });
        return id;
      };
      const beg = (a: FsAccountMeta) => (hasPrior ? c.bal.closed(1, a.code) : 0);
      const end = (a: FsAccountMeta) => c.bal.closed(0, a.code);
      const ids = [
        rowOf("Cost, beginning of period", "n.ppe.beg", beg),
        rowOf("Additions", "n.ppe.add", (a) => Math.max(end(a) - beg(a), 0)),
        rowOf("Disposals", "n.ppe.disp", (a) => Math.min(end(a) - beg(a), 0)),
      ];
      const costEnd = rowOf("Cost, end of period", "n.ppe.end", end, "subtotal");
      const costEndRow = rows[rows.length - 1]!;
      costEndRow.cells = costEndRow.cells!.map((cellV, ci) =>
        ci < n
          ? cell(cellV!.v ?? 0, { t: "terms", terms: ids.map((id) => ({ s: 1 as const, id, col: ci })) })
          : cellV,
      );
      const accum = (c.accountsByCaption.get("ppe") ?? []).filter((a) => assignAccount(a)?.contra);
      const accumBeg = round2(-accum.reduce((s, a) => s + (hasPrior ? c.bal.closed(1, a.code) : 0), 0));
      const accumEnd = round2(-accum.reduce((s, a) => s + c.bal.closed(0, a.code), 0));
      const depCharge = round2(accumEnd - accumBeg);
      const accRow = (label: string, id: string, v: number, kind: RowKind = "caption", f?: FormulaSpec) => {
        rows.push({
          kind, label, indent: 1, id,
          cells: [...Array.from({ length: n }, () => null), cell(v, f)],
        });
      };
      accRow("Accumulated depreciation, beginning of period", "n.ppe.accbeg", accumBeg);
      accRow("Depreciation for the period", "n.ppe.dep", depCharge);
      accRow("Accumulated depreciation, end of period", "n.ppe.accend", accumEnd, "subtotal",
        { t: "terms", terms: [{ s: 1, id: "n.ppe.accbeg", col: n }, { s: 1, id: "n.ppe.dep", col: n }] });
      const ncv = round2((rowLast(rows, costEnd, n) ?? 0) - accumEnd);
      accRow("Net carrying value, end of period", "n.ppe.ncv", ncv, "total",
        { t: "terms", terms: [{ s: 1, id: "n.ppe.end", col: n }, { s: -1, id: "n.ppe.accend", col: n }] });
    },
  });

  specs.push({
    key: "payables", title: "Trade and Other Payables", always: true,
    build: (c, rows) => {
      const accounts = [
        ...(c.accountsByCaption.get("payables") ?? []),
        ...(c.accountsByCaption.get("statutory") ?? []),
      ].filter((a) => !(assignAccount(a)?.system ?? false));
      accountTable(c, rows, accounts, -1, "Total trade and other payables", "n.pay");
    },
  });

  specs.push({
    key: "related-party", title: "Related Party Transactions", always: true,
    build: (c, rows) => {
      rows.push({
        kind: "para", indent: 0,
        label:
          "In the ordinary course of business, the Company transacts with its officers, employees and " +
          "shareholders. Outstanding balances with related parties as at the reporting date follow:",
      });
      const related = c.input.engine.accounts.filter((a) =>
        a.code.startsWith("1002") || a.code === "2002002" || a.code === "2002001",
      );
      accountTable(c, rows, related, 1, "Net related-party balances", "n.rpt");
    },
  });

  specs.push({
    key: "income-taxes", title: "Income Taxes", always: true,
    build: (c, rows) => {
      const cols = Array.from({ length: c.faceCols }, (_, i) => i);
      const hasOlder = (i: number) => i + 1 < c.input.periods.length;
      const deferred = cols.map((i) => {
        if (!hasOlder(i)) return 0;
        const dta = c.bal.closed(i, "9001001") - c.bal.closed(i + 1, "9001001");
        const dtl = c.bal.closed(i, "9002001") - c.bal.closed(i + 1, "9002001");
        return round2(-dta - dtl);
      });
      const current = cols.map((i) => round2((c.is.provision[i] ?? 0) - (deferred[i] ?? 0)));
      rows.push({ kind: "para", label: "The provision for income tax consists of:", indent: 0 });
      rows.push(tableHead(c));
      rows.push({ kind: "caption", label: "Current", indent: 1, id: "n.tax.cur", cells: current.map((v) => cell(v)) });
      rows.push({ kind: "caption", label: "Deferred", indent: 1, id: "n.tax.def", cells: deferred.map((v) => cell(v)) });
      rows.push({
        kind: "subtotal", label: "Provision for income tax", indent: 1, id: "n.tax.total",
        cells: cols.map((i) => cell(c.is.provision[i] ?? 0, { t: "sum", ids: ["n.tax.cur", "n.tax.def"] })),
      });
      rows.push({ kind: "para", label: "The reconciliation to the statutory income-tax rate follows:", indent: 0 });
      rows.push(tableHead(c));
      const rate = c.input.options.statutoryRate;
      const atStatutory = cols.map((i) => round2((c.is.nibt[i] ?? 0) * rate));
      const others = cols.map((i) => round2((c.is.provision[i] ?? 0) - (atStatutory[i] ?? 0)));
      rows.push({
        kind: "caption", label: `Tax at the statutory rate of ${(rate * 100).toFixed(0)}%`, indent: 1,
        id: "n.tax.stat", cells: atStatutory.map((v) => cell(v)),
      });
      rows.push({
        kind: "caption", label: "Tax effects of permanent differences and others", indent: 1,
        id: "n.tax.perm", cells: others.map((v) => cell(v)),
      });
      rows.push({
        kind: "subtotal", label: "Provision per statements", indent: 1, id: "n.tax.per",
        cells: cols.map((i) => cell(c.is.provision[i] ?? 0, { t: "sum", ids: ["n.tax.stat", "n.tax.perm"] })),
      });
    },
  });

  specs.push({
    key: "capital-stock", title: "Capital Stock", always: true,
    build: (c, rows) => {
      const authorized = p.authorizedShares;
      const issued = p.issuedShares;
      const par = p.parValue;
      const fmtShares = (n: number | null, ph: string) => (n === null ? ph : n.toLocaleString("en-PH"));
      rows.push({
        kind: "para", indent: 0,
        label:
          `The Company's authorized capital stock is ${fmtShares(authorized, "[authorized shares]")} common shares ` +
          `at a par value of ${par === null ? "[par value]" : `₱${par.toFixed(2)}`} per share, of which ` +
          `${fmtShares(issued, "[issued shares]")} shares are issued and outstanding.`,
      });
      rows.push(tableHead(c));
      const capAccounts = c.accountsByCaption.get("share-capital") ?? [];
      const sc = Array.from({ length: c.faceCols }, (_, i) =>
        round2(-capAccounts.reduce((s, a) => s + c.bal.closed(i, a.code), 0)),
      );
      rows.push({
        kind: "caption", label: "Issued and fully paid", indent: 1, id: "n.cap.issued",
        cells: sc.map((v) => cell(v)),
      });
    },
  });

  for (const custom of input.customNotes) {
    specs.push({
      key: `custom.${custom.title}`, title: custom.title || "Other Matters", always: true,
      build: (_c, rows) => {
        for (const para of custom.body.split(/\n\s*\n/).map((s) => s.trim()).filter(Boolean)) {
          rows.push({ kind: "para", label: para, indent: 0 });
        }
      },
    });
  }
  return specs;
}

function rowLast(rows: XRow[], id: string, col: number): number | null {
  const row = rows.find((r) => r.id === id);
  return row?.cells?.[col]?.v ?? null;
}

function buildNotes(ctx: Ctx, specs: NoteSpec[]): XSheet {
  const { input } = ctx;
  const rows: XRow[] = [];
  let n = 0;
  for (const spec of specs) {
    const body: XRow[] = [];
    spec.build(ctx, body);
    const hasAmounts = body.some((r) => r.cells && !allZero(r.cells));
    if (!spec.always && !hasAmounts && input.options.suppressZeroRows) continue;
    n += 1;
    rows.push({ kind: "notetitle", label: `${n}. ${spec.title.toUpperCase()}`, indent: 0 });
    rows.push(...body);
    rows.push({ kind: "spacer", label: "", indent: 0 });
  }
  const periods = input.periods.slice(0, ctx.faceCols);
  return {
    name: "Notes",
    titles: [
      input.profile.entityName,
      "NOTES TO FINANCIAL STATEMENTS",
      forLine(periods),
      "(Amounts in Philippine Peso)",
    ],
    amountHeads: [],
    amountCols: Math.max(ctx.faceCols, 4),
    hasNoteCol: false,
    rows,
  };
}

/** Pre-assign note numbers so the BS/IS faces can reference them. Mirrors the
 *  inclusion logic in buildNotes. */
function assignNoteNumbers(ctx: Ctx, specs: NoteSpec[]): void {
  let n = 0;
  for (const spec of specs) {
    const body: XRow[] = [];
    spec.build(ctx, body);
    const hasAmounts = body.some((r) => r.cells && !allZero(r.cells));
    if (!spec.always && !hasAmounts && ctx.input.options.suppressZeroRows) continue;
    n += 1;
    ctx.noteNo.set(spec.key, n);
  }
}

// ----------------------------------------------------------------- entry point

export function buildExportModel(input: ModelInput): ExportModel {
  const ctx = buildContext(input);

  // Missing company-profile fields → keep placeholders, warn (§F.1).
  const p = input.profile;
  const missing: Array<[string, unknown]> = [
    ["SEC Registration No.", p.secRegistrationNo],
    ["registered address", p.registeredAddress],
    ["principal business activity", p.businessDescription],
    ["BOD approval date", p.approvalDate],
    ["authorized shares", p.authorizedShares],
    ["issued shares", p.issuedShares],
    ["par value", p.parValue],
  ];
  for (const [label, value] of missing) {
    if (value === null || value === undefined || value === "") {
      ctx.warnings.push({
        code: "missing-profile-field",
        message: `Company-profile field "${label}" is missing; the Notes keep a bracket placeholder.`,
      });
    }
  }

  const includeNotes = input.includeNotes !== false;
  if (!includeNotes) {
    // PH filing rule: gross sales/revenue of P3,000,000 and above requires
    // Notes to Financial Statements — warn when this export omits them.
    const grossRevenue = round2(
      -input.engine.accounts
        .filter((a) => a.class === "Revenue" && a.code !== "3901001")
        .reduce((s2, a) => s2 + ctx.bal.raw(0, a.code), 0),
    );
    if (grossRevenue >= NOTES_REQUIRED_THRESHOLD) {
      ctx.warnings.push({
        code: "notes-required",
        message:
          `Gross sales/revenue of ${grossRevenue.toLocaleString("en-PH", { minimumFractionDigits: 2 })} ` +
          `meets or exceeds the P3,000,000 threshold — Notes to Financial Statements are required, ` +
          `but this report is set not to generate them.`,
      });
    }
  }

  const sheets: XSheet[] = [];
  if (includeNotes) {
    const specs = buildNoteSpecs(ctx);
    assignNoteNumbers(ctx, specs);
    sheets.push(buildBs(ctx), buildIs(ctx), buildCf(ctx), buildCe(ctx), buildNotes(ctx, specs));
  } else {
    sheets.push(buildBs(ctx), buildIs(ctx), buildCf(ctx), buildCe(ctx));
  }
  return { sheets, warnings: ctx.warnings, currentLabel: input.periods[0]?.label ?? "" };
}

export function exportFileName(entityName: string, currentLabel: string): string {
  const entity = entityName.replace(/[^\w\- ]+/g, "").replace(/\s+/g, " ").trim() || "Financial Statements";
  return `${entity} FS${currentLabel ? ` ${currentLabel.replace(/[^\w\-]+/g, "")}` : ""}.xlsx`;
}
