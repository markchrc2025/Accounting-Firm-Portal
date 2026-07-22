import { z } from "zod";

/** A permission string "Resource:Action" (validated against the FIRM catalog). */
const PermissionString = z.string().regex(/^[A-Za-z]+:[A-Za-z]+$/, "Invalid permission");

export const CreateRoleSchema = z.object({
  name: z.string().min(1).max(60),
  permissions: z.array(PermissionString).default([]),
});
export type CreateRoleInput = z.infer<typeof CreateRoleSchema>;

export const UpdateRoleSchema = z
  .object({
    name: z.string().min(1).max(60).optional(),
    permissions: z.array(PermissionString).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: "At least one field is required",
  });
export type UpdateRoleInput = z.infer<typeof UpdateRoleSchema>;
