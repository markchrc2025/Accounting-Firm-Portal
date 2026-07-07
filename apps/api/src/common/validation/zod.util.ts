import { BadRequestException } from "@nestjs/common";
import type { ZodTypeAny, infer as ZodInfer } from "zod";

/**
 * Parse `data` with a Zod schema, throwing a 400 with structured issues on
 * failure. Lets services validate against the frozen @portal/shared schemas
 * directly (no re-declaration) while surfacing clean API errors. Generic over
 * the schema so effects/defaults (input ≠ output) resolve to the OUTPUT type.
 */
export function parseOrBadRequest<S extends ZodTypeAny>(
  schema: S,
  data: unknown,
): ZodInfer<S> {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw new BadRequestException({
      message: "Validation failed",
      errors: result.error.issues.map((i) => ({
        path: i.path.join("."),
        message: i.message,
      })),
    });
  }
  return result.data;
}
