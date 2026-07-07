import { BadRequestException, PipeTransform } from "@nestjs/common";
import type { ZodTypeAny, infer as ZodInfer } from "zod";

/**
 * Validates/parses a request payload against a Zod schema. Portal request
 * validation uses Zod (per project conventions); the frozen @portal/shared
 * package stays contract-only, so these schemas live in the API.
 *
 * Generic over the schema so schemas with defaults/transforms (input ≠ output)
 * resolve to their OUTPUT type.
 *
 * Usage: `@Body(new ZodValidationPipe(LoginSchema)) body: LoginInput`
 */
export class ZodValidationPipe<S extends ZodTypeAny> implements PipeTransform<
  unknown,
  ZodInfer<S>
> {
  constructor(private readonly schema: S) {}

  transform(value: unknown): ZodInfer<S> {
    const result = this.schema.safeParse(value);
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
}
