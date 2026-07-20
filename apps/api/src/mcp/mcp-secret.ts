// Capability-URL gate for the MCP endpoint (pure, unit-tested).
//
// The MCP route is /api/v1/mcp/<key>. The expected key comes from the
// MCP_SHARED_SECRET env var (Sliplane), NEVER from code — guardrail #6. The
// endpoint is disabled entirely (404) unless the secret is set and long enough
// to be unguessable, so a fresh deploy without the env var exposes nothing.

import { createHash, timingSafeEqual } from "crypto";

/** Refuse to serve with a weak secret — 32+ chars (~190 bits base64). */
export const MCP_SECRET_MIN_LENGTH = 32;

/** The endpoint only exists when a strong shared secret is configured. */
export function mcpEnabled(expected: string | undefined): boolean {
  return typeof expected === "string" && expected.length >= MCP_SECRET_MIN_LENGTH;
}

/**
 * Constant-time key check. Hashing both sides first normalizes length so
 * `timingSafeEqual` never throws and comparison time leaks nothing.
 */
export function mcpKeyMatches(provided: string, expected: string | undefined): boolean {
  if (!mcpEnabled(expected) || !provided) return false;
  const a = createHash("sha256").update(provided).digest();
  const b = createHash("sha256").update(expected as string).digest();
  return timingSafeEqual(a, b);
}
