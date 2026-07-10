// Local domain types for the COR OCR parser/extractor. These mirror the API's
// `TaxTypeRow` shape (apps/api/src/clients/dto/client.schemas.ts) and the
// `kind` enum on the Client filer profile; the web app can't import the API DTO,
// so they're replicated here (the same values live in @portal/shared's frozen
// enums for transactions, but not for the client/COR profile).

export type TaxpayerKind = "individual" | "non-individual";

export interface TaxType {
  /** Tax type, e.g. "Income Tax", "Value-Added Tax", "Registration Fee". */
  type: string;
  /** Form/return type filed for it, e.g. "1701", "2550Q", "0605". */
  form: string;
  /** Filing frequency, e.g. "Annually", "Quarterly", "Monthly". */
  frequency: string;
  /** Filing start date, ISO yyyy-mm-dd (optional). */
  startDate?: string;
}
