# @portal/shared

The **single source of truth** for the tax-classification enums and the
Accounting Firm Portal ⇄ BIR Form Generator data contract. Import these in both the API
and the web app — never re-declare the enums or payload shapes inline.

## Contents

| Module | What it locks |
|---|---|
| `enums.ts` | The frozen enums: `VatClass`, `InputVATCategory`, `InputTaxAttribution`, plus `FormCode`, `PeriodType`, `FilingStatus`, `TransactionSource`, and `OAUTH_SCOPES`. |
| `money.ts` | `zMoney` (net-of-VAT, non-negative), `zSignedMoney`, `zIsoDate`, `round2`. |
| `transactions.ts` | `IncomeTransaction` / `PurchaseTransaction` domain schemas, incl. the capital-goods and government-sale refinements. |
| `import.ts` | `SalesImportRow` / `ExpenseImportRow` — coercing schemas for parsed CSV/XLSX cells (headers per system-design.md §9). |
| `integration.ts` | `VatSummaryResponse`, `PercentageTaxSummaryResponse`, `TaxComputationSummary`, `BirFilingPushback`, `InputTaxAssetHandoff`, and `birFilingIdempotencyKey()`. |

## Verified

`npm run typecheck` (strict) and `npm run test` (Vitest) both pass. The tests validate the
exact sample payloads from the integration spec and the refinement rules (e.g. the
`input-tax-asset` total must equal its parts; `CAPITAL_GOODS_GT_1M` requires cost + life).

## Consumption

This package is consumed **as TypeScript source** inside the monorepo (`main`/`types` point
at `src/index.ts`), so the app bundler / compiler handles it — no separate build step is
required to use it. A `build` script (`tsconfig.build.json`) is included for when you want
to emit `dist/` for publishing.

```ts
import { IncomeTransaction, VatSummaryResponse, OAUTH_SCOPES } from "@portal/shared";
```

## Rule of thumb

If a value crosses the Portal ⇄ Generator boundary, its schema lives **here**. Enforce
regime-specific rules (VAT vs percentage client) at the service layer using the client's
VAT-registration flag — those depend on data this package doesn't see.
