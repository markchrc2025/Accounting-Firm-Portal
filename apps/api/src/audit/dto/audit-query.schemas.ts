import { z } from "zod";

/**
 * Firm-facing audit-log list filters (FR-32). All optional: `actor` and
 * `entity` are case-insensitive substring matches, `action` is an exact match,
 * and `from`/`to` are ISO date/datetime bounds on the entry timestamp. The
 * query never exposes raw metadata; it is a read-only, firm-scoped view.
 */
export const AuditQuerySchema = z.object({
  actor: z.string().optional(),
  action: z.string().optional(),
  entity: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
});
export type AuditQuery = z.infer<typeof AuditQuerySchema>;
