import { z } from "zod";

/** Self-service profile update — a user may edit their own display name. */
export const UpdateProfileSchema = z.object({
  fullName: z.string().min(1, "Full name is required"),
});
export type UpdateProfileInput = z.infer<typeof UpdateProfileSchema>;
