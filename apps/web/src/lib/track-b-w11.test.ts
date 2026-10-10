// track-b-w11.test.ts — W11 R3: no tax rate or bracket figure in apps/web/src
// outside a test file. The tax estimate is the API's (U10, D47); the web reads
// it and computes nothing. A rate fraction (0.03, 0.08, 0.12, or 3/8/12 over
// 100) or a TRAIN bracket figure (250000 … 2202500, written plain, with
// underscores or with commas) fails this test, with file, line and figure.
//
// The few places named in ALLOWED keep a figure for a reason given beside it;
// each is reported, never silently passed.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = resolve(__dirname, "..");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

/** A whole number written plain, with underscores or with thousands commas. */
function figure(n: number): RegExp {
  const groups = n.toLocaleString("en-US").split(",");
  return new RegExp(`(?<![\\w.,])${groups.join("[,_]?")}(?![\\w]|[.,]\\d)`);
}
/** A rate written as a fraction: 0.03 or .03, not 20.03, 0.031 or a CSS .12em. */
function fraction(digits: string): RegExp {
  return new RegExp(`(?<![\\w.])0?\\.${digits}(?![\\d\\w%])`);
}

export const FIGURES: { name: string; re: RegExp }[] = [
  { name: "0.03", re: fraction("03") },
  { name: "0.08", re: fraction("08") },
  { name: "0.12", re: fraction("12") },
  { name: "n/100", re: /(?<![\w.])(?:3|8|12)\)?\s*\/\s*100(?![\w.])/ },
  ...[250000, 400000, 800000, 2000000, 8000000, 22500, 102500, 402500, 2202500].map(
    (n) => ({ name: String(n), re: figure(n) }),
  ),
];

/** Colours and SVG geometry carry decimals that are not rates. */
function scrub(line: string): string {
  return line
    .replace(/\b(?:rgba?|hsla?)\([^)]*\)/g, "")
    .replace(/\b(?:d|viewBox|points)="[^"]*"/g, "");
}

/** The figures a line carries, by name. */
export function figuresIn(line: string): string[] {
  const code = scrub(line);
  return FIGURES.filter((f) => f.re.test(code)).map((f) => f.name);
}

const BRACKETS = [
  "250000",
  "400000",
  "800000",
  "2000000",
  "8000000",
  "22500",
  "102500",
  "402500",
  "2202500",
];

/** Files that keep a figure, and why. Paths are relative to src/. */
export const ALLOWED: { file: string; figures: string[]; why: string }[] = [
  {
    file: "pages/TaxRulesPage.tsx",
    figures: BRACKETS,
    why: "The Tax Rules form's TRAIN starting brackets; U5 rebuilds the page and W11 may not touch it.",
  },
  {
    file: "pages/BillingPage.tsx",
    figures: ["0.12"],
    why: "VAT on the firm's own invoices to its clients, not a tax estimate.",
  },
  {
    file: "components/TransactionEntryModal.tsx",
    figures: ["0.12"],
    why: "VAT on a sale or purchase line as it is entered, not a tax estimate.",
  },
  {
    file: "pages/BirForm1701AEditor.tsx",
    figures: ["250000"],
    why: "The printed wording of the 1701A's Item 54 label, not a figure the page computes with.",
  },
];

const isTest = (file: string) => /\.(test|spec)\.[tj]sx?$/.test(file);

/** Every tax figure under `root` outside a test file, as "file:line: figure: code". */
export function taxFigures(root = SRC, allowed = ALLOWED): string[] {
  const out: string[] = [];
  for (const file of walk(root)) {
    if (!/\.(tsx?|jsx?)$/.test(file) || isTest(file)) continue;
    const rel = relative(root, file).split(sep).join("/");
    const allow = new Set(allowed.find((a) => a.file === rel)?.figures ?? []);
    readFileSync(file, "utf8")
      .split("\n")
      .forEach((line, i) => {
        for (const name of figuresIn(line)) {
          if (!allow.has(name)) out.push(`${rel}:${i + 1}: ${name}: ${line.trim()}`);
        }
      });
  }
  return out;
}

describe("no tax rate or bracket figure in apps/web/src (W11 R3)", () => {
  it("finds none outside a test file", () => {
    expect(taxFigures()).toEqual([]);
  });

  it("the check itself sees each way a figure is written", () => {
    const hits: [string, string][] = [
      ["const percentageTax = inc.totalNet * 0.03;", "0.03"],
      ["const due = gross * .08;", "0.08"],
      ["const VAT_RATE = 0.12;", "0.12"],
      ["const due = (gross * 3) / 100;", "n/100"],
      ["{ over: 250000, notOver: 400000, baseTax: 0, rate: 15 },", "250000"],
      ["{ over: 8000000, notOver: null, baseTax: 2202500, rate: 35 },", "2202500"],
      ["Taxable income is within the ₱250,000 exempt threshold", "250000"],
      ["const LIMIT = 2_202_500;", "2202500"],
      ["[400000, 800000, 22500, 20],", "22500"],
      ["[800000, 2000000, 102500, 25],", "102500"],
      ["[2000000, 8000000, 402500, 30],", "402500"],
    ];
    for (const [line, name] of hits) expect(figuresIn(line), line).toContain(name);
    for (const line of [
      'fill="rgba(255,255,255,0.08)"',
      'd="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59 0 20.12 0 24"',
      'step="0.01"',
      "setTimeout(() => URL.revokeObjectURL(url), 10_000);",
      "days * 86_400_000",
      "Math.abs(check[p.id] ?? 0) >= 0.01",
      "const n = 1250000.5;",
      "const id = 'a2500000';",
      "width: 0.125",
      'className="font-mono uppercase tracking-[.12em]"',
      'className="tracking-[.08em]"',
    ]) {
      expect(figuresIn(line), line).toEqual([]);
    }
  });

  it("an allowed file keeps only the figures named for it", () => {
    // TaxRulesPage may keep its brackets but not a percentage-tax fraction.
    const rules = ALLOWED.find((a) => a.file === "pages/TaxRulesPage.tsx")!;
    expect(rules.figures).not.toContain("0.03");
    for (const a of ALLOWED) expect(a.why.length, a.file).toBeGreaterThan(20);
  });
});
