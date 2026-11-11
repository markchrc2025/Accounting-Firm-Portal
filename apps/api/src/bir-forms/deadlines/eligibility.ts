// eligibility.ts — PA8 (D70): which returns a client must file, from its kind and registered tax
// types, and what the client record lacks to decide. Pure.
import { registeredWithholding } from "../withholding";

export interface DeadlineClient {
  id: string;
  name: string;
  /** "individual" | "non-individual" */
  kind: string;
  /** "VAT" | "PERCENTAGE" | null */
  taxType: string | null;
  taxTypesJson: unknown;
  /** "2024-07-01" or null. */
  fiscalYearStart: string | null;
}

export interface RequiredReturn {
  form: string;
  /** Other forms that satisfy the same row (the 1701 row is also filed on the 1701A). */
  alternatives: string[];
}

export function requiredReturns(c: DeadlineClient): RequiredReturn[] {
  const out: RequiredReturn[] = [];
  const add = (form: string, alternatives: string[] = []) =>
    out.push({ form, alternatives });
  if (c.taxType === "VAT") add("2550Q");
  if (c.taxType === "PERCENTAGE") add("2551Q");
  const w = registeredWithholding(c.taxTypesJson);
  if (w.expanded) {
    add("0619E");
    add("1601EQ");
    add("2307");
    add("1604E");
  }
  if (w.compensation) {
    add("1601C");
    add("1604C");
    add("2316");
  }
  if (c.kind === "individual") {
    add("1701Q");
    add("1701", ["1701A"]);
  } else {
    add("1702Q");
    add("1702RT");
  }
  return out;
}

export interface MissingItem {
  field: "taxType" | "taxTypes" | "fiscalYearStart";
  sentence: string;
}

/** What the client's record lacks to decide its returns. */
export function missingInfo(c: DeadlineClient): MissingItem[] {
  const out: MissingItem[] = [];
  if (!c.taxType) {
    out.push({
      field: "taxType",
      sentence:
        "The business tax (VAT or percentage tax) is not set, so the 2550Q or 2551Q cannot be listed.",
    });
  }
  if (!Array.isArray(c.taxTypesJson) || c.taxTypesJson.length === 0) {
    out.push({
      field: "taxTypes",
      sentence: "No registered tax types, so the withholding returns cannot be listed.",
    });
  }
  if (c.kind !== "individual" && !c.fiscalYearStart) {
    out.push({
      field: "fiscalYearStart",
      sentence:
        "The fiscal year start is not set; the calendar year is assumed for the 2550Q, 1702Q and 1702RT.",
    });
  }
  return out;
}
