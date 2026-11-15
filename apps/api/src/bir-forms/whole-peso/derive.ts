/**
 * derive.ts — U26 (D73): which draft keys of a return print in a box with no centavos.
 *
 * The print map (packages/bir-pdf/maps) says, field by field, whether the paper has centavo
 * boxes: a money field with no `cents`, or a text field whose `amount` is whole pesos. A draft
 * key reaches the paper through the form's compute and XML builder, so the key is found by
 * asking the builder: every key the builder reads is given an amount with centavos, alone, on
 * a few starting drafts that open each schedule (graduated or 8%, OSD or itemized, a spouse
 * or none), and the key is whole pesos when that amount reaches a whole-peso field with its
 * centavos. Its item is the first such field in the map's order where the amount prints as
 * typed, the one the fewest keys reach. The rate boxes (map items ending "rate", and the
 * keys that hold a rate) are percentages, not pesos, and are not counted.
 *
 * Nothing here is hand-kept: scripts/gen-whole-peso.ts writes the result into @portal/shared
 * and whole-peso.spec.ts fails when the committed list and this derivation disagree.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseEbirExport } from "@portal/bir-pdf";
import { build1701 } from "../engine/build1701";
import { build1701A } from "../engine/build1701A";
import { build1701Q } from "../engine/build1701Q";
import { build1702Q } from "../engine/build1702Q";
import { build1702RT } from "../engine/build1702RT";
import { build2550Q } from "../engine/build2550Q";
import { build2551Q } from "../engine/build2551Q";
import { compute1701 } from "../engine/compute1701";
import { compute1701A } from "../engine/compute1701A";
import { compute1701Q } from "../engine/compute1701Q";
import { compute1702Q } from "../engine/compute1702Q";
import { compute1702RT } from "../engine/compute1702RT";
import { compute2550Q } from "../engine/compute2550Q";
import { compute2551Q } from "../engine/compute2551Q";
import type { Filing, FilingData, Taxpayer } from "../engine/types";
import { type PaperField, wholePesoFieldsOf } from "./paper";

export { centavosOnPaper } from "./paper";

export const MAPS_DIR = join(__dirname, "../../../../../packages/bir-pdf/maps");

type Xml = (data: FilingData) => string;
const TP = {
  kind: "individual",
  tin: "000000000",
  branch: "00000",
} as unknown as Taxpayer;
const filing = (form: string, period: string, data: FilingData) =>
  ({ form, period, data }) as unknown as Filing;

/** The forms that print through an eBIRForms export, with the map each prints on. */
export const PROBED: Record<string, { map: string; period: string; xml: Xml }> = {
  "1701Q": {
    map: "1701Q-2018-01.json",
    period: "2026-Q3",
    xml: (d) => build1701Q(filing("1701Q", "2026-Q3", d), TP, compute1701Q(d)),
  },
  "1701A": {
    map: "1701A-2018-01.json",
    period: "2025",
    xml: (d) => build1701A(filing("1701A", "2025", d), TP, compute1701A(d)),
  },
  "1701": {
    map: "1701-2018-01.json",
    period: "2025",
    xml: (d) => build1701(filing("1701", "2025", d), TP, compute1701(d)),
  },
  "1702Q": {
    map: "1702Q-2018-01.json",
    period: "2026-Q3",
    xml: (d) => build1702Q(filing("1702Q", "2026-Q3", d), TP, compute1702Q(d)),
  },
  "1702RT": {
    map: "1702RT-2018-01.json",
    period: "2025",
    xml: (d) => build1702RT(filing("1702RT", "2025", d), TP, compute1702RT(d)),
  },
  "2550Q": {
    map: "2550Q-2024-04.json",
    period: "2026-Q3",
    xml: (d) => build2550Q(filing("2550Q", "2026-Q3", d), TP, compute2550Q(d)),
  },
  "2551Q": {
    map: "2551Q-2018-01.json",
    period: "2026-Q3",
    xml: (d) => build2551Q(filing("2551Q", "2026-Q3", d), TP, compute2551Q(d)),
  },
};

