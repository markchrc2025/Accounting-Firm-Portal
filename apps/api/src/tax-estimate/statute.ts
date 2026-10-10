/**
 * statute.ts — the statutory rates the management tax estimate needs that the
 * dated graduated tables in bir-forms/engine/taxTables.ts do not carry (U10 R3,
 * D47). Until U5 turns this into the dated statute table D5 and D13 call for,
 * nothing else in the codebase may carry its own copy of these numbers.
 *
 * All three come from TRAIN, Republic Act No. 10963, effective 1 January 2018.
 *  - PERCENTAGE_TAX_RATE: Sec. 116 percentage tax on gross receipts, 3% from
 *    1 January 2018. NOTE: RA 11534 (CREATE) set it at 1% from 1 July 2020 to
 *    30 June 2023; that window is not applied here until U5 dates this table.
 *  - EIGHT_PERCENT_RATE: the 8% income-tax option of Sec. 24(A)(2)(b), on gross
 *    sales/receipts, in lieu of the graduated rates and the percentage tax,
 *    from 1 January 2018.
 *  - EIGHT_PERCENT_REDUCTION: the ₱250,000 the 8% option deducts from gross
 *    sales/receipts for a purely self-employed taxpayer, from 1 January 2018.
 * The graduated brackets are imported, never restated: Table 1 (2018–2022) and
 * Table 2 (from 2023) live, dated, in taxTables.ts.
 */
export { graduatedTax } from "../bir-forms/engine/taxTables";

/** Percentage tax, % of gross receipts (TRAIN, from 1 January 2018). */
export const PERCENTAGE_TAX_RATE = 3;

/** The 8% income-tax option, % of gross receipts (TRAIN, from 1 January 2018). */
export const EIGHT_PERCENT_RATE = 8;

/** The 8% option's reduction from gross receipts, pesos (TRAIN, from 1 January 2018). */
export const EIGHT_PERCENT_REDUCTION = 250_000;
