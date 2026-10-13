import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { InputVATCategory, VatClass } from "@portal/shared";
import type { AuthUser } from "../../common/auth/auth-user";
import { isoToDate } from "../../financial/serialization";
import { PrismaService } from "../../prisma/prisma.service";
import { RbacService } from "../../rbac/rbac.service";
import {
  PERCENTAGE_TAX_CREATE_NOTE,
  PERCENTAGE_TAX_RATE,
  pesos,
} from "../../tax-estimate/statute";
import type { BookFiguresQuery } from "../dto/bir-form.schemas";
import { bookQuarter } from "./book-period";
import { roundToNearestWholePesoHalfUp } from "./round-to-whole-peso";

/** BIRForms:Read, as BirFormsService holds it (kept here to avoid a cycle). */
const READ = "BIRForms:Read";

/** The forms the books can fill so far. */
const FEEDABLE = new Set(["2551Q", "2550Q"]);

// --- every sentence a person reads (U15) -------------------------------------------
export const NOT_PERCENTAGE_CLIENT =
  "This client isn't a percentage-tax client; the 2551Q will stay empty.";
export const NOT_VAT_CLIENT =
  "This client isn't a VAT client; the 2550Q will stay empty.";
export const booksCantFill = (form: string) => `Books can't fill the ${form} yet.`;
export const badPeriod = (form: string) => `That isn't a valid period for the ${form}.`;
const peso = (n: number) => (n < 0 ? `-${pesos(-n)}` : pesos(n));
const sales = (n: number, total: number, one: string, many: string) =>
  n === 1 ? `1 sale (${peso(total)}) ${one}` : `${n} sales (${peso(total)}) ${many}`;
const purchases = (n: number, total: number, one: string, many: string) =>
  n === 1
    ? `1 purchase (${peso(total)}) ${one}`
    : `${n} purchases (${peso(total)}) ${many}`;
const belowZero = (label: string, exact: Prisma.Decimal) => {
  const abs = exact.abs();
  const shown = abs.toNumber().toLocaleString("en-US", {
    minimumFractionDigits: abs.isInteger() ? 0 : 2,
    maximumFractionDigits: 2,
  });
  return `The books total for ${label} is below zero (-₱${shown}); it is shown as ₱0.`;
};
/** The 1% percentage-tax rate of 1 July 2020 to 30 June 2023 (CREATE, RA 11534) is not
 *  applied (statute.ts); a quarter inside that window says so. */
export const CREATE_WINDOW = { from: "2020-07-01", to: "2023-06-30" };
export const CREATE_RATE_WARNING = `${PERCENTAGE_TAX_CREATE_NOTE} Check the rate on each row.`;

/** The 2551Q's Schedule 1 ATC list, in the editor's order (BirForm2551QEditor.tsx:34).
 *  The export carries these eight and refuses any other (build2551Q.ts ATC_INDEX). */
export const SCHEDULE_1_ATCS = [
  "PT010",
  "PT040",
  "PT041",
  "PT060",
  "PT070",
  "PT090",
  "PT120",
  "PT130",
] as const;
/** The rows Schedule 1 of the 2551Q has room for (build2551Q.ts SCHEDULE_1_ROWS). */
const SCHEDULE_1_ROOM = 6;

export interface BookLineFilter {
  kind: "income" | "purchases";
  from: string;
  to: string;
  vatClass?: string;
  atc?: string;
  inputVATCategory?: string;
}
export interface BookLine {
  key: string;
  label: string;
  amount: number;
  records: number;
  filter: BookLineFilter;
}
export interface BookFigures {
  form: string;
  period: string;
  asOf: string;
  recordCount: number;
  figures: Record<string, unknown>;
  lines: BookLine[];
  warnings: string[];
}

/** The 2550Q's purchase categories and the data keys each one fills. `net` is
 *  the purchase amount (a), `tax` the input tax (b); null where the form takes
 *  the amount only (Items 48 and 49). Labels are the editor's (BirForm2550QEditor.tsx). */