/** The starting drafts: each opens schedules the others leave shut. */
export const STARTS: FilingData[] = [
  {},
  {
    methodA: "itemized",
    methodB: "itemized",
    method: "itemized",
    rateA: "graduated",
    rateB: "graduated",
    spouseIncome: "yes",
    filing: "joint",
  },
  {
    rateA: "eight",
    rateB: "eight",
    rate: "eight",
    spouseTaxRate: "eight",
    spouseIncome: "yes",
    filing: "joint",
  },
  {
    incomeExempt: "yes",
    incomeSpecial: "yes",
    spouseIncomeExempt: "yes",
    treaty: "yes",
    foreignCredit: "yes",
    spouseForeignCredit: "yes",
    over: "carry",
  },
];

/** A draft key that holds a rate (a percentage: the 1702Q's income tax rate, a row's
 *  rate), never pesos, however its box is drawn. */
const RATE_KEY = /(^|[a-z])rate[A-Z0-9]?$/i;

const PROBE = "1234.37";
/** The probe as an export writes it, either sign. */
const AS_TYPED = new Set(["1,234.37", "-1,234.37", "(1,234.37)"]);

/** The whole-peso boxes of a map file, in the map's order: key → item. */
export function wholePesoFields(mapFile: string): Map<string, string> {
  const map = JSON.parse(readFileSync(join(MAPS_DIR, mapFile), "utf8")) as {
    fields: PaperField[];
  };
  return wholePesoFieldsOf(map.fields);
}

/** The top-level keys the builder reads from a draft. */
function keysRead(xml: Xml, start: FilingData): Set<string> {
  const seen = new Set<string>();
  const data = new Proxy({ ...start } as Record<string, unknown>, {
    get(target, prop, receiver) {
      if (typeof prop === "string") seen.add(prop);
      return Reflect.get(target, prop, receiver);
    },
  });
  try {
    xml(data as FilingData);
  } catch {
    /* a starting draft a builder cannot take still tells which keys it read */
  }
  return seen;
}

/** Every whole-peso key of one form: key → the item number the notes name. A key counts
 *  when its amount prints as typed in a whole-peso box (a rate or a choice that only moves
 *  a computed figure does not); its item is the box of those that the fewest keys reach. */
export function deriveForm(form: string): Record<string, string> {
  const p = PROBED[form];
  if (!p) throw new Error(`no probe for ${form}`);
  const whole = wholePesoFields(p.map);
  const order = [...whole.keys()];
  const printedAt = new Map<string, string[]>(); // key → whole fields it prints in as typed
  for (const start of STARTS) {
    for (const key of [...keysRead(p.xml, start)].sort()) {
      if (key in start || printedAt.has(key) || RATE_KEY.test(key)) continue;
      let rows: [string, string][];
      try {
        rows = parseEbirExport(p.xml({ ...start, [key]: PROBE }));
      } catch {
        continue;
      }
      const exact = rows
        .filter(([k, v]) => whole.has(k) && AS_TYPED.has(v))
        .map(([k]) => k);
      if (exact.length > 0) printedAt.set(key, exact);
    }
  }
  const reach = new Map<string, number>();
  for (const fields of printedAt.values())
    for (const f of new Set(fields)) reach.set(f, (reach.get(f) ?? 0) + 1);
  const out: Record<string, string> = {};
  for (const key of [...printedAt.keys()].sort()) {
    const best = [...new Set(printedAt.get(key)!)].sort(
      (a, b) => reach.get(a)! - reach.get(b)! || order.indexOf(a) - order.indexOf(b),
    )[0]!;
    out[key] = whole.get(best)!;
  }
  return out;
}

/** The whole list, every probed form (a form with none is left out). */
export function deriveWholePesoKeys(): Record<string, Record<string, string>> {
  const out: Record<string, Record<string, string>> = {};
  for (const form of Object.keys(PROBED).sort()) {
    const keys = deriveForm(form);
    if (Object.keys(keys).length > 0) out[form] = keys;
  }
  return out;
}
