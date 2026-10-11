/**
 * drive-key.ts — the Portal's Google Drive robot: its service-account key, read
 * from GOOGLE_SERVICE_ACCOUNT_JSON in the API service's environment (U14 R1, D51).
 *
 * The key is never logged, returned, committed, audited or sent to a browser; only
 * its client_email may be shown. It is read as pasted — pretty-printed, or with its
 * line breaks stripped by a single-line field — or as base64, with one pair of
 * wrapping quotes tolerated. The PEM is re-wrapped so a key whose line breaks were
 * lost still loads.
 */
import { createPrivateKey, type KeyObject } from "node:crypto";

export const KEY_UNREADABLE = "The key in GOOGLE_SERVICE_ACCOUNT_JSON could not be read.";

export interface RobotKey {
  clientEmail: string;
  privateKey: KeyObject;
}

/** The variable's value as JSON text, whichever way it was pasted; null if none. */
function jsonText(raw: string): string | null {
  let text = raw.trim();
  const q = text[0];
  if (text.length >= 2 && (q === '"' || q === "'") && text.endsWith(q)) {
    text = text.slice(1, -1).trim();
  }
  if (text.startsWith("{")) return text;
  const decoded = Buffer.from(text.replace(/\s+/g, ""), "base64").toString("utf8").trim();
  return decoded.startsWith("{") ? decoded : null;
}

/** JSON.parse, and again with raw line breaks escaped (a key pasted with its "\n"
 *  sequences turned into real line breaks inside the private_key string). */
function parseJson(text: string): Record<string, unknown> | null {
  for (const t of [text, text.replace(/\r?\n/g, "\\n")]) {
    try {
      const v: unknown = JSON.parse(t);
      if (v && typeof v === "object" && !Array.isArray(v))
        return v as Record<string, unknown>;
    } catch {
      // try the next form
    }
  }
  return null;
}

/** A PEM rebuilt from its base64 body, however its line breaks arrived. */
function normalizePem(pem: string): string | null {
  const flat = pem.replace(/\\n/g, "\n");
  const m = /-----BEGIN ([A-Z ]*PRIVATE KEY)-----([\s\S]*?)-----END \1-----/.exec(flat);
  if (!m) return null;
  const body = m[2]!.replace(/\s+/g, "");
  const lines = body.match(/.{1,64}/g) ?? [];
  return `-----BEGIN ${m[1]}-----\n${lines.join("\n")}\n-----END ${m[1]}-----\n`;
}

/**
 * The robot's key from the variable's value: null when the variable is empty or
 * absent; { problem } when it is present but cannot be read.
 */
export function readRobotKey(
  raw: string | undefined,
): { key: RobotKey } | { problem: string } | null {
  if (!raw || !raw.trim()) return null;
  const text = jsonText(raw);
  const json = text ? parseJson(text) : null;
  const email = json?.client_email;
  const pem =
    typeof json?.private_key === "string" ? normalizePem(json.private_key) : null;
  if (typeof email !== "string" || !email.includes("@") || !pem) {
    return { problem: KEY_UNREADABLE };
  }
  try {
    const privateKey = createPrivateKey(pem);
    if (privateKey.asymmetricKeyType !== "rsa") return { problem: KEY_UNREADABLE };
    return { key: { clientEmail: email, privateKey } };
  } catch {
    return { problem: KEY_UNREADABLE };
  }
}
