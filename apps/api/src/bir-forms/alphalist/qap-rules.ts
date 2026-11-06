// qap-rules.ts — U19 (D59): the BIR Validation program's rules for the 1601-EQ alphalist,
// repeated in the Portal BEFORE a file is answered, so the Portal never writes a file the
// BIR program would reject. Each failure is one sentence naming the payee and the field.
import { Prisma } from "@prisma/client";
import type { AlphalistModel, Schedule1Row, Schedule2Row } from "./qap-writer";
import { totalsOf } from "./qap-writer";

type Dec = Prisma.Decimal;

export const DUMMY_TINS = new Set(["999999999", "111111111"]);
/** Names may hold printable ASCII except these (the BIR program's list). */
const FORBIDDEN = new Set(['"', "&", "'", ",", "|"]);

/** 123456789 → 123-456-789. */
export function dashedTin(tin9: string): string {
  return `${tin9.slice(0, 3)}-${tin9.slice(3, 6)}-${tin9.slice(6, 9)}`;
}

/**
 * A branch code read as a NUMBER and written as exactly 4 digits: 000, 0000 and 00000 are
 * all 0000. Blank is the head office. null: not digits, or more than 4 significant digits.
 */
export function branch4(raw: string | null | undefined): string | null {
  const t = (raw ?? "").trim();
  if (t === "") return "0000";
  if (!/^\d+$/.test(t)) return null;
  const n = Number(t);
  return n > 9999 ? null : String(n).padStart(4, "0");
}

/**
 * A name as the file carries it: trimmed, upper-cased, the enye (both cases) converted
 * to N. `bad` is the first character the BIR program would reject, if any.
 */
export function convertName(raw: string): { value: string; enye: boolean; bad: string | null } {
  const trimmed = raw.trim();
  const enye = /[ñÑ]/.test(trimmed);
  const value = trimmed.toUpperCase().replace(/Ñ/g, "N");
  // Name the character as it was typed (é, not É).
  for (const ch of trimmed) {
    for (const u of ch.toUpperCase().replace(/Ñ/g, "N")) {
      const code = u.codePointAt(0)!;
      if (code < 0x20 || code > 0x7e || FORBIDDEN.has(u)) return { value, enye, bad: ch };
    }
  }
  return { value, enye, bad: null };
}

/** The agent's name in the header: a company's registered name; an individual's LAST FIRST MIDDLE. */
export function agentName(c: {
  kind: string;
  regName?: string | null;
  businessName: string;
  lastName?: string | null;
  firstName?: string | null;
  middleName?: string | null;
}): string {
  if (c.kind === "individual") {
    return [c.lastName, c.firstName, c.middleName]
      .map((p) => (p ?? "").trim().replace(/\s+/g, " "))
      .filter(Boolean)
      .join(" ");
  }
  return (c.regName ?? "").trim() || c.businessName.trim();
}

/** The BIR's formula check: income x rate / 100 equals the tax, with centavos dropped on
 *  both sides or with both rounded to 2 decimals. `computed` is the 2-decimal figure. */
export function formulaHolds(
  income: Dec,
  ratePct: Dec,
  tax: Dec,
): { ok: boolean; computed: string } {
  const computed = income.times(ratePct).div(100);
  const whole = (d: Dec) => d.toDecimalPlaces(0, Prisma.Decimal.ROUND_DOWN);
  const cents = (d: Dec) => d.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
  const ok = whole(computed).eq(whole(tax)) || cents(computed).eq(cents(tax));
  return { ok, computed: cents(computed).toFixed(2) };
}

/** The Schedule 1 total tax must equal the return's Item 19. */
export function checkTotals(m: AlphalistModel, item19: string): string | null {
  const tax = totalsOf(m).schedule1.tax;
  const want = new Prisma.Decimal(item19).toFixed(2);
  return tax === want
    ? null
    : `The alphalist's total tax withheld is ${tax}, but the 1601-EQ's total taxes withheld (Item 19) is ${want}.`;
}

const nameSentence = (who: string, ch: string, where: string) =>
  `The name of ${who} contains ${ch}, which the BIR alphalist does not accept. Correct the name in the ${where} record.`;

