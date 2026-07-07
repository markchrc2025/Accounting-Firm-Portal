import { z } from "zod";

/**
 * Category is a Portal-internal entity (not part of the frozen Portal⇄Generator
 * contract), so its validation lives here rather than in @portal/shared.
 * CategoryType mirrors the structural Prisma enum — it is NOT a tax classifier.
 */
export const CategoryType = z.enum(["INCOME", "EXPENSE"]);
export type CategoryType = z.infer<typeof CategoryType>;

export const CreateCategorySchema = z.object({
  type: CategoryType,
  name: z.string().min(1),
  isDeductible: z.boolean().default(true),
});
export type CreateCategoryInput = z.infer<typeof CreateCategorySchema>;

/** `type` is immutable after creation (it binds the category to a txn table). */
export const UpdateCategorySchema = z
  .object({
    name: z.string().min(1).optional(),
    isDeductible: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: "At least one field is required",
  });
export type UpdateCategoryInput = z.infer<typeof UpdateCategorySchema>;

export const CategoryListQuerySchema = z.object({
  type: CategoryType.optional(),
  search: z.string().optional(),
});
export type CategoryListQuery = z.infer<typeof CategoryListQuerySchema>;
