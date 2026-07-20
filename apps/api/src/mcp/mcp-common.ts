// Shared plumbing for the MCP tool handlers (read + write): result envelopes,
// tool annotations, and error normalization. Every tool reports failures
// in-band (`isError: true`) with an actionable message — never a protocol
// error, never a stack trace.

import { HttpException } from "@nestjs/common";
import { z } from "zod/v3";

/** Successful tool result: pretty JSON text + the same object structured. */
export function ok(data: Record<string, unknown>) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
    structuredContent: data,
  };
}

/** Failed tool result with an actionable message (never throws at the client). */
export function fail(message: string) {
  return {
    content: [{ type: "text" as const, text: `Error: ${message}` }],
    isError: true as const,
  };
}

export const READ_ONLY = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};

/** Pure create: adds a row, repeat calls add more rows. */
export const WRITE_CREATE = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false,
};

/** Mutates existing data (update/delete/status change). */
export const WRITE_MUTATE = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: false,
  openWorldHint: false,
};

/** Mutation where repeating the same call is a no-op (e.g. re-archiving). */
export const WRITE_MUTATE_IDEMPOTENT = { ...WRITE_MUTATE, idempotentHint: true };

export const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD")
  .describe("Calendar date, YYYY-MM-DD");

/** True when `iso` (YYYY-MM-DD) is a real calendar date (no 2026-02-30). */
export function isRealDate(iso: string): boolean {
  const d = new Date(`${iso}T00:00:00.000Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === iso;
}

/** Today's date (UTC) as YYYY-MM-DD — the same convention `@db.Date` uses. */
export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Normalize any thrown error to one actionable line. Nest HttpExceptions
 * carry the service-layer message (and Zod issue list for validation
 * failures); everything else falls back to its message. Internals (stacks,
 * SQL) are never included.
 */
export function errMsg(err: unknown): string {
  if (err instanceof HttpException) {
    const res = err.getResponse();
    if (typeof res === "string") return res;
    const o = res as { message?: unknown; errors?: { path?: string; message?: string }[] };
    const base = typeof o.message === "string" ? o.message : err.message;
    if (Array.isArray(o.errors) && o.errors.length > 0) {
      const details = o.errors
        .map((e) => (e.path ? `${e.path}: ${e.message ?? ""}` : (e.message ?? "")))
        .join("; ");
      return `${base} — ${details}`;
    }
    return base;
  }
  return err instanceof Error ? err.message : String(err);
}
