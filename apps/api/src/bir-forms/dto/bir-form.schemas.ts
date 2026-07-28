import { z } from "zod";

/** `GET /bir-forms?clientId=` — optional firm-scoped client filter. */
export const ListBirFormsQuerySchema = z.object({
  clientId: z.string().uuid().optional(),
});
export type ListBirFormsQuery = z.infer<typeof ListBirFormsQuerySchema>;
