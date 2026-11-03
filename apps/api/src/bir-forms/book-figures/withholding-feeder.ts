/**
 * withholding-feeder.ts — what the client's posted expense records give the 0619-E and
 * the 1601-EQ (U17, D57). The client is the WITHHOLDING AGENT: the figures come from the
 * tax it withheld from its suppliers, recorded on PurchaseTransaction.whtAmount under
 * the supplier's ATC. Like a 2307 in reverse.
 *
 * CENTAVOS, NOT PESOS (R4). These two returns carry centavos: every amount is an exact
 * decimal reported to two places (engine/exact.ts), and U15's whole-peso function
 * (round-to-whole-peso.ts) is never called from this file; a test keeps it so.
 *
 * WHICH records count (R5): posted (never held), dated inside the period, with an amount
 * withheld greater than zero, under an ATC whose BirAtcCode classification is "ewt" (the
 * expanded-withholding codes, WI and WC). The test is the classification, never the
 * prefix: the table holds 44 final-withholding codes that begin WI or WC (WI161, …).
 *  - Withheld with NO ATC, or under an ATC that is not expanded withholding (another
 *    class, or not in the table): left out, and named in a warning with the count and
 *    the amount, so nothing disappears silently.
 *  - An ATC with nothing withheld (0.00 or empty) adds to nothing and is not mentioned.
 *
 * The ATC write paths (REST, legacy import, the connector) never check the code, which
 * is why a record can carry any text; that is reported, not changed, in U17.
 */
import { Prisma } from "@prisma/client";
import { isoToDate } from "../../financial/serialization";
import { PrismaService } from "../../prisma/prisma.service";
import { compute0619E } from "../engine/compute0619E";
import { compute1601EQ, ROWS_ON_THE_FORM } from "../engine/compute1601EQ";
import { centavoText, centavos, dec, sum, type Dec } from "../engine/exact";
import type { FilingData } from "../engine/types";
import { sixRowsSentence } from "../withholding";
import type { BookFigures, BookLine, BookLineFilter } from "./book-figures.service";

interface Counted {
  atc: string;
  net: Dec;
  wht: Dec;
}

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];
const pad = (n: number) => String(n).padStart(2, "0");
const lastDay = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

