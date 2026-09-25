// track-b-Form2307.test.tsx — structure and render tests for the 2307 replica.
//
// T4 reads EVERY expectation from the inventory fixture and nowhere else:
// e2e/fixtures/bir-2307-jan-2018-encs.json, authored from the BIR's own
// January 2018 (ENCS) workbook. If the form and the fixture disagree, the
// fixture is the reference.
//
// All data here is invented. No real name, TIN, address, phone or email.

import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import FIXTURE from "../../../e2e/fixtures/bir-2307-jan-2018-encs.json";
import { Form2307, type Form2307Props } from "./Form2307";

/** Collapse runs of whitespace, as the browser does when it lays text out. */
const norm = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();

/**
 * Every element whose own text is EXACTLY `text` — not an ancestor that merely
 * contains it, and not a longer string it happens to be part of (so "To" does
 * not match inside "Total", nor "2307" inside "2307 01/18ENCS").
 */
function exactElements(root: HTMLElement, text: string): HTMLElement[] {
  const want = norm(text);
  const out: HTMLElement[] = [];
  root.querySelectorAll<HTMLElement>("*").forEach((el) => {
    if (norm(el.textContent) !== want) return;
    const childHasIt = Array.from(el.children).some((c) => norm(c.textContent) === want);
    if (!childHasIt) out.push(el);
  });
  return out;
}

const EMPTY: Form2307Props = {
  payee: {},
  payor: {},
  rows: [],
  rowTotals: [],
  totals: { m1: 0, m2: 0, m3: 0, income: 0, tax: 0 },
};

const fetchSpy = vi.fn(() => Promise.reject(new Error("Form2307 must never fetch")));

