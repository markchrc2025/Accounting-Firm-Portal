import { BadRequestException, Injectable } from "@nestjs/common";
import type { IncomeTransaction, PurchaseTransaction } from "@portal/shared";

/**
 * A client's tax regime, derived from Client.taxType. EXEMPT is internal (U8, D39):
 * it is what a null taxType means — the client form's "None (exempt from business
 * tax)" — and is never stored. An EXEMPT client keeps books under the non-VAT rules
 * and owes no business tax.
 */
export type Regime = "VAT" | "PERCENTAGE" | "EXEMPT";

/** True when a stored taxType means EXEMPT: no regime at all (U8, D39). */
export function isExemptTaxType(taxType: string | null | undefined): boolean {
  return taxType === null || taxType === undefined;
}

/** The non-VAT regimes: one rule set for both (U8 R2). */
export function isNonVat(regime: Regime): boolean {
  return regime !== "VAT";
}

/** InputVATCategory members that carry NO creditable input VAT (amount only). */
const NO_INPUT_VAT_CATEGORIES = new Set([
  "DOMESTIC_NO_INPUT_TAX",
  "VAT_EXEMPT_IMPORTATION",
  "CAPITAL_GOODS_GT_1M", // Schedule-1 amortization only; not claimed in full here
]);

function isZeroOrAbsent(v: number | undefined | null): boolean {
  return v === undefined || v === null || v === 0;
}

/**
 * Enforces the regime-specific rules that the frozen @portal/shared schema can't
 * express on its own (it validates the shape + the government-sale and
 * capital-goods couplings; this adds the rules that depend on Client.taxType).
 *
 * The Portal never computes authoritative BIR tax (guardrail #1): amount checks
 * against a derived 12% are intentionally NOT enforced here.
 */
@Injectable()
export class RegimeValidator {
  /**
   * Resolve a client's regime. VAT and PERCENTAGE are themselves; null (or absent)
   * is EXEMPT — a client exempt from business tax still keeps books (D39). Any
   * other stored value is refused.
   */
  requireRegime(taxType: string | null | undefined): Regime {
    if (taxType === "VAT" || taxType === "PERCENTAGE") return taxType;
    if (taxType === null || taxType === undefined) return "EXEMPT";
    throw new BadRequestException(
      "Unknown tax regime: use VAT, PERCENTAGE, or none for a client exempt from business tax.",
    );
  }

  validateIncome(regime: Regime, tx: IncomeTransaction): void {
    if (regime === "VAT") {
      if (tx.vatClass === "NON_VAT") {
        this.fail(
          "vatClass",
          "A VAT-registered client cannot record a NON_VAT sale; use VATABLE_12, ZERO_RATED, or EXEMPT.",
        );
      }
      if (tx.saleToGovernment && tx.vatClass !== "VATABLE_12") {
        this.fail(
          "saleToGovernment",
          "A government sale (5% VAT withheld) must be a VATABLE_12 sale.",
        );
      }
      if (!tx.saleToGovernment && !isZeroOrAbsent(tx.creditableVATWithheld5pct)) {
        this.fail(
          "creditableVATWithheld5pct",
          "creditableVATWithheld5pct only applies to government sales (set saleToGovernment).",
        );
      }
      if (
        (tx.vatClass === "ZERO_RATED" || tx.vatClass === "EXEMPT") &&
        !isZeroOrAbsent(tx.outputVAT)
      ) {
        this.fail("outputVAT", `${tx.vatClass} sales have no output VAT.`);
      }
      return;
    }

    // A non-VAT client: PERCENTAGE, or EXEMPT (no regime) — the same rules (U8 R2).
    if (tx.vatClass !== "NON_VAT") {
      this.fail("vatClass", "A non-VAT client's income must be classified NON_VAT.");
    }
    if (tx.saleToGovernment) {
      this.fail(
        "saleToGovernment",
        "The 5% creditable VAT withholding is VAT-only; it does not apply to a non-VAT client.",
      );
    }
    if (!isZeroOrAbsent(tx.creditableVATWithheld5pct)) {
      this.fail(
        "creditableVATWithheld5pct",
        "A non-VAT client has no creditable VAT withheld.",
      );
    }
    if (!isZeroOrAbsent(tx.outputVAT)) {
      this.fail("outputVAT", "A NON_VAT sale has no output VAT.");
    }
  }

  validatePurchase(regime: Regime, tx: PurchaseTransaction): void {
    if (regime === "VAT") {
      if (!tx.inputVATCategory) {
        this.fail(
          "inputVATCategory",
          "A VAT-registered client must classify each purchase's input-VAT category.",
        );
      }
      if (
        tx.inputVATCategory &&
        NO_INPUT_VAT_CATEGORIES.has(tx.inputVATCategory) &&
        !isZeroOrAbsent(tx.inputVAT)
      ) {
        this.fail(
          "inputVAT",
          `${tx.inputVATCategory} carries no creditable input VAT; inputVAT must be 0.`,
        );
      }
      if (tx.inputVATCategory === "CAPITAL_GOODS_GT_1M" && !tx.isCapitalGood) {
        this.fail(
          "isCapitalGood",
          "CAPITAL_GOODS_GT_1M purchases must be flagged isCapitalGood.",
        );
      }
      return;
    }

    // A non-VAT client (PERCENTAGE or EXEMPT): no input-VAT classification applies.
    if (tx.inputVATCategory) {
      this.fail(
        "inputVATCategory",
        "A non-VAT client claims no input VAT; leave the category unset.",
      );
    }
    if (!isZeroOrAbsent(tx.inputVAT)) {
      this.fail("inputVAT", "A non-VAT client has no creditable input VAT.");
    }
    if (tx.inputTaxAttribution) {
      this.fail(
        "inputTaxAttribution",
        "Input-tax attribution only applies to VAT-registered clients.",
      );
    }
  }

  private fail(path: string, message: string): never {
    throw new BadRequestException({
      message: "Regime validation failed",
      errors: [{ path, message }],
    });
  }
}
