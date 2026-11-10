// github.ts: checks that a webhook delivery really came from GitHub.
import { createHmac, timingSafeEqual } from "node:crypto";

const SIGNATURE = /^sha256=([0-9a-fA-F]{64})$/;

/**
 * Checks the `X-Hub-Signature-256` header of a GitHub webhook delivery.
 *
 * `rawBody` must be the request body exactly as it arrived (the bytes, not a parsed and
 * re-serialised object). `header` is the header's value, `sha256=` and 64 hex digits.
 * Returns false, and never throws, for a missing, repeated or malformed header, an old
 * `sha1=` header, an empty secret, a body that is not bytes, or a signature that does not
 * match. The comparison takes the same time wherever the two signatures differ.
 */
export function verifyGithubSignature(
  rawBody: Uint8Array,
  header: string | string[] | null | undefined,
  secret: string | Uint8Array,
): boolean {
  if (typeof header !== "string") return false;
  const match = SIGNATURE.exec(header);
  if (!match) return false;
  if (!ArrayBuffer.isView(rawBody)) return false;
  // An empty secret signs anything, so a hook that was never configured must not pass.
  if (secret.length === 0) return false;
  try {
    const expected = createHmac("sha256", secret).update(rawBody).digest();
    const given = Buffer.from(match[1]!, "hex");
    return given.length === expected.length && timingSafeEqual(given, expected);
  } catch {
    return false;
  }
}
