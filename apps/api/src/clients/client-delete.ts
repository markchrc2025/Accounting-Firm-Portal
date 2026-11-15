/**
 * client-delete.ts — U25 (D72): the words of a client delete. The kinds are @portal/shared's
 * lists; the sentences live here, once, and the web shows them word for word.
 */
import type { ClientDeleteBlockerKind } from "@portal/shared";
import { registeredName } from "../bir-forms/engine/certificate2307";

/** The 400 when confirmName is not the client's name. */
export const NAME_MISMATCH = "Type the client's name exactly to delete it.";

/** The 404 for a client outside the caller's firm (the clients module's own words). */
export const CLIENT_NOT_FOUND = "Client not found";

const PHRASES: Record<ClientDeleteBlockerKind, [one: string, many: string]> = {
  filedBirReturns: ["filed BIR return", "filed BIR returns"],
  sentInvoices: ["sent invoice", "sent invoices"],
  billedForInvoices: [
    "invoice billed for it under another client",
    "invoices billed for it under another client",
  ],
  linkedProjects: ["linked project", "linked projects"],
  subClients: ["sub-client billed under it", "sub-clients billed under it"],
};

/** "3 filed BIR returns". */
export function blockerPhrase(kind: ClientDeleteBlockerKind, count: number): string {
  const [one, many] = PHRASES[kind];
  return `${count} ${count === 1 ? one : many}`;
}

/** One sentence naming every blocker: "a", "a and b", "a, b and c". */
export function refusalSentence(
  blockers: { kind: ClientDeleteBlockerKind; count: number }[],
): string {
  const parts = blockers.map((b) => blockerPhrase(b.kind, b.count));
  const list =
    parts.length <= 1
      ? (parts[0] ?? "")
      : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
  return `This client cannot be deleted: it has ${list}. Archive it instead.`;
}

/** Case folded, and every run of white space one space, trimmed. */
export function foldName(name: unknown): string {
  return (typeof name === "string" ? name : "").trim().replace(/\s+/g, " ").toLowerCase();
}

/** The name the owner types: the BIR registered name (as a certificate prints it), else the
 *  client's name in the Portal when the registered name's fields are empty. */
export function nameToType(client: {
  kind?: string | null;
  regName?: string | null;
  lastName?: string | null;
  firstName?: string | null;
  middleName?: string | null;
  businessName: string;
}): string {
  return registeredName(client) || client.businessName.trim();
}
