import { z } from "zod";

const intQuery = (min: number, max: number, dflt: number) =>
  z
    .string()
    .regex(/^\d+$/)
    .optional()
    .transform((v) => (v === undefined ? dflt : Math.min(max, Math.max(min, Number(v)))));

/** unread-first: unread ones on top, then the rest, each newest first. newest: plain newest first. */
export const NotificationListQuerySchema = z.object({
  order: z.enum(["unread-first", "newest"]).default("unread-first"),
  page: intQuery(1, 100000, 1),
  pageSize: intQuery(1, 100, 25),
});
export type NotificationListQuery = z.infer<typeof NotificationListQuerySchema>;

export const NotificationPreferencesSchema = z.object({ emailEnabled: z.boolean() });
