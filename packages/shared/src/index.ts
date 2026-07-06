/**
 * @portal/shared — the single source of truth for the tax-classification enums and the
 * Portal ⇄ BIR Form Generator data contract. Import from here in both the API and the web
 * app; never re-declare these enums or shapes inline.
 */
export * from "./enums";
export * from "./money";
export * from "./transactions";
export * from "./import";
export * from "./integration";
