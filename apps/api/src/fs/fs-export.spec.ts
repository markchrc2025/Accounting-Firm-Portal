import * as XLSX from "xlsx";
import { buildFsWorkbook, exportFileName, longDate, periodSpan, type FsExportInput } from "./fs-export";
import type { FsRow } from "./fs-engine";

const PERIODS = [
  { id: "p1", label: "2025", endDate: "2025-12-31" },
  { id: "p0", label: "2024", endDate: "2024-12-31" },
];

const BS_ROWS: FsRow[] = [
  { kind: "section", label: "ASSETS", level: 0 },
  { kind: "line", label: "Cash in Bank", level: 1, code: "1001", amounts: { p1: 6230124, p0: 1832651.99 } },
  { kind: "total", label: "TOTAL ASSETS", level: 0, amounts: { p1: 6230124, p0: 1832651.99 }, emphasis: true },
];
const CF_ROWS: FsRow[] = [
  { kind: "section", label: "Operating Activities", level: 0 },
  // Movement statement: the earliest period has no column at all.
  { kind: "total", label: "Cash, end of period", level: 0, amounts: { p1: 6230124 }, emphasis: true },
];

function input(): FsExportInput {
  return {
    entityName: "Workscale Resources Inc.",
    periods: PERIODS,
    balanceSheet: { rows: BS_ROWS },
    incomeStatement: { rows: [{ kind: "spacer", label: "", level: 0 }] },
    cashFlow: { rows: CF_ROWS },
    changesInEquity: { rows: [] },
    notes: [
      {
        number: 1,
        title: "Corporate Information",
        paragraphs: ["The Company was incorporated in the Philippines."],
      },
      {
        number: 4,
        title: "Cash and Cash Equivalents",
        table: {
          rows: [
            { label: "Cash in Bank", amounts: { p1: 6230124, p0: 1832651.99 } },
            { label: "Total Cash and Cash Equivalents", amounts: { p1: 6230124, p0: 1832651.99 }, emphasis: true },
          ],
        },
      },
    ],
  };
}

/** Read back a sheet as a raw grid for assertions. */
function grid(wb: XLSX.WorkBook, name: string): unknown[][] {
  return XLSX.utils.sheet_to_json(wb.Sheets[name]!, { header: 1, defval: null });
}

/** Round-trip through the real xlsx writer so we assert the actual file. */
function roundTrip(i: FsExportInput): XLSX.WorkBook {
  const buffer = XLSX.write(buildFsWorkbook(i), { type: "buffer", bookType: "xlsx" }) as Buffer;
  return XLSX.read(buffer, { type: "buffer" });
}

describe("fs-export — workbook structure", () => {
  const wb = roundTrip(input());

  it("emits the five template sheets in order", () => {
    expect(wb.SheetNames).toEqual(["BS", "IS", "CF", "CE", "Notes"]);
  });

  it("writes the title block: entity, statement title, period line", () => {
    const bs = grid(wb, "BS");
    expect(bs[0]?.[0]).toBe("Workscale Resources Inc.");
    expect(bs[1]?.[0]).toBe("STATEMENT OF FINANCIAL POSITION");
    expect(bs[2]?.[0]).toBe("As of December 31, 2025");
    const cf = grid(wb, "CF");
    expect(cf[1]?.[0]).toBe("STATEMENT OF CASH FLOWS");
    expect(cf[2]?.[0]).toBe("For the periods ended December 31, 2024 and December 31, 2025");
  });

  it("writes period labels as column headers and amounts as real numbers", () => {
    const bs = grid(wb, "BS");
    expect(bs[4]).toEqual(["", "2025", "2024"]);
    const cashRow = bs.find((r) => String(r[0]).includes("Cash in Bank"))!;
    expect(cashRow[1]).toBe(6230124);
    expect(cashRow[2]).toBe(1832651.99);
    // Indentation is carried as leading spaces on the label.
    expect(cashRow[0]).toBe("  Cash in Bank");
  });

  it("leaves absent-period cells blank on movement statements", () => {
    const cf = grid(wb, "CF");
    const endRow = cf.find((r) => String(r[0]).includes("Cash, end of period"))!;
    expect(endRow[1]).toBe(6230124);
    expect(endRow[2] ?? null).toBeNull(); // earliest period: no column
  });

  it("renders notes with numbering, narrative, and period-columned tables", () => {
    const notes = grid(wb, "Notes");
    const flat = notes.map((r) => r[0]);
    expect(flat).toContain("1. CORPORATE INFORMATION");
    expect(flat).toContain("The Company was incorporated in the Philippines.");
    expect(flat).toContain("4. CASH AND CASH EQUIVALENTS");
    const total = notes.find((r) => r[0] === "Total Cash and Cash Equivalents")!;
    expect(total[1]).toBe(6230124);
  });
});

describe("fs-export — helpers", () => {
  it("formats long dates and period spans", () => {
    expect(longDate("2025-12-31")).toBe("December 31, 2025");
    expect(longDate(null)).toBe("");
    expect(periodSpan(PERIODS)).toBe("December 31, 2024 and December 31, 2025");
    expect(periodSpan([PERIODS[0]!])).toBe("December 31, 2025");
    expect(
      periodSpan([
        { id: "a", label: "2025", endDate: "2025-12-31" },
        { id: "b", label: "2024", endDate: "2024-12-31" },
        { id: "c", label: "2023", endDate: "2023-12-31" },
      ]),
    ).toBe("December 31, 2023, December 31, 2024, and December 31, 2025");
  });

  it("builds a header-safe filename from the entity and current period", () => {
    expect(exportFileName("Workscale Resources Inc.", PERIODS)).toBe("Workscale Resources Inc FS 2025.xlsx");
    expect(exportFileName('A/B "Quoted" Co.', PERIODS)).toBe("AB Quoted Co FS 2025.xlsx");
    expect(exportFileName("", [])).toBe("Financial Statements FS.xlsx");
  });
});
