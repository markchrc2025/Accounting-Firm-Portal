import { z } from "zod";

export const TemplateQuerySchema = z.object({
  clientId: z.string().uuid(),
});
export type TemplateQuery = z.infer<typeof TemplateQuerySchema>;

export const ImportQuerySchema = z.object({
  clientId: z.string().uuid(),
  dryRun: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
});
export type ImportQuery = z.infer<typeof ImportQuerySchema>;
