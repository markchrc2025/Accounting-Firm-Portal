// clientDelete.ts - W26: deleting a client entered by mistake or twice (Track A U25, D72).
// The API decides everything: what blocks a delete (its sentences are shown word for word),
// what goes and what is kept. The web only names each kind in plain words and folds the typed
// name the way the API does, so the Delete button waits for the right name.
import type {
  ClientDeleteBlockerKind,
  ClientDeleteKind,
  ClientUnlinkKind,
} from "@portal/shared";
import { apiFetch } from "./api";

export interface ClientDeleteCheck {
  canDelete: boolean;
  nameToType: string;
  blockers: { kind: ClientDeleteBlockerKind; count: number; sentence: string }[];
  willDelete: { kind: ClientDeleteKind; count: number }[];
  willUnlink: { kind: ClientUnlinkKind; count: number }[];
}
export interface ClientDeleteResult {
  deleted: { kind: ClientDeleteKind; count: number }[];
  unlinked: { kind: ClientUnlinkKind; count: number }[];
  filesNotRemoved: { key: string }[];
}

export const fetchClientDeleteCheck = (clientId: string) =>
  apiFetch<ClientDeleteCheck>(`/clients/${encodeURIComponent(clientId)}/delete-check`);
export const deleteClient = (clientId: string, confirmName: string) =>
  apiFetch<ClientDeleteResult>(`/clients/${encodeURIComponent(clientId)}`, {
    method: "DELETE",
    body: JSON.stringify({ confirmName }),
  });

/** Case folded, every run of white space one space, trimmed: the API's foldName (D72). */
export function foldName(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}
/** Whether the typed text is the name to type, as the API compares them. */
export const nameMatches = (typed: string, nameToType: string): boolean =>
  foldName(typed) !== "" && foldName(typed) === foldName(nameToType);

/** Each kind that goes with the client, in plain words: [one, many]. */
export const DELETE_KIND_LABELS: Record<ClientDeleteKind, [string, string]> = {
  incomeTransactions: ["income record", "income records"],
  purchaseTransactions: ["purchase record", "purchase records"],
  categories: ["category", "categories"],
  birFormDrafts: ["draft BIR return", "draft BIR returns"],
  birFormDraftFiles: [
    "stored file of a draft BIR return",
    "stored files of draft BIR returns",
  ],
  birFilingsNotFiled: ["BIR filing record not filed", "BIR filing records not filed"],
  receiptScans: ["receipt scan", "receipt scans"],
  receiptScanFiles: ["stored receipt photo", "stored receipt photos"],
  inputTaxAssets: ["input tax asset", "input tax assets"],
  taxRules: ["tax rule", "tax rules"],
  draftInvoices: ["draft invoice", "draft invoices"],
  corFiles: ["COR file", "COR files"],
  clientUserProfiles: ["client portal user profile", "client portal user profiles"],
  invitations: ["invitation", "invitations"],
  clientRoleGrants: ["client role grant", "client role grants"],
  staffAssignments: ["staff assignment", "staff assignments"],
};
/** What stays, with its link to the client cleared. */
export const UNLINK_KIND_LABELS: Record<ClientUnlinkKind, [string, string]> = {
  fsReports: ["financial statement report", "financial statement reports"],
};

/** "124 purchase records". */
export const deleteLine = (kind: ClientDeleteKind, count: number): string =>
  `${count} ${DELETE_KIND_LABELS[kind][count === 1 ? 0 : 1]}`;
/** "1 financial statement report, kept and unlinked". */
export const unlinkLine = (kind: ClientUnlinkKind, count: number): string =>
  `${count} ${UNLINK_KIND_LABELS[kind][count === 1 ? 0 : 1]}, kept and unlinked`;

export const DELETED_NOTE = "Client deleted.";
export const FILES_NOT_REMOVED_NOTE =
  "Some stored files could not be removed. They are listed in the server log.";
export const CANNOT_UNDO = "This cannot be undone. Type the client's name to confirm:";
/** Where the Portal keeps the last opened client (AppShell's workspace nav). */
export const ACTIVE_CLIENT_KEY = "mcrc.activeClientId";
