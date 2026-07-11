import { z } from "zod";

/**
 * Service is a Portal-internal, firm-scoped entity (the firm's service-offering
 * catalog). It is NOT part of the frozen Portal⇄Generator contract, so its
 * validation lives here rather than in @portal/shared. `linkedForm` is a free
 * FormCode string (or null); the ATC/rate contract is owned by the Generator.
 */
export const BillingMethod = z.enum(["Quarterly", "Monthly", "As Filing"]);
export type BillingMethod = z.infer<typeof BillingMethod>;

export const ServiceStatus = z.enum(["Active", "Retired"]);
export type ServiceStatus = z.infer<typeof ServiceStatus>;

export const CreateServiceSchema = z.object({
  name: z.string().min(1),
  description: z.string().default(""),
  defaultFee: z.number().nonnegative(),
  billingMethod: BillingMethod,
  linkedForm: z.string().min(1).nullish(),
  status: ServiceStatus.default("Active"),
});
export type CreateServiceInput = z.infer<typeof CreateServiceSchema>;

export const UpdateServiceSchema = z
  .object({
    name: z.string().min(1).optional(),
    description: z.string().optional(),
    defaultFee: z.number().nonnegative().optional(),
    billingMethod: BillingMethod.optional(),
    linkedForm: z.string().min(1).nullish(),
    status: ServiceStatus.optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: "At least one field is required",
  });
export type UpdateServiceInput = z.infer<typeof UpdateServiceSchema>;
