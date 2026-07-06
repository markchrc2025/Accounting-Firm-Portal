import { z } from "zod";

export const CreateUserSchema = z.object({
  email: z.string().email(),
  fullName: z.string().min(1),
  password: z.string().min(8),
  title: z.string().optional(),
  employeeId: z.string().optional(),
  /** Firm role names to grant (e.g. "Accountant"). */
  roleNames: z.array(z.string().min(1)).default([]),
});
export type CreateUserInput = z.infer<typeof CreateUserSchema>;

export const UpdateUserSchema = z
  .object({
    fullName: z.string().min(1).optional(),
    status: z.enum(["ACTIVE", "DISABLED"]).optional(),
    title: z.string().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: "At least one field is required",
  });
export type UpdateUserInput = z.infer<typeof UpdateUserSchema>;

export const SetRolesSchema = z.object({
  roleNames: z.array(z.string().min(1)),
});
export type SetRolesInput = z.infer<typeof SetRolesSchema>;

export const AssignClientsSchema = z.object({
  clientIds: z.array(z.string().uuid()),
});
export type AssignClientsInput = z.infer<typeof AssignClientsSchema>;
