import { z } from "zod";

/** Sender streams used by the transactional-email system. */
export const EMAIL_STREAMS = [
  "invites",
  "hello",
  "team",
  "noReply",
  "notifications",
  "esign",
  "billing",
] as const;
export type EmailStreamKey = (typeof EMAIL_STREAMS)[number];

const optionalEmail = z.string().email().or(z.literal("")).optional();

/** PUT /firm-settings/email — every field optional; "" clears an override. */
export const UpdateEmailSettingsSchema = z
  .object({
    supportEmail: optionalEmail,
    fromName: z.string().max(120).optional(),
    buttonAccent: z.enum(["navy", "gold"]).optional(),
    showBrandLockup: z.boolean().optional(),
    senders: z
      .object(
        Object.fromEntries(EMAIL_STREAMS.map((s) => [s, optionalEmail])) as Record<
          EmailStreamKey,
          typeof optionalEmail
        >,
      )
      .partial()
      .optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "At least one field is required" });
export type UpdateEmailSettingsInput = z.infer<typeof UpdateEmailSettingsSchema>;
