// payeeDetails.ts — the payee details an expense carries for the 1601-EQ alphalist
// (W19, Track A U19): the branch, whether the payee is an individual or a company, and
// an individual's name parts. All optional; a blank saves as it always did. The prefill
// fills only what is blank and never touches anything that was typed.

import type { PayeeDetails, PayeeKind, PurchaseTxn } from "./api";

/** The expense form's payee boxes, as text. */
export interface PayeeFields {
  /** The supplier's name: a company's registered name. */
  vendor: string;
  branch: string;
  kind: PayeeKind | "";
  lastName: string;
  firstName: string;
  middleName: string;
}

/** Said under the boxes when the prefill filled something. */
export const PREFILL_NOTE = "Filled from the latest expense with this TIN.";

/** Said next to Company: the supplier name is the registered name. */
export const COMPANY_HINT =
  "For a company, the supplier name above is its registered name.";

/** The digits of a TIN as typed (dashes, spaces and all else dropped). */
export const tinDigits = (tin: string): string => tin.replace(/\D/g, "");

/** The prefill asks only for a TIN of exactly 9 digits (dashes allowed). */
export const isNineDigits = (tin: string): boolean => tinDigits(tin).length === 9;

/** Whether the payee boxes (not the supplier name) are all still blank. */
export function payeeBoxesBlank(f: PayeeFields): boolean {
  return (
    f.branch.trim() === "" &&
    f.kind === "" &&
    f.lastName.trim() === "" &&
    f.firstName.trim() === "" &&
    f.middleName.trim() === ""
  );
}

/** The boxes of a saved expense. */
export function payeeFieldsOf(t: PurchaseTxn | undefined): PayeeFields {
  return {
    vendor: t?.vendor ?? "",
    branch: t?.vendorBranch ?? "",
    kind: t?.payeeKind ?? "",
    lastName: t?.payeeLastName ?? "",
    firstName: t?.payeeFirstName ?? "",
    middleName: t?.payeeMiddleName ?? "",
  };
}

/**
 * The boxes after the prefill: each BLANK box takes the saved value, each box that holds
 * anything is left exactly as it is. `filled` says whether anything changed. A `found:
 * false` answer changes nothing.
 */
export function applyPrefill(
  current: PayeeFields,
  found: PayeeDetails,
): { fields: PayeeFields; filled: boolean } {
  if (!found.found) return { fields: current, filled: false };
  const next: PayeeFields = { ...current };
  const take = (
    key: "vendor" | "branch" | "lastName" | "firstName" | "middleName",
    v: string | null,
  ) => {
    if (current[key].trim() === "" && v && v.trim() !== "") next[key] = v;
  };
  take("vendor", found.vendor);
  take("branch", found.branch);
  take("lastName", found.lastName);
  take("firstName", found.firstName);
  take("middleName", found.middleName);
  if (current.kind === "" && found.payeeKind) next.kind = found.payeeKind;
  const filled = (Object.keys(next) as (keyof PayeeFields)[]).some(
    (k) => next[k] !== current[k],
  );
  return { fields: filled ? next : current, filled };
}

/** What goes to the API with an expense: only the boxes that hold something, so a blank
 *  saves as it always did. */
export function payeePayload(f: PayeeFields): Record<string, string> {
  const out: Record<string, string> = {};
  if (f.branch.trim()) out.vendorBranch = f.branch.trim();
  if (f.kind) out.payeeKind = f.kind;
  if (f.lastName.trim()) out.payeeLastName = f.lastName.trim();
  if (f.firstName.trim()) out.payeeFirstName = f.firstName.trim();
  if (f.middleName.trim()) out.payeeMiddleName = f.middleName.trim();
  return out;
}

/** The payee line under a supplier in the list: "Individual · DELA CRUZ, JUAN M. · branch 00001". */
export function payeeLine(t: PurchaseTxn): string {
  const parts: string[] = [];
  if (t.payeeKind === "individual") parts.push("Individual");
  else if (t.payeeKind === "non_individual") parts.push("Company");
  const name = [
    t.payeeLastName ? `${t.payeeLastName},` : "",
    t.payeeFirstName ?? "",
    t.payeeMiddleName ?? "",
  ]
    .filter(Boolean)
    .join(" ");
  if (name) parts.push(name);
  if (t.vendorBranch) parts.push(`branch ${t.vendorBranch}`);
  return parts.join(" · ");
}

// --- W24: a full TIN typed into the TIN box --------------------------------------------------

/** Said when a full TIN was split: the branch now sits in the Branch box. */
export const SPLIT_NOTE = "Branch moved to the Branch field.";

/** Said when the TIN carries a branch that is not the one in the Branch box. */
export const branchConflictMessage = (branch: string): string =>
  `The TIN includes a branch (${branch}) that differs from the Branch field. Check which is right.`;

/** The TIN box's hint and example: the TIN is 9 digits, the branch has its own box. */
export const TIN_PLACEHOLDER = "123-456-789";
export const TIN_HINT = "9 digits, for example 123-456-789.";
export const BRANCH_HINT = "Up to 5 digits.";

/** 9 digits as the form shows them: 123-456-789. */
export const formatTin9 = (digits: string): string =>
  `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6, 9)}`;

/**
 * What a TIN of 12 or 14 digits (dashes and spaces dropped) becomes: the first 9 digits are
 * the TIN and the rest is the branch.
 * - `none`: not 12 or 14 digits; nothing to do.
 * - `split`: the Branch box is empty or holds the same digits: the TIN becomes the 9 digits
 *   (123-456-789) and the branch goes to the Branch box.
 * - `conflict`: the Branch box holds other digits: both stay as typed, and the person is told.
 */
export type TinSplit =
  | { kind: "none" }
  | { kind: "split"; tin: string; branch: string }
  | { kind: "conflict"; branch: string };

export function splitTin(typedTin: string, branchBox: string): TinSplit {
  const d = tinDigits(typedTin);
  if (d.length !== 12 && d.length !== 14) return { kind: "none" };
  const branch = d.slice(9);
  const box = branchBox.trim();
  if (box === "" || box === branch) return { kind: "split", tin: formatTin9(d), branch };
  return { kind: "conflict", branch };
}
