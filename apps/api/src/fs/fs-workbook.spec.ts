// Acceptance tests for the reworked FS export (audit spec §A–§G).
//
// A seeded three-period trial balance exercises every major group: contra
// accounts, negatives, comparative balances, a share issuance, a dividends
// plug, and nonzero system/plug accounts (PDCs, opening-balance accounts,
// OPC Owner's Equity) to drive the warning log. The generated workbook is
// round-tripped through the real xlsx writer and re-read with exceljs; every
// formula is re-evaluated by a small SUM/± interpreter to prove that a
// recalculation yields the cached results with zero formula errors.

import * as ExcelJS from "exceljs";
import type { FsAccountMeta } from "./fs-engine";
import {
  buildExportModel,
  DEFAULT_EXPORT_OPTIONS,
  type ExportModel,
  type ModelInput,
} from "./fs-statement-model";
import { AMOUNT_FORMAT, renderWorkbook, workbookBuffer } from "./fs-workbook";

// ------------------------------------------------------------------- fixture

const A = (code: string, name: string, cls: string, type: string): FsAccountMeta => ({
  code, name, class: cls, accountType: type, parentCode: null, parentName: null,
});

const ACCOUNTS: FsAccountMeta[] = [
  A("1001", "Cash in Bank", "Asset", "Bank Accounts"),
  A("1004", "Petty Cash", "Asset", "Current Asset"),
  A("1007", "Trade Receivable - Client", "Asset", "Current Asset"),
  A("1902001", "Allowance for Doubtful Accounts", "Asset", "Current Asset"),
  A("1002002", "Accounts Receivable from Employees", "Asset", "Current Asset"),
  A("1008", "Prepaid Expenses", "Asset", "Current Asset"),
  A("1009", "Inventory", "Asset", "Current Asset"),
  A("8001001", "Input VAT", "Asset", "Current Asset"),
  A("9001002", "Creditable Withholding Tax", "Asset", "Current Asset"),
  A("9001001", "Deferred Tax Asset", "Asset", "Non-current Asset"),
  A("1003001", "Work Equipment", "Asset", "Fixed Asset"),
  A("1901001", "Accumulated Depreciation", "Asset", "Fixed Asset"),
  A("2001001", "Accounts Payable", "Liability", "Current Liability"),
  A("2800001", "Post-Dated Checks Issued", "Liability", "Current Liability"),
  A("2700001", "Opening Balance Adjustments", "Liability", "Current Liability"),
  A("2101001", "Withholding Tax on Compensation Payable", "Liability", "Current Liability"),
  A("2008001", "SSS EmployER Contribution", "Liability", "Current Liability"),
  A("2003002", "Income Tax Payable", "Liability", "Current Liability"),
  A("2003003", "Percentage Tax Payable", "Liability", "Current Liability"),
  A("2600001", "Unearned Revenue", "Liability", "Current Liability"),
  A("8002001", "Output VAT", "Liability", "Current Liability"),
  A("2005", "Loans Payable - Current", "Liability", "Current Liability"),
  A("2501", "Loans Payable - Non-Current", "Liability", "Non-current Liability"),
  A("9002001", "Deferred Tax Liability", "Liability", "Non-current Liability"),
  A("2901004", "Share Capital", "Equity", "Shareholders Equity"),
  A("2901005", "Additional Paid-in Capital", "Equity", "Shareholders Equity"),
  A("2901001", "Owner's Equity", "Equity", "Shareholders Equity"),
  A("2901002", "Opening Balance Offset", "Equity", "Shareholders Equity"),
  A("2901003", "Retained Earnings", "Equity", "Shareholders Equity"),
  A("3001001", "Sales", "Revenue", "Operating Revenue"),
  A("3001002", "Service Income", "Revenue", "Operating Revenue"),
  A("3901001", "Sales Returns, Allowances and Discounts", "Revenue", "Other Revenue"),
  A("3002001", "Interest Income", "Revenue", "Other Revenue"),
  A("4001", "Cost of Goods Sold", "Expense", "Direct Costs"),
  A("4002", "Cost of Services", "Expense", "Direct Costs"),
  A("5001001", "Salaries and Wages", "Expense", "Operating Expense"),
  A("5002004", "Office Supplies", "Expense", "Operating Expense"),
  A("5003001", "Electricity", "Expense", "Operating Expense"),
  A("5004001", "Finance Cost", "Expense", "Operating Expense"),
  A("5005001", "Business Taxes", "Expense", "Operating Expense"),
  A("5006", "Exchange Gain or Loss", "Expense", "Operating Expense"),
  A("5007001", "Depreciation Expense", "Expense", "Operating Expense"),
  A("5007002", "Bad Debt Expense", "Expense", "Operating Expense"),
  A("5008", "Provision for Income Tax", "Expense", "Operating Expense"),
];

