// client-ref.ts — U20b (D61): finding a client from what the owner says. A name (registered
// name, trade name or business name), or a TIN, matched exactly after case, punctuation and
// extra spaces are set aside. The Portal's own client search (ClientsService.listForFirm)
// matches the business name only, by "contains"; this is a separate, exact resolver, so the
// connector never picks a client the owner did not name.
export interface ClientRow {
  id: string;
  businessName: string;
  regName: string | null;
  tradeName: string | null;
  tin: string | null;
  status: string;
}

/** Lower-case, punctuation to spaces, one space between words. */
export function normalizeName(s: string | null | undefined): string {
  return (s ?? "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/** The nine digits of a TIN typed with or without dashes (a TIN with its branch counts by its first nine); null if it is not one. */
export function tinOf(ref: string | null | undefined): string | null {
  const t = (ref ?? "").replace(/[\s.-]/g, "");
  return /^\d+$/.test(t) && [9, 12, 14].includes(t.length) ? t.slice(0, 9) : null;
}

export type ClientMatch = { by: "tin" | "name"; rows: ClientRow[] };

/** Every client the reference names, exactly: by TIN if it is one, otherwise by any of its names. */
export function matchClients(rows: ClientRow[], ref: string): ClientMatch {
  const tin = tinOf(ref);
  if (tin) {
    return { by: "tin", rows: rows.filter((r) => tinOf(r.tin ?? "") === tin) };
  }
  const want = normalizeName(ref);
  if (want === "") return { by: "name", rows: [] };
  return {
    by: "name",
    rows: rows.filter((r) =>
      [r.regName, r.tradeName, r.businessName].some((n) => normalizeName(n) === want),
    ),
  };
}

export const NEAR_LIMIT = 10;

/**
 * U20c: when nothing matches exactly, the clients the owner may have meant. A client is a
 * near match when ONE of its names (registered, trade or business) holds every word given,
 * after the same folding as the exact match; or, if the reference is only digits (dashes,
 * dots and spaces set aside), when its TIN starts with them (three or more digits, fewer
 * than a whole TIN). Returns the first ten by name and how many matched in all.
 */
export function nearMatches(
  rows: ClientRow[],
  ref: string,
): { rows: ClientRow[]; total: number } {
  const folded = normalizeName(ref);
  if (folded === "") return { rows: [], total: 0 };
  const words = folded.split(" ");
  const digits = ref.replace(/[\s.-]/g, "");
  const prefix = /^\d{3,8}$/.test(digits) ? digits : null;
  const hit = rows.filter((r) => {
    const names = [r.regName, r.tradeName, r.businessName].map(normalizeName);
    if (names.some((n) => n !== "" && words.every((w) => n.includes(w)))) return true;
    return prefix !== null && (r.tin ?? "").replace(/[\s.-]/g, "").startsWith(prefix);
  });
  hit.sort((a, b) => {
    const x = normalizeName(a.businessName);
    const y = normalizeName(b.businessName);
    return x < y ? -1 : x > y ? 1 : 0;
  });
  return { rows: hit.slice(0, NEAR_LIMIT), total: hit.length };
}

export const dashed = (tin9: string) =>
  `${tin9.slice(0, 3)}-${tin9.slice(3, 6)}-${tin9.slice(6, 9)}`;

/** An option in "Which client do you mean?": name, TIN and status; an inactive client is flagged. */
export function optionText(c: ClientRow): string {
  const tin = tinOf(c.tin ?? "");
  const status = c.status === "ACTIVE" ? "ACTIVE" : `${c.status} (inactive)`;
  return `${c.businessName} — TIN ${tin ? dashed(tin) : "none on file"} — ${status}`;
}