/** ₱ with thousands and exactly two places: ₱1,234.56. */
const pesos2 = (d: Dec) =>
  `₱${d.toNumber().toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

export class WithholdingFeeder {
  constructor(private readonly prisma: PrismaService) {}

  // --- 0619-E: the month ------------------------------------------------------------
  async feed0619E(
    clientId: string,
    period: string,
    base: { form: string; period: string; asOf: string },
  ): Promise<BookFigures> {
    const y = Number(period.slice(0, 4));
    const m = Number(period.slice(5, 7));
    const from = `${y}-${pad(m)}-01`;
    const to = `${y}-${pad(m)}-${pad(lastDay(y, m))}`;
    const { counted, rates, warnings } = await this.collect(clientId, from, to);

    const total = sum(...counted.map((r) => r.wht));
    const lines: BookLine[] = [...rates.keys()].sort().map((atc) => {
      const mine = counted.filter((r) => r.atc === atc);
      return {
        key: `atc.${atc}`,
        label: `ATC ${atc}`,
        amount: centavos(sum(...mine.map((r) => r.wht))),
        records: mine.length,
        filter: filter(from, to, atc),
      };
    });
    lines.push({
      key: "remittance",
      label: "Amount of remittance — Item 14",
      amount: centavos(total),
      records: counted.length,
      filter: filter(from, to),
    });
    return {
      ...base,
      recordCount: counted.length,
      figures: {
        anyWithheld: total.gt(0) ? "yes" : "no",
        remittance: centavoText(total),
      },
      lines,
      warnings,
    };
  }

  // --- 1601-EQ: the quarter ---------------------------------------------------------
  async feed1601EQ(
    firmId: string,
    clientId: string,
    period: string,
    range: { from: string; to: string },
    base: { form: string; period: string; asOf: string },
  ): Promise<BookFigures> {
    const { from, to } = range;
    const year = Number(period.slice(0, 4));
    const quarter = Number(period.slice(6, 7));
    const { counted, rates, warnings } = await this.collect(clientId, from, to);

    const rows: Array<{ atc: string; base: string; rate: string; withheld: string }> = [];
    const lines: BookLine[] = [];
    const perAtc: string[] = [];
    for (const atc of [...rates.keys()].sort()) {
      const mine = counted.filter((r) => r.atc === atc);
      const rate = rates.get(atc) ?? null;
      const withheld = sum(...mine.map((r) => r.wht));
      // The tax base is the exact sum of netAmount as recorded; the tax withheld is the
      // amount recorded, never base times rate (D57).
      rows.push({
        atc,
        base: centavoText(sum(...mine.map((r) => r.net))),
        rate: rate ? rate.times(100).toString() : "",
        withheld: centavoText(withheld),
      });
      lines.push({
        key: `rows.${atc}`,
        label: `ATC ${atc}`,
        amount: centavos(withheld),
        records: mine.length,
        filter: filter(from, to, atc),
      });
      if (!rate) {
        perAtc.push(`The rate of ${atc} is not in the table; enter it by hand.`);
        continue;
      }
      // A record whose amount withheld is not base x rate (to a centavo) is named.
      const off = mine.filter((r) =>
        r.wht.minus(r.net.times(rate)).abs().gt("0.01"),
      ).length;
      if (off > 0) {
        const pct = rate.times(100).toString();
        perAtc.push(
          `${off} ${plural(off, "purchase", "purchases")} under ${atc} ${plural(off, "has", "have")} an amount withheld that ${plural(off, "differs", "differ")} from the tax base times the rate (${pct}%) by more than one centavo.`,
        );
      }
    }
    warnings.push(...perAtc);
    if (rows.length > ROWS_ON_THE_FORM) warnings.push(sixRowsSentence(rows.length));

    // Items 20 and 21: the net amount (item 16) of the client's FILED 0619-E for the
    // quarter's first and second month.
    const firstMonth = 3 * (quarter - 1) + 1;
    const net: string[] = [];
    for (const m of [firstMonth, firstMonth + 1]) {
      const filed = await this.latestFiled(
        firmId,
        clientId,
        "0619E",
        `${year}-${pad(m)}`,
      );
      if (filed) net.push(compute0619E(filed).i16.toFixed(2));
      else {
        net.push("");
        warnings.push(`No filed 0619-E for ${MONTHS[m - 1]} ${year}.`);
      }
    }

    // Item 23: over-remittance carried over from the previous quarter of the SAME year,
    // only if that filed return marked its carried-over box.
    let carried = "";
    if (quarter > 1) {
      const prev = await this.latestFiled(
        firmId,
        clientId,
        "1601EQ",
        `${year}-Q${quarter - 1}`,
      );
      if (prev) {
        const c = compute1601EQ(prev);
        if (c.overRemittance && c.overRemittanceChoice === "carried")
          carried = c.overRemittanceAmount.toFixed(2);
      }
    }

    return {
      ...base,
      recordCount: counted.length,
      figures: {
        anyWithheld:
          counted.length > 0 && sum(...counted.map((r) => r.wht)).gt(0) ? "yes" : "no",
        rows,
        remittance1: net[0],
        remittance2: net[1],
        overRemittancePrior: carried,
      },
      lines,
      warnings,
    };
  }

  // --- internals --------------------------------------------------------------------

  /** The data of the client's latest FILED return of a form and period (an amendment,
   *  once filed, replaces the return it amends: the highest sequence wins). */
  private async latestFiled(
    firmId: string,
    clientId: string,
    form: string,
    period: string,
  ): Promise<FilingData | null> {
    const row = await this.prisma.birForm.findFirst({
      where: { firmId, clientId, form, period, status: "filed" },
      orderBy: { sequence: "desc" },
      select: { dataJson: true },
    });
    return row ? ((row.dataJson ?? {}) as unknown as FilingData) : null;
  }

  /**
   * The records that count, by ATC, the table's rate for each, and the warnings for what
   * was withheld but cannot be counted (no ATC; an ATC that is not expanded withholding).
   */
  private async collect(clientId: string, from: string, to: string) {
    const [records, table] = await Promise.all([
      this.prisma.purchaseTransaction.findMany({
        where: {
          clientId,
          status: "posted", // a held import is in no figure
          txnDate: { gte: isoToDate(from), lte: isoToDate(to) },
          whtAmount: { gt: 0 },
        },
        select: { atc: true, netAmount: true, whtAmount: true },
      }),
      this.prisma.birAtcCode.findMany({
        where: { classification: "ewt" },
        select: { atc: true, rate: true },
      }),
    ]);
    const ewt = new Map<string, Dec | null>(
      table.map((a) => [a.atc, a.rate ? new Prisma.Decimal(a.rate) : null]),
    );

    const counted: Counted[] = [];
    const rates = new Map<string, Dec | null>();
    const noAtc: Dec[] = [];
    const notEwt: Dec[] = [];
    const notEwtCodes = new Set<string>();
    for (const r of records) {
      const atc = (r.atc ?? "").trim().toUpperCase();
      const wht = dec(r.whtAmount);
      if (atc === "") noAtc.push(wht);
      else if (ewt.has(atc)) {
        counted.push({ atc, net: dec(r.netAmount), wht });
        rates.set(atc, ewt.get(atc) ?? null);
      } else {
        notEwt.push(wht);
        notEwtCodes.add(atc);
      }
    }
    const warnings: string[] = [];
    if (noAtc.length > 0) {
      const n = noAtc.length;
      warnings.push(
        `${n} ${plural(n, "purchase", "purchases")} (${pesos2(sum(...noAtc))}) ${plural(n, "has", "have")} an amount withheld but no ATC and ${plural(n, "was", "were")} left out.`,
      );
    }
    if (notEwt.length > 0) {
      const n = notEwt.length;
      const codes = [...notEwtCodes].sort().join(", ");
      warnings.push(
        `${n} ${plural(n, "purchase", "purchases")} (${pesos2(sum(...notEwt))}) ${plural(n, "has", "have")} an amount withheld under an ATC that is not an expanded-withholding code (${codes}) and ${plural(n, "was", "were")} left out.`,
      );
    }
    return { counted, rates, warnings };
  }
}

function filter(from: string, to: string, atc?: string): BookLineFilter {
  return { kind: "purchases", from, to, ...(atc ? { atc } : {}) };
}
