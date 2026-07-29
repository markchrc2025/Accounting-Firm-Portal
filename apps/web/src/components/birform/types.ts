// Core domain types for the internal BIR Forms engine.
// PORTED from the Sentire BIR Form Generator (src/types) — the authoritative
// tax logic now lives inside the portal (guardrail #1). Per-form computation
// *result* types live beside their compute module.

/** The nine BIR forms the generator supports. */
export type FormCode =
  | "1701"
  | "1701A"
  | "1701Q"
  | "1702RT"
  | "1702Q"
  | "2550Q"
  | "2551Q"
  | "2307"
  | "2316";

export type TaxpayerKind = "individual" | "non-individual";

export type FormCategory = "Income Tax" | "Business Tax" | "Withholding";

/** One registered tax-type line from the BIR Certificate of Registration (2303). */
export interface TaxType {
  type: string;
  form: string;
  frequency: string;
  startDate?: string;
}

/** A registered filer — an individual or a company. */
export interface Taxpayer {
  id: string;
  kind: TaxpayerKind;
  regName: string;
  lastName: string;
  firstName: string;
  middleName: string;
  tradeName?: string;
  tin: string;
  branch: string;
  rdo: string;
  taxTypes?: TaxType[];
  address: string;
  city: string;
  zip: string;
  birthdate: string;
  incorpDate?: string;
  email: string;
  phone: string;
  citizenship: string;
  civilStatus: string;
  taxpayerType: string;
  classification: string;
  rdoName?: string;
  corPath?: string;
  createdAt: number;
  updatedAt?: number;
}

// ---- per-form repeating rows (2307, 2551Q) ----
export interface Row2307 {
  [key: string]: string | undefined;
  atc?: string;
  desc?: string;
  m1?: string;
  m2?: string;
  m3?: string;
  tax?: string;
}

export interface Row2551Q {
  [key: string]: string | undefined;
  atc?: string;
  desc?: string;
  taxable?: string;
  rate?: string;
}

export type FilingRow = Row2307 | Row2551Q;

/**
 * Raw field values for a filing, keyed by form-field id. Values are the literal
 * strings the user typed; computed values are NEVER stored — always derived.
 * The repeating-line tables (2307/2551Q) live under the "rows" key.
 */
export interface FilingData {
  [key: string]: string | FilingRow[] | undefined;
}

export interface XmlExport {
  at: number;
  filename: string;
  xml: string;
}

export type FilingStatus = "draft" | "filed";

/** A single saved form instance for a taxpayer + period. */
export interface Filing {
  id: string;
  form: FormCode;
  taxpayerId: string;
  status: FilingStatus;
  period: string;
  data: FilingData;
  exports?: XmlExport[];
  createdAt: number;
  updatedAt: number;
}
