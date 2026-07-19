import { z } from "zod";

const zDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use yyyy-mm-dd");
const zCode = z.string().regex(/^\d{4}$|^\d{7}$/, "Account code must be 4 or 7 digits");
const zMoney = z.number().finite();

export const PeriodSchema = z.object({
  label: z.string().min(1),
  endDate: zDate,
  periodType: z.enum(["FY", "Interim"]).optional(),
});

/** Create an FS report with 1–5 comparative periods. Entity facts are typed in
 *  (no client-profile wiring yet). */
export const CreateReportSchema = z.object({
  entityName: z.string().min(1),
  secRegistrationNo: z.string().optional(),
  registeredAddress: z.string().optional(),
  businessDescription: z.string().optional(),
  framework: z.string().optional(),
  functionalCurrency: z.string().optional(),
  approvalDate: zDate.optional(),
  authorizedShares: z.number().int().positive().optional(),
  issuedShares: z.number().int().positive().optional(),
  parValue: z.number().positive().optional(),
  periods: z.array(PeriodSchema).min(1).max(5),
});
export type CreateReportInput = z.infer<typeof CreateReportSchema>;

export const UpdateReportSchema = z
  .object({
    entityName: z.string().min(1).optional(),
    secRegistrationNo: z.string().optional(),
    registeredAddress: z.string().optional(),
    businessDescription: z.string().optional(),
    framework: z.string().optional(),
    functionalCurrency: z.string().optional(),
    approvalDate: zDate.nullable().optional(),
    authorizedShares: z.number().int().positive().nullable().optional(),
    issuedShares: z.number().int().positive().nullable().optional(),
    parValue: z.number().positive().nullable().optional(),
    status: z.enum(["draft", "final"]).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "Provide at least one field." });

/** Export options (§D), all optional — defaults: formal, comparative when a
 *  prior period exists, zero rows suppressed. */
export const ExportOptionsSchema = z.object({
  presentation: z.enum(["formal", "detailed"]).optional(),
  comparative: z.enum(["true", "false"]).optional(),
  suppressZero: z.enum(["true", "false"]).optional(),
});
export type ExportOptionsInput = z.infer<typeof ExportOptionsSchema>;
export type UpdateReportInput = z.infer<typeof UpdateReportSchema>;

/** Replace the report's period configuration (1–5). Removed periods drop their
 *  trial-balance rows. */
export const SetPeriodsSchema = z.object({ periods: z.array(PeriodSchema).min(1).max(5) });
export type SetPeriodsInput = z.infer<typeof SetPeriodsSchema>;

/** Replace one period's trial balance. Amounts are signed debit-positive. */
export const SetTrialBalanceSchema = z.object({
  entries: z.array(z.object({ accountCode: zCode, amount: zMoney })),
});
export type SetTrialBalanceInput = z.infer<typeof SetTrialBalanceSchema>;

/** A workpaper adjustment: ≥2 lines, each a single-sided debit or credit, and
 *  the whole entry must balance (Σdebit = Σcredit). */
export const CreateAdjustmentSchema = z.object({
  periodId: z.string().uuid(),
  memo: z.string().optional(),
  lines: z
    .array(
      z
        .object({
          accountCode: zCode,
          debit: z.number().nonnegative().optional(),
          credit: z.number().nonnegative().optional(),
        })
        .refine((l) => (l.debit ?? 0) > 0 !== ((l.credit ?? 0) > 0), {
          message: "Each line is exactly one of debit or credit.",
        }),
    )
    .min(2),
});
export type CreateAdjustmentInput = z.infer<typeof CreateAdjustmentSchema>;

/** Toggle/override a policy note block. */
export const SetPolicyNoteSchema = z
  .object({
    included: z.boolean().optional(),
    title: z.string().min(1).optional(),
    body: z.string().min(1).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "Provide at least one field." });
export type SetPolicyNoteInput = z.infer<typeof SetPolicyNoteSchema>;

export const AddCustomNoteSchema = z.object({
  title: z.string().min(1).optional(),
  body: z.string().min(1),
});
export type AddCustomNoteInput = z.infer<typeof AddCustomNoteSchema>;

export const UpdateCustomNoteSchema = z
  .object({
    title: z.string().min(1).optional(),
    body: z.string().min(1).optional(),
    included: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "Provide at least one field." });
export type UpdateCustomNoteInput = z.infer<typeof UpdateCustomNoteSchema>;
