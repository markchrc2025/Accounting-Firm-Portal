// keys.ts: issue keys (PAY-12) in free text, and the ones a message closes.
//
// An issue key is 2 to 10 capital letters or digits starting with a letter, a dash, and a
// number from 1 to 9999999 with no leading zero: PAY-12, BKS-7, A1-300. The edge cases are
// listed in README.md; each one has a test.

export interface KeyOptions {
  /**
   * Accept lower and mixed case (`pay-12`, `Pay-12`) and return the key in capitals. Off by
   * default: a key must be written in capitals, so "explain-3" or "utf-8" are never keys.
   * Turn it on for branch names (`feature/pay-12-login`), where people write lower case.
   */
  ignoreCase?: boolean;
  /**
   * The project keys that exist (`["PAY", "BKS"]`). When given, only keys of these projects
   * are returned and the built-in list of look-alike prefixes is not used. Compared in
   * capitals.
   */
  projectKeys?: readonly string[];
}

/**
 * Prefixes of well-known identifiers that have the shape of an issue key: UTF-8, SHA-256,
 * ISO-8601, COVID-19, CWE-79. Skipped unless `projectKeys` says which keys are real.
 */
export const LOOKALIKE_PREFIXES: readonly string[] = [
  "AES",
  "CAPEC",
  "COVID",
  "CVE",
  "CWE",
  "GMT",
  "HTTP",
  "IPV",
  "ISO",
  "MD",
  "RFC",
  "RSA",
  "SARS",
  "SHA",
  "SSL",
  "TLS",
  "UTC",
  "UTF",
];

export interface KeyHit {
  key: string;
  /** Index of the first character in the text. */
  start: number;
  /** Index after the last character. */
  end: number;
}

const STRICT = /(?<![A-Za-z0-9_])[A-Z][A-Z0-9]{1,9}-[1-9][0-9]{0,6}(?![A-Za-z0-9_])/g;
const LOOSE =
  /(?<![A-Za-z0-9_])[A-Za-z][A-Za-z0-9]{1,9}-[1-9][0-9]{0,6}(?![A-Za-z0-9_])/g;
const URL_SPAN = /(?:https?:\/\/|www\.)[^\s<>"'`]+/gi;

/** Where each key sits, with the rules of README.md applied. Shared by both exported functions. */
export function scanIssueKeys(text: string, options: KeyOptions = {}): KeyHit[] {
  const urls = [...text.matchAll(URL_SPAN)].map((m) => ({
    from: m.index!,
    to: m.index! + m[0].length,
  }));
  const allowed = options.projectKeys
    ? new Set(options.projectKeys.map((k) => k.toUpperCase()))
    : null;
  const lookalike = new Set(LOOKALIKE_PREFIXES);
  const hits: KeyHit[] = [];

  for (const m of text.matchAll(options.ignoreCase ? LOOSE : STRICT)) {
    const start = m.index!;
    const end = start + m[0].length;
    const before = text.slice(Math.max(0, start - 2), start);
    const after = text.slice(end, end + 2);

    if (/^-\d/.test(after)) continue; // CVE-2024-1234, ABC-12-34: a longer number
    if (/^\.[A-Za-z0-9]/.test(after)) continue; // ABC-1.5, PAY-12.md, PAY-12.example.com
    if (after[0] === "@" || before.endsWith("@")) continue; // an e-mail address
    if (/[A-Z0-9]-$/.test(before)) continue; // ISO-IEC-27001: a hyphenated name, not a key

    const url = urls.find((u) => start >= u.from && start < u.to);
    if (url) {
      // In a link only a whole path segment counts: /browse/PAY-12 yes, ?ref=PAY-12 or /PAY-12-slug no.
      const next = end === url.to ? "" : text[end]!;
      const closesSentence = next === "." && end + 1 === url.to;
      if (
        text[start - 1] !== "/" ||
        !(next === "" || closesSentence || "/?#),;]".includes(next))
      )
        continue;
    }

    const key = m[0].toUpperCase();
    const prefix = key.slice(0, key.indexOf("-"));
    if (allowed) {
      if (!allowed.has(prefix)) continue;
    } else if (lookalike.has(prefix)) {
      continue;
    }
    hits.push({ key, start, end });
  }
  return hits;
}

/** Every issue key in the text, unique, in order of first appearance. */
export function extractIssueKeys(text: string, options: KeyOptions = {}): string[] {
  return [...new Set(scanIssueKeys(text, options).map((h) => h.key))];
}

/**
 * The words GitHub closes an issue on: close, closes, closed, fix, fixes, fixed, resolve,
 * resolves, resolved (any case).
 */
export const CLOSING_KEYWORDS: readonly string[] = [
  "close",
  "closes",
  "closed",
  "fix",
  "fixes",
  "fixed",
  "resolve",
  "resolves",
  "resolved",
];

const KEYWORD =
  /(?<![A-Za-z0-9_])(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)(?![A-Za-z0-9_])/gi;
const AFTER_KEYWORD = /^(?::[ \t]*|[ \t]+)/;
const BETWEEN_KEYS =
  /^(?:[ \t]*,[ \t]*(?:and[ \t]+)?|[ \t]+and[ \t]+|[ \t]*&[ \t]*|[ \t]+)/i;

/**
 * The keys a message closes: a closing keyword, an optional colon, then a key. A list after
 * one keyword closes all of it ("fixes PAY-3, PAY-4 and PAY-5"). A list ends at a full stop,
 * a new line or any other word. Unique, in order of first appearance.
 */
export function closingKeys(text: string, options: KeyOptions = {}): string[] {
  const hits = scanIssueKeys(text, options);
  const byStart = new Map(hits.map((h) => [h.start, h]));
  const out: string[] = [];
  for (const k of text.matchAll(KEYWORD)) {
    let pos = k.index! + k[0].length;
    const gap = AFTER_KEYWORD.exec(text.slice(pos));
    if (!gap) continue;
    pos += gap[0].length;
    for (let hit = byStart.get(pos); hit;) {
      if (!out.includes(hit.key)) out.push(hit.key);
      pos = hit.end;
      const sep = BETWEEN_KEYS.exec(text.slice(pos));
      hit = sep ? byStart.get(pos + sep[0].length) : undefined;
      if (hit && sep) pos += sep[0].length;
    }
  }
  return out;
}