// Debit-positive balances per period: [current P0, prior P1, oldest P2].
const BALANCES: Record<string, [number, number, number]> = {
  "1004": [5000, 5000, 5000],
  "1007": [300000, 200000, 100000],
  "1902001": [-15000, -10000, -5000],
  "1002002": [20000, 15000, 10000],
  "1008": [12000, 10000, 8000],
  "1009": [50000, 40000, 30000],
  "8001001": [8000, 6000, 4000],
  "9001002": [9000, 7000, 5000],
  "9001001": [6000, 5000, 4000],
  "1003001": [250000, 200000, 150000],
  "1901001": [-80000, -50000, -30000],
  "2001001": [-90000, -70000, -50000],
  "2800001": [-7000, -5000, -3000], // system → warning
  "2700001": [-1000, -1000, -1000], // system → warning
  "2101001": [-12000, -9000, -6000],
  "2008001": [-8000, -6000, -4000],
  "2003002": [-20000, -15000, -10000],
  "2003003": [-3000, -2500, -2000],
  "2600001": [-25000, -20000, -15000],
  "8002001": [-11000, -8000, -6000],
  "2005": [-60000, -40000, -30000],
  "2501": [-100000, -120000, -140000],
  "9002001": [-4000, -3000, -2000],
  "2901004": [-500000, -400000, -400000], // 100k issuance in current year
  "2901005": [-50000, -50000, -50000],
  "2901001": [-10000, -10000, -10000], // system → warning
  "2901002": [-2000, -2000, -2000], // system → warning
  "2901003": [-295500, -183500, -100000], // pre-closing; 50k dividends plug in P0
  "3001001": [-900000, -700000, -500000],
  "3001002": [-100000, -80000, -60000],
  "3901001": [20000, 15000, 10000], // contra revenue
  "3002001": [-5000, -4000, -3000],
  "4001": [300000, 250000, 200000],
  "4002": [100000, 80000, 60000],
  "5001001": [200000, 160000, 120000],
  "5002004": [30000, 25000, 20000],
  "5003001": [15000, 12000, 10000],
  "5004001": [8000, 6000, 5000],
  "5005001": [10000, 8000, 6000],
  "5006": [2000, 1000, 500],
  "5007001": [30000, 20000, 15000], // == Δ accumulated depreciation (no residual)
  "5007002": [5000, 5000, 3000], // == Δ allowance
  "5008": [50000, 40000, 30000],
};

const PERIOD_IDS = ["p0", "p1", "p2"];

function fixtureInput(overrides: Partial<ModelInput["options"]> = {}): ModelInput {
  // Cash in Bank is the balancing plug so every period's TB sums to zero.
  const tb: { periodId: string; accountCode: string; amount: number }[] = [];
  PERIOD_IDS.forEach((pid, i) => {
    let sum = 0;
    for (const [code, vals] of Object.entries(BALANCES)) {
      tb.push({ periodId: pid, accountCode: code, amount: vals[i]! });
      sum += vals[i]!;
    }
    tb.push({ periodId: pid, accountCode: "1001", amount: -sum });
    expect(-sum).toBeGreaterThan(0); // sanity: positive bank balance
  });
  const longPolicy =
    "The accompanying financial statements have been prepared in compliance with the Philippine " +
    "Financial Reporting Standards for Small Entities as approved by the Financial and Sustainability " +
    "Reporting Standards Council and adopted by the Securities and Exchange Commission. The financial " +
    "statements have been prepared on the historical cost basis and are presented in Philippine Peso, " +
    "which is also the Company's functional currency; all values are rounded to the nearest peso unless " +
    "otherwise indicated.";
  return {
    profile: {
      entityName: "Sample Corp OPC",
      secRegistrationNo: null, // missing → warning + bracket placeholder
      registeredAddress: null,
      businessDescription: "testing services",
      framework: "PFRS for Small Entities",
      functionalCurrency: "Philippine Peso (₱)",
      approvalDate: "2027-04-15",
      authorizedShares: null, // missing → warning
      issuedShares: null,
      parValue: null,
    },
    periods: [
      { id: "p0", label: "2026", endDate: "2026-12-31", periodType: "FY", sortOrder: 0 },
      { id: "p1", label: "2025", endDate: "2025-12-31", periodType: "FY", sortOrder: 1 },
      { id: "p2", label: "2024", endDate: "2024-12-31", periodType: "FY", sortOrder: 2 },
    ],
    engine: {
      accounts: ACCOUNTS,
      periods: PERIOD_IDS.map((id, i) => ({ id, label: ["2026", "2025", "2024"][i]!, sortOrder: i })),
      tb,
      adjustments: [],
    },
    policyNotes: [{ title: "Basis of Preparation", body: longPolicy }],
    customNotes: [],
    options: { ...DEFAULT_EXPORT_OPTIONS, ...overrides },
  };
}

