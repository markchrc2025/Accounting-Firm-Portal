import { z } from "zod";

/** `GET /bir-forms?clientId=` — optional firm-scoped client filter. */
export const ListBirFormsQuerySchema = z.object({
  clientId: z.string().uuid().optional(),
});
export type ListBirFormsQuery = z.infer<typeof ListBirFormsQuerySchema>;

/** Raw form field values (the engine's FilingData; validated per-form at compute). */
const FilingDataSchema = z.record(z.unknown());

export const CreateBirFormSchema = z.object({
  clientId: z.string().uuid(),
  form: z.string().min(1),
  period: z.string().default(""),
  data: FilingDataSchema.default({}),
});
export type CreateBirFormInput = z.infer<typeof CreateBirFormSchema>;

export const UpdateBirFormSchema = z
  .object({
    period: z.string().optional(),
    status: z.enum(["draft", "filed"]).optional(),
    data: FilingDataSchema.optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: "At least one field is required",
  });
export type UpdateBirFormInput = z.infer<typeof UpdateBirFormSchema>;

/** `POST /bir-forms/compute` — authoritative live preview without saving. */
export const ComputeBirFormSchema = z.object({
  form: z.string().min(1),
  data: FilingDataSchema.default({}),
});
export type ComputeBirFormInput = z.infer<typeof ComputeBirFormSchema>;
