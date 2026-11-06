// payees.ts — U19 (D59): Schedule 1 of the alphalist from the client's posted expense
// records. The payee has no record of its own: its TIN, branch and name ride on each
// expense, with the kind and name parts the alphalist needs. So the rows of one payee are
// brought together by TIN and branch, and their details are RESOLVED, never guessed:
//
//   - a row with blank details takes the details of the rows that have them;
//   - rows that HAVE details and disagree (a different kind, or a different name part
//     after upper-casing and trimming) are refused, all such payees in one sentence;
//     for a company, vendor names that differ are the same kind of conflict;
//   - a payee with no details, or only some, is refused, all in one sentence.
//
// Nothing here talks to the database: the service passes the records in.
import { Prisma } from "@prisma/client";
import {
  branch4,
  checkRows,
  convertName,
  dashedTin,
  DUMMY_TINS,
} from "./qap-rules";
import type { Schedule1Row } from "./qap-writer";

type Dec = Prisma.Decimal;

/** One posted expense that counts (an expanded-withholding ATC and an amount withheld). */
export interface BookRecord {
  /** vendorTin as recorded (any punctuation), or null. */
  tin: string | null;
  /** vendorBranch as typed, or null. */
  branch: string | null;
  vendor: string | null;
  kind: string | null;
  last: string | null;
  first: string | null;
  middle: string | null;
  atc: string;
  /** The ATC table's rate as a percent (1 means 1%), or null if the table has none. */
  ratePct: Dec | null;
  net: Dec;
  wht: Dec;
  at: Date;
}

export interface Schedule1Build {
  rows: Schedule1Row[];
  refusals: string[];
  notes: string[];
}

const ZERO = new Prisma.Decimal(0);
const norm = (v: string | null | undefined) => (v ?? "").trim().replace(/\s+/g, " ").toUpperCase();
const plural = (n: number) => (n === 1 ? "expense" : "expenses");

interface Detail {
  kind: string;
  last: string;
  first: string;
  middle: string;
}

const hasDetails = (r: BookRecord) =>
  norm(r.kind) !== "" || norm(r.last) !== "" || norm(r.first) !== "" || norm(r.middle) !== "";
const detailOf = (r: BookRecord): Detail => ({
  kind: (r.kind ?? "").trim(),
  last: norm(r.last),
  first: norm(r.first),
  middle: norm(r.middle),
});
const sigOf = (d: Detail) => [d.kind, d.last, d.first, d.middle].join("|");
const kindWord = (k: string) => (k === "individual" ? "individual" : k === "non_individual" ? "company" : "no kind");

