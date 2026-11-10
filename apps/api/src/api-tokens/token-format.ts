// token-format.ts — PA3 (D67): the shape of a personal API token and how it is hashed. Pure.
//
// A token is "ppt_" and 43 URL-safe characters (256 bits of randomness). Only its SHA-256 is
// stored; the token itself exists in the response that makes it and nowhere after that.
import { createHash, randomBytes } from "node:crypto";

export const TOKEN_PREFIX = "ppt_";
const TOKEN_RE = /^ppt_[A-Za-z0-9_-]{43}$/;
/** How many leading characters are kept visible, so a person can tell their tokens apart. */
export const VISIBLE_PREFIX_LENGTH = 10;

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function generateToken(): { token: string; hash: string; prefix: string } {
  const token = TOKEN_PREFIX + randomBytes(32).toString("base64url");
  return { token, hash: hashToken(token), prefix: token.slice(0, VISIBLE_PREFIX_LENGTH) };
}

/** True only for the exact shape of a token, so nothing else is ever looked up. */
export function looksLikeToken(value: string): boolean {
  return TOKEN_RE.test(value);
}

/** The value of an `Authorization: Bearer <value>` header, or undefined. */
export function parseBearer(header?: string): string | undefined {
  if (!header) return undefined;
  const parts = header.split(" ");
  if (parts.length !== 2) return undefined;
  const [scheme, value] = parts;
  return scheme?.toLowerCase() === "bearer" && value ? value : undefined;
}
