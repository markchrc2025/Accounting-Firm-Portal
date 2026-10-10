/**
 * compute.ts — the management tax estimate's arithmetic, pure (U10 R2–R3, D47).
 * A MANAGEMENT ESTIMATE (guardrail 1): it never overrides a figure a filed BIR
 * form carries. Rates come from statute.ts; graduated brackets come either from
 * the client's saved rule or, on the TRAIN default, from the dated tables in
 * bir-forms/engine/taxTables.ts for the estimate's year.
 */
import type { TaxBracket, TaxRuleInput } from "../tax-rules/dto/tax-rule.schemas";
import {
  EIGHT_PERCENT_RATE,
  EIGHT_PERCENT_REDUCTION,
  PERCENTAGE_TAX_CREATE_NOTE,
  PERCENTAGE_TAX_RATE,
  graduatedTax,
  pesos,
} from "./statute";

/** Round to centavos. */
export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** Where the client's rule came from: saved on Tax Rules, or the TRAIN default. */
export type RuleSource = "saved" | "default";

export interface IncomeTaxResult {
  grossIncome: number;
  deductibleExpenses: number;
  /** The amount the method's rate applies to. */
  taxableIncome: number;
  due: number;
  assumptions: string[];
}

/** The page's bracket rule for a SAVED schedule: baseTax + (t − over) × rate%. */
export function savedBracketTax(taxable: number, brackets: TaxBracket[]): number {
  if (taxable <= 0) return 0;
  const b = brackets.find(
    (x) => taxable > x.over && (x.notOver === null || taxable <= x.notOver),
  );
  return b ? b.baseTax + ((taxable - b.over) * b.rate) / 100 : 0;
}

/** Income tax by the client's rule (R2). */
export function incomeTax(
  rule: TaxRuleInput,
  source: RuleSource,
  year: number,
  grossIncome: number,
  deductibleExpenses: number,
): IncomeTaxResult {
  const net = Math.max(0, grossIncome - deductibleExpenses);
  const assumptions: string[] = [];
  const rate = rule.flatRate ?? 0;
  let taxableIncome: number;
  let due: number;

  switch (rule.method) {
    case "simplified8": {
      taxableIncome = Math.max(0, grossIncome - EIGHT_PERCENT_REDUCTION);
      due = (taxableIncome * EIGHT_PERCENT_RATE) / 100;
      assumptions.push(
        `${EIGHT_PERCENT_RATE}% income tax on gross receipts less ` +
          `${pesos(EIGHT_PERCENT_REDUCTION)}; expenses are not deducted. This assumes no ` +
          "compensation income; a mixed-income earner gets no " +
          `${pesos(EIGHT_PERCENT_REDUCTION)} reduction.`,
      );
      break;
    }
    case "flat": {
      taxableIncome = net;
      due = (net * rate) / 100;
      assumptions.push(
        `Flat ${rate}% of taxable income (gross income less deductible expenses, never below zero).`,
      );
      if (rule.flatRate === null)
        assumptions.push("No rate is saved for this rule; 0% is used.");
      break;
    }
    case "percentage": {
      taxableIncome = Math.max(0, grossIncome);
      due = (taxableIncome * rate) / 100;
      assumptions.push(
        `${rate}% of gross receipts. The Tax Rules page describes this method as ` +
          '"Percentage tax on gross receipts, in lieu of VAT"; the estimate applies the ' +
          "saved rate to gross receipts as the income-tax figure.",
      );
      if (rule.flatRate === null)
        assumptions.push("No rate is saved for this rule; 0% is used.");
      break;
    }
    case "graduated":
    default: {
      taxableIncome = net;
      if (source === "default") {
        due = graduatedTax(net, year);
        assumptions.push(
          `Graduated TRAIN rates for ${year} (the default rule; no rule is saved for this client), ` +
            "on gross income less deductible expenses, never below zero.",
        );
      } else {
        due = savedBracketTax(net, rule.brackets);
        assumptions.push(
          "Graduated rates from the brackets saved on this client's Tax Rules, on gross " +
            "income less deductible expenses, never below zero.",
        );
        const covered = rule.brackets.some(
          (b) => net > b.over && (b.notOver === null || net <= b.notOver),
        );
        if (net > 0 && !covered) {
          assumptions.push(
            `No saved bracket covers taxable income of ${pesos(round2(net))}, so 0 is used. ` +
              "Check the brackets on this client's Tax Rules.",
          );
        }
      }
      break;
    }
  }

  return {
    grossIncome: round2(grossIncome),
    deductibleExpenses: round2(deductibleExpenses),
    taxableIncome: round2(taxableIncome),
    due: round2(due),
    assumptions,
  };
}

export type BusinessTaxKind = "vat" | "percentage" | "none";

export interface BusinessTaxResult {
  kind: BusinessTaxKind;
  grossReceipts: number;
  outputVAT: number;
  inputVAT: number;
  /** The percentage-tax rate applied, %; null when no percentage tax applies. */
  rate: number | null;
  due: number;
  assumptions: string[];
}

/** Business tax by regime (R3). */
export function businessTax(
  taxType: string | null,
  method: TaxRuleInput["method"],
  grossReceipts: number,
  outputVAT: number,
  inputVAT: number,
): BusinessTaxResult {
  const base = {
    grossReceipts: round2(grossReceipts),
    outputVAT: round2(outputVAT),
    inputVAT: round2(inputVAT),
  };
  if (taxType === "VAT") {
    const due = outputVAT - inputVAT;
    return {
      kind: "vat",
      ...base,
      rate: null,
      due: round2(due),
      assumptions: [
        "VAT payable is output VAT less input VAT for the period" +
          (due < 0 ? "; a negative figure is excess input VAT to carry over." : "."),
        "Output VAT is taken as recorded on each sale; a sale saved without it counts as none.",
      ],
    };
  }
  if (taxType === "PERCENTAGE") {
    if (method === "simplified8") {
      return {
        kind: "percentage",
        ...base,
        rate: null,
        due: 0,
        assumptions: [
          `No percentage tax: the ${EIGHT_PERCENT_RATE}% option is in lieu of percentage tax.`,
        ],
      };
    }
    return {
      kind: "percentage",
      ...base,
      rate: PERCENTAGE_TAX_RATE,
      due: round2((grossReceipts * PERCENTAGE_TAX_RATE) / 100),
      assumptions: [
        `Percentage tax at ${PERCENTAGE_TAX_RATE}% of gross receipts (TRAIN). ` +
          PERCENTAGE_TAX_CREATE_NOTE,
      ],
    };
  }
  return {
    kind: "none",
    ...base,
    rate: null,
    due: 0,
    assumptions: [
      taxType === null
        ? "No business tax: this client is exempt from business tax."
        : `No business tax is estimated for the regime "${taxType}".`,
    ],
  };
}