/** The agent (the client) as the BIR Validation program would judge it. */
export function checkAgent(a: AlphalistModel["agent"]): string[] {
  const out: string[] = [];
  if (!/^\d{9}$/.test(a.tin)) out.push("The client's TIN must be exactly 9 digits.");
  else if (DUMMY_TINS.has(a.tin)) {
    out.push(`The client's TIN ${dashedTin(a.tin)} is not accepted by the BIR alphalist.`);
  }
  if (!/^\d{4}$/.test(a.branch)) out.push("The client's branch code must be exactly 4 digits.");
  if (a.rdo === "") out.push("Add the client's RDO code before making the alphalist.");
  else if (a.rdo.length !== 3) out.push("The client's RDO code must be 3 characters.");
  const agentBad = convertName(a.name).bad;
  if (a.name.trim() === "") out.push("The client has no name to put in the alphalist.");
  else if (agentBad !== null) out.push(nameSentence("the client", agentBad, "client"));
  return out;
}

/** The model as the BIR Validation program would judge it. [] means it would accept it. */
export function checkModel(m: AlphalistModel, knownAtc: ReadonlySet<string> = new Set()): string[] {
  const out = checkAgent(m.agent);
  if (m.schedule1.length === 0 && m.schedule2.length === 0) {
    out.push("The alphalist has no payees to list.");
    return out;
  }
  out.push(...checkRows(m.schedule1, m.schedule2, knownAtc));
  return out;
}

/** The payee lines of both schedules as the BIR Validation program would judge them. */
export function checkRows(
  schedule1: Schedule1Row[],
  schedule2: Schedule2Row[],
  knownAtc: ReadonlySet<string> = new Set(),
): string[] {
  const out: string[] = [];
  const payeeChecks = (r: Schedule1Row | Schedule2Row, label: string): boolean => {
    const who = /^\d{9}$/.test(r.tin) ? dashedTin(r.tin) : r.tin;
    if (!/^\d{9}$/.test(r.tin)) {
      out.push(`Payee ${label.replace("%", who)}: the TIN must be exactly 9 digits.`);
      return false;
    }
    if (DUMMY_TINS.has(r.tin)) {
      out.push(`Payee ${label.replace("%", who)}: the TIN is not accepted by the BIR alphalist.`);
      return false;
    }
    if (!/^\d{4}$/.test(r.branch)) {
      out.push(`Payee ${label.replace("%", who)}: the branch code must be exactly 4 digits.`);
      return false;
    }
    const parts = [r.registeredName, r.lastName, r.firstName, r.middleName];
    if (parts.every((p) => p.trim() === "")) {
      out.push(`Payee ${label.replace("%", who)}: the payee has no name.`);
      return false;
    }
    for (const p of parts) {
      const bad = convertName(p).bad;
      if (bad !== null) {
        out.push(nameSentence(`payee ${who}`, bad, "payee"));
        return false;
      }
    }
    return true;
  };

  for (const r of schedule1) {
    const label = `% ${r.atc}`;
    if (!payeeChecks(r, label)) continue;
    const who = `${dashedTin(r.tin)} ${r.atc}`;
    if (!knownAtc.has(r.atc)) {
      out.push(`Payee ${who}: the ATC is not in the BIR ATC table.`);
      continue;
    }
    const rate = new Prisma.Decimal(r.rate);
    if (rate.gt(99)) {
      out.push(`Payee ${who}: the rate ${rate.toFixed(2)}% is more than 99.`);
      continue;
    }
    const income = new Prisma.Decimal(r.income);
    const tax = new Prisma.Decimal(r.tax);
    if (income.isZero() || tax.isZero()) {
      out.push(`Payee ${who}: the income payment and the tax withheld must not be zero.`);
      continue;
    }
    const f = formulaHolds(income, rate, tax);
    if (!f.ok) {
      out.push(
        `Payee ${who}: ${income.toFixed(2)} at ${rate.toFixed(2)}% is ${f.computed}, but the tax withheld is ${tax.toFixed(2)}.`,
      );
    }
  }

  for (const r of schedule2) {
    const atc = r.atc.trim();
    // The seed holds no code for income not subject to withholding (DI900, EI900…), so a
    // Schedule 2 ATC is checked for shape only.
    if (atc === "") {
      out.push(`Payee ${/^\d{9}$/.test(r.tin) ? dashedTin(r.tin) : r.tin}: the Schedule 2 ATC is blank.`);
      continue;
    }
    if (!/^[A-Z0-9]{2,8}$/.test(atc)) {
      out.push(
        `Payee ${/^\d{9}$/.test(r.tin) ? dashedTin(r.tin) : r.tin}: the Schedule 2 ATC ${atc} is not a valid ATC.`,
      );
      continue;
    }
    if (!payeeChecks(r, `% ${atc}`)) continue;
    if (new Prisma.Decimal(r.income).isZero()) {
      out.push(`Payee ${dashedTin(r.tin)} ${atc}: the income payment must not be zero.`);
    }
  }
  return out;
}