// --------------------------------------------------------- formula evaluator

type WS = ExcelJS.Worksheet;

function cellNumber(wb: ExcelJS.Workbook, sheetName: string, addr: string): number {
  const ws = wb.getWorksheet(sheetName)!;
  const v = ws.getCell(addr).value;
  if (v === null || v === undefined) return 0;
  if (typeof v === "number") return v;
  if (typeof v === "object" && "result" in v) return Number(v.result ?? 0);
  return 0;
}

/** Evaluate the formula grammar this exporter emits: SUM(cells/ranges),
 *  [Sheet!]A1 terms joined with +/-, optionally wrapped in ROUND(expr,2). */
function evalFormula(wb: ExcelJS.Workbook, ownSheet: string, formula: string): number {
  let f = formula.trim();
  let doRound = false;
  const roundMatch = /^ROUND\((.*),2\)$/.exec(f);
  if (roundMatch) {
    doRound = true;
    f = roundMatch[1]!;
  }
  const sumMatch = /^SUM\((.*)\)$/.exec(f);
  const refVal = (token: string): number => {
    const m = /^(?:([A-Za-z]+)!)?\$?([A-Z]+)\$?(\d+)$/.exec(token.trim());
    if (!m) throw new Error(`Unparseable ref "${token}" in ${formula}`);
    return cellNumber(wb, m[1] ?? ownSheet, `${m[2]}${m[3]}`);
  };
  let out = 0;
  if (sumMatch) {
    for (const arg of sumMatch[1]!.split(",")) {
      const range = /^([A-Z]+)(\d+):([A-Z]+)(\d+)$/.exec(arg.trim());
      if (range) {
        for (let r = Number(range[2]); r <= Number(range[4]); r++) {
          out += cellNumber(wb, ownSheet, `${range[1]}${r}`);
        }
      } else {
        out += refVal(arg);
      }
    }
  } else {
    // Signed term expression like C8-C10+IS!C42.
    for (const m of f.matchAll(/([+-]?)((?:[A-Za-z]+!)?\$?[A-Z]+\$?\d+)/g)) {
      out += (m[1] === "-" ? -1 : 1) * refVal(m[2]!);
    }
  }
  return doRound ? Math.round(out * 100) / 100 : out;
}

function findRow(ws: WS, label: string): number {
  let found = 0;
  ws.eachRow((row, n) => {
    if (!found && row.getCell(1).value === label) found = n;
  });
  expect(found).toBeGreaterThan(0);
  return found;
}

function amountCell(ws: WS, label: string, colOffset = 0): ExcelJS.Cell {
  const start = ws.name === "BS" || ws.name === "IS" ? 3 : 2;
  return ws.getCell(findRow(ws, label), start + colOffset);
}

const resultOf = (cell: ExcelJS.Cell): number => {
  const v = cell.value;
  if (typeof v === "number") return v;
  if (v && typeof v === "object" && "result" in v) return Number(v.result ?? 0);
  return 0;
};
const formulaOf = (cell: ExcelJS.Cell): string | null => {
  const v = cell.value;
  return v && typeof v === "object" && "formula" in v ? String(v.formula) : null;
};

// ------------------------------------------------------------------- tests

