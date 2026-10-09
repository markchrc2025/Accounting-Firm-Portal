// certificateRules.ts — the rules a 2307 must meet before it is issued (W3 R4,
// R6). Pure functions, so the editor and its tests share one definition.

/** The head-office branch code. Offered and confirmed — never assumed (R4). */
export const HEAD_OFFICE_BRANCH = "00000";

/** How the payee's branch is chosen: head office, or another branch's code. */
export type PayeeBranchChoice = "" | "head" | "other";

export const PAYEE_BRANCH_CHOICES: { value: PayeeBranchChoice; label: string }[] = [
  { value: "", label: "Choose the payee's branch…" },
  { value: "head", label: `Head office (${HEAD_OFFICE_BRANCH})` },
  { value: "other", label: "Another branch — enter its code" },
];

/** The stored branch code for a choice and a typed code; "" when incomplete. */
export function payeeBranchFrom(choice: PayeeBranchChoice, typed: string): string {
  if (choice === "head") return HEAD_OFFICE_BRANCH;
  if (choice === "other") {
    const d = typed.replace(/\D/g, "");
    return d.length === 5 ? d : "";
  }
  return "";
}

/** The choice a stored branch code shows as when a certificate is reopened. */
export function payeeBranchChoice(stored: string | null | undefined): {
  choice: PayeeBranchChoice;
  typed: string;
} {
  const d = String(stored ?? "").replace(/\D/g, "");
  if (d === "") return { choice: "", typed: "" };
  if (d === HEAD_OFFICE_BRANCH) return { choice: "head", typed: "" };
  return { choice: "other", typed: d };
}

/** The branch digits a TIN carries after its nine TIN digits, if any. */
function branchInTin(tin: string | null | undefined): string {
  return String(tin ?? "")
    .replace(/\D/g, "")
    .slice(9);
}

export interface IssueBlocker {
  /** Which rule — so the editor can attach a link to the right one. */
  rule:
    | "payor-unknown"
    | "payor-branch"
    | "payee-branch"
    | "payee-branch-mismatch"
    | "atc-missing";
  message: string;
}

/** A Part III row as far as the issue rules read it. */
interface RuleRow {
  atc?: string;
  m1?: string;
  m2?: string;
  m3?: string;
  tax?: string;
}

const hasAmount = (r: RuleRow) =>
  [r.m1, r.m2, r.m3, r.tax].some((v) => v != null && String(v).trim() !== "");

/**
 * Everything that stops a 2307 from being issued (R4). An empty list means it
 * may be issued.
 */
export function issueBlockers(input: {
  /** False while the client record has not loaded; its branch is then unknown,
   *  not empty. Defaults to true. */
  payorKnown?: boolean;
  /** The client record could not be read at all. */
  payorLoadFailed?: boolean;
  payorBranch: string | null | undefined;
  payeeBranch: string | null | undefined;
  payeeTin: string | null | undefined;
  rows?: RuleRow[];
}): IssueBlocker[] {
  const out: IssueBlocker[] = [];
  if (input.payorKnown === false) {
    out.push({
      rule: "payor-unknown",
      message: input.payorLoadFailed
        ? "The client record could not be loaded, so the payor's branch code cannot be checked."
        : "Checking the client's branch code…",
    });
  } else if (String(input.payorBranch ?? "").replace(/\D/g, "") === "") {
    out.push({
      rule: "payor-branch",
      message:
        "This client has no branch code on file, so the payor's TIN cannot be printed in full. Add the branch code on the client's record before issuing.",
    });
  }
  const payee = String(input.payeeBranch ?? "").replace(/\D/g, "");
  if (payee.length !== 5) {
    out.push({
      rule: "payee-branch",
      message: `Choose the payee's branch code — Head office (${HEAD_OFFICE_BRANCH}) or the branch's own five digits — before issuing.`,
    });
  } else {
    const inTin = branchInTin(input.payeeTin);
    if (inTin !== "" && inTin.padStart(5, "0") !== payee) {
      out.push({
        rule: "payee-branch-mismatch",
        message: `The payee TIN ends in branch code ${inTin}, but the branch chosen is ${payee}. Make them agree before issuing.`,
      });
    }
  }
  // No default ATC (R6): a row with an amount needs the ATC the accountant chose.
  const noAtc = (input.rows ?? [])
    .map((r, i) => (hasAmount(r) && String(r.atc ?? "").trim() === "" ? i + 1 : 0))
    .filter((n) => n > 0);
  if (noAtc.length) {
    const which =
      noAtc.length === 1 ? `Row ${noAtc[0]} has` : `Rows ${noAtc.join(", ")} have`;
    out.push({
      rule: "atc-missing",
      message: `${which} an amount but no ATC. Choose the ATC for every row with an amount before issuing.`,
    });
  }
  return out;
}

/** A TIN as the form prints it: 000-000-000-00000, as many groups as given. */
export function formatTin(tin: string | null | undefined): string {
  const d = String(tin ?? "").replace(/\D/g, "");
  return [d.slice(0, 3), d.slice(3, 6), d.slice(6, 9), d.slice(9)]
    .filter((g) => g !== "")
    .join("-");
}

/**
 * The "(Indicate Title/Designation and TIN)" line under a signature (R6):
 * "TITLE / TIN 000-000-000-00000". Either half alone prints alone.
 */
export function titleTinLine(
  title: string | null | undefined,
  tin: string | null | undefined,
): string {
  const t = String(title ?? "").trim();
  const n = formatTin(tin);
  const tinPart = n ? `TIN ${n}` : "";
  return [t, tinPart].filter(Boolean).join(" / ");
}
