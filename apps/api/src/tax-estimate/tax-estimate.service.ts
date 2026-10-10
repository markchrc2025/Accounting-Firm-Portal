import { Injectable, NotFoundException } from "@nestjs/common";
import type { AuthUser } from "../common/auth/auth-user";
import { BirFormsService } from "../bir-forms/bir-forms.service";
import { parsePeriod } from "../bir-forms/engine/period";
import { Prisma } from "@prisma/client";
import { isoToDate } from "../financial/serialization";
import { PrismaService } from "../prisma/prisma.service";
import { TaxRulesService } from "../tax-rules/tax-rules.service";
import { businessTax, incomeTax, type RuleSource } from "./compute";
import type { TaxEstimateQuery } from "./dto/tax-estimate.schemas";
import { estimatePeriod } from "./period";
import { EIGHT_PERCENT_RATE } from "./statute";

/** What every estimate tells the reader first (guardrail 1). */
/** Business-tax returns cover their own quarter alone; income-tax returns run from 1 January. */
const BUSINESS_TAX_FORMS = new Set(["2550Q", "2551Q"]);

export const TAX_ESTIMATE_NOTICE =
  "Management estimate, not the filed figure. A filed BIR return for the period, " +
  "listed under filedForms, is the figure that counts.";

/**
 * U10 R1–R4 (D47): the management tax estimate, computed once, for a year or a
 * quarter, from posted records and the client's own Tax Rule. It replaces the two
 * browser copies (TaxPage, PortalTaxPage) once Track B's W11 switches them over.
 */
@Injectable()
export class TaxEstimateService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly taxRules: TaxRulesService,
    private readonly birForms: BirFormsService,
  ) {}

  async estimate(user: AuthUser, clientId: string, query: TaxEstimateQuery) {
    const client = await this.prisma.client.findFirst({
      where: { id: clientId, firmId: user.firmId },
      select: { id: true, businessName: true, taxType: true },
    });
    if (!client) throw new NotFoundException("Client not found");

    const period = estimatePeriod(query.year, query.quarter);
    // R2: the saved rule, or the TRAIN default TaxRulesService serves when none is saved.
    const rule = await this.taxRules.get(user, clientId);
    const saved = await this.prisma.taxRule.findUnique({
      where: { clientId },
      select: { id: true },
    });
    const source: RuleSource = saved ? "saved" : "default";

    const forIncomeTax = await this.sums(
      clientId,
      period.incomeTaxFrom,
      period.incomeTaxTo,
    );
    const forBusinessTax = await this.sums(
      clientId,
      period.businessTaxFrom,
      period.businessTaxTo,
    );

    const it = incomeTax(
      rule,
      source,
      period.year,
      forIncomeTax.grossIncome,
      forIncomeTax.deductibleExpenses,
    );
    const bt = businessTax(
      client.taxType,
      rule.method,
      forBusinessTax.grossIncome,
      forBusinessTax.outputVAT,
      forBusinessTax.inputVAT,
    );

    // R4: the filed returns that cover the period. A business-tax return covers its
    // quarter alone; a quarterly income-tax return runs from 1 January to its
    // quarter's end; an annual return covers the year. An amended original is
    // flagged as superseded by the amendment that names it.
    const allFiled = await this.birForms.filedForClient(user.firmId, clientId);
    const amended = new Set(allFiled.map((f) => f.amendsId).filter(Boolean));
    const filedForms = allFiled
      .filter((f) => {
        const p = parsePeriod(f.period);
        if (Number(p.year) !== period.year) return false;
        if (!period.quarter || !p.quarter) return true;
        const q = Number(p.quarter.slice(1));
        return BUSINESS_TAX_FORMS.has(f.form)
          ? q === period.quarter
          : q <= period.quarter;
      })
      .map((f) => ({ ...f, superseded: amended.has(f.id) }));

    return {
      basis: "management-estimate" as const,
      notice: TAX_ESTIMATE_NOTICE,
      client: {
        id: client.id,
        businessName: client.businessName,
        regime: client.taxType ?? "EXEMPT",
      },
      period,
      method: {
        name: rule.method,
        source,
        rate:
          rule.method === "simplified8"
            ? EIGHT_PERCENT_RATE
            : rule.method === "graduated"
              ? null
              : (rule.flatRate ?? 0),
      },
      incomeTax: {
        grossIncome: it.grossIncome,
        deductibleExpenses: it.deductibleExpenses,
        taxableIncome: it.taxableIncome,
        due: it.due,
      },
      businessTax: {
        kind: bt.kind,
        grossReceipts: bt.grossReceipts,
        outputVAT: bt.outputVAT,
        inputVAT: bt.inputVAT,
        rate: bt.rate,
        due: bt.due,
      },
      assumptions: [
        "Figures come from posted records only; held imports are left out.",
        "Gross income is the sum of recorded sales, net of VAT; deductible expenses are " +
          "posted purchases marked deductible, net of VAT.",
        ...(period.quarter
          ? [
              "Income tax is cumulative from 1 January to the quarter's end, as a quarterly " +
                "income-tax return is; business tax covers the quarter alone.",
              "The income tax shown is the total from 1 January, before subtracting what " +
                "earlier quarterly returns paid.",
            ]
          : []),
        ...it.assumptions,
        ...bt.assumptions,
      ],
      filedForms,
    };
  }

  /** Posted totals for one client between two Manila dates, inclusive. */
  private async sums(clientId: string, from: string, to: string) {
    const txnDate = { gte: isoToDate(from), lte: isoToDate(to) };
    const [income, purchases, deductible] = await this.prisma.$transaction([
      this.prisma.incomeTransaction.aggregate({
        where: { clientId, txnDate },
        _sum: { netAmount: true, outputVAT: true },
      }),
      this.prisma.purchaseTransaction.aggregate({
        where: { clientId, txnDate, status: "posted" },
        _sum: { inputVAT: true },
      }),
      this.prisma.purchaseTransaction.aggregate({
        where: { clientId, txnDate, status: "posted", deductible: true },
        _sum: { netAmount: true },
      }),
    ]);
    return {
      grossIncome: num(income._sum.netAmount),
      outputVAT: num(income._sum.outputVAT),
      inputVAT: num(purchases._sum.inputVAT),
      deductibleExpenses: num(deductible._sum.netAmount),
    };
  }
}

/** A summed Decimal as a number (null when nothing matched → 0). */
function num(v: Prisma.Decimal | null): number {
  return v === null ? 0 : Number(v);
}
