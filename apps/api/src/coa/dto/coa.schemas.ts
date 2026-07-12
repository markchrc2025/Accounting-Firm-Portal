import { z } from "zod";
import { COA_CLASSES } from "../coa-import";

const zClass = z.enum(COA_CLASSES);
const zCode = z
  .string()
  .regex(/^\d{4}$|^\d{7}$/, "Code must be 4 digits (top-level) or 7 digits (sub-account)");

/** Create a posting account. Currency is always PHP; the normal balance and
 *  parent group are derived server-side. For a P&L account, taxReturnLine seeds
 *  its BIR mapping in the same call (required by coverage validation unless the
 *  code is in the allowed-unmapped set). */
export const CreateAccountSchema = z.object({
  code: zCode,
  name: z.string().min(1),
  class: zClass,
  accountType: z.string().min(1),
  /** Optional parent group/account code (blank = top-level). Must resolve to an
   *  existing account or group header — enforced by chart validation. */
  parentCode: zCode.optional(),
  description: z.string().optional(),
  monthlyMovement: z.boolean().optional(),
  taxReturnLine: z.string().min(1).optional(),
});
export type CreateAccountInput = z.infer<typeof CreateAccountSchema>;

/** Update an account (code is immutable — archive and recreate to renumber). */
export const UpdateAccountSchema = z
  .object({
    name: z.string().min(1).optional(),
    class: zClass.optional(),
    accountType: z.string().min(1).optional(),
    description: z.string().optional(),
    monthlyMovement: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "Provide at least one field." });
export type UpdateAccountInput = z.infer<typeof UpdateAccountSchema>;

export const SetMappingSchema = z.object({ taxReturnLine: z.string().min(1) });
export type SetMappingInput = z.infer<typeof SetMappingSchema>;