describe("FS export rework — acceptance criteria", () => {
  let model: ExportModel;
  let rendered: ExcelJS.Workbook;
  let wb: ExcelJS.Workbook; // round-tripped through the xlsx writer

  beforeAll(async () => {
    const input = fixtureInput();
    model = buildExportModel(input);
    rendered = renderWorkbook(model, input.profile.entityName);
    const buffer = await workbookBuffer(rendered);
    wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer as unknown as ArrayBuffer);
  });

  it("keeps the five-sheet structure (§H)", () => {
    expect(wb.worksheets.map((w) => w.name)).toEqual(["BS", "IS", "CF", "CE", "Notes"]);
  });

  it("1. TOTAL ASSETS == TOTAL LIABILITIES AND EQUITY and the BS check cell is 0", () => {
    const bs = wb.getWorksheet("BS")!;
    for (const col of [0, 1]) {
      const ta = resultOf(amountCell(bs, "TOTAL ASSETS", col));
      const tle = resultOf(amountCell(bs, "TOTAL LIABILITIES AND EQUITY", col));
      expect(ta).toBeCloseTo(tle, 2);
      expect(resultOf(amountCell(bs, "Check (must be 0)", col))).toBeCloseTo(0, 2);
    }
  });

  it("2. every Total / Net cash / Balance-end cell contains a real formula", () => {
    const expectFormula = (sheet: string, label: string) => {
      const cell = amountCell(wb.getWorksheet(sheet)!, label);
      expect(formulaOf(cell)).toBeTruthy();
    };
    for (const label of ["Total Current Assets", "Total Non-Current Assets", "TOTAL ASSETS", "TOTAL LIABILITIES", "Total Equity", "TOTAL LIABILITIES AND EQUITY"]) {
      expectFormula("BS", label);
    }
    for (const label of ["Net revenues", "GROSS PROFIT", "Total operating expenses", "INCOME FROM OPERATIONS", "NET INCOME/(LOSS) BEFORE TAX", "NET INCOME/(LOSS) AFTER TAX"]) {
      expectFormula("IS", label);
    }
    for (const label of [
      "Net cash provided by/(used in) operating activities",
      "Net cash provided by/(used in) investing activities",
      "Net cash provided by/(used in) financing activities",
      "NET INCREASE/(DECREASE) IN CASH",
      "Cash and cash equivalents, end of period",
    ]) {
      expectFormula("CF", label);
    }
    expectFormula("CE", "Balance at end of period");
  });

  it("3. IS net income is the single source for the CE line and CF starting line", () => {
    const isNiat = resultOf(amountCell(wb.getWorksheet("IS")!, "NET INCOME/(LOSS) AFTER TAX"));
    const isNibt = resultOf(amountCell(wb.getWorksheet("IS")!, "NET INCOME/(LOSS) BEFORE TAX"));
    expect(isNiat).toBeCloseTo(235000, 2);
    expect(isNibt).toBeCloseTo(285000, 2);

    const ce = wb.getWorksheet("CE")!;
    // Current-year block is the last "Net income/(loss) for the period" row; RE = column D.
    let ceNiRow = 0;
    ce.eachRow((row, n) => {
      if (row.getCell(1).value === "Net income/(loss) for the period") ceNiRow = n;
    });
    const ceNi = ce.getCell(ceNiRow, 4);
    expect(formulaOf(ceNi)).toContain("IS!");
    expect(resultOf(ceNi)).toBeCloseTo(isNiat, 2);

    const cfStart = amountCell(wb.getWorksheet("CF")!, "Net income/(loss) before tax");
    expect(formulaOf(cfStart)).toContain("IS!");
    expect(resultOf(cfStart)).toBeCloseTo(isNibt, 2);
  });

  it("4. CF end-of-period cash ties to the BS; net change equals the cash delta", () => {
    const cf = wb.getWorksheet("CF")!;
    const bs = wb.getWorksheet("BS")!;
    for (const col of [0, 1]) {
      const end = resultOf(amountCell(cf, "Cash and cash equivalents, end of period", col));
      const begin = resultOf(amountCell(cf, "Cash and cash equivalents, beginning of period", col));
      const net = resultOf(amountCell(cf, "NET INCREASE/(DECREASE) IN CASH", col));
      expect(net).toBeCloseTo(end - begin, 2);
      expect(resultOf(amountCell(cf, "Check vs BS cash (must be 0)", col))).toBeCloseTo(0, 2);
      expect(end).toBeCloseTo(resultOf(amountCell(bs, "Cash and cash equivalents", col)), 2);
    }
  });

  it("5. re-evaluating every formula reproduces the cached results — zero errors", () => {
    let formulas = 0;
    for (const ws of wb.worksheets) {
      ws.eachRow((row) => {
        row.eachCell((cell) => {
          const f = formulaOf(cell);
          if (!f) return;
          formulas += 1;
          expect(f).not.toMatch(/#(REF|NAME|DIV|VALUE)/);
          const recalculated = evalFormula(wb, ws.name, f);
          expect(recalculated).toBeCloseTo(resultOf(cell), 1);
        });
      });
    }
    expect(formulas).toBeGreaterThan(40);
  });

  it("6. labels never start with a literal space; hierarchy uses alignment indent", () => {
    for (const ws of wb.worksheets) {
      ws.eachRow((row) => {
        row.eachCell((cell) => {
          if (typeof cell.value === "string") expect(cell.value.startsWith(" ")).toBe(false);
        });
      });
    }
    const cashLabelRow = findRow(wb.getWorksheet("BS")!, "Cash and cash equivalents");
    expect(wb.getWorksheet("BS")!.getCell(cashLabelRow, 1).alignment?.indent).toBeGreaterThanOrEqual(1);
  });

  it("7. formal faces never show system/plug accounts or Retained Earnings as a CF line", () => {
    const banned = ["Opening Balance Adjustments", "Opening Balance Offset", "Post-Dated Checks Issued", "Owner's Equity"];
    for (const name of ["BS", "IS", "CF", "CE"]) {
      const ws = wb.getWorksheet(name)!;
      ws.eachRow((row) => {
        row.eachCell((cell) => {
          if (typeof cell.value !== "string") return;
          for (const b of banned) expect(cell.value).not.toContain(b);
          if (name === "CF") expect(cell.value).not.toBe("Retained Earnings");
        });
      });
    }
  });

  it("8. amount cells carry the parentheses/dash format and negatives render in it", () => {
    const taxesPaid = amountCell(wb.getWorksheet("CF")!, "Income taxes paid");
    expect(taxesPaid.numFmt).toBe(AMOUNT_FORMAT);
    expect(resultOf(taxesPaid)).toBeLessThan(0);
    const additions = amountCell(wb.getWorksheet("CF")!, "Additions to property, plant and equipment");
    expect(resultOf(additions)).toBeLessThan(0);
    expect(amountCell(wb.getWorksheet("BS")!, "Cash and cash equivalents").numFmt).toBe(AMOUNT_FORMAT);
  });

  it("9. comparative mode: two amount columns on statements and note tables", () => {
    const bs = wb.getWorksheet("BS")!;
    expect(bs.getCell(6, 3).value).toBe("2026");
    expect(bs.getCell(6, 4).value).toBe("2025");
    expect(wb.getWorksheet("IS")!.getCell(6, 3).value).toBe("2026");
    expect(wb.getWorksheet("CF")!.getCell(6, 2).value).toBe("2026");
    expect(wb.getWorksheet("CF")!.getCell(6, 3).value).toBe("2025");
    // CE stacks one year-block per column.
    const ceLabels: string[] = [];
    wb.getWorksheet("CE")!.eachRow((row) => {
      const v = row.getCell(1).value;
      if (typeof v === "string" && v.startsWith("For the year ended")) ceLabels.push(v);
    });
    expect(ceLabels).toHaveLength(2);
    // A notes table head carries both period labels.
    let notesHead = false;
    wb.getWorksheet("Notes")!.eachRow((row) => {
      if (row.getCell(2).value === "2026" && row.getCell(3).value === "2025") notesHead = true;
    });
    expect(notesHead).toBe(true);
  });

  it("10. print setup on every sheet; notes paragraphs wrap", () => {
    for (const ws of rendered.worksheets) {
      expect(ws.pageSetup.printArea).toBeTruthy();
      expect(ws.pageSetup.fitToWidth).toBe(1);
      expect(ws.pageSetup.printTitlesRow).toBeTruthy();
      expect(ws.pageSetup.orientation).toBe("portrait");
      expect(ws.headerFooter.oddFooter).toContain("Page &P of &N");
    }
    const notes = rendered.getWorksheet("Notes")!;
    let wrapped = false;
    notes.eachRow((row) => {
      const cell = row.getCell(1);
      if (typeof cell.value === "string" && cell.value.length > 200 && cell.alignment?.wrapText) wrapped = true;
    });
    expect(wrapped).toBe(true);
    // Freeze panes below the header row on the main statements.
    expect(rendered.getWorksheet("BS")!.views[0]).toMatchObject({ state: "frozen", ySplit: 6 });
  });

  it("11. the export log warns on system accounts, plugs and missing profile fields", () => {
    const codes = model.warnings.map((w) => w.code);
    expect(codes).toContain("system-account");
    expect(codes).toContain("missing-profile-field");
    expect(codes).toContain("dividends-plug");
    const text = model.warnings.map((w) => w.message).join("\n");
    expect(text).toContain("2800001");
    expect(text).toContain("2901001");
    expect(text).toContain("SEC Registration No.");
  });

  it("titles follow §E.6 wording with the peso subtitle", () => {
    const bs = wb.getWorksheet("BS")!;
    expect(bs.getCell(1, 1).value).toBe("Sample Corp OPC");
    expect(bs.getCell(3, 1).value).toBe("As of December 31, 2026");
    expect(bs.getCell(4, 1).value).toBe("(Amounts in Philippine Peso)");
    expect(wb.getWorksheet("IS")!.getCell(3, 1).value).toContain("For the years ended");
  });

  it("conditional cost heading shows COST OF SALES AND SERVICES when both are active", () => {
    findRow(wb.getWorksheet("IS")!, "COST OF SALES AND SERVICES");
  });

  it("interest income sits under OTHER INCOME (CHARGES), not REVENUES", () => {
    const is = wb.getWorksheet("IS")!;
    const revRow = findRow(is, "REVENUES");
    const otherRow = findRow(is, "OTHER INCOME (CHARGES)");
    const intRow = findRow(is, "Interest income");
    expect(intRow).toBeGreaterThan(otherRow);
    expect(otherRow).toBeGreaterThan(revRow);
  });

  it("CE is a Share Capital / APIC / Retained Earnings / Total matrix with an issuance row", () => {
    const ce = wb.getWorksheet("CE")!;
    expect(ce.getCell(6, 2).value).toBe("Share Capital");
    expect(ce.getCell(6, 3).value).toBe("Additional Paid-in Capital");
    expect(ce.getCell(6, 4).value).toBe("Retained Earnings");
    expect(ce.getCell(6, 5).value).toBe("Total");
    // Current-year issuance of 100k share capital.
    let issuance = 0;
    ce.eachRow((row, n) => {
      if (row.getCell(1).value === "Issuance of share capital") issuance = n;
    });
    expect(resultOf(ce.getCell(issuance, 2))).toBeCloseTo(100000, 2);
    // Dividends plug of 50k presented as a distribution.
    let dividends = 0;
    ce.eachRow((row, n) => {
      if (row.getCell(1).value === "Dividends declared") dividends = n;
    });
    expect(resultOf(ce.getCell(dividends, 4))).toBeCloseTo(-50000, 2);
  });

  it("BS Retained Earnings references the CE ending balance (A.2)", () => {
    const re = amountCell(wb.getWorksheet("BS")!, "Retained earnings");
    expect(formulaOf(re)).toContain("CE!");
  });

  it("detailed presentation expands captions into account lines with Less: contra rows", async () => {
    const input = fixtureInput({ presentation: "detailed", suppressZeroRows: false });
    const detailedModel = buildExportModel(input);
    const detailedWb = renderWorkbook(detailedModel, input.profile.entityName);
    const buffer = await workbookBuffer(detailedWb);
    const read = new ExcelJS.Workbook();
    await read.xlsx.load(buffer as unknown as ArrayBuffer);
    const bs = read.getWorksheet("BS")!;
    findRow(bs, "Trade Receivable - Client");
    findRow(bs, "Less: Allowance for Doubtful Accounts");
    findRow(bs, "Less: Accumulated Depreciation");
  });

  it("workbook metadata is set (§G.7)", () => {
    expect(rendered.title).toContain("Sample Corp OPC");
    expect(rendered.title).toContain("FY2026");
    expect(rendered.company).toBe("Sample Corp OPC");
  });
});
