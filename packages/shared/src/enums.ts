import { z } from "zod";

/**
 * ============================================================================
 * FROZEN TAX-CLASSIFICATION ENUMS
 * ----------------------------------------------------------------------------
 * These values are the contract between the Accounting Firm Portal and the BIR
 * Form Generator. They MUST match the integration spec byte-for-byte. Do not
 * rename, reorder-for-meaning, or add values without changing the contract on
 * both sides.
 * ============================================================================
 */

/** Output-side VAT classification of an income transaction. */
export const VatClass = z.enum([
  "VATABLE_12",
  "ZERO_RATED",
  "EXEMPT",
  "NON_VAT", // percentage-tax (non-VAT) clients
]);
export type VatClass = z.infer<typeof VatClass>;

/** Input-side VAT category of a purchase (maps to 2550Q Items 44–49 / Schedule 1). */
export const InputVATCategory = z.enum([
  "DOMESTIC_PURCHASES", // Item 44 (incl. capital goods <= 1M, claimed in full)
  "SERVICES_NONRESIDENT", // Item 45
  "IMPORTATION_GOODS", // Item 46
  "OTHERS_WITH_INPUT_TAX", // Item 47
  "DOMESTIC_NO_INPUT_TAX", // Item 48 (amount only)
  "VAT_EXEMPT_IMPORTATION", // Item 49 (amount only)
  "CAPITAL_GOODS_GT_1M", // Schedule 1 amortization only (requires cost + useful life)
]);
export type InputVATCategory = z.infer<typeof InputVATCategory>;

/** How input tax is attributed for apportionment (Schedule 2). */
export const InputTaxAttribution = z.enum(["VATABLE", "EXEMPT", "MIXED"]);
export type InputTaxAttribution = z.infer<typeof InputTaxAttribution>;

/** Where a record originated. */
export const TransactionSource = z.enum(["manual", "import"]);
export type TransactionSource = z.infer<typeof TransactionSource>;

/** Reporting period granularity. Integration payloads use `quarter` / `year`. */
export const PeriodType = z.enum(["month", "quarter", "year"]);
export type PeriodType = z.infer<typeof PeriodType>;

/** BIR form codes handled across the two systems. */
export const FormCode = z.enum([
  "1701",
  "1701A",
  "1701Q",
  "1702RT",
  "1702Q",
  "2550Q",
  "2551Q",
  "2307",
  "2316",
]);
export type FormCode = z.infer<typeof FormCode>;

/** Lifecycle status of a BIR filing artifact stored on the Portal. */
export const FilingStatus = z.enum(["draft", "ready", "filed"]);
export type FilingStatus = z.infer<typeof FilingStatus>;

/**
 * OAuth2 scopes the BIR Form Generator may request (client-credentials). The Portal
 * grants only what the connector needs and still enforces per-client visibility.
 */
export const OAUTH_SCOPES = [
  "clients:read",
  "tax-computations:read",
  "vat-summary:read",
  "percentage-tax-summary:read",
  "transactions:read",
  "bir-filings:read",
  "bir-filings:write",
  "input-tax-asset:write",
] as const;
export const OAuthScope = z.enum(OAUTH_SCOPES);
export type OAuthScope = z.infer<typeof OAuthScope>;