const PURCHASE_ITEMS: ReadonlyArray<{
  category: InputVATCategory;
  net: string;
  tax: string | null;
  label: string;
}> = [
  {
    category: "DOMESTIC_PURCHASES",
    net: "i44a",
    tax: "i44b",
    label: "Domestic — goods (Item 44)",
  },
  {
    category: "SERVICES_NONRESIDENT",
    net: "i45a",
    tax: "i45b",
    label: "Domestic — services (Item 45)",
  },
  {
    category: "IMPORTATION_GOODS",
    net: "i46a",
    tax: "i46b",
    label: "Importation — goods (Item 46)",
  },
  {
    category: "OTHERS_WITH_INPUT_TAX",
    net: "i47a",
    tax: "i47b",
    label: "Others (Item 47)",
  },
  {
    category: "DOMESTIC_NO_INPUT_TAX",
    net: "i48a",
    tax: null,
    label: "Purchases not qualified for input tax — Item 48A",
  },
  {
    category: "VAT_EXEMPT_IMPORTATION",
    net: "i49a",
    tax: null,
    label: "VAT-exempt importations — Item 49A",
  },
];

/** A line before it is rounded: its exact sum. */
type LineSpec = Omit<BookLine, "amount"> & { exact: Prisma.Decimal };

const ZERO = new Prisma.Decimal(0);
const total = (xs: Prisma.Decimal[]) => xs.reduce((a, b) => a.plus(b), ZERO);

/**
 * U15 (D54): the figures the client's posted records give a business-tax return,
 * in the keys and shapes the editor saves, so the web merges them with no
 * translation. Output tax and every total stay the compute file's own.
 *
 * R4 names a duplication: the gross receipts here are the same sum the tax
 * estimate's `sums()` makes (tax-estimate.service.ts: income of the client dated
 * inside the period, net of VAT, no status filter). The estimate module is not
 * touched, so the query is written again here and track-a-book-figures.db-spec.ts
 * proves the two equal.
 */
