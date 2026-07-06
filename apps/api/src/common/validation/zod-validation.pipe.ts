import { BadRequestException, PipeTransform } from "@nestjs/common";
import type { ZodSchema } from "zod";

/**
 * Validates/parses a request payload against a Zod schema. Portal request
 * validation uses Zod (per project conventions); the frozen @portal/shared
 * package stays contract-only, so these schemas live in the API.
 *
 * Usage: `@Body(new ZodValidationPipe(LoginSchema)) body: LoginInput`
 */
export class ZodValidationPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodSchema<T>) {}

  transform(value: unknown): T {
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
