import { z } from "zod";

/** Self-service profile update — a user may edit their own display name. */
export const UpdateProfileSchema = z.object({
  fullName: z.string().min(1, "Full name is required"),
});
export type UpdateProfileInput = z.infer<typeof UpdateProfileSchema>;

/** Self-service login-email change — re-authenticates with the current password. */
export const ChangeEmailSchema = z.object({
  newEmail: z.string().email("Enter a valid email address"),
  currentPassword: z.string().min(1, "Your current password is required"),
});
export type ChangeEmailInput = z.infer<typeof ChangeEmailSchema>;