beforeEach(() => {
  fetchSpy.mockClear();
  vi.stubGlobal("fetch", fetchSpy);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function sheetOf(props: Form2307Props): HTMLElement {
  const { container } = render(<Form2307 {...props} />);
  const sheet = container.querySelector<HTMLElement>(".bir-sheet");
  expect(sheet).not.toBeNull();
  return sheet!;
}

// ---------------------------------------------------------------------------
// T4 — structure parity with the official inventory
// ---------------------------------------------------------------------------

describe("T4 Form2307 structure matches the official January 2018 (ENCS) inventory", () => {
  it("carries every inventory string, with the inventory's count", () => {
    const sheet = sheetOf(EMPTY);
    const misses: string[] = [];
    for (const { text, count } of FIXTURE.strings) {
      const found = exactElements(sheet, text).length;
      if (found !== count)
        misses.push(`${JSON.stringify(text)}: expected ${count}, found ${found}`);
    }
    expect(misses).toEqual([]);
  });

  it("sets the singleton strings in form order", () => {
    const sheet = sheetOf(EMPTY);
    const nodes = FIXTURE.orderedSingletons.map((t) => {
      const hits = exactElements(sheet, t);
      expect(hits, t).toHaveLength(1);
      return hits[0]!;
    });
    for (let i = 1; i < nodes.length; i++) {
      const precedes =
        nodes[i - 1]!.compareDocumentPosition(nodes[i]!) &
        Node.DOCUMENT_POSITION_FOLLOWING;
      expect(
        precedes,
        `${FIXTURE.orderedSingletons[i - 1]} → ${FIXTURE.orderedSingletons[i]}`,
      ).toBeTruthy();
    }
  });

  it("carries nothing the official form does not (no Page 1, no ATC reference list)", () => {
    const sheet = sheetOf(EMPTY);
    const text = norm(sheet.textContent);
    const present = FIXTURE.forbidden.substrings.filter((s) => text.includes(s));
    expect(present).toEqual([]);
  });

  it("has the digit boxes the official form has: 28 TIN, 16 period, 32 tax-agent date, 8 ZIP", () => {
    const sheet = sheetOf(EMPTY);
    const boxes = (kind: string) =>
      sheet.querySelectorAll(`[data-box-group="${kind}"] .bir-box`).length;
    const groups = (kind: string) =>
      sheet.querySelectorAll(`[data-box-group="${kind}"]`).length;
    const bc = FIXTURE.boxCounts;
    expect({
      tin: boxes("tin"),
      tinGroups: groups("tin"),
      period: boxes("period"),
      periodGroups: groups("period"),
      taxAgentDate: boxes("taxAgentDate"),
      taxAgentDateGroups: groups("taxAgentDate"),
      zip: boxes("zip"),
      zipGroups: groups("zip"),
      total: sheet.querySelectorAll(".bir-box").length,
    }).toEqual({
      tin: bc.tin,
      tinGroups: bc.tinGroups,
      period: bc.period,
      periodGroups: bc.periodGroups,
      taxAgentDate: bc.taxAgentDate,
      taxAgentDateGroups: bc.taxAgentDateGroups,
      zip: bc.zip,
      zipGroups: bc.zipGroups,
      total: bc.total,
    });
    // TIN boxes group 3-3-3-5, both times.
    sheet.querySelectorAll('[data-box-group="tin"]').forEach((g) => {
      const sizes = Array.from(g.querySelectorAll(".grp")).map(
        (grp) => grp.children.length,
      );
      expect(sizes).toEqual(FIXTURE.boxCounts.tinGrouping);
    });
  });

  it("has two Part III blocks of ten data rows, each followed by one Total row", () => {
    const sheet = sheetOf(EMPTY);
    const rc = FIXTURE.rowCounts;
    expect({
      blockADataRows: sheet.querySelectorAll('[data-p3-row="A"]').length,
      blockBDataRows: sheet.querySelectorAll('[data-p3-row="B"]').length,
      dataRows: sheet.querySelectorAll("[data-p3-row]").length,
      totalRows: sheet.querySelectorAll("[data-total-row]").length,
    }).toEqual({
      blockADataRows: rc.blockADataRows,
      blockBDataRows: rc.blockBDataRows,
      dataRows: rc.dataRows,
      totalRows: rc.totalRows,
    });
  });

  it("numbers its items exactly as the official form does — 5 present, no 9", () => {
    const sheet = sheetOf(EMPTY);
    const numbers = Array.from(sheet.querySelectorAll(".bir-ino")).map((n) =>
      norm(n.textContent),
    );
    expect(numbers).toEqual(FIXTURE.itemNumbers);
  });

  it("prints nothing in any box when given no data", () => {
    const sheet = sheetOf(EMPTY);
    const filledBoxes = Array.from(sheet.querySelectorAll(".bir-box")).filter(
      (b) => norm(b.textContent) !== "",
    );
    const filledValues = Array.from(sheet.querySelectorAll(".bir-val, .bir-amt")).filter(
      (v) => norm(v.textContent) !== "",
    );
    expect(filledBoxes).toHaveLength(0);
    expect(filledValues.map((v) => v.textContent)).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// T5 — render from props (invented fixture)
// ---------------------------------------------------------------------------

const SYNTHETIC: Form2307Props = {
  periodFrom: "01/01/2026",
  periodTo: "03/31/2026",
  payee: {
    tin: "987-654-321-00000",
    name: "DELA PAZ, ANDREA SANTOS",
    address: "45 INVENTED STREET, FICTION VILLAGE",
    zip: "4027",
    foreignAddress: "UNIT 9, 100 PLACEHOLDER ROAD, NOWHERE",
  },
  payor: {
    tin: "123-456-789",
    branch: "00000",
    name: "NORTHWIND SUPPLY TRADING CORPORATION",
    address: "128 SAMPLE AVENUE, BARANGAY EXAMPLE, SAMPLE CITY",
    zip: "1600",
  },
  rows: [
    {
      desc: "Professional fees",
      atc: "WI010",
      m1: "20000",
      m2: "21000",
      m3: "22000",
      tax: "3150",
    },
    { desc: "Rental", atc: "WI100", m1: "15000", m2: "15000", m3: "15000", tax: "2250" },
  ],
  rowTotals: [63000, 45000],
  totals: { m1: 35000, m2: 36000, m3: 37000, income: 108000, tax: 5400 },
  payorSignatory: {
    name: "RIVERA, JOSE MARIANO",
    title: "TREASURER",
    tin: "111-222-333-00000",
    taxAgentNo: "TA-0000-EXAMPLE",
    issued: "01/15/2026",
    expiry: "01/14/2029",
  },
  payeeSignatory: {
    name: "DELA PAZ, ANDREA SANTOS",
    title: "PROPRIETOR",
    tin: "987-654-321-00000",
    taxAgentNo: "ROLL-00000",
    issued: "02/01/2026",
    expiry: "01/31/2029",
  },
};

describe("T5 Form2307 renders its props and fetches nothing", () => {
  it("puts every prop on the sheet, leaves block B blank, and never calls fetch", () => {
    const sheet = sheetOf(SYNTHETIC);
    const text = norm(sheet.textContent);
    const digits = (kind: string, i: number) =>
      Array.from(
        sheet
          .querySelectorAll(`[data-box-group="${kind}"]`)
          [i]!.querySelectorAll(".bir-box"),
      )
        .map((b) => b.textContent)
        .join("");

    // Part II — the payor, i.e. the firm's client.
    expect(text).toContain("NORTHWIND SUPPLY TRADING CORPORATION");
    expect(digits("tin", 1)).toBe("12345678900000");
    expect(digits("zip", 1)).toBe("1600");

    // Part I — the payee.
    expect(text).toContain("DELA PAZ, ANDREA SANTOS");
    expect(digits("tin", 0)).toBe("98765432100000");
    expect(digits("zip", 0)).toBe("4027");
    expect(text).toContain("UNIT 9, 100 PLACEHOLDER ROAD, NOWHERE");

    // Item 1.
    expect(digits("period", 0)).toBe("01012026");
    expect(digits("period", 1)).toBe("03312026");

    // Block A rows — at least three row amounts, as printed.
    const rowA = sheet.querySelectorAll('[data-p3-row="A"]');
    const amounts = (row: Element) =>
      Array.from(row.querySelectorAll(".bir-amt")).map((a) => a.textContent);
    expect(amounts(rowA[0]!)).toEqual(["20,000", "21,000", "22,000", "63,000", "3,150"]);
    expect(amounts(rowA[1]!)).toEqual(["15,000", "15,000", "15,000", "45,000", "2,250"]);
    expect(norm(rowA[0]!.textContent)).toContain("Professional fees");
    expect(norm(rowA[0]!.textContent)).toContain("WI010");
    // Rows 3-10 of block A are untouched and print blank.
    for (let i = 2; i < 10; i++) expect(norm(rowA[i]!.textContent)).toBe("");

    // Block A total row — straight from the totals prop.
    const totalA = sheet.querySelector('[data-total-row="A"]')!;
    expect(amounts(totalA)).toEqual(["35,000", "36,000", "37,000", "108,000", "5,400"]);

    // Block B — every cell empty, its Total row carries only the word "Total".
    const rowB = sheet.querySelectorAll('[data-p3-row="B"]');
    expect(rowB).toHaveLength(10);
    rowB.forEach((r) => expect(norm(r.textContent)).toBe(""));
    expect(norm(sheet.querySelector('[data-total-row="B"]')!.textContent)).toBe("Total");

    // Signatories — the printed lines under each signature.
    expect(text).toContain("RIVERA, JOSE MARIANO");
    expect(text).toContain("TREASURER · 111-222-333-00000");
    expect(text).toContain("TA-0000-EXAMPLE");
    expect(text).toContain("PROPRIETOR · 987-654-321-00000");
    expect(text).toContain("ROLL-00000");
    expect(digits("taxAgentDate", 0)).toBe("01152026");
    expect(digits("taxAgentDate", 1)).toBe("01142029");
    expect(digits("taxAgentDate", 2)).toBe("02012026");
    expect(digits("taxAgentDate", 3)).toBe("01312029");

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("never invents a branch code: a nine-digit TIN leaves the five branch boxes blank", () => {
    const sheet = sheetOf({
      ...SYNTHETIC,
      payee: { ...SYNTHETIC.payee, tin: "987-654-321" },
      payor: { ...SYNTHETIC.payor, tin: "123-456-789", branch: "" },
    });
    const groups = (root: HTMLElement, i: number) =>
      Array.from(
        root.querySelectorAll('[data-box-group="tin"]')[i]!.querySelectorAll(".grp"),
      ).map((g) =>
        Array.from(g.querySelectorAll(".bir-box"))
          .map((b) => b.textContent || "□")
          .join(""),
      );
    expect(groups(sheet, 0)).toEqual(["987", "654", "321", "□□□□□"]);
    expect(groups(sheet, 1)).toEqual(["123", "456", "789", "□□□□□"]);
    cleanup();

    // A branch that WAS given, in the old three-digit style, is widened — not invented.
    const old = sheetOf({
      ...SYNTHETIC,
      payor: { ...SYNTHETIC.payor, tin: "123-456-789", branch: "001" },
    });
    expect(groups(old, 1)).toEqual(["123", "456", "789", "00001"]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