@Injectable()
export class BookFiguresService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly rbac: RbacService,
  ) {}

  async figures(user: AuthUser, q: BookFiguresQuery): Promise<BookFigures> {
    // Another firm's client is 404 (as the tax estimate); an unassigned user is 403.
    const client = await this.prisma.client.findFirst({
      where: { id: q.clientId, firmId: user.firmId },
      select: { id: true, taxType: true, fiscalYearStart: true },
    });
    if (!client) throw new NotFoundException("Client not found");
    await this.rbac.assertClient(user, [READ], client.id);

    if (!FEEDABLE.has(q.form)) throw new BadRequestException(booksCantFill(q.form));
    // The 2550Q follows the client's fiscal year, as its export does (build2550Q.ts,
    // U13 F4). The 2551Q has no fiscal handling anywhere (its editor saves
    // periodType "calendar", its export and clear copy print calendar quarters, as does
    // the tax estimate), so its quarter is the calendar quarter.
    const quarter = bookQuarter(
      q.period,
      q.form === "2550Q" ? client.fiscalYearStart : null,
    );
    if (!quarter) throw new BadRequestException(badPeriod(q.form));

    const base = {
      form: q.form,
      period: q.period.trim(),
      asOf: new Date().toISOString(),
    };
    const empty = (warning: string): BookFigures => ({
      ...base,
      recordCount: 0,
      figures: {},
      lines: [],
      warnings: [warning],
    });

    if (q.form === "2551Q") {
      if (client.taxType !== "PERCENTAGE") return empty(NOT_PERCENTAGE_CLIENT);
      return this.feed2551Q(client.id, quarter, base);
    }
    if (client.taxType !== "VAT") return empty(NOT_VAT_CLIENT);
    return this.feed2550Q(client.id, quarter, base);
  }

  // --- 2551Q: Schedule 1, one row per ATC ------------------------------------------
  private async feed2551Q(
    clientId: string,
    { from, to }: { from: string; to: string },
    base: { form: string; period: string; asOf: string },
  ): Promise<BookFigures> {
    const income = await this.income(clientId, from, to);
    const warnings: string[] = [];

    const byAtc = new Map<string, Prisma.Decimal[]>();
    const noAtc: Prisma.Decimal[] = [];
    const unlisted: Prisma.Decimal[] = [];
    const unlistedCodes = new Set<string>();
    for (const r of income) {
      const code = (r.atc ?? "").trim().toUpperCase();
      if (code === "") noAtc.push(r.netAmount);
      else if ((SCHEDULE_1_ATCS as readonly string[]).includes(code)) {
        byAtc.set(code, [...(byAtc.get(code) ?? []), r.netAmount]);
      } else {
        unlisted.push(r.netAmount);
        unlistedCodes.add(code);
      }
    }
    if (noAtc.length > 0) {
      warnings.push(
        sales(
          noAtc.length,
          roundToNearestWholePesoHalfUp(total(noAtc)),
          "has no ATC and was left out.",
          "have no ATC and were left out.",
        ),
      );
    }
    if (unlisted.length > 0) {
      const codes = [...unlistedCodes].sort().join(", ");
      warnings.push(
        sales(
          unlisted.length,
          roundToNearestWholePesoHalfUp(total(unlisted)),
          `has an ATC the 2551Q doesn't list (${codes}) and was left out.`,
          `have an ATC the 2551Q doesn't list (${codes}) and were left out.`,
        ),
      );
    }

    const lines: BookLine[] = [];
    const rows: Array<{ atc: string; taxable: string; rate: string }> = [];
    for (const atc of SCHEDULE_1_ATCS) {
      const amounts = byAtc.get(atc);
      if (!amounts) continue;
      const line = this.line(
        {
          key: `rows.${atc}`,
          label: `Schedule 1 · ${atc}`,
          exact: total(amounts),
          records: amounts.length,
          filter: { kind: "income", from, to, atc },
        },
        warnings,
      );
      lines.push(line);
      // The rate is the percentage-tax rate the estimate uses (statute.ts), which is
      // the rate the editor gives a new row (BirForm2551QEditor.tsx:42).
      rows.push({ atc, taxable: String(line.amount), rate: String(PERCENTAGE_TAX_RATE) });
    }
    if (rows.length > 0 && from <= CREATE_WINDOW.to && to >= CREATE_WINDOW.from) {
      warnings.push(CREATE_RATE_WARNING);
    }
    if (rows.length > SCHEDULE_1_ROOM) {
      warnings.push(
        `The books have ${rows.length} ATCs, but Schedule 1 has room for ${SCHEDULE_1_ROOM} rows. Combine or move some before exporting.`,
      );
    }
    lines.push(
      this.line(
        {
          key: "grossReceipts",
          label: "Gross receipts for the quarter",
          exact: total(income.map((r) => r.netAmount)),
          records: income.length,
          filter: { kind: "income", from, to },
        },
        warnings,
      ),
    );

    return {
      ...base,
      recordCount: income.length,
      figures: { rows },
      lines,
      warnings,
    };
  }

  // --- 2550Q: sales by class, Item 16, Items 44 to 49 --------------------------------
  private async feed2550Q(
    clientId: string,
    { from, to }: { from: string; to: string },
    base: { form: string; period: string; asOf: string },
  ): Promise<BookFigures> {
    const [income, bought] = await Promise.all([
      this.income(clientId, from, to),
      this.prisma.purchaseTransaction.findMany({
        where: {
          clientId,
          txnDate: { gte: isoToDate(from), lte: isoToDate(to) },
          status: "posted", // a held import is in no figure
        },
        select: { netAmount: true, inputVAT: true, inputVATCategory: true },
      }),
    ]);
    const warnings: string[] = [];
    const figures: Record<string, string> = {};
    const lines: BookLine[] = [];
    const add = (spec: LineSpec) => {
      const line = this.line(spec, warnings);
      figures[line.key] = String(line.amount);
      lines.push(line);
    };

    // Sales. A sale to government is vatable and the form has no line of its own
    // for it, so it is in Item 31A; its 5% withheld is in Item 16.
    const ofClass = (c: VatClass) => income.filter((r) => r.vatClass === c);
    for (const [key, vatClass, label] of [
      ["i31a", "VATABLE_12", "VATable sales (net) — Item 31A"],
      ["i32a", "ZERO_RATED", "Zero-rated sales — Item 32A"],
      ["i33a", "EXEMPT", "VAT-exempt sales — Item 33A"],
    ] as const) {
      const rows = ofClass(vatClass);
      add({
        key,
        label,
        exact: total(rows.map((r) => r.netAmount)),
        records: rows.length,
        filter: { kind: "income", from, to, vatClass },
      });
    }
    const withheld = income.filter((r) => r.creditableVATWithheld5pct !== null);
    add({
      key: "i16",
      label: "Creditable VAT withheld — Item 16",
      exact: total(withheld.map((r) => r.creditableVATWithheld5pct!)),
      records: withheld.length,
      filter: { kind: "income", from, to },
    });

    // Current purchases, by the shared input-VAT category.
    for (const item of PURCHASE_ITEMS) {
      const rows = bought.filter((r) => r.inputVATCategory === item.category);
      const filter: BookLineFilter = {
        kind: "purchases",
        from,
        to,
        inputVATCategory: item.category,
      };
      add({
        key: item.net,
        label: item.tax ? `${item.label}: purchases` : item.label,
        exact: total(rows.map((r) => r.netAmount)),
        records: rows.length,
        filter,
      });
      if (item.tax) {
        add({
          key: item.tax,
          label: `${item.label}: input tax`,
          exact: total(rows.map((r) => r.inputVAT ?? ZERO)),
          records: rows.length,
          filter,
        });
      }
    }

    // What the books hold that no line of the form takes.
    const nonVat = income.filter(
      (r) => r.vatClass === "NON_VAT" || !VatClass.safeParse(r.vatClass).success,
    );
    if (nonVat.length > 0) {
      warnings.push(
        sales(
          nonVat.length,
          roundToNearestWholePesoHalfUp(total(nonVat.map((r) => r.netAmount))),
          "is marked non-VAT and was left out.",
          "are marked non-VAT and were left out.",
        ),
      );
    }
    const capital = bought.filter(
      (r) => r.inputVATCategory === InputVATCategory.enum.CAPITAL_GOODS_GT_1M,
    );
    if (capital.length > 0) {
      warnings.push(
        purchases(
          capital.length,
          roundToNearestWholePesoHalfUp(total(capital.map((r) => r.netAmount))),
          "is capital goods over ₱1 million; it belongs in Schedule 1 and was left out.",
          "are capital goods over ₱1 million; they belong in Schedule 1 and were left out.",
        ),
      );
    }
    const uncategorised = bought.filter(
      (r) => !InputVATCategory.safeParse(r.inputVATCategory).success,
    );
    if (uncategorised.length > 0) {
      warnings.push(
        purchases(
          uncategorised.length,
          roundToNearestWholePesoHalfUp(total(uncategorised.map((r) => r.netAmount))),
          "has no VAT category and was left out.",
          "have no VAT category and were left out.",
        ),
      );
    }

    lines.push(
      this.line(
        {
          key: "grossReceipts",
          label: "Gross receipts for the quarter",
          exact: total(income.map((r) => r.netAmount)),
          records: income.length,
          filter: { kind: "income", from, to },
        },
        warnings,
      ),
    );

    return {
      ...base,
      recordCount: income.length + bought.length,
      figures,
      lines,
      warnings,
    };
  }

  /** The client's income records dated inside the quarter (the books keep no status
   *  for income: every record is posted). */
  private income(clientId: string, from: string, to: string) {
    return this.prisma.incomeTransaction.findMany({
      where: { clientId, txnDate: { gte: isoToDate(from), lte: isoToDate(to) } },
      select: {
        netAmount: true,
        atc: true,
        vatClass: true,
        creditableVATWithheld5pct: true,
      },
    });
  }

  /**
   * One reported line: its exact sum, rounded ONCE. A line is never negative; a
   * negative sum (only a direct write can leave one) is shown as ₱0 and said so.
   */
  private line(spec: LineSpec, warnings: string[]): BookLine {
    const { exact, ...rest } = spec;
    if (exact.lt(0)) warnings.push(belowZero(spec.label, exact));
    return { ...rest, amount: Math.max(roundToNearestWholePesoHalfUp(exact), 0) };
  }
}
