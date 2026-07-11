import { z } from "zod";

export const ClientTaxType = z.enum(["VAT", "PERCENTAGE"]);

export const ClientKind = z.enum(["individual", "non-individual"]);

/** How the firm bills the client for its services (Portal-only engagement field). */
export const BillingMethod = z.enum(["QUARTERLY", "MONTHLY", "AS_FILING"]);

/** One registration line from the BIR COR "Tax Types" table. */
export const TaxTypeRow = z.object({
  type: z.string().default(""),
  form: z.string().default(""),
  frequency: z.string().default(""),
  startDate: z.string().optional(),
});
export type TaxTypeRow = z.infer<typeof TaxTypeRow>;

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD");

/**
 * The BIR filer profile (mirrors Sentire's Add Filer) shared by create/update.
 * All optional here — required-ness (a company needs regName, an individual a
 * last name) is not enforced structurally so drafts and partial COR auto-fills
 * are accepted; businessName remains the one hard requirement on create.
 */
const filerFields = {
  tin: z.string().optional(),
  address: z.string().optional(),
  taxType: ClientTaxType.optional(),

  kind: ClientKind.optional(),
  regName: z.string().optional(),
  lastName: z.string().optional(),
  firstName: z.string().optional(),
  middleName: z.string().optional(),
  tradeName: z.string().optional(),
  branch: z.string().optional(),
  rdo: z.string().optional(),
  rdoName: z.string().optional(),
  city: z.string().optional(),
  province: z.string().optional(),
  region: z.string().optional(),
  zip: z.string().optional(),
  // Accept "" as well as a valid date so an edit can CLEAR the field (the service
  // maps "" → null). Same pattern as `email` below.
  birthdate: isoDate.optional().or(z.literal("")),
  incorpDate: isoDate.optional().or(z.literal("")),
  email: z.string().email().optional().or(z.literal("")),
  phone: z.string().optional(),
  citizenship: z.string().optional(),
  civilStatus: z.string().optional(),
  taxpayerType: z.string().optional(),
  classification: z.string().optional(),
  taxTypes: z.array(TaxTypeRow).optional(),

  // Firm-only engagement fields (never exported to the BIR Generator).
  professionalFee: z.number().nonnegative().optional(),
  billingMethod: BillingMethod.optional(),
};

export const CreateClientSchema = z.object({
  businessName: z.string().min(1),
  currency: z.string().length(3).default("PHP"),
  seatLimit: z.number().int().min(3).default(3), // FR-17: minimum 3 seats
  ...filerFields,
});
export type CreateClientInput = z.infer<typeof CreateClientSchema>;

export const UpdateClientSchema = z
  .object({
    businessName: z.string().min(1).optional(),
    currency: z.string().length(3).optional(),
    seatLimit: z.number().int().min(3).optional(),
    status: z.enum(["ACTIVE", "ARCHIVED"]).optional(),
    ...filerFields,
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: "At least one field is required",
  });
export type UpdateClientInput = z.infer<typeof UpdateClientSchema>;
