/**
 * The cached prefix every request of a pile carries (U11 R6): the versioned rules,
 * the document-type codes, and the allowed expense accounts exactly as the
 * template's COA sheet offers them (classifyAccounts over the chart), with the
 * chart's description as the "Use for" text where the chart has one.
 */
import { DOCUMENT_TYPES } from "../../purchase-transactions/import/expense-import.constants";
import { RECEIPTS_V1_RULES } from "./receipts-v1";

export { RECEIPTS_PROMPT_VERSION } from "./receipts-v1";

export interface InstructionAccount {
  code: string;
  name: string;
  useFor: string | null;
}

export function buildInstructions(accounts: InstructionAccount[]): string {
  const docTypes = DOCUMENT_TYPES.map((d) => `${d.code} — ${d.label}: ${d.note}`).join(
    "\n",
  );
  const allowed = accounts
    .map((a) => `${a.code} — ${a.name}${a.useFor ? ` — use for: ${a.useFor}` : ""}`)
    .join("\n");
  return `${RECEIPTS_V1_RULES}\n\nDOCUMENT TYPES (code — label: note)\n${docTypes}\n\nALLOWED EXPENSE ACCOUNTS (code — name)\n${allowed}\n`;
}
