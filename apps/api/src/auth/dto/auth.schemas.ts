import { z } from "zod";

export const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});
export type LoginInput = z.infer<typeof LoginSchema>;

export const MfaVerifySchema = z.object({
  mfaToken: z.string().min(1),
  code: z.string().min(6).max(10),
});
export type MfaVerifyInput = z.infer<typeof MfaVerifySchema>;

export const MfaConfirmSchema = z.object({
  code: z.string().min(6).max(10),
});
export type MfaConfirmInput = z.infer<typeof MfaConfirmSchema>;

/** U9 R1 b: turning two-factor off (re-enrolling or disabling) needs a current code. */
export const MfaCurrentCodeSchema = z.object({
  code: z.string().min(6).max(10).optional(),
});
export type MfaCurrentCodeInput = z.infer<typeof MfaCurrentCodeSchema>;
