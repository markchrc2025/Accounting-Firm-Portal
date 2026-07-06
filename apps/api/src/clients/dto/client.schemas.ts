import { z } from "zod";

export const ClientTaxType = z.enum(["VAT", "PERCENTAGE"]);

export const CreateClientSchema = z.object({
  businessName: z.string().min(1),
  tin: z.string().optional(),
  address: z.string().optional(),
  taxType: ClientTaxType.optional(),
  currency: z.string().length(3).default("PHP"),
  seatLimit: z.number().int().min(3).default(3), // FR-17: minimum 3 seats
});
export type CreateClientInput = z.infer<typeof CreateClientSchema>;

export const UpdateClientSchema = z
  .object({
    businessName: z.string().min(1).optional(),
    tin: z.string().optional(),
    address: z.string().optional(),
    taxType: ClientTaxType.optional(),
    currency: z.string().length(3).optional(),
    seatLimit: z.number().int().min(3).optional(),
    status: z.enum(["ACTIVE", "ARCHIVED"]).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: "At least one field is required",
  });
export type UpdateClientInput = z.infer<typeof UpdateClientSchema>;
