// qap-writer.ts — U19 (D59): the 1601-EQ alphalist as the BIR's QAP .DAT file.
//
// Plain ASCII, comma-delimited, every line ending CRLF (the last too). Text in double
// quotes; an unused name is "". Amounts have two decimals and no thousands separator; the
// rate is a percent with two decimals. The layout is the BIR Validation program's (routine
// val1601e): the Portal writes it and NEVER adds a validation key (the owner runs the BIR
// program himself before eSubmission).
//
//   HQAP,H1601EQ,<agent TIN 9>,<agent branch 4>,"<agent name>",MM/YYYY,<RDO 3>
//   D1,1601EQ,<seq>,<TIN>,<branch 4>,"<registered>","<last>","<first>","<middle>",MM/YYYY,<ATC>,<rate>,<income>,<tax>
//   C1,1601EQ,<agent TIN>,<agent branch>,MM/YYYY,<total income>,<total tax>
//   D2,1601EQ,<seq>,<TIN>,<branch 4>,"<registered>","<last>","<first>","<middle>",MM/YYYY,<ATC>,<income>
//   C2,1601EQ,<agent TIN>,<agent branch>,MM/YYYY,<total income>
//
// This file only WRITES; whether the model is one the BIR program would accept is
// qap-rules.ts's question, asked before the file is answered.
import { Prisma } from "@prisma/client";

export interface AlphalistAgent {
  /** 9 digits. */
  tin: string;
  /** Exactly 4 digits. */
  branch: string;
  name: string;
  /** Exactly 3 characters. */
  rdo: string;
}

interface PayeeFields {
  seq: number;
  /** 9 digits. */
  tin: string;
  /** Exactly 4 digits. */
  branch: string;
  /** A company's registered name, or "". */
  registeredName: string;
  lastName: string;
  firstName: string;
  middleName: string;
  atc: string;
}

/** Schedule 1: income subject to expanded withholding. */
export interface Schedule1Row extends PayeeFields {
  /** A percent with 2 decimals: "1.00". */
  rate: string;
  income: string;
  tax: string;
}

/** Schedule 2: income NOT subject to withholding (ATCs such as DI900 and EI900). */
export interface Schedule2Row extends PayeeFields {
  income: string;
}

export interface AlphalistModel {
  version: 1;
  /** The last month of the quarter, "09/2026". */
  period: string;
  agent: AlphalistAgent;
  schedule1: Schedule1Row[];
  schedule2: Schedule2Row[];
}

const CRLF = "\r\n";
const q = (s: string) => `"${s}"`;
const ZERO = new Prisma.Decimal(0);

function payee(r: PayeeFields): string[] {
  return [
    String(r.seq),
    r.tin,
    r.branch,
    q(r.registeredName),
    q(r.lastName),
    q(r.firstName),
    q(r.middleName),
  ];
}

/** The control totals: the exact sums of the detail lines. */
export function totalsOf(m: AlphalistModel): {
  schedule1: { rows: number; income: string; tax: string };
  schedule2: { rows: number; income: string };
} {
  const sum = (xs: string[]) =>
    xs.reduce((a, x) => a.plus(new Prisma.Decimal(x)), ZERO).toFixed(2);
  return {
    schedule1: {
      rows: m.schedule1.length,
      income: sum(m.schedule1.map((r) => r.income)),
      tax: sum(m.schedule1.map((r) => r.tax)),
    },
    schedule2: { rows: m.schedule2.length, income: sum(m.schedule2.map((r) => r.income)) },
  };
}

/** The file's text. Schedule 1 lines only when there are rows; Schedule 2 likewise. */
export function writeQap(m: AlphalistModel): string {
  const t = totalsOf(m);
  const out: string[] = [
    ["HQAP", "H1601EQ", m.agent.tin, m.agent.branch, q(m.agent.name), m.period, m.agent.rdo].join(","),
  ];
  for (const r of m.schedule1) {
    out.push(
      ["D1", "1601EQ", ...payee(r), m.period, r.atc, r.rate, r.income, r.tax].join(","),
    );
  }
  if (m.schedule1.length > 0) {
    out.push(
      ["C1", "1601EQ", m.agent.tin, m.agent.branch, m.period, t.schedule1.income, t.schedule1.tax].join(","),
    );
  }
  for (const r of m.schedule2) {
    out.push(["D2", "1601EQ", ...payee(r), m.period, r.atc, r.income].join(","));
  }
  if (m.schedule2.length > 0) {
    out.push(
      ["C2", "1601EQ", m.agent.tin, m.agent.branch, m.period, t.schedule2.income].join(","),
    );
  }
  return out.join(CRLF) + CRLF;
}

/** The only file name the BIR Validation program accepts: TIN 9, branch 4, MMYYYY, 1601EQ.DAT. */
export function qapFileName(m: AlphalistModel): string {
  const [mm, yyyy] = m.period.split("/");
  return `${m.agent.tin}${m.agent.branch}${mm}${yyyy}1601EQ.DAT`;
}