export function buildSchedule1(records: BookRecord[], knownAtc: ReadonlySet<string>): Schedule1Build {
  const tinProblems = new Set<string>();
  const branchProblems = new Set<string>();
  const payees = new Map<string, { tin: string; branch4: string; recs: BookRecord[] }>();

  for (const r of records) {
    const raw = (r.tin ?? "").trim();
    const digits = raw.replace(/\D/g, "");
    const name = (r.vendor ?? "").trim() || "(no name)";
    if (raw === "") {
      tinProblems.add(`An expense for ${name} has no vendor TIN. Add it on the expense.`);
      continue;
    }
    if (digits.length !== 9) {
      tinProblems.add(
        `An expense for ${name} has a vendor TIN that is not 9 digits (${raw}). Correct it on the expense.`,
      );
      continue;
    }
    if (DUMMY_TINS.has(digits)) {
      tinProblems.add(`The vendor TIN ${dashedTin(digits)} is not accepted by the BIR alphalist. Correct it on the expense.`);
      continue;
    }
    const b = branch4(r.branch);
    if (b === null) {
      branchProblems.add(
        `Payee ${dashedTin(digits)}: the branch code ${(r.branch ?? "").trim()} has more than 4 significant digits.`,
      );
      continue;
    }
    const key = `${digits}|${b}`;
    const p = payees.get(key) ?? { tin: digits, branch4: b, recs: [] };
    p.recs.push(r);
    payees.set(key, p);
  }

  const missing: string[] = [];
  const conflicts: string[] = [];
  const notes: string[] = [];
  const resolved: Array<{
    tin: string;
    branch4: string;
    registeredName: string;
    last: string;
    first: string;
    middle: string;
    recs: BookRecord[];
  }> = [];

  for (const p of [...payees.values()].sort((a, b) => (a.tin + a.branch4).localeCompare(b.tin + b.branch4))) {
    const shown = dashedTin(p.tin);
    const withDetails = p.recs.filter(hasDetails);

    // --- rows that have details must agree --------------------------------------------
    const sigs = new Map<string, { d: Detail; n: number }>();
    for (const r of withDetails) {
      const d = detailOf(r);
      const e = sigs.get(sigOf(d)) ?? { d, n: 0 };
      e.n++;
      sigs.set(sigOf(d), e);
    }
    const describe = (items: Array<{ text: string; n: number; kind?: string }>, kinds: Set<string>) =>
      items
        .sort((a, b) => b.n - a.n || a.text.localeCompare(b.text))
        .map((i) => `${kinds.size > 1 ? `${kindWord(i.kind ?? "")} ` : ""}${i.text} on ${i.n} ${plural(i.n)}`)
        .join(", ");
    if (sigs.size > 1) {
      const kinds = new Set([...sigs.values()].map((e) => e.d.kind));
      const items = [...sigs.values()].map((e) => ({
        n: e.n,
        kind: e.d.kind,
        text:
          e.d.kind === "non_individual"
            ? norm(p.recs.find((r) => sigOf(detailOf(r)) === sigOf(e.d))?.vendor)
            : [e.d.last, e.d.first, e.d.middle].filter(Boolean).join(" "),
      }));
      conflicts.push(`${shown} (${describe(items, kinds)})`);
      continue;
    }
    const d = withDetails.length > 0 ? detailOf(withDetails[0]!) : null;

    // --- a company's vendor names must agree ------------------------------------------
    const vendors = new Map<string, number>();
    for (const r of p.recs) if (norm(r.vendor) !== "") vendors.set(norm(r.vendor), (vendors.get(norm(r.vendor)) ?? 0) + 1);
    if (d?.kind === "non_individual" && vendors.size > 1) {
      const items = [...vendors.entries()].map(([text, n]) => ({ text, n }));
      conflicts.push(`${shown} (${describe(items, new Set())})`);
      continue;
    }

    // --- what is still missing --------------------------------------------------------
    if (!d || (d.kind !== "individual" && d.kind !== "non_individual")) {
      missing.push(`${shown} (choose individual or company)`);
      continue;
    }
    if (d.kind === "individual") {
      const lack = [d.last === "" ? "last" : "", d.first === "" ? "first" : ""].filter(Boolean);
      if (lack.length > 0) {
        missing.push(`${shown} (${lack.join(" and ")} name)`);
        continue;
      }
    } else if (vendors.size === 0) {
      missing.push(`${shown} (company name)`);
      continue;
    }

    // --- the name as the file carries it ------------------------------------------------
    const company = d.kind === "non_individual";
    const parts = company
      ? [[...vendors.keys()][0]!]
      : [p.recs.find(hasDetails)!.last ?? "", p.recs.find(hasDetails)!.first ?? "", p.recs.find(hasDetails)!.middle ?? ""];
    const raw = company
      ? [p.recs.find((r) => norm(r.vendor) !== "")!.vendor!]
      : parts;
    if (raw.some((x) => convertName(x).enye)) {
      notes.push(`The name of payee ${shown} had Ñ; it is written as N.`);
    }
    const c = raw.map((x) => convertName(x).value);
    resolved.push({
      tin: p.tin,
      branch4: p.branch4,
      registeredName: company ? c[0]! : "",
      last: company ? "" : c[0]!,
      first: company ? "" : c[1]!,
      middle: company ? "" : c[2]!,
      recs: p.recs,
    });
  }

  const refusals: string[] = [...tinProblems, ...branchProblems];
  if (missing.length > 0) {
    refusals.push(`These payees need details before the alphalist can be made: ${missing.join(", ")}.`);
  }
  if (conflicts.length > 0) {
    refusals.push(
      `These payees have different details on different expenses: ${conflicts.join(", ")}. Make them the same, then try again.`,
    );
  }

  // --- one row per payee, ATC and rate ---------------------------------------------------
  const rows: Schedule1Row[] = [];
  for (const p of resolved) {
    const byAtcRate = new Map<string, { atc: string; rate: Dec | null; income: Dec; tax: Dec }>();
    for (const r of p.recs) {
      const rate = r.ratePct ? r.ratePct.toFixed(2) : "";
      const key = `${r.atc}|${rate}`;
      const e = byAtcRate.get(key) ?? { atc: r.atc, rate: r.ratePct, income: ZERO, tax: ZERO };
      e.income = e.income.plus(r.net);
      e.tax = e.tax.plus(r.wht);
      byAtcRate.set(key, e);
    }
    for (const e of byAtcRate.values()) {
      if (!e.rate) {
        refusals.push(`Payee ${dashedTin(p.tin)} ${e.atc}: the ATC table has no rate for ${e.atc}.`);
        continue;
      }
      rows.push({
        seq: 0,
        tin: p.tin,
        branch: p.branch4,
        registeredName: p.registeredName,
        lastName: p.last,
        firstName: p.first,
        middleName: p.middle,
        atc: e.atc,
        rate: e.rate.toFixed(2),
        income: e.income.toFixed(2),
        tax: e.tax.toFixed(2),
      });
    }
  }
  rows.sort(
    (a, b) =>
      a.tin.localeCompare(b.tin) ||
      a.branch.localeCompare(b.branch) ||
      a.atc.localeCompare(b.atc) ||
      Number(a.rate) - Number(b.rate),
  );
  rows.forEach((r, i) => (r.seq = i + 1));
  refusals.push(...checkRows(rows, [], knownAtc));
  return { rows: refusals.length > 0 ? [] : rows, refusals, notes };
}
