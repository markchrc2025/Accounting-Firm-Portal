// The Claude connector card's view of GET /mcp-connector (M1 R3, D41 amendment):
// who issued the link in use and who Claude acts as. The base shape and the
// fetch/rotate/disable calls stay in lib/api.ts; this file only adds the fields
// M1 put on the same response, and the sentences the card shows for them.
import type { McpConnector } from "./api";
import { filedDate } from "./birFiling";

export interface McpPerson {
  name: string;
  email: string;
}

/** GET /mcp-connector (and the rotate/disable responses) since M1. */
export interface McpConnectorStatus extends McpConnector {
  /** Who issued the link in use; null for the server's environment link, or when off. */
  issuedBy?: McpPerson | null;
  issuedAt?: string | null;
  /** Who connector writes act as; null when no one does (then actingProblem says why). */
  actingAs?: McpPerson | null;
  actingProblem?: string | null;
}

/** What to do when no one is acting (R3). */
export const ROTATE_AS_ADVICE =
  "Rotate the link while signed in as the Super Admin Claude should act as.";

export interface ActingLines {
  /** "Issued by A on Oct 11, 2026. Claude acts as A." — or the parts that apply. */
  summary: string | null;
  /** When no one is acting: the refusal sentence, as a write would refuse. */
  problem: string | null;
  /** When no one is acting: ROTATE_AS_ADVICE. */
  advice: string | null;
}

/** The card's sentences for a connector status. Nothing while the connector is off. */
export function actingLines(c: McpConnectorStatus | undefined): ActingLines {
  if (!c?.enabled) return { summary: null, problem: null, advice: null };
  const parts: string[] = [];
  if (c.issuedBy) {
    const on = c.issuedAt ? ` on ${filedDate(c.issuedAt)}` : "";
    parts.push(`Issued by ${c.issuedBy.name}${on}.`);
  }
  if (c.actingAs) parts.push(`Claude acts as ${c.actingAs.name}.`);
  const nobody = !c.actingAs;
  return {
    summary: parts.length > 0 ? parts.join(" ") : null,
    problem: nobody ? (c.actingProblem ?? null) : null,
    advice: nobody ? ROTATE_AS_ADVICE : null,
  };
}
